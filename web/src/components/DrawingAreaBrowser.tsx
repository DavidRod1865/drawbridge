import { useState } from 'react';
import type { DrawingArea } from '../lib/procore.ts';

interface Props {
  areas: readonly DrawingArea[];
  selectedAreaId: number | null;
  onSelect: (id: number) => void;
  /** Creates the area in Procore and resolves to it. */
  onCreate: (name: string) => Promise<DrawingArea>;
  /** Lifts the new area into App state so every picker of areas gains it. */
  onCreated: (area: DrawingArea) => void;
}

/**
 * Lists every Drawing Area in the project as a selectable set (not a dropdown), so the
 * user sees what exists before choosing — and can create the one they need inline when
 * it doesn't. Selecting an area both reveals its contents (via <AreaDrawings/>) and, in
 * App.tsx, targets it for upload; the two are deliberately the same action.
 */
export function DrawingAreaBrowser({ areas, selectedAreaId, onSelect, onCreate, onCreated }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Prefer an existing match over creating a twin. Procore allows duplicate names, and
    // two identically named areas stay confusing for the life of the project.
    const existing = areas.find((a) => a.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onSelect(existing.id);
      reset();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const created = await onCreate(trimmed);
      onCreated(created);
      onSelect(created.id); // Drop the user straight into the area they just made.
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCreating(false);
    setName('');
    setError(null);
  }

  return (
    <section className="card area-card">
      <div className="area-card-head">Drawing Area</div>

      <div className="area-list">
        {areas.map((area) => (
          <button
            key={area.id}
            type="button"
            className={`area-item${area.id === selectedAreaId ? ' active' : ''}`}
            onClick={() => onSelect(area.id)}
          >
            {area.name}
          </button>
        ))}
        {areas.length === 0 && !creating && (
          <span className="muted">No drawing areas yet — create one to get started.</span>
        )}
      </div>

      {creating ? (
        <div className="inline-create">
          <input
            className="cell-input"
            autoFocus
            placeholder="New area name"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') reset();
            }}
          />
          <button className="button subtle tiny" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button className="button subtle tiny" disabled={busy} onClick={reset}>
            Cancel
          </button>
          {error && <div className="issue blocking">{error}</div>}
        </div>
      ) : (
        <button className="button subtle" onClick={() => setCreating(true)}>
          + New drawing area
        </button>
      )}
    </section>
  );
}
