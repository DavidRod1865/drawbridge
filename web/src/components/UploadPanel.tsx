import { useState } from 'react';
import { StatusBadge, type StatusTone } from './StatusBadge.tsx';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SheetProgress, UploadResult } from '../lib/upload.ts';
import type { PlannedSheet } from '../lib/validation.ts';
import { sheetsToCsv, sheetsToTsv } from '../lib/exportSummary.ts';

interface Props {
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

const PHASE_TONE: Record<SheetProgress['phase'], StatusTone> = {
  pending: 'duplicate',
  'uploading-file': 'new',
  uploaded: 'new',
  registered: 'revision',
  failed: 'blocked',
};

export function UploadPanel({
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
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <strong className="font-heading">
          {running ? 'Uploading to Procore' : result ? 'Upload complete' : 'Upload'}
        </strong>
        <span className="text-sm text-muted-foreground">
          {done} of {sheets.length} registered
        </span>
        {result && result.failed > 0 && (
          <StatusBadge tone="blocked">{result.failed} failed</StatusBadge>
        )}
      </div>

      <Progress value={percent} className="rounded-none" />

      {result?.registrationError && (
        <Alert variant="destructive" className="m-4">
          <AlertDescription>
            Files reached storage but Procore rejected the batch: {result.registrationError}{' '}
            Retrying re-registers them without re-uploading.
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto">
        <Table className="min-w-[1040px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Sheet #</TableHead>
              <TableHead className="w-[330px]">Title</TableHead>
              <TableHead className="w-[250px]">Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheets.map((sheet) => {
              const state = progress.get(sheet.id);
              const phase = state?.phase ?? 'pending';
              return (
                <TableRow key={sheet.id} className="hover:bg-muted">
                  <TableCell className="font-mono text-[13px]">{sheet.sheetNumber}</TableCell>
                  <TableCell>{sheet.title}</TableCell>
                  <TableCell>
                    <StatusBadge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</StatusBadge>
                    {state?.error && (
                      <div className="mt-1 text-xs leading-snug text-destructive">{state.error}</div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-4 border-t px-4 py-3">
        {result && result.failed === 0 && (
          <span className="text-sm text-muted-foreground">
            Sheets are in Procore's <strong>Items to Review</strong> queue — its OCR reads sheet
            numbers and titles from the same title blocks this app parsed, and organizes them by
            discipline. Use the reference table below to confirm the dates and revision labels OCR
            doesn't capture as you approve them in Procore.
          </span>
        )}

        {procoreUrl && result && (
          <Button asChild variant="outline">
            <a href={procoreUrl} target="_blank" rel="noreferrer">
              Open in Procore
            </a>
          </Button>
        )}

        {result && result.failed > 0 && <Button onClick={onRetry}>Retry {result.failed} failed</Button>}

        {result && result.failed === 0 && <Button onClick={onDone}>Upload another package</Button>}
      </div>

      {result && (
        <div className="m-4 overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-3">
            <strong className="font-heading">Reference table</strong>
            <span className="text-sm text-muted-foreground">
              Procore's review screen won't show revision or date metadata — use this while
              confirming sheets by hand.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? 'Copied' : 'Copy as table'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadCsv}>
              Download CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[1040px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Sheet #</TableHead>
                  <TableHead className="w-[330px]">Title</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Drawing Date</TableHead>
                  <TableHead>Received Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((sheet) => (
                  <TableRow key={sheet.id} className="hover:bg-muted">
                    <TableCell className="font-mono text-[13px]">{sheet.sheetNumber}</TableCell>
                    <TableCell>{sheet.title}</TableCell>
                    <TableCell>{sheet.revision}</TableCell>
                    <TableCell>{sheet.drawingDate}</TableCell>
                    <TableCell>{sheet.receivedDate}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </section>
  );
}
