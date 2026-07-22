import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { configurePdfWorker, extractPage, parseFile } from './pdf.ts';

// Node resolves the worker from node_modules; the browser gets a bundled asset URL.
configurePdfWorker(import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs'));

/**
 * Builds a landscape drawing package with a title block in the bottom-right corner,
 * mimicking the layout the parser keys off.
 */
async function buildPackage(sheets: { number: string; title: string }[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const sheet of sheets) {
    const page = doc.addPage([1224, 792]); // 34x22in at 36dpi, a common sheet ratio
    // Body content, well away from the title block.
    page.drawText('SEE A-501 FOR DETAILS', { x: 80, y: 700, size: 12, font });
    page.drawText('GENERAL NOTES', { x: 80, y: 660, size: 12, font });
    // Title block, hard bottom-right. Coordinates mirror a real package measured
    // from docs/: title around y≈0.90 of page height, sheet number at y≈0.96, both
    // at x≈0.92 — the synthetic fixture originally sat too far left to be realistic.
    page.drawText('SHEET NO', { x: 1130, y: 70, size: 10, font });
    page.drawText(sheet.title, { x: 1130, y: 50, size: 10, font });
    page.drawText(sheet.number, { x: 1130, y: 24, size: 14, font });
  }

  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

test('parses a multi-page package into one sheet per page', async () => {
  const data = await buildPackage([
    { number: 'A-101', title: 'FIRST FLOOR PLAN' },
    { number: 'A-102', title: 'SECOND FLOOR PLAN' },
    { number: 'S-201', title: 'FOUNDATION PLAN' },
  ]);

  const sheets = await parseFile(data, 'package.pdf');

  assert.equal(sheets.length, 3);
  assert.deepEqual(
    sheets.map((s) => s.sheetNumber),
    ['A-101', 'A-102', 'S-201'],
  );
  assert.equal(sheets[0]?.pageIndex, 0);
  assert.equal(sheets[2]?.discipline, 'Structural');
  assert.ok(!sheets[0]?.needsOcr);
});

test('picks the title block number over the body callout', async () => {
  // Every page contains 'SEE A-501' in the body; none should be read as A-501.
  const data = await buildPackage([{ number: 'A-101', title: 'FIRST FLOOR PLAN' }]);
  const [sheet] = await parseFile(data, 'one.pdf');

  assert.equal(sheet?.sheetNumber, 'A-101');
  assert.ok((sheet?.confidence ?? 0) > 0.5, `expected high confidence, got ${sheet?.confidence}`);
});

test('reads the sheet title from the title block', async () => {
  const data = await buildPackage([{ number: 'A-101', title: 'FIRST FLOOR PLAN' }]);
  const [sheet] = await parseFile(data, 'one.pdf');
  assert.equal(sheet?.title, 'FIRST FLOOR PLAN');
});

test('extractPage yields a standalone single-page PDF', async () => {
  const data = await buildPackage([
    { number: 'A-101', title: 'FIRST FLOOR PLAN' },
    { number: 'A-102', title: 'SECOND FLOOR PLAN' },
  ]);

  const pageBytes = await extractPage(data, 1);
  const extracted = pageBytes.buffer.slice(
    pageBytes.byteOffset,
    pageBytes.byteOffset + pageBytes.byteLength,
  ) as ArrayBuffer;

  // The split page must contain exactly one sheet, and it must be the right one:
  // an off-by-one here would file every sheet under its neighbour's number.
  const sheets = await parseFile(extracted, 'split.pdf');
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0]?.sheetNumber, 'A-102');
});

test('a page with no text is flagged for OCR rather than guessed at', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([1224, 792]); // deliberately blank, like a scanned sheet
  const bytes = await doc.save();
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const [sheet] = await parseFile(data, 'scan.pdf');
  assert.equal(sheet?.needsOcr, true);
  assert.equal(sheet?.sheetNumber, null);
});
