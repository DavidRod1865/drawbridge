import { useMemo, useState } from 'react';
import { DisciplinePicker } from './DisciplinePicker.tsx';
import { DisciplineField, DisciplineOptions } from './DisciplineField.tsx';
import { summarize, validateSheets, type Outcome, type PlannedSheet } from '../lib/validation.ts';
import type { DrawingRevision } from '../lib/procore.ts';

interface Props {
  sheets: readonly PlannedSheet[];
  existingRevisions: readonly DrawingRevision[];
  onUpdate: (ids: readonly string[], patch: Partial<PlannedSheet>) => void;
  /** An upload-level blocker outside per-sheet validation, e.g. no Drawing Set chosen. */
  blockedReason?: string | null;
  onUpload: () => void;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  new: 'New',
  revision: 'Revision',
  duplicate: 'Duplicate',
  older: 'Older',
  unknown: 'Check',
  blocked: 'Needs fix',
};

export function ReviewTable({
  sheets,
  existingRevisions,
  onUpdate,
  blockedReason,
  onUpload,
}: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const verdicts = useMemo(
    () => validateSheets(sheets, existingRevisions),
    [sheets, existingRevisions],
  );
  const summary = useMemo(() => summarize(verdicts), [verdicts]);

  const selectedIds = [...selected];
  const allSelected = sheets.length > 0 && selected.size === sheets.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Bulk edits apply to the selection, or to everything when nothing is selected. */
  function applyToSelection(patch: Partial<PlannedSheet>) {
    onUpdate(selectedIds.length > 0 ? selectedIds : sheets.map((s) => s.id), patch);
  }

  const targetCount = selectedIds.length > 0 ? selectedIds.length : sheets.length;

  return (
    <section className="review">
      <div className="review-summary">
        <strong>{summary.total} sheets</strong>
        {summary.new > 0 && <span className="pill new">{summary.new} new</span>}
        {summary.revision > 0 && <span className="pill revision">{summary.revision} revision</span>}
        {summary.duplicate > 0 && (
          <span className="pill duplicate">{summary.duplicate} duplicate</span>
        )}
        {summary.older > 0 && <span className="pill older">{summary.older} older</span>}
        {summary.unknown > 0 && <span className="pill unknown">{summary.unknown} check</span>}
        {summary.blocked > 0 && <span className="pill blocked">{summary.blocked} needs fix</span>}
      </div>

      <div className="bulk-bar">
        <span className="muted">
          {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Applies to all sheets'}
        </span>

        <DisciplinePicker onPick={(value) => applyToSelection({ discipline: value })} />

        <label className="inline">
          Revision
          <input
            className="bulk-input narrow"
            placeholder="auto"
            onBlur={(e) => e.target.value && applyToSelection({ revision: e.target.value })}
          />
        </label>

        <label className="inline">
          Drawing date
          <input
            type="date"
            onChange={(e) => e.target.value && applyToSelection({ drawingDate: e.target.value })}
          />
        </label>

        <label className="inline">
          Received
          <input
            type="date"
            onChange={(e) => e.target.value && applyToSelection({ receivedDate: e.target.value })}
          />
        </label>

        <span className="muted">→ {targetCount} sheet(s)</span>
      </div>

      <DisciplineOptions />

      <div className="table-scroll">
        <table className="review-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(sheets.map((s) => s.id)))
                  }
                />
              </th>
              <th className="col-number">Sheet #</th>
              <th className="col-title">Title</th>
              <th className="col-discipline">Discipline / Floor</th>
              <th className="col-rev">Rev</th>
              <th className="col-status">Status</th>
            </tr>
          </thead>
          <tbody>
            {sheets.map((sheet) => {
              const verdict = verdicts.get(sheet.id);
              const issues = verdict?.issues ?? [];
              const isBlocked = issues.some((i) => i.blocking);

              return (
                <tr key={sheet.id} className={isBlocked ? 'row-blocked' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(sheet.id)}
                      onChange={() => toggle(sheet.id)}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input mono"
                      value={sheet.sheetNumber ?? ''}
                      placeholder="required"
                      onChange={(e) => onUpdate([sheet.id], { sheetNumber: e.target.value })}
                    />
                    {/* Tracing a misparse back to its page matters in a 200-page package. */}
                    <div className="source" title={sheet.sourceFile}>
                      p.{sheet.pageIndex + 1} · {sheet.sourceFile}
                    </div>
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      value={sheet.title ?? ''}
                      onChange={(e) => onUpdate([sheet.id], { title: e.target.value })}
                    />
                  </td>
                  <td>
                    <DisciplineField
                      value={sheet.discipline}
                      onChange={(value) => onUpdate([sheet.id], { discipline: value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input narrow"
                      value={sheet.revision}
                      placeholder="auto"
                      onChange={(e) => onUpdate([sheet.id], { revision: e.target.value })}
                    />
                  </td>
                  <td>
                    <span className={`pill ${verdict?.outcome ?? 'new'}`}>
                      {OUTCOME_LABEL[verdict?.outcome ?? 'new']}
                    </span>
                    {issues.map((issue) => (
                      <div
                        key={issue.code}
                        className={issue.blocking ? 'issue blocking' : 'issue'}
                      >
                        {issue.message}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="review-actions">
        {(!summary.canUpload || blockedReason) && (
          <span className="muted">
            {blockedReason
              ? blockedReason
              : summary.blocked > 0
                ? `Resolve ${summary.blocked} sheet(s) before uploading.`
                : 'Nothing to upload — every sheet is already in Procore.'}
          </span>
        )}
        <button
          className="button primary"
          disabled={!summary.canUpload || Boolean(blockedReason)}
          onClick={onUpload}
        >
          Upload {summary.new + summary.revision + summary.older + summary.unknown} sheets
        </button>
      </div>
    </section>
  );
}
