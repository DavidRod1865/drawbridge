import type { DrawingRevision } from '../lib/procore.ts';

/** The catch-all bucket for drawings whose discipline Procore hasn't set. */
export const UNASSIGNED = 'Unassigned';

export interface DisciplineGroup {
  discipline: string;
  rows: DrawingRevision[];
}

/**
 * Groups an area's CURRENT drawings by discipline for the browse view.
 *
 * Only `current` revisions in `areaId` are shown — one row per drawing, matching how
 * Procore's Drawings tool displays the log (superseded revisions would just be noise
 * here). Kept in a JSX-free module, separate from <AreaDrawings/>, so `node --test` can
 * exercise it directly (type-stripping runs .ts but not the .tsx's JSX).
 *
 * Sort rules: disciplines A→Z, but 'Unassigned' always last — it's the absence of a
 * discipline, not a peer, so it reads as a footnote. Sheets within a discipline sort
 * with `numeric` collation so A-2 precedes A-10 (plain string order would not).
 */
export function groupCurrentByDiscipline(
  revisions: readonly DrawingRevision[],
  areaId: number,
): DisciplineGroup[] {
  const byDiscipline = new Map<string, DrawingRevision[]>();
  for (const rev of revisions) {
    if (!rev.current || rev.drawing_area.id !== areaId) continue;
    const key = rev.discipline?.name ?? UNASSIGNED;
    const bucket = byDiscipline.get(key);
    // Buckets are freshly allocated here, so sorting them later never mutates `revisions`.
    if (bucket) bucket.push(rev);
    else byDiscipline.set(key, [rev]);
  }

  const groups = [...byDiscipline.entries()].map(([discipline, rows]) => ({
    discipline,
    rows: rows.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
  }));

  groups.sort((a, b) => {
    if (a.discipline === UNASSIGNED) return 1;
    if (b.discipline === UNASSIGNED) return -1;
    return a.discipline.localeCompare(b.discipline);
  });

  return groups;
}
