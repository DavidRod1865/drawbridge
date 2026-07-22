/**
 * The upload queue.
 *
 * Per sheet:
 *   1. Create a Project Upload   (returns a presigned S3 destination + uuid)
 *   2. PUT/POST the bytes to S3  (browser -> S3 directly; never through our server)
 * then once for the whole batch:
 *   3. Create a Drawing Upload   (hands the uuids to Procore's Drawings tool)
 *
 * Procore OCRs the package and routes it to "Items to Review" — the drawing_id path
 * that would skip review 500s on Procore's side (a confirmed defect), so we do not use
 * it. That also removes the old Create-Drawing step, and with it the orphaned-drawing
 * problem entirely.
 *
 * Retry must not re-upload. Each sheet records its uploadUuid, so a retry that failed
 * only at the batch registration step re-registers without sending bytes again.
 */

import { extractPage } from './pdf.ts';
import type { PlannedSheet } from './validation.ts';
import type { DrawingLogImport, ProjectUpload } from './procore.ts';
import { ProcoreApiError } from './api.ts';

export type SheetPhase = 'pending' | 'uploading-file' | 'uploaded' | 'registered' | 'failed';

export interface SheetProgress {
  id: string;
  phase: SheetPhase;
  error?: string;
  /** Set once the file is in S3; carried across retries so bytes are not re-sent. */
  uploadUuid?: string;
  /**
   * The Drawing this sheet is assigned to (the direct/no-review path). Carried across
   * retries so a re-run reuses the Drawing instead of creating a duplicate — the mirror
   * of `uploadUuid`'s "don't repeat side effects" guarantee.
   */
  drawingId?: number;
}

export interface UploadDeps {
  createProjectUpload: (
    projectId: number,
    filename: string,
    size: number,
  ) => Promise<ProjectUpload>;
  putFile: (upload: ProjectUpload, bytes: Uint8Array, filename: string) => Promise<void>;
  /** Creates the parent Drawing (authoritative number/title/discipline) for a new sheet. */
  createDrawing: (
    areaId: number,
    drawing: { number: string; title?: string; disciplineName: string },
  ) => Promise<{ id: number }>;
  createDrawingUpload: (
    projectId: number,
    areaId: number,
    setId: number,
    imports: readonly DrawingLogImport[],
  ) => Promise<{ id: number }>;
  /** Yields the single-page PDF for a sheet. */
  pageBytes: (sheet: PlannedSheet) => Promise<Uint8Array>;
}

export interface UploadRequest {
  projectId: number;
  drawingSetId: number;
  drawingAreaId: number;
  sheets: readonly PlannedSheet[];
  /**
   * Existing Procore `drawing_id` per sheet, for sheets that are a new revision of a
   * drawing already in Procore. New sheets are absent here and get a Drawing created for
   * them. Keyed by `PlannedSheet.id`.
   */
  existingDrawingIdBySheetId?: ReadonlyMap<string, number>;
  /** Progress from a previous attempt, so a retry resumes instead of restarting. */
  previous?: ReadonlyMap<string, SheetProgress>;
  concurrency?: number;
  onProgress?: (progress: ReadonlyMap<string, SheetProgress>) => void;
  signal?: AbortSignal;
}

export interface UploadResult {
  progress: Map<string, SheetProgress>;
  uploaded: number;
  failed: number;
  /** Set when the batch registration call itself failed. */
  registrationError?: string;
}

/**
 * Sends bytes to the presigned destination.
 *
 * Procore returns either an S3 POST policy (url + fields, which must be sent as
 * multipart with the file last) or a plain PUT target. Both shapes are handled
 * because which one you get depends on the storage backend behind the project.
 */
