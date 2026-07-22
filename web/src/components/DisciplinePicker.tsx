import { useState } from 'react';
import { DisciplineField } from './DisciplineField.tsx';

interface Props {
  onPick: (value: string) => void;
}

/**
 * Bulk discipline setter — same DisciplineField as each row, so the menu, filter,
 * and custom-name path stay identical whether you're editing one sheet or many.
 */
export function DisciplinePicker({ onPick }: Props) {
  const [value, setValue] = useState<string | null>(null);

  return (
    <div className="w-[170px]">
      <DisciplineField
        value={value}
        onChange={(next) => {
          setValue(next);
          onPick(next);
        }}
      />
    </div>
  );
}
