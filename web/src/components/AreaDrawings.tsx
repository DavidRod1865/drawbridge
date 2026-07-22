import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { DrawingRevision, DrawingSet } from '../lib/procore.ts';
import { groupCurrentByDiscipline, type DisciplineGroup } from './areaGrouping.ts';

interface Props {
  revisions: readonly DrawingRevision[];
  sets: readonly DrawingSet[];
  areaId: number;
}

/**
 * Per-discipline accent colour. Disciplines are free-form strings, so a deterministic
 * hash into a fixed drafting-palette gives each group a stable colour that survives
 * reordering and never collapses two adjacent groups to the same hue by accident.
 */
const DISCIPLINE_HUES = [
  '#1849a9', // blue
  '#027a48', // green
  '#b54708', // amber
  '#9f1ab1', // purple
  '#0e7490', // teal
  '#b42318', // red
  '#4338ca', // indigo
  '#a16207', // gold
];

function hueFor(discipline: string): string {
  let hash = 0;
  for (let i = 0; i < discipline.length; i++) hash = (hash * 31 + discipline.charCodeAt(i)) | 0;
  return DISCIPLINE_HUES[Math.abs(hash) % DISCIPLINE_HUES.length]!;
}

/** Read-only view of what a Drawing Area already holds, one table per discipline. */
export function AreaDrawings({ revisions, sets, areaId }: Props) {
  const groups = useMemo(() => groupCurrentByDiscipline(revisions, areaId), [revisions, areaId]);

  // A revision only carries its drawing_set.id, so resolve the human name here.
  const setNameById = useMemo(() => {
    const byId = new Map<number, string>();
    for (const set of sets) byId.set(set.id, set.name);
    return byId;
  }, [sets]);

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No drawings in this area yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {groups.map((group) => (
        <DisciplineTable key={group.discipline} group={group} setNameById={setNameById} />
      ))}
    </div>
  );
}

/**
 * One discipline's drawings, collapsible. Local open state (defaulting open) lives here so
 * each table toggles independently; keying by discipline in the parent resets it per area.
 */
function DisciplineTable({
  group,
  setNameById,
}: {
  group: DisciplineGroup;
  setNameById: ReadonlyMap<number, string>;
}) {
  const [open, setOpen] = useState(true);
  const hue = hueFor(group.discipline);

  return (
    <section className="grid gap-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border-l-[3px] py-2 pr-2 pl-3 text-left text-sm font-semibold transition-colors"
        // Colour-coded per discipline so groups separate at a glance when scrolling.
        style={{ borderLeftColor: hue, backgroundColor: `color-mix(in oklab, ${hue} 8%, transparent)` }}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight
          className={cn('size-4 transition-transform', open && 'rotate-90')}
          style={{ color: hue }}
          aria-hidden="true"
        />
        <span style={{ color: hue }}>{group.discipline}</span>
        <span
          className="rounded-full px-2 py-px text-[11px] font-semibold"
          style={{ color: hue, backgroundColor: `color-mix(in oklab, ${hue} 14%, transparent)` }}
        >
          {group.rows.length}
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="min-w-[1020px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Sheet #</TableHead>
                <TableHead className="w-[330px]">Title</TableHead>
                <TableHead className="w-14">Rev</TableHead>
                <TableHead className="w-[240px]">Drawing Set</TableHead>
                <TableHead className="w-[120px]">Drawing date</TableHead>
                <TableHead className="w-[120px]">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted">
                  <TableCell className="font-mono text-[13px]">{row.number}</TableCell>
                  <TableCell className="break-words">{row.title}</TableCell>
                  <TableCell>{row.revision_number || '—'}</TableCell>
                  <TableCell className="break-words">{setNameById.get(row.drawing_set.id) ?? '—'}</TableCell>
                  <TableCell className="font-mono text-[13px]">{row.drawing_date || '—'}</TableCell>
                  <TableCell className="font-mono text-[13px]">{row.received_date || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
