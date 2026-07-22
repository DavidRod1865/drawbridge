import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetsToCsv, sheetsToTsv } from './exportSummary.ts';
import type { PlannedSheet } from './validation.ts';

function sheet(overrides: Partial<PlannedSheet> = {}): PlannedSheet {
  return {
    id: 'a',
    sourceFile: 'package.pdf',
    folder: 'Mechanical',
    pageIndex: 0,
    sheetNumber: 'M-101',
    title: 'MECHANICAL PLAN',
    discipline: 'Mechanical',
    revision: '2',
    drawingDate: '2026-05-28',
    receivedDate: '2026-05-29',
    drawingAreaId: 7,
    confidence: 0.95,
    needsOcr: false,
    ...overrides,
  };
}

test('TSV has a header row matching Procore review-screen column order', () => {
  const tsv = sheetsToTsv([]);
  assert.equal(tsv, 'Sheet Number\tTitle\tRevision\tDrawing Date\tReceived Date');
});

test('TSV rows carry sheet fields in column order', () => {
  const tsv = sheetsToTsv([sheet()]);
  const lines = tsv.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1], 'M-101\tMECHANICAL PLAN\t2\t2026-05-28\t2026-05-29');
});

test('CSV has the same header row', () => {
  const csv = sheetsToCsv([]);
  assert.equal(csv, 'Sheet Number,Title,Revision,Drawing Date,Received Date');
});

test('CSV rows carry sheet fields in column order', () => {
  const csv = sheetsToCsv([sheet()]);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], 'M-101,MECHANICAL PLAN,2,2026-05-28,2026-05-29');
});

test('CSV quotes a field containing a comma', () => {
  const csv = sheetsToCsv([sheet({ title: 'PLAN, LEVEL 1' })]);
  assert.match(csv, /"PLAN, LEVEL 1"/);
});

test('CSV quotes and doubles embedded quotes', () => {
  const csv = sheetsToCsv([sheet({ title: 'THE "MAIN" PLAN' })]);
  assert.match(csv, /"THE ""MAIN"" PLAN"/);
});

test('CSV quotes a field containing a newline', () => {
  const csv = sheetsToCsv([sheet({ title: 'LINE ONE\nLINE TWO' })]);
  assert.match(csv, /"LINE ONE\nLINE TWO"/);
});

test('null sheetNumber and title fall back to empty cells, not "null"', () => {
  const tsv = sheetsToTsv([sheet({ sheetNumber: null, title: null })]);
  const lastRow = tsv.split('\n')[1];
  assert.equal(lastRow, '\t\t2\t2026-05-28\t2026-05-29');
});
