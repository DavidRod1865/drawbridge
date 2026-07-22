import { ALL_DISCIPLINE_OPTIONS } from '../lib/disciplines.ts';

interface Props {
  value: string | null;
  onChange: (value: string) => void;
}

/** Rendered once by ReviewTable; every field references it by id. */
export function DisciplineOptions() {
  return (
    <datalist id="discipline-options">
      {ALL_DISCIPLINE_OPTIONS.map((option) => (
        <option key={option} value={option} />
      ))}
    </datalist>
  );
}

/**
 * Per-sheet discipline field.
 *
 * A filtering combobox rather than a menu: with twelve disciplines plus a hundred
 * floor labels, a native <select> renders all 119 options at once in a popup that
 * covers the viewport and ignores CSS sizing. Typing '47' narrows to Floor 47
 * immediately, and arbitrary text still works since Procore accepts any name.
 */
export function DisciplineField({ value, onChange }: Props) {
  return (
    <input
      className="cell-input"
      list="discipline-options"
      value={value ?? ''}
      placeholder="Discipline or floor"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
