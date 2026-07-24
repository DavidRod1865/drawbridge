/**
 * PDF text extraction and page splitting — all local, in the browser.
 *
 * Two libraries, two jobs:
 *   pdfjs-dist — reads text and positions (parsing)
 *   pdf-lib    — writes single-page documents (splitting)
 *
 * Splitting is required because `drawing_uploads` (see procore.ts) registers one
 * upload_uuid per sheet: a multi-page source PDF has to become N single-page uploads
 * before it reaches Procore's OCR, or OCR would read the whole file as one drawing.
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, TextItem as PdfTextItem } from 'pdfjs-dist/types/src/display/api';
import { PDFDocument } from 'pdf-lib';
import { pickSheetNumber, reconcile, type TextItem } from './sheetNumber.ts';
import { extractWithLlm, resetLlmCircuit } from './llmExtract.ts';

/**
 * The pdf.js worker is located differently per environment — Vite rewrites it to a
 * hashed asset URL, Node resolves it out of node_modules — so the caller supplies it
 * rather than this module guessing. That keeps parsing logic runnable under `node
 * --test` without a bundler.
 */
export function configurePdfWorker(workerSrc: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

export type PdfErrorKind = 'encrypted' | 'corrupt' | 'unknown';

export class PdfError extends Error {
  // Written out rather than using a parameter property: Node's type-stripping runs
  // these files directly in tests, and it cannot synthesize the implied assignment.
  readonly kind: PdfErrorKind;

  constructor(message: string, kind: PdfErrorKind) {
    super(message);
    this.kind = kind;
  }
}

export interface ParsedSheet {
  sourceFile: string;
  /** 0-based page index within the source file. */
  pageIndex: number;
  sheetNumber: string | null;
  title: string | null;
  discipline: string | null;
  /** 0..1 from the sheet-number scorer; 0 when nothing was found. */
  confidence: number;
  /** True when the page carried no extractable text and needs OCR. */
  needsOcr: boolean;
}

export async function loadDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  } catch (cause) {
    const name = (cause as { name?: string }).name;
    // Distinguish these so the review screen can tell the user what to actually do:
    // a password-protected file needs re-exporting, a corrupt one needs re-downloading.
    if (name === 'PasswordException') {
      throw new PdfError('PDF is password protected', 'encrypted');
    }
    if (name === 'InvalidPDFException') {
      throw new PdfError('PDF is corrupt or unreadable', 'corrupt');
    }
    throw new PdfError(String(cause), 'unknown');
  }
}

/**
 * Extracts positioned text for one page, normalized to 0..1 with y measured from the
 * top. `convertToViewportPoint` applies the page's rotation and flips PDF's
 * bottom-left origin to screen orientation, so a rotated landscape sheet still puts
 * its title block near (1, 1).
 */
async function extractTextItems(doc: PDFDocumentProxy, pageNumber: number): Promise<TextItem[]> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items: TextItem[] = [];
  for (const raw of content.items) {
    const item = raw as PdfTextItem;
    if (!item.str?.trim()) continue;

    const transform = item.transform as number[];
    const [px, py] = [transform[4] ?? 0, transform[5] ?? 0];
    const [vx, vy] = viewport.convertToViewportPoint(px, py);

    items.push({
      text: item.str,
      x: Math.min(1, Math.max(0, (vx ?? 0) / viewport.width)),
      y: Math.min(1, Math.max(0, (vy ?? 0) / viewport.height)),
    });
  }
  return items;
}

/**
 * Title block labels and stamp text that sit among the title fragments. The digit-run
 * rule catches permit and job numbers ('M01335738-S1') that get split away from their
 * own label and so carry no other marker.
 */
