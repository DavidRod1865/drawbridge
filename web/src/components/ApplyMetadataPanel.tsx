import { useState } from 'react';
import { planMetadataUpdates, type ApplyMetadataOutcome } from '../lib/applyMetadata.ts';
import { listCurrentRevisions, updateDrawingRevision } from '../lib/procore.ts';
import type { SheetProgress } from '../lib/upload.ts';
import type { PlannedSheet } from '../lib/validation.ts';

interface Props {
  projectId: number;
  sheets: readonly PlannedSheet[];
  progress: ReadonlyMap<string, SheetProgress>;
}

/** Per-sheet result of the last "Apply dates & revisions" run, for display. */
type RunOutcome =
  | { status: 'applied' }
  | { status: 'already-applied' }
  | { status: 'not-found' }
  | { status: 'missing-data' }
  | { status: 'error'; message: string };

const STATUS_LABEL: Record<RunOutcome['status'], string> = {
  applied: 'Applied',
  'already-applied': 'Already applied',
  'not-found': 'Not found — confirm in Procore first, then run again',
  'missing-data': 'Missing sheet number or dates',
  error: 'Failed',
};

const STATUS_PILL: Record<RunOutcome['status'], string> = {
  applied: 'revision',
  'already-applied': 'duplicate',
  'not-found': 'older',
  'missing-data': 'blocked',
  error: 'blocked',
};

/**
 * Shown after registration succeeds. The sheets exist in Procore's review queue with
 * none of the app's metadata attached (OCR-only); this panel writes it onto the
 * created revisions once the user has confirmed them there.
 *
 * Deliberately not auto-run or polled: confirmation in Procore's review queue is async
 * and user-driven, so there is no moment we could know to trigger this automatically.
 * Re-triggerable because re-PATCHing already-correct values is harmless (the endpoint is
 * a plain field overwrite, not additive) — a second click after confirming more sheets
 * just picks up whatever is newly matchable.
 */
export function ApplyMetadataPanel({ projectId, sheets, progress }: Props) {
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<Map<string, RunOutcome> | null>(null);

  // Only the sheets this batch actually registered — anything that failed upload was
  // never sent to Procore at all, so there is nothing there yet to match against.
  const registered = sheets.filter((sheet) => progress.get(sheet.id)?.phase === 'registered');

  async function handleApply() {
    setRunning(true);
    const next = new Map<string, RunOutcome>();

    try {
      const currentRevisions = await listCurrentRevisions(projectId);
      const plan = planMetadataUpdates(registered, currentRevisions);

      for (const entry of plan) {
        next.set(entry.sheetId, await applyOne(entry));
      }
    } catch (cause) {
      // listCurrentRevisions itself failed — nothing could be planned, so every sheet
      // in this batch shows the same error rather than being left blank.
      const message = cause instanceof Error ? cause.message : String(cause);
      for (const sheet of registered) next.set(sheet.id, { status: 'error', message });
    }

    setOutcomes(next);
    setRunning(false);
  }

  async function applyOne(entry: ApplyMetadataOutcome): Promise<RunOutcome> {
    if (entry.status === 'not-found') return { status: 'not-found' };
    if (entry.status === 'missing-data') return { status: 'missing-data' };
    if (entry.status === 'already-applied') return { status: 'already-applied' };

    try {
      await updateDrawingRevision(projectId, entry.revisionId, entry.update);
      return { status: 'applied' };
    } catch (cause) {
      return { status: 'error', message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  if (registered.length === 0) return null;

  return (
    <div className="reference-table" style={{ margin: 'var(--s3) var(--s4)' }}>
      <div className="review-summary">
        <strong>Apply dates &amp; revisions</strong>
        <span className="muted">
          Sheets are waiting in Procore's review queue. After you confirm them there,
          click below to write this batch's dates and revision labels onto the
          confirmed revisions — sheets not yet confirmed will show as not found; run
          again once they are.
        </span>
      </div>

      <div className="review-actions">
        <button className="button primary" onClick={() => void handleApply()} disabled={running}>
          {running ? 'Applying…' : 'Apply dates & revisions'}
        </button>
      </div>

      {outcomes && (
        <div className="table-scroll">
          <table className="review-table">
            <thead>
              <tr>
                <th className="col-number">Sheet #</th>
                <th className="col-title">Title</th>
                <th className="col-status">Result</th>
              </tr>
            </thead>
            <tbody>
              {registered.map((sheet) => {
                const outcome = outcomes.get(sheet.id);
                if (!outcome) return null;
                return (
                  <tr key={sheet.id}>
                    <td className="mono">{sheet.sheetNumber}</td>
                    <td>{sheet.title}</td>
                    <td>
                      <span className={`pill ${STATUS_PILL[outcome.status]}`}>
                        {STATUS_LABEL[outcome.status]}
                      </span>
                      {outcome.status === 'error' && (
                        <div className="issue blocking">{outcome.message}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