export async function putFileToStorage(
  upload: ProjectUpload,
  bytes: Uint8Array,
  filename: string,
): Promise<void> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });

  if (upload.fields) {
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
    // S3 requires the file field last; earlier fields are policy metadata.
    form.append('file', blob, filename);

    const response = await fetch(upload.url, { method: 'POST', body: form });
    if (!response.ok) {
      throw new Error(`Storage rejected the file (${response.status})`);
    }
    return;
  }

  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`Storage rejected the file (${response.status})`);
  }
}

/**
 * Procore's drawing_uploads endpoint wants an ISO datetime; our sheets carry plain
 * `yyyy-mm-dd`. Anchor at noon UTC so the calendar date cannot shift a day across a
 * timezone. A value that already has a time component is passed through untouched.
 */
function toUploadDatetime(date: string): string {
  return date.includes('T') ? date : `${date}T12:00:00Z`;
}

/** Runs `worker` over `items`, at most `limit` at a time. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function runUpload(
  request: UploadRequest,
  deps: UploadDeps,
): Promise<UploadResult> {
  const {
    projectId,
    drawingSetId,
    drawingAreaId,
    sheets,
    existingDrawingIdBySheetId,
    previous,
    concurrency = 4,
    onProgress,
    signal,
  } = request;

  const progress = new Map<string, SheetProgress>();
  for (const sheet of sheets) {
    // Carry forward what a previous attempt achieved so retries resume mid-sheet.
    const prior = previous?.get(sheet.id);
    progress.set(sheet.id, {
      id: sheet.id,
      phase: prior?.phase === 'registered' ? 'registered' : 'pending',
      ...(prior?.uploadUuid === undefined ? {} : { uploadUuid: prior.uploadUuid }),
      ...(prior?.drawingId === undefined ? {} : { drawingId: prior.drawingId }),
    });
  }

  const report = () => onProgress?.(new Map(progress));
  const update = (id: string, patch: Partial<SheetProgress>) => {
    const current = progress.get(id);
    if (current) progress.set(id, { ...current, ...patch });
    report();
  };

  report();

  await pool(sheets, concurrency, async (sheet) => {
    if (signal?.aborted) return;

    const state = progress.get(sheet.id);
    // Already fully registered by an earlier attempt — re-uploading would duplicate.
    if (!state || state.phase === 'registered') return;

    try {
      if (state.uploadUuid === undefined) {
        update(sheet.id, { phase: 'uploading-file' });
        const bytes = await deps.pageBytes(sheet);
        const filename = `${sheet.sheetNumber ?? 'sheet'}.pdf`;
        const upload = await deps.createProjectUpload(projectId, filename, bytes.byteLength);
        await deps.putFile(upload, bytes, filename);
        update(sheet.id, { uploadUuid: upload.uuid });
      }

      update(sheet.id, { phase: 'uploaded' });
    } catch (cause) {
      update(sheet.id, {
        phase: 'failed',
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });

  const ready = sheets.filter((sheet) => progress.get(sheet.id)?.phase === 'uploaded');

  // Resolve the parent Drawing for each ready sheet — the direct/no-review path that keeps
  // our number/title/discipline authoritative instead of letting OCR re-derive them. Done
  // AFTER bytes are in S3 so a failure here never orphans a Drawing; the id is recorded so
  // a retry reuses it rather than creating a duplicate.
  for (const sheet of ready) {
    if (signal?.aborted) break;
    const state = progress.get(sheet.id)!;

    // A revision of a sheet already in Procore reuses that Drawing's id (passed in);
    // a prior attempt's created id is honored too.
    const existing = existingDrawingIdBySheetId?.get(sheet.id) ?? state.drawingId;
    if (existing !== undefined) {
      if (state.drawingId === undefined) update(sheet.id, { drawingId: existing });
      continue;
    }

    // A new sheet with both a number and a discipline gets a Drawing created so its
    // metadata is authoritative. Without a discipline we cannot create one, so it routes
    // through OCR instead (drawingId stays unset) — a deliberate fallback, not an error.
    if (sheet.sheetNumber && sheet.discipline) {
      try {
        const drawing = await deps.createDrawing(drawingAreaId, {
          number: sheet.sheetNumber,
          ...(sheet.title ? { title: sheet.title } : {}),
          disciplineName: sheet.discipline,
        });
        update(sheet.id, { drawingId: drawing.id });
      } catch (cause) {
        // Surface it rather than silently falling back to OCR, which would override the
        // metadata the user asked to be authoritative. Bytes stay in S3, so a retry
        // re-creates the Drawing without re-uploading.
        update(sheet.id, {
          phase: 'failed',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }

  // Hand every file still standing (Drawing resolved or OCR fallback) to the Drawings tool
  // in one call.
  const toRegister = ready.filter((sheet) => progress.get(sheet.id)?.phase === 'uploaded');

  let registrationError: string | undefined;
  if (toRegister.length > 0 && !signal?.aborted) {
    const imports = toRegister.map((sheet): DrawingLogImport => {
      const state = progress.get(sheet.id)!;
      // drawing_date is required by Procore. Fall back to the received date, then to
      // today's upload date, so a sheet with no parsed date still registers.
      const drawingDate =
        sheet.drawingDate ?? sheet.receivedDate ?? new Date().toISOString().slice(0, 10);
      return {
        uploadUuid: state.uploadUuid!,
        drawingDate: toUploadDatetime(drawingDate),
        ...(sheet.title ? { title: sheet.title } : {}),
        ...(sheet.revision ? { revisionNumber: sheet.revision } : {}),
        ...(sheet.receivedDate ? { receivedDate: toUploadDatetime(sheet.receivedDate) } : {}),
        // Direct/no-review assignment when we have a Drawing; default_revision (the new
        // revision's label) is required by Procore alongside drawing_id.
        ...(state.drawingId === undefined
          ? {}
          : { drawingId: state.drawingId, defaultRevision: sheet.revision || '0' }),
      };
    });

    try {
      await deps.createDrawingUpload(projectId, drawingAreaId, drawingSetId, imports);
      for (const sheet of toRegister) update(sheet.id, { phase: 'registered' });
    } catch (cause) {
      // 2026-07-21: Procore's sandbox drawing_uploads endpoint had an outage where every
      // payload 500'd, including previously-working ones. A 5xx here is much more likely
      // to be "Procore is down" than "our request is malformed" — say so plainly, since
      // the raw ProcoreApiError message is a Procore-internal error blob that doesn't
      // tell the user their files are safe and a retry won't duplicate them.
      registrationError =
        cause instanceof ProcoreApiError && cause.status >= 500
          ? "Procore's drawing registration service looks unavailable right now. Your " +
            'files are uploaded and safe — use Retry later; nothing will be re-uploaded.'
          : cause instanceof Error
            ? cause.message
            : String(cause);
      // Files are in storage but Procore has no drawing upload for them. Mark failed so
      // a retry re-registers; the uploadUuid and drawingId are kept so it will not
      // re-upload bytes or re-create the Drawing.
      for (const sheet of toRegister) {
        update(sheet.id, { phase: 'failed', error: `Registration failed: ${registrationError}` });
      }
    }
  }

  const all = [...progress.values()];
  return {
    progress,
    uploaded: all.filter((state) => state.phase === 'registered').length,
    failed: all.filter((state) => state.phase === 'failed').length,
    ...(registrationError === undefined ? {} : { registrationError }),
  };
}

/** Reads one sheet's page out of its source file, splitting lazily. */
export function pageBytesFrom(files: ReadonlyMap<string, File>) {
  return async (sheet: PlannedSheet): Promise<Uint8Array> => {
    const file = files.get(sheet.id);
    if (!file) throw new Error(`Source file for ${sheet.sourceFile} is no longer available`);
    // Read and split per sheet, never holding the whole package in memory at once.
    return extractPage(await file.arrayBuffer(), sheet.pageIndex);
  };
}
