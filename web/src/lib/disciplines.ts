/**
 * Discipline options.
 *
 * Procore accepts an arbitrary discipline name, so these are suggestions rather than a
 * constraint. Two distinct vocabularies are offered because packages are organized
 * either by trade ('Mechanical') or by level ('Floor 5') depending on the job.
 */

export const STANDARD_DISCIPLINES = [
  'Architectural',
  'Civil',
  'Electrical',
  'Fire Protection',
  'General',
  'Interiors',
  'Landscape',
  'Mechanical',
  'Plumbing',
  'Equipment',
  'Structural',
  'Telecommunications',
] as const;

/** Named levels below and above the numbered floors, in building order. */
export const FLOOR_LABELS = [
  'Cellar',
  'Sub-Basement',
  'Basement',
  'Ground Floor',
  'Mezzanine',
  ...Array.from({ length: 100 }, (_, index) => `Floor ${index + 1}`),
  'Penthouse',
  'Roof',
] as const;

export type DisciplineMode = 'standard' | 'floor';

export function optionsFor(mode: DisciplineMode): readonly string[] {
  return mode === 'floor' ? FLOOR_LABELS : STANDARD_DISCIPLINES;
}

/** Every suggestion, for the free-text combobox on each row. */
export const ALL_DISCIPLINE_OPTIONS: readonly string[] = [
  ...STANDARD_DISCIPLINES,
  ...FLOOR_LABELS,
];
