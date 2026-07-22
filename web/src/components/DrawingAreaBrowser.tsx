import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
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
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          Drawing Area
        </span>
        {creating ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              className="h-8 w-[160px]"
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
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={reset}>
              Cancel
            </Button>
            {error && <span className="w-full text-xs text-destructive">{error}</span>}
          </div>
        ) : (
          <Button
            size="sm"
            className="border-primary/40 bg-primary/5 text-primary hover:bg-primary hover:text-primary-foreground"
            variant="outline"
            onClick={() => setCreating(true)}
          >
            <Plus />
            New Drawing Area
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {areas.map((area) => {
          const active = area.id === selectedAreaId;
          return (
            <button
              key={area.id}
              type="button"
              className={cn(
                'rounded-md border px-3 py-1.5 text-[13px] transition-colors',
                active
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-input bg-card hover:border-muted-foreground/60',
              )}
              onClick={() => onSelect(area.id)}
            >
              {area.name}
            </button>
          );
        })}
        {areas.length === 0 && !creating && (
          <span className="text-sm text-muted-foreground">
            No drawing areas yet — create one to get started.
          </span>
        )}
      </div>
    </Card>
  );
}
