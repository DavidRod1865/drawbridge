import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawing, createDrawingUpload, updateDrawingRevision } from './procore.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

interface Captured {
  requests: CapturedRequest[];
}

/** Captures every outgoing request without hitting the network. */
function captureFetch(status: number): Captured {
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers as Record<string, string>) ?? {};
    requests.push({
      url,
      headers,
      payload: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    if (status >= 200 && status < 300) {
      return new Response('{"id":1}', {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{"errors":"boom"}', { status });
  }) as typeof fetch;
  return { requests };
}

test('registers with a single JSON POST nesting drawing_log_imports', async () => {
  const cap = captureFetch(200);
  await createDrawingUpload(1, 44, 43, [
    { uploadUuid: 'UUID-1', drawingDate: '2026-05-28T12:00:00Z', title: 'PLAN', revisionNumber: '2' },
    { uploadUuid: 'UUID-2', drawingDate: '2026-05-29T12:00:00Z' },
  ]);

  assert.equal(cap.requests.length, 1);
  assert.match(cap.requests[0]!.url, /\/api\/procore\/v1\.1\/projects\/1\/drawing_uploads$/);

  const wrapper = cap.requests[0]!.payload as { drawing_upload: Record<string, unknown> };
  const du = wrapper.drawing_upload;
  assert.equal(du.drawing_area_id, 44);
  assert.equal(du.drawing_set_id, 43);

  const imports = du.drawing_log_imports as Record<string, unknown>[];
  assert.equal(imports.length, 2);
  assert.deepEqual(imports[0], {
    upload_uuid: 'UUID-1',
    drawing_date: '2026-05-28T12:00:00Z',
    title: 'PLAN',
    revision_number: '2',
  });
  // Optional fields absent from the entry must be omitted, never sent as null (which
  // would blank Procore's OCR result).
  assert.deepEqual(imports[1], {
    upload_uuid: 'UUID-2',
    drawing_date: '2026-05-29T12:00:00Z',
  });
});

test('sends a JSON content-type', async () => {
  const cap = captureFetch(200);
  await createDrawingUpload(1, 44, 43, [{ uploadUuid: 'UUID-1', drawingDate: '2026-05-28T12:00:00Z' }]);
  assert.equal(cap.requests[0]!.headers['content-type'], 'application/json');
});

test('includes drawing_id + default_revision for the direct (no-review) path', async () => {
  const cap = captureFetch(200);
  await createDrawingUpload(1, 44, 43, [
    { uploadUuid: 'UUID-1', drawingDate: '2026-05-28T12:00:00Z', drawingId: 987, defaultRevision: '3' },
  ]);

  const wrapper = cap.requests[0]!.payload as { drawing_upload: Record<string, unknown> };
  const entry = (wrapper.drawing_upload.drawing_log_imports as Record<string, unknown>[])[0]!;
  assert.equal(entry.drawing_id, 987);
  assert.equal(entry.default_revision, '3');
});

test('createDrawing POSTs the nested drawing_discipline shape to the area endpoint', async () => {
  const cap = captureFetch(200);
  await createDrawing(44, { number: 'M-101', title: 'PLAN', disciplineName: 'Mechanical' });

  assert.match(cap.requests[0]!.url, /\/api\/procore\/v1\.0\/drawing_areas\/44\/drawings$/);
  const payload = cap.requests[0]!.payload as { drawing: Record<string, unknown> };
  assert.deepEqual(payload.drawing, {
    number: 'M-101',
    title: 'PLAN',
    // discipline is an object nested INSIDE drawing — a sibling/id/string is rejected.
    drawing_discipline: { name: 'Mechanical' },
  });
});

test('carries an idempotency token', async () => {
  const cap = captureFetch(200);
  await createDrawingUpload(1, 44, 43, [{ uploadUuid: 'UUID-1', drawingDate: '2026-05-28T12:00:00Z' }]);
  assert.ok(cap.requests[0]!.headers['idempotency-token']);
});

test('a failure propagates to the caller', async () => {
  captureFetch(500);
  await assert.rejects(
    createDrawingUpload(1, 44, 43, [{ uploadUuid: 'UUID-1', drawingDate: '2026-05-28T12:00:00Z' }]),
  );
});

// ---------------------------------------------------------- updateDrawingRevision

/**
 * Captures a single JSON (not multipart) request, for the PATCH endpoint verified in
 * the 2026-07-21 sandbox probe.
 */
function captureJsonFetch(status: number): { requests: { url: string; method: string; payload: unknown }[] } {
  const requests: { url: string; method: string; payload: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      payload: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (status >= 200 && status < 300) {
      return new Response('{"id":9}', { status, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{"errors":"boom"}', { status });
  }) as typeof fetch;
  return { requests };
}

test('updateDrawingRevision PATCHes the verified v1.0 path with a nested-only body', async () => {
  const cap = captureJsonFetch(200);

  await updateDrawingRevision(1, 9, {
    drawingDate: '2026-05-28',
    receivedDate: '2026-05-29',
    revisionNumber: '3',
  });

  assert.equal(cap.requests.length, 1);
  const req = cap.requests[0]!;
  assert.equal(req.method, 'PATCH');
  assert.match(req.url, /\/api\/procore\/v1\.0\/projects\/1\/drawing_revisions\/9$/);

  const payload = req.payload as Record<string, unknown>;
  // Nested-only: top-level attributes are silently ignored by this endpoint (verified
  // in sandbox), so sending them would be dead weight that looks like it worked.
  assert.equal(payload.drawing_date, undefined);
  assert.equal(payload.received_date, undefined);
  assert.equal(payload.revision_number, undefined);

  const nested = payload.drawing_revision as Record<string, unknown>;
  assert.equal(nested.drawing_date, '2026-05-28');
  assert.equal(nested.received_date, '2026-05-29');
  assert.equal(nested.revision_number, '3');
});
