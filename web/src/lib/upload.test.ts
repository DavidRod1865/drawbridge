import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUpload, type SheetProgress, type UploadDeps } from './upload.ts';
import type { PlannedSheet } from './validation.ts';
import type { DrawingLogImport } from './procore.ts';
import { ProcoreApiError } from './api.ts';

function sheet(id: string, number: string): PlannedSheet {
  return {
    id,
    sourceFile: 'package.pdf',
    folder: 'Mechanical',
    pageIndex: Number(id.at(-1) ?? 0),
    sheetNumber: number,
    title: `${number} TITLE`,
    discipline: 'Mechanical',
    revision: '0',
    drawingDate: '2026-05-28',
    receivedDate: '2026-05-29',
    drawingAreaId: 7,
    confidence: 0.95,
    needsOcr: false,
  };
}

interface Recorder {
  deps: UploadDeps;
  calls: string[];
  filesUploaded: string[];
  registeredUuids: string[];
  registeredImports: DrawingLogImport[];
  createdDrawings: { number: string; title?: string; disciplineName: string }[];
}

function recorder(overrides: Partial<UploadDeps> = {}): Recorder {
  const calls: string[] = [];
  const filesUploaded: string[] = [];
  const registeredUuids: string[] = [];
  const registeredImports: DrawingLogImport[] = [];
  const createdDrawings: { number: string; title?: string; disciplineName: string }[] = [];

  const deps: UploadDeps = {
    createProjectUpload: async (_project, filename) => {
      calls.push(`createProjectUpload:${filename}`);
      return { uuid: `uuid-${filename}`, url: 'https://s3.example/put' };
    },
    putFile: async (_upload, _bytes, filename) => {
      calls.push(`putFile:${filename}`);
      filesUploaded.push(filename);
    },
    createDrawing: async (_area, drawing) => {
      calls.push(`createDrawing:${drawing.number}`);
      createdDrawings.push(drawing);
      // Deterministic id derived from creation order, for assertions.
      return { id: 5000 + createdDrawings.length };
    },
    createDrawingUpload: async (_project, _area, _set, imports) => {
      calls.push(`createDrawingUpload:${imports.length}`);
      registeredImports.push(...imports);
      registeredUuids.push(...imports.map((entry) => entry.uploadUuid));
      return { id: 1 };
    },
    pageBytes: async () => new Uint8Array([1, 2, 3]),
    ...overrides,
  };

  return { deps, calls, filesUploaded, registeredUuids, registeredImports, createdDrawings };
}

const request = (sheets: PlannedSheet[], previous?: Map<string, SheetProgress>) => ({
  projectId: 1,
  drawingSetId: 2,
  drawingAreaId: 7,
  sheets,
  concurrency: 1, // deterministic ordering for assertions
  ...(previous ? { previous } : {}),
});

test('uploads each file, creates its Drawing, then registers the batch once', async () => {
  const rec = recorder();
  const result = await runUpload(request([sheet('a', 'M-101')]), rec.deps);

  assert.deepEqual(rec.calls, [
    'createProjectUpload:M-101.pdf',
    'putFile:M-101.pdf',
    'createDrawing:M-101',
    'createDrawingUpload:1',
  ]);
  assert.equal(result.uploaded, 1);
  assert.equal(result.failed, 0);
});

test('creates a Drawing per new sheet and assigns the revision to it (direct path)', async () => {
  const rec = recorder();
  await runUpload(request([sheet('a', 'M-101')]), rec.deps);

  assert.deepEqual(rec.createdDrawings, [
    { number: 'M-101', title: 'M-101 TITLE', disciplineName: 'Mechanical' },
  ]);
  // The import references the created Drawing and supplies default_revision.
  assert.equal(rec.registeredImports[0]!.drawingId, 5001);
  assert.equal(rec.registeredImports[0]!.defaultRevision, '0');
});

test('reuses an existing drawing_id for a revision instead of creating a Drawing', async () => {
  const rec = recorder();
  await runUpload(
    { ...request([sheet('a', 'M-101')]), existingDrawingIdBySheetId: new Map([['a', 7788]]) },
    rec.deps,
  );

  assert.deepEqual(rec.createdDrawings, [], 'must not create a Drawing for an existing sheet');
  assert.equal(rec.registeredImports[0]!.drawingId, 7788);
});

test('a new sheet with no discipline routes through OCR (no Drawing, no drawing_id)', async () => {
  const noDiscipline = { ...sheet('a', 'M-101'), discipline: null };
  const rec = recorder();
  await runUpload(request([noDiscipline]), rec.deps);

  assert.deepEqual(rec.createdDrawings, []);
  assert.equal(rec.registeredImports[0]!.drawingId, undefined);
  assert.equal(rec.registeredImports[0]!.defaultRevision, undefined);
});

test('a failed Drawing creation fails only that sheet, keeping the uuid for retry', async () => {
  const rec = recorder({
    createDrawing: async () => {
      throw new Error('discipline rejected');
    },
  });
  const result = await runUpload(request([sheet('a', 'M-101')]), rec.deps);

  assert.equal(result.failed, 1);
  assert.match(result.progress.get('a')!.error!, /discipline rejected/);
  // Bytes stay in storage so a retry re-creates the Drawing without re-uploading.
  assert.equal(result.progress.get('a')!.uploadUuid, 'uuid-M-101.pdf');
  // Nothing was registered (the sheet dropped out before the batch call).
  assert.ok(!rec.calls.some((c) => c.startsWith('createDrawingUpload')));
});

