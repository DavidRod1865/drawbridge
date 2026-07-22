import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCurrentByDiscipline } from './areaGrouping.ts';
import type { DrawingRevision } from '../lib/procore.ts';

/** Builds a revision with sensible defaults; override only what a case cares about. */
function rev(over: Partial<DrawingRevision> & { number: string }): DrawingRevision {
  return {
    id: Math.floor(Math.random() * 1e9),
    drawing_id: 1,
    title: '',
    revision_number: '0',
    drawing_area: { id: 1 },
    drawing_set: { id: 1 },
    discipline: { name: 'Architectural' },
    current: true,
    drawing_date: '2026-07-01',
    received_date: '2026-07-01',
    ...over,
  };
}

test('excludes non-current and other-area revisions', () => {
  const groups = groupCurrentByDiscipline(
    [
      rev({ number: 'A-101' }),
      rev({ number: 'A-100', current: false }), // superseded
      rev({ number: 'A-102', drawing_area: { id: 2 } }), // different area
    ],
    1,
  );
  const numbers = groups.flatMap((g) => g.rows.map((r) => r.number));
  assert.deepEqual(numbers, ['A-101']);
});

test('groups by discipline; null discipline becomes Unassigned', () => {
  const groups = groupCurrentByDiscipline(
    [
      rev({ number: 'A-101', discipline: { name: 'Architectural' } }),
      rev({ number: 'S-201', discipline: { name: 'Structural' } }),
      rev({ number: 'X-001', discipline: null }),
    ],
    1,
  );
  assert.deepEqual(
    groups.map((g) => g.discipline),
    ['Architectural', 'Structural', 'Unassigned'],
  );
});

test('Unassigned sorts last even against later-alphabet disciplines', () => {
  const groups = groupCurrentByDiscipline(
    [
      rev({ number: 'X-001', discipline: null }),
      rev({ number: 'Z-001', discipline: { name: 'Zoning' } }),
    ],
    1,
  );
  assert.deepEqual(
    groups.map((g) => g.discipline),
    ['Zoning', 'Unassigned'],
  );
});

test('sheets within a discipline sort numerically (A-2 before A-10)', () => {
  const groups = groupCurrentByDiscipline(
    [
      rev({ number: 'A-10' }),
      rev({ number: 'A-2' }),
      rev({ number: 'A-1' }),
    ],
    1,
  );
  assert.deepEqual(
    groups[0]?.rows.map((r) => r.number),
    ['A-1', 'A-2', 'A-10'],
  );
});

test('does not mutate the input revisions array order', () => {
  const input = [rev({ number: 'A-10' }), rev({ number: 'A-2' })];
  const before = input.map((r) => r.number);
  groupCurrentByDiscipline(input, 1);
  assert.deepEqual(
    input.map((r) => r.number),
    before,
  );
});
