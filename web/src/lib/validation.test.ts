import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, validateSheets, type PlannedSheet } from './validation.ts';
import type { DrawingRevision } from './procore.ts';

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
    receivedDate: '2026-05-28',
    drawingAreaId: 10,
    confidence: 0.95,
    needsOcr: false,
    ...overrides,
  };
}

function existing(number: string, revisionNumber: string, areaId = 10): DrawingRevision {
  return {
    id: 1,
    drawing_id: 100,
    number,
    title: 'Existing',
    revision_number: revisionNumber,
    drawing_area: { id: areaId },
    drawing_set: { id: 5 },
    discipline: null,
    current: true,
    drawing_date: '2026-01-01',
    received_date: '2026-01-01',
  };
}

const verdictFor = (s: PlannedSheet, e: DrawingRevision[] = []) =>
  validateSheets([s], e).get(s.id)!;

test('a sheet absent from Procore is new', () => {
  assert.equal(verdictFor(sheet()).outcome, 'new');
});

test('a higher revision of an existing sheet is a revision', () => {
  assert.equal(verdictFor(sheet(), [existing('M-105.00', '1')]).outcome, 'revision');
});

test('sheet numbers match across formatting differences', () => {
  // Procore holds 'M105.00'; the PDF prints 'M-105.00'. Treating these as different
  // drawings would upload a duplicate instead of a revision.
  assert.equal(verdictFor(sheet(), [existing('M105.00', '1')]).outcome, 'revision');
});

test('an identical revision is a skippable duplicate, not blocking', () => {
  const verdict = verdictFor(sheet({ revision: '2' }), [existing('M-105.00', '2')]);
  assert.equal(verdict.outcome, 'duplicate');
  assert.ok(!verdict.issues.some((i) => i.blocking));
});

test('an older revision warns but stays uploadable after confirmation', () => {
  const verdict = verdictFor(sheet({ revision: '1' }), [existing('M-105.00', '3')]);
  assert.equal(verdict.outcome, 'older');
  assert.ok(verdict.issues.some((i) => i.code === 'older-revision' && !i.blocking));
});

test('incomparable revision schemes defer instead of guessing', () => {
  const verdict = verdictFor(sheet({ revision: '1' }), [existing('M-105.00', 'IFC')]);
  assert.equal(verdict.outcome, 'unknown');
});

test('only current revisions are compared against', () => {
  const superseded = { ...existing('M-105.00', '9'), current: false };
  // A stale revision must not make a legitimate upload look older than it is.
  assert.equal(verdictFor(sheet({ revision: '2' }), [superseded]).outcome, 'new');
});

test('a matching number in a different Drawing Area is a new sheet, not a revision', () => {
  // Shop Drawings reuse numbers across areas. A sheet uploaded into area 10 must not be
  // matched against an identically-numbered drawing that lives in area 20.
  const otherArea = existing('M-105.00', '1', 20);
  assert.equal(verdictFor(sheet({ drawingAreaId: 10 }), [otherArea]).outcome, 'new');
});

test('a sheet matches the revision in its own area when the number exists in several', () => {
  // Same number in two areas: the sheet targets area 20, so it revises that one only.
  const revisions = [existing('M-105.00', '1', 10), existing('M-105.00', '1', 20)];
  assert.equal(verdictFor(sheet({ drawingAreaId: 20 }), revisions).outcome, 'revision');
});

test('a missing sheet number blocks upload', () => {
  const verdict = verdictFor(sheet({ sheetNumber: null, id: 'x' }));
  assert.equal(verdict.outcome, 'blocked');
  assert.ok(verdict.issues.some((i) => i.code === 'missing-number' && i.blocking));
});

test('drawing area is a package-level choice, not a per-sheet verdict', () => {
  // App blocks the upload until an area is picked; a sheet without one is still a
  // perfectly valid sheet, so validation must not mark it broken.
  assert.equal(verdictFor(sheet({ drawingAreaId: null })).outcome, 'new');
});

test('a scanned sheet blocks until a number is entered', () => {
  const verdict = verdictFor(sheet({ needsOcr: true, sheetNumber: null, id: 'scan' }));
  assert.equal(verdict.outcome, 'blocked');
  assert.ok(verdict.issues.some((i) => i.code === 'needs-ocr'));
});

test('two sheets claiming one number both block', () => {
  const a = sheet({ id: 'a', sourceFile: 'floor1.pdf' });
  const b = sheet({ id: 'b', sourceFile: 'floor2.pdf' });
  const verdicts = validateSheets([a, b], []);

  for (const id of ['a', 'b']) {
    const verdict = verdicts.get(id)!;
    assert.equal(verdict.outcome, 'blocked');
    assert.ok(verdict.issues.some((i) => i.code === 'duplicate-in-upload'));
  }
});

test('a low-confidence parse warns without blocking', () => {
  const verdict = verdictFor(sheet({ confidence: 0.3 }));
  assert.equal(verdict.outcome, 'new');
  assert.ok(verdict.issues.some((i) => i.code === 'low-confidence' && !i.blocking));
});

test('summary refuses upload while anything is blocked', () => {
  const good = sheet({ id: 'good', sheetNumber: 'M-105.00' });
  const bad = sheet({ id: 'bad', sheetNumber: 'M-205.00', needsOcr: true });
  const summary = summarize(validateSheets([good, bad], []));

  assert.equal(summary.total, 2);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.canUpload, false, 'one blocked sheet must stop the whole upload');
});

test('summary allows upload once everything resolves', () => {
  const summary = summarize(
    validateSheets([sheet({ id: 'a', sheetNumber: 'M-105.00' })], [existing('M-105.00', '1')]),
  );
  assert.equal(summary.revision, 1);
  assert.equal(summary.canUpload, true);
});

test('an all-duplicate package has nothing to upload', () => {
  const summary = summarize(
    validateSheets([sheet({ id: 'a', revision: '2' })], [existing('M-105.00', '2')]),
  );
  assert.equal(summary.duplicate, 1);
  assert.equal(summary.canUpload, false);
});