test('registers the whole batch in a single call', async () => {
  const rec = recorder();
  await runUpload(request([sheet('a', 'M-101'), sheet('b', 'M-102')]), rec.deps);
  const batch = rec.calls.filter((c) => c.startsWith('createDrawingUpload'));
  assert.deepEqual(batch, ['createDrawingUpload:2']);
});

test('registers the uploaded uuids', async () => {
  const rec = recorder();
  await runUpload(request([sheet('a', 'M-101')]), rec.deps);
  assert.deepEqual(rec.registeredUuids, ['uuid-M-101.pdf']);
});

test('one failing upload does not stop the others', async () => {
  const rec = recorder({
    putFile: async (_u, _b, filename) => {
      if (filename === 'M-102.pdf') throw new Error('network died');
    },
  });
  const result = await runUpload(
    request([sheet('a', 'M-101'), sheet('b', 'M-102'), sheet('c', 'M-103')]),
    rec.deps,
  );
  assert.equal(result.uploaded, 2);
  assert.equal(result.failed, 1);
  assert.match(result.progress.get('b')!.error!, /network died/);
});

test('a retry does not re-upload a file already in storage', async () => {
  const first = recorder({
    createDrawingUpload: async () => {
      throw new Error('registration blip');
    },
  });
  const attempt1 = await runUpload(request([sheet('a', 'M-101')]), first.deps);
  assert.equal(attempt1.progress.get('a')!.uploadUuid, 'uuid-M-101.pdf');

  const second = recorder();
  await runUpload(request([sheet('a', 'M-101')], attempt1.progress), second.deps);
  assert.deepEqual(second.filesUploaded, [], 'file must not be re-uploaded');
  assert.ok(second.calls.includes('createDrawingUpload:1'), 'registration is retried');
});

test('a failed batch registration keeps uuids so a retry re-registers only', async () => {
  const rec = recorder({
    createDrawingUpload: async () => {
      throw new Error('500 Internal Server Error');
    },
  });
  const result = await runUpload(request([sheet('a', 'M-101')]), rec.deps);
  assert.match(result.registrationError!, /500/);
  assert.equal(result.failed, 1);
  assert.equal(result.progress.get('a')!.uploadUuid, 'uuid-M-101.pdf');
});

test('never exceeds the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const rec = recorder({
    putFile: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    },
  });
  const sheets = Array.from({ length: 9 }, (_, i) => sheet(`s${i}`, `M-10${i}`));
  await runUpload({ ...request(sheets), concurrency: 3 }, rec.deps);
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit of 3`);
});

test('nothing is registered when every upload fails', async () => {
  const rec = recorder({ putFile: async () => { throw new Error('offline'); } });
  const result = await runUpload(request([sheet('a', 'M-101')]), rec.deps);
  assert.ok(!rec.calls.some((c) => c.startsWith('createDrawingUpload')));
  assert.equal(result.uploaded, 0);
});

test('carries each sheet\'s metadata to createDrawingUpload as ISO datetimes', async () => {
  const rec = recorder();
  await runUpload(request([sheet('a', 'M-101')]), rec.deps);

  assert.equal(rec.registeredImports.length, 1);
  assert.deepEqual(rec.registeredImports[0], {
    uploadUuid: 'uuid-M-101.pdf',
    // yyyy-mm-dd from the sheet becomes a noon-UTC ISO datetime for this endpoint.
    drawingDate: '2026-05-28T12:00:00Z',
    receivedDate: '2026-05-29T12:00:00Z',
    title: 'M-101 TITLE',
    revisionNumber: '0',
    // This sheet has a discipline, so it takes the direct path: a Drawing is created
    // (id 5001) and the revision is assigned to it.
    drawingId: 5001,
    defaultRevision: '0',
  });
});

test('falls back to the received date when a sheet has no drawing date', async () => {
  const noDrawingDate = { ...sheet('a', 'M-101'), drawingDate: null };
  const rec = recorder();
  await runUpload(request([noDrawingDate]), rec.deps);

  // drawing_date is required by Procore; received date stands in rather than blocking.
  assert.equal(rec.registeredImports[0]!.drawingDate, '2026-05-29T12:00:00Z');
});

test('a >=500 ProcoreApiError from registration produces a friendly outage message', async () => {
  const rec = recorder({
    createDrawingUpload: async () => {
      throw new ProcoreApiError(503, 'Service Unavailable');
    },
  });
  const result = await runUpload(request([sheet('a', 'M-101')]), rec.deps);

  assert.match(result.registrationError!, /unavailable right now/);
  assert.match(result.registrationError!, /files are uploaded and safe/);
  assert.equal(result.failed, 1);
});

test('a non-5xx ProcoreApiError from registration keeps the raw message', async () => {
  const rec = recorder({
    createDrawingUpload: async () => {
      throw new ProcoreApiError(400, 'upload_uuids is invalid');
    },
  });
  const result = await runUpload(request([sheet('a', 'M-101')]), rec.deps);

  assert.match(result.registrationError!, /Procore API error 400/);
});
