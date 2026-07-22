import { useState } from 'react';
import { Select } from './Select.tsx';

/** Any Procore resource picked by name — Drawing Areas and Drawing Sets both fit. */
export interface NamedResource {
  id: number;
  name: string;
}

interface Props<T extends NamedResource> {
  items: readonly T[];
  value: number | null;
  onChange: (id: number) => void;
  /** Creates the resource in Procore and resolves to it. */
  onCreate: (name: string) => Promise<T>;
  /** Lifts the new resource so every other picker of the same kind gains it too. */
  onCreated: (item: T) => void;
  placeholder?: string;
  createLabel: string;
  newLabel: string;
}

/**
 * A select that can create the option it is missing.
 *
 * A fresh Procore project has no Drawing Areas and no Drawing Sets, and uploading
 * requires both — so a select-only control deadlocks the user into leaving for Procore
 * and coming back. That round trip is exactly what Drawbridge exists to remove, which
 * makes inline creation a requirement rather than a convenience.
 */
export function CreatableSelect<T extends NamedResource>({
  items,
  value,
  onChange,
  onCreate,
  onCreated,
  placeholder = 'Choose…',
  createLabel,
  newLabel,
}: Props<T>) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Prefer an existing match over creating a twin. Procore allows duplicate names,
    // and two identically named areas stay confusing for the life of the project.
    const existing = items.find(
      (item) => item.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      onChange(existing.id);
      setCreating(false);
      setName('');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await onCreate(trimmed);
      onCreated(created);
      onChange(created.id);
      setCreating(false);
      setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <div className="inline-create">
        <input
          autoFocus
          placeholder={newLabel}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
            if (event.key === 'Escape') setCreating(false);
          }}
        />
        <button className="button subtle tiny" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button className="button subtle tiny" disabled={busy} onClick={() => setCreating(false)}>
          Cancel
        </button>
        {error && <div className="issue blocking">{error}</div>}
      </div>
    );
  }

  return (
    <Select
      options={items.map((item) => ({ value: String(item.id), label: item.name }))}
      value={value === null ? null : String(value)}
      placeholder={placeholder}
      actionLabel={createLabel}
      onAction={() => setCreating(true)}
      onChange={(next) => onChange(Number(next))}
    />
  );
}
