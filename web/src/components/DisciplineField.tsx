import { Select, type SelectOption } from './Select.tsx';
import { FLOOR_LABELS, STANDARD_DISCIPLINES } from '../lib/disciplines.ts';

interface Props {
  value: string | null;
  onChange: (value: string) => void;
}

const OPTIONS: readonly SelectOption[] = [
  ...STANDARD_DISCIPLINES.map((name) => ({
    value: name,
    label: name,
    group: 'Discipline',
  })),
  ...FLOOR_LABELS.map((name) => ({
    value: name,
    label: name,
    group: 'Floor',
  })),
];

/**
 * Per-sheet discipline field.
 *
 * Same Select trigger as everywhere else (menu always opens on click), with
 * `allowCustom` so a name Procore accepts but we don't list — "HVAC", "Level B2" —
 * can still be typed into the filter and committed via Enter or “Use …”.
 */
export function DisciplineField({ value, onChange }: Props) {
  return (
    <Select
      options={OPTIONS}
      value={value}
      onChange={onChange}
      placeholder="Discipline or floor"
      ariaLabel="Discipline or floor"
      allowCustom
    />
  );
}
