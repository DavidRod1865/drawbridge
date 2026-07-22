import { useState } from 'react';
import type { SheetProgress, UploadResult } from '../lib/upload.ts';
import type { PlannedSheet } from '../lib/validation.ts';
import { sheetsToCsv, sheetsToTsv } from '../lib/exportSummary.ts';
import { ApplyMetadataPanel } from './ApplyMetadataPanel.tsx';

interface Props {
  projectId: number;
  sheets: readonly PlannedSheet[];
  progress: ReadonlyMap<string, SheetProgress>;
  result: UploadResult | null;
  running: boolean;
  procoreUrl: string | null;
  onRetry: () => void;
  onDone: () => void;
}

const PHASE_LABEL: Record<SheetProgress['phase'], string> = {
  pending: 'Waiting',
  'uploading-file': 'Uploading…',
  uploaded: 'Uploaded',
  registered: 'Sent to Procore',
  failed: 'Failed',
};

const PHASE_PILL: Record<SheetProgress['phase'], string> = {
  pending: 'duplicate',
  'uploading-file': 'new',
  uploaded: 'new',
  registered: 'revision',
  failed: 'blocked',
};

export function UploadPanel({
  projectId,
  sheets,
  progress,
  result,
  running,
  procoreUrl,
  onRetry,
  onDone,
}: Props) {
  const [copied, setCopied] = useState(false);

  const done = [...progress.values()].filter((s) => s.phase === 'registered').length;
  const percent = sheets.length === 0 ? 0 : Math.round((done / sheets.length) * 100);

  async function handleCopy() {
    await navigator.clipboard.writeText(sheetsToTsv(sheets));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadCsv() {
    const blob = new Blob([sheetsToCsv(sheets)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'drawbridge-upload-summary.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="review">
      <div className="review-summary">
        <strong>
          {running ? 'Uploading to Procore' : result ? 'Upload complete' : 'Upload'}
        </strong>
        <span className="muted">
          {done} of {sheets.length} registered
        </span>
        {result && result.failed > 0 && (
          <span className="pill blocked">{result.failed} failed</span>
        )}
      </div>

      <div className="progress-track" role="progressbar" aria-valuenow={percent}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {result?.registrationError && (
        <div className="error" style={{ margin: 'var(--s3) var(--s4)' }} role="alert">
          Files reached storage but Procore rejected the batch: {result.registrationError}
          {' '}Retrying re-registers them without re-uploading.
        </div>
      )}

      <div className="table-scroll">
        <table className="review-table">
          <thead>
            <tr>
              <th className="col-number">Sheet #</th>
              <th className="col-title">Title</th>
              <th className="col-status">Progress</th>
            </tr>
          </thead>
          <tbody>
            {sheets.map((sheet) => {
              const state = progress.get(sheet.id);
              const phase = state?.phase ?? 'pending';
              return (
                <tr key={sheet.id}>
                  <td className="mono">{sheet.sheetNumber}</td>
                  <td>{sheet.title}</td>
                  <td>
                    <span className={`pill ${PHASE_PILL[phase]}`}>{PHASE_LABEL[phase]}</span>
                    {state?.error && <div className="issue blocking">{state.error}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="review-actions">
        {result && result.failed === 0 && (
          <span className="muted">
            Sheets are in Procore's <strong>Items to Review</strong> queue — its OCR
            reads sheet numbers and titles from the same title blocks this app parsed,
            and organizes them by discipline. Check them against the reference table
            below, confirm them in Procore, then come back here and use
            "Apply dates &amp; revisions" to write the dates and revision label OCR
            doesn't capture.
          </span>
        )}

        {procoreUrl && result && (
          <a className="button subtle" href={procoreUrl} target="_blank" rel="noreferrer">
            Open in Procore
          </a>
        )}

        {result && result.failed > 0 && (
          <button className="button primary" onClick={onRetry}>
            Retry {result.failed} failed
          </button>
        )}

        {result && result.failed === 0 && (
          <button className="button primary" onClick={onDone}>
            Upload another package
          </button>
        )}
      </div>

      {result && (
        <div className="reference-table" style={{ margin: 'var(--s3) var(--s4)' }}>
          <div className="review-summary">
            <strong>Reference table</strong>
            <span className="muted">
              Procore's review screen won't show revision or date metadata — use this
              while confirming sheets by hand.
            </span>
          </div>
          <div className="review-actions">
            <button className="button subtle" onClick={() => void handleCopy()}>
              {copied ? 'Copied' : 'Copy as table'}
            </button>
            <button className="button subtle" onClick={handleDownloadCsv}>
              Download CSV
            </button>
          </div>
          <div className="table-scroll">
            <table className="review-table">
              <thead>
                <tr>
                  <th className="col-number">Sheet #</th>
                  <th className="col-title">Title</th>
                  <th>Revision</th>
                  <th>Drawing Date</th>
                  <th>Received Date</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet) => (
                  <tr key={sheet.id}>
                    <td className="mono">{sheet.sheetNumber}</td>
                    <td>{sheet.title}</td>
                    <td>{sheet.revision}</td>
                    <td>{sheet.drawingDate}</td>
                    <td>{sheet.receivedDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <ApplyMetadataPanel
          projectId={projectId}
          sheets={sheets}
          progress={progress}
        />
      )}
    </section>
  );
}
