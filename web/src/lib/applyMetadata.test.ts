import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMetadataUpdates } from './applyMetadata.ts';
import type { DrawingRevision } from './procore.ts';
import type { PlannedSheet } from './validation.ts';

function sheet(overrides: Partial<PlannedSheet> = {}): PlannedSheet {
  return {
    id: overrides.sheetNumber ?? 'sheet-1',
    sourceFile: 'package.pdf',
    folder: 'Mechanical',
    pageIndex: 0,
    sheetNumber: 'M-105.00',
    title: 'MECHANICAL FLOOR PLAN',
    discipline: 'Mechanical',
    revision: '2',
    drawingDate: '2026-05-28',
    receivedDate: '2026-05-29',
    drawingAreaId: 10,
    confidence: 0.95,
    needsOcr: false,
    ...overrides,
  };
}

function revision(overrides: Partial<DrawingRevision> = {}): DrawingRevision {
  return {
    id: 1,
    drawing_id: 100,
    number: 'M105.00',
    title: 'MECHANICAL FLOOR PLAN',
    revision_number: '1',
    drawing_area: { id: 10 },
    drawing_set: { id: 5 },
    discipline: null,
    current: true,
    drawing_date: '2026-01-01',
    received_date: '2026-01-01',
    ...overrides,
  };
}

test('matches a sheet to its current revision across formatting differences', () => {
  // Sheet prints 'M-105.00' with separators; Procore's revision.number is 'M105.00'
  // without them. Same normalization validation.ts relies on.
  const [outcome] = planMetadataUpdates([sheet({ sheetNumber: 'M-105.00' })], [revision()]);

  assert.equal(outcome!.status, 'matched');
  if (outcome!.status === 'matched') {
    assert.equal(outcome!.revisionId, 1);
    assert.deepEqual(outcome!.update, {
      drawingDate: '2026-05-28',
      receivedDate: '2026-05-29',
      revisionNumber: '2',
    });
  }
});

test('a sheet number with no current revision in Procore is not-found', () => {
  const [outcome] = planMetadataUpdates(
    [sheet({ sheetNumber: 'M-105.00' })],
    [revision({ number: 'M-999' })],
  );
  assert.equal(outcome!.status, 'not-found');
});

test('a current revision with the same number in another area is not-found', () => {
  // The sheet targets area 10; the only same-number current revision is in area 20, so it
  // is a different drawing and must not be PATCHed.
  const [outcome] = planMetadataUpdates(
    [sheet({ sheetNumber: 'M-105.00', drawingAreaId: 10 })],
    [revision({ drawing_area: { id: 20 } })],
  );
  assert.equal(outcome!.status, 'not-found');
});

test('an existing but non-current revision does not count as a match', () => {
  // Confirming in the review queue always creates/promotes the current revision, so an
  // old superseded revision sharing the number must not be mistaken for it.
  const [outcome] = planMetadataUpdates(
    [sheet({ sheetNumber: 'M-105.00' })],
    [revision({ current: false })],
  );
  assert.equal(outcome!.status, 'not-found');
});

test('a sheet with no parsed sheet number is missing-data', () => {
  const [outcome] = planMetadataUpdates([sheet({ sheetNumber: null })], [revision()]);
  assert.equal(outcome!.status, 'missing-data');
});

test('a sheet with no drawing or received date is missing-data', () => {
  const [a] = planMetadataUpdates([sheet({ drawingDate: null })], [revision()]);
  const [b] = planMetadataUpdates([sheet({ receivedDate: null })], [revision()]);
  assert.equal(a!.status, 'missing-data');
  assert.equal(b!.status, 'missing-data');
});

test('a revision that already has our exact dates and label is already-applied, not re-sent', () => {
  const [outcome] = planMetadataUpdates(
    [sheet({ sheetNumber: 'M-105.00', revision: '2', drawingDate: '2026-05-28', receivedDate: '2026-05-29' })],
    [
      revision({
        revision_number: '2',
        drawing_date: '2026-05-28',
        received_date: '2026-05-29',
      }),
    ],
  );
  assert.equal(outcome!.status, 'already-applied');
  if (outcome!.status === 'already-applied') assert.equal(outcome!.revisionId, 1);
});

test('a revision matching the number but with different dates still needs a PATCH', () => {
  const [outcome] = planMetadataUpdates(
    [sheet({ sheetNumber: 'M-105.00', revision: '2', drawingDate: '2026-05-28', receivedDate: '2026-05-29' })],
    [revision({ revision_number: '2', drawing_date: '2026-05-01', received_date: '2026-05-29' })],
  );
  assert.equal(outcome!.status, 'matched');
});

test('plans independently for multiple sheets', () => {
  const outcomes = planMetadataUpdates(
    [sheet({ id: 'a', sheetNumber: 'M-105.00' }), sheet({ id: 'b', sheetNumber: null })],
    [revision()],
  );
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]!.status, 'matched');
  assert.equal(outcomes[1]!.status, 'missing-data');
});
