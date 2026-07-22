import { useState } from 'react';
import { Select } from './Select.tsx';
import { optionsFor, type DisciplineMode } from '../lib/disciplines.ts';

interface Props {
  onPick: (value: string) => void;
}

/**
 * Bulk discipline setter: choose the vocabulary, then type or pick a value.
 *
 * The value field is a filtering combobox rather than a dropdown because the floor
 * list runs past a hundred entries — a native menu that long covers the screen and
 * cannot be constrained with CSS. Choosing the mode first also narrows what the
 * suggestions contain, so 'Floor 5' and 'Fire Protection' never compete.
 */
export function DisciplinePicker({ onPick }: Props) {
  const [mode, setMode] = useState<DisciplineMode>('standard');

  return (
    <span className="discipline-picker">
      <Select
        className="mode"
        ariaLabel="Discipline type"
        options={[
          { value: 'standard', label: 'Discipline' },
          { value: 'floor', label: 'Floor' },
        ]}
        value={mode}
        onChange={(value) => setMode(value as DisciplineMode)}
      />

      <input
        className="bulk-input"
        list={`bulk-${mode}-options`}
        placeholder={mode === 'floor' ? 'Set floor…' : 'Set discipline…'}
        onBlur={(event) => {
          if (event.target.value) onPick(event.target.value);
        }}
      />

      <datalist id={`bulk-${mode}-options`}>
        {optionsFor(mode).map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </span>
  );
}
