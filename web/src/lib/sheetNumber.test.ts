import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  disciplineFor,
  normalizeSheetNumber,
  parseSheetNumber,
  pickSheetNumber,
  reconcile,
  type SheetNumberResult,
  type TextItem,
} from './sheetNumber.ts';

test('accepts the common sheet number formats', () => {
  for (const input of ['A-101', 'A101', 'A 101', 'M2.1', 'S-201', 'E-001', 'AD1.01', 'A-101A']) {
    assert.ok(parseSheetNumber(input), `expected ${input} to parse`);
  }
});

test('preserves the printed form while normalizing for comparison', () => {
  const match = parseSheetNumber('a-101');
  // Procore receives what is printed on the sheet, not our normalized key.
  assert.equal(match?.raw, 'a-101');
  assert.equal(match?.normalized, 'A101');
});

test('formatting variants collapse to one identity', () => {
  const forms = ['A-101', 'A101', 'A 101', 'a.101'].map(normalizeSheetNumber);
  assert.equal(new Set(forms).size, 1, 'all spellings should normalize alike');
});

test('rejects strings that are not sheet numbers', () => {
  for (const input of ['SCALE', '1/4"=1\'-0"', '', 'REV 2', 'SHEET', '12', '2024-01-15']) {
    assert.equal(parseSheetNumber(input), null, `expected ${input} to be rejected`);
  }
});

test('rejects bare four-digit numbers that look like years', () => {
  assert.equal(parseSheetNumber('A2024'), null);
  // ...but keeps them when a separator marks it as a real sheet number.
  assert.ok(parseSheetNumber('A-2024'));
});

const at = (text: string, x: number, y: number): TextItem => ({ text, x, y });

test('prefers the title block over a drawing callout', () => {
  // The callout appears first in reading order; position must win over order.
  const result = pickSheetNumber([at('A-501', 0.2, 0.3), at('A-101', 0.9, 0.94)]);
  assert.equal(result?.raw, 'A-101');
});

test('a nearby SHEET NO label raises confidence', () => {
  const withLabel = pickSheetNumber([at('SHEET NO', 0.85, 0.9), at('A-101', 0.9, 0.94)]);
  const without = pickSheetNumber([at('A-101', 0.9, 0.94)]);
  assert.ok(withLabel!.confidence > without!.confidence);
});

test('an upper-left match is heavily discounted', () => {
  const result = pickSheetNumber([at('A-501', 0.1, 0.1)]);
  // Still returned, but flagged low enough that the review screen surfaces it.
  assert.ok(result !== null);
  assert.ok(result.confidence < 0.5, `expected low confidence, got ${result.confidence}`);
});

test('returns null when the page has no sheet number at all', () => {
  assert.equal(pickSheetNumber([at('GENERAL NOTES', 0.5, 0.5)]), null);
});

test('maps discipline prefixes, including multi-letter ones', () => {
  assert.equal(disciplineFor('A'), 'Architectural');
  assert.equal(disciplineFor('S'), 'Structural');
  assert.equal(disciplineFor('AD'), 'Architectural');
  assert.equal(disciplineFor('X'), 'General');
});

/** A realistic heuristic pick, built through the real scorer. */
const heuristicMatch = (raw: string): SheetNumberResult =>
  pickSheetNumber([at(raw, 0.9, 0.94)])!;

test('reconcile with no LLM reduces to the heuristic result', () => {
  const match = heuristicMatch('A-101');
  const merged = reconcile({ match, title: 'FIRST FLOOR PLAN' }, null);
  assert.equal(merged.sheetNumber, 'A-101');
  assert.equal(merged.title, 'FIRST FLOOR PLAN');
  assert.equal(merged.discipline, 'Architectural');
  assert.equal(merged.confidence, match.confidence);
});

test('reconcile raises confidence when LLM and heuristic agree', () => {
  const match = heuristicMatch('A-101');
  const merged = reconcile(
    { match, title: 'FIRST FLOOR PLAN' },
    { sheetNumber: 'A-101', title: 'FIRST FLOOR PLAN' },
  );
  assert.equal(merged.sheetNumber, 'A-101');
  assert.equal(merged.confidence, 0.95);
});

test('agreement is judged on normalized form, not exact spelling', () => {
  const match = heuristicMatch('A-101');
  const merged = reconcile({ match, title: null }, { sheetNumber: 'A101', title: null });
  assert.equal(merged.confidence, 0.95);
});

test('reconcile takes the LLM number but flags it when they disagree', () => {
  const match = heuristicMatch('S1'); // the classic job-number-fragment false positive
  const merged = reconcile({ match, title: null }, { sheetNumber: 'M-105.00', title: null });
  assert.equal(merged.sheetNumber, 'M-105.00');
  assert.equal(merged.discipline, 'Mechanical'); // discipline follows the winning number
  assert.equal(merged.confidence, 0.5);
});

test('reconcile trusts the LLM when the heuristic found nothing', () => {
  const merged = reconcile(
    { match: null, title: null },
    { sheetNumber: 'E-001', title: 'ELECTRICAL PLAN' },
  );
  assert.equal(merged.sheetNumber, 'E-001');
  assert.equal(merged.title, 'ELECTRICAL PLAN');
  assert.equal(merged.discipline, 'Electrical');
  assert.equal(merged.confidence, 0.7);
});

test('reconcile falls back to the heuristic title when the LLM omits one', () => {
  const match = heuristicMatch('A-101');
  const merged = reconcile({ match, title: 'FIRST FLOOR PLAN' }, { sheetNumber: 'A-101', title: null });
  assert.equal(merged.title, 'FIRST FLOOR PLAN');
});