const TITLE_NOISE =
  /[#:]|\d{5,}|\bSHEET\s*(NO|NUMBER)\b|\b(PROJECT|DRAWN|CHECKED|SCALE|DATE|JOB|REV|DOB|NO\.)\b/;

/**
 * Reassembles the sheet title from the title block.
 *
 * Titles are split across several text items by the PDF producer — a real sheet
 * yielded 'MECHANICAL FLOOR' / 'PLAN' / '-' / '5TH FLOOR (THE' / 'KNOT)' as five
 * separate runs. Taking the longest single run therefore returns a fragment, or worse
 * the licensing boilerplate, which is longer than any real title.
 *
 * So: keep the narrow band between the stamp above and the sheet number below, drop
 * label noise, then rejoin in reading order (top-to-bottom, left-to-right).
 */
function pickTitle(items: readonly TextItem[], sheetNumber: string | null): string | null {
  const fragments = items
    .filter((item) => item.x > 0.85 && item.y > 0.85 && item.y < 0.95)
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter(
      (item) =>
        item.text.length >= 3 &&
        item.text !== sheetNumber &&
        /[A-Z]/.test(item.text) &&
        // Titles are set in caps; lowercase here means legal or descriptive prose.
        item.text === item.text.toUpperCase() &&
        !TITLE_NOISE.test(item.text),
    )
    // Bucket y so fragments on one visual line sort together, then left to right.
    .sort((a, b) => Math.round(a.y * 100) - Math.round(b.y * 100) || a.x - b.x);

  if (fragments.length === 0) return null;
  return fragments.map((f) => f.text).join(' ').replace(/\s+/g, ' ').trim();
}

/** Below this many characters, a page is effectively a scan and needs OCR. */
const OCR_TEXT_THRESHOLD = 20;

export async function parsePage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  sourceFile: string,
): Promise<ParsedSheet> {
  const items = await extractTextItems(doc, pageNumber);
  const characterCount = items.reduce((sum, item) => sum + item.text.trim().length, 0);

  if (characterCount < OCR_TEXT_THRESHOLD) {
    // A scanned sheet. OCR is wired in separately; flag rather than guess.
    return {
      sourceFile,
      pageIndex: pageNumber - 1,
      sheetNumber: null,
      title: null,
      discipline: null,
      confidence: 0,
      needsOcr: true,
    };
  }

  const match = pickSheetNumber(items);
  const heuristicTitle = pickTitle(items, match?.raw ?? null);

  // LLM first: every sheet is sent to the extractor (title-block corner only, so each call
  // is cheap), and `reconcile` lets the LLM answer win. The heuristic is the fallback —
  // used when the LLM returns nothing, errors, or the circuit breaker has tripped after a
  // rate limit (extractWithLlm then returns null). Costs nothing when no extractor exists.
  const llm = await extractWithLlm(items);
  const merged = reconcile({ match, title: heuristicTitle }, llm);

  return {
    sourceFile,
    pageIndex: pageNumber - 1,
    sheetNumber: merged.sheetNumber,
    title: merged.title,
    discipline: merged.discipline,
    confidence: merged.confidence,
    needsOcr: false,
  };
}

export async function parseFile(data: ArrayBuffer, sourceFile: string): Promise<ParsedSheet[]> {
  // Re-arm the LLM circuit breaker so a limit hit on a previous package doesn't keep the
  // LLM disabled for this one (a later upload, or a retry after the daily quota resets).
  resetLlmCircuit();
  const doc = await loadDocument(data);
  try {
    const sheets: ParsedSheet[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      sheets.push(await parsePage(doc, page, sourceFile));
    }
    return sheets;
  } finally {
    // pdf.js holds the worker's copy of the document until destroyed. Skipping this
    // is how a 200-sheet package exhausts memory.
    await doc.destroy();
  }
}

/**
 * Paints a page onto `canvas` at `scale` and reports the CSS-pixel box the caller should
 * lay the canvas out in.
 *
 * `scale` already folds in devicePixelRatio (the preview computes fitScale * zoom * DPR),
 * so the backing store is sized in device pixels for crisp text at any zoom, while the
 * returned width/height are the CSS pixels to display it at. Rendering — not CSS-scaling a
 * single bitmap — is what keeps a title block legible when the user zooms in to read it.
 *
 * The render is not cancellable here; the caller guards fast page-flipping by discarding a
 * resolved render whose sheet is no longer current.
 */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) throw new PdfError('Could not get a 2D canvas context', 'unknown');

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;

  // CSS size = device size / DPR. The caller passed DPR inside `scale`, so divide it back
  // out to get the layout box; the extra device pixels stay in the backing store.
  const dpr = window.devicePixelRatio || 1;
  return { width: canvas.width / dpr, height: canvas.height / dpr };
}

/**
 * Extracts one page as a standalone single-page PDF.
 *
 * Called lazily, one page at a time, immediately before that page is uploaded — a
 * large package must never have every split page resident at once.
 */
export async function extractPage(data: ArrayBuffer, pageIndex: number): Promise<Uint8Array> {
  const source = await PDFDocument.load(data, { ignoreEncryption: false });
  const target = await PDFDocument.create();
  const [copied] = await target.copyPages(source, [pageIndex]);
  if (!copied) throw new PdfError(`Page ${pageIndex + 1} not found`, 'corrupt');
  target.addPage(copied);
  return target.save();
}
