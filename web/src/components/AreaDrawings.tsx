import { useMemo, useState } from 'react';
import type { DrawingRevision, DrawingSet } from '../lib/procore.ts';
import { groupCurrentByDiscipline, type DisciplineGroup } from './areaGrouping.ts';

interface Props {
  revisions: readonly DrawingRevision[];
  sets: readonly DrawingSet[];
  areaId: number;
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
    return <p className="muted">No drawings in this area yet.</p>;
  }

  return (
    <div className="area-drawings">
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

  return (
    <section className="discipline-group">
      <button
        type="button"
        className="discipline-heading"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`chevron${open ? ' open' : ''}`} aria-hidden="true" />
        {group.discipline}
        <span className="discipline-count">{group.rows.length}</span>
      </button>

      {open && (
        <div className="table-scroll">
          <table className="review-table browse-table">
            <thead>
              <tr>
                <th className="col-number">Sheet #</th>
                <th className="col-title">Title</th>
                <th className="col-rev">Rev</th>
                <th className="col-set">Drawing Set</th>
                <th className="col-date">Drawing date</th>
                <th className="col-date">Received</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.number}</td>
                  <td>{row.title}</td>
                  <td>{row.revision_number || '—'}</td>
                  <td>{setNameById.get(row.drawing_set.id) ?? '—'}</td>
                  <td>{row.drawing_date || '—'}</td>
                  <td>{row.received_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
