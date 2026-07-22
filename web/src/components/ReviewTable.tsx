import { useMemo, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { DisciplinePicker } from './DisciplinePicker.tsx';
import { DisciplineField } from './DisciplineField.tsx';
import { StatusBadge, type StatusTone } from './StatusBadge.tsx';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { summarize, validateSheets, type Outcome, type PlannedSheet } from '../lib/validation.ts';
import type { DrawingRevision } from '../lib/procore.ts';

interface Props {
  sheets: readonly PlannedSheet[];
  existingRevisions: readonly DrawingRevision[];
  onUpdate: (ids: readonly string[], patch: Partial<PlannedSheet>) => void;
  /** An upload-level blocker outside per-sheet validation, e.g. no Drawing Set chosen. */
  blockedReason?: string | null;
  /** Destination shown in the header so the user sees where these sheets are going. */
  drawingSetName?: string | null;
  drawingAreaName?: string | null;
  onUpload: () => void;
}

/** English pluralization for the one noun this table counts. */
function sheetCount(n: number): string {
  return `${n} ${n === 1 ? 'sheet' : 'sheets'}`;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  new: 'New',
  revision: 'Revision',
  duplicate: 'Duplicate',
  older: 'Older',
  unknown: 'Check',
  blocked: 'Needs fix',
};

// Ghost input: cell borders carry the grid; controls stay quiet until hover/focus.
const CELL_INPUT =
  'h-8 border-transparent bg-transparent shadow-none hover:border-input hover:bg-background focus-visible:bg-background';

const CELL = 'border border-border p-1.5';
const HEAD = 'border border-border bg-muted/50 px-2 text-xs font-medium';

export function ReviewTable({
  sheets,
  existingRevisions,
  onUpdate,
  blockedReason,
  drawingSetName,
  drawingAreaName,
  onUpload,
}: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

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

  return (
    <section className="w-full overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
        <div className="grid gap-0.5">
          <strong className="font-heading text-base">Review Drawings</strong>
          <span className="text-sm text-muted-foreground">
            {sheetCount(summary.total)}
            {drawingSetName && (
              <>
                {' → '}
                Drawing Set:{' '}
                <span className="font-medium text-foreground">{drawingSetName}</span>
              </>
            )}
            {drawingAreaName && (
              <>
                {' '}
                in Drawing Area:{' '}
                <span className="font-medium text-foreground">{drawingAreaName}</span>
              </>
            )}
          </span>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {summary.new > 0 && <StatusBadge tone="new">{summary.new} new</StatusBadge>}
            {summary.revision > 0 && (
              <StatusBadge tone="revision">{summary.revision} revision</StatusBadge>
            )}
            {summary.duplicate > 0 && (
              <StatusBadge tone="duplicate">{summary.duplicate} duplicate</StatusBadge>
            )}
            {summary.older > 0 && <StatusBadge tone="older">{summary.older} older</StatusBadge>}
            {summary.unknown > 0 && (
              <StatusBadge tone="unknown">{summary.unknown} check</StatusBadge>
            )}
            {summary.blocked > 0 && (
              <StatusBadge tone="blocked">{summary.blocked} needs fix</StatusBadge>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={bulkOpen}
            aria-controls="review-bulk-edit"
            className={cn(
              'h-7 gap-1.5 rounded-md px-2 font-medium text-muted-foreground',
              'hover:bg-muted hover:text-foreground',
              bulkOpen && 'bg-muted text-foreground',
            )}
            onClick={() => setBulkOpen((open) => !open)}
          >
            <SlidersHorizontal data-icon="inline-start" />
            {bulkOpen ? 'Hide bulk edit' : 'Bulk edit'}
            <ChevronDown
              className={cn(
                'size-3.5 opacity-60 transition-transform duration-200',
                bulkOpen && 'rotate-180',
              )}
              data-icon="inline-end"
            />
          </Button>
        </div>
      </div>

      {bulkOpen && (
        <div id="review-bulk-edit" className="border-b px-4 py-3">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Bulk edit
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedIds.length > 0
                ? `Applying to ${selectedIds.length} selected sheet${selectedIds.length === 1 ? '' : 's'}`
                : `Applying to all ${sheetCount(sheets.length)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Discipline</Label>
              <DisciplinePicker onPick={(value) => applyToSelection({ discipline: value })} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Revision</Label>
              <Input
                className="h-[34px] w-16"
                placeholder="auto"
                onBlur={(e) => e.target.value && applyToSelection({ revision: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Drawing date</Label>
              <Input
                type="date"
                className="h-[34px] w-[150px]"
                onChange={(e) =>
                  e.target.value && applyToSelection({ drawingDate: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Received</Label>
              <Input
                type="date"
                className="h-[34px] w-[150px]"
                onChange={(e) =>
                  e.target.value && applyToSelection({ receivedDate: e.target.value })
                }
              />
            </div>
          </div>
        </div>
      )}

      <div className="max-h-[62vh] overflow-auto">
        {/* border-collapse + per-cell borders = real grid (border-r alone was too easy to miss). */}
        <Table className="w-full min-w-[1060px] table-fixed border-collapse">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(HEAD, 'w-10 text-center')}>
                <Checkbox
                  checked={allSelected}
                  aria-label="Select all sheets"
                  onCheckedChange={() =>
                    setSelected(allSelected ? new Set() : new Set(sheets.map((s) => s.id)))
                  }
                />
              </TableHead>
              <TableHead className={cn(HEAD, 'w-[116px]')}>Sheet #</TableHead>
              <TableHead className={cn(HEAD, 'min-w-0')}>Title</TableHead>
              <TableHead className={cn(HEAD, 'w-[150px] text-center')}>Discipline</TableHead>
              <TableHead className={cn(HEAD, 'w-14 text-center')}>Rev</TableHead>
              <TableHead className={cn(HEAD, 'w-[150px] text-center')}>Drawing Date</TableHead>
              <TableHead className={cn(HEAD, 'w-[150px] text-center')}>Received</TableHead>
              <TableHead className={cn(HEAD, 'w-[100px] text-center')}>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheets.map((sheet) => {
              const verdict = verdicts.get(sheet.id);
              const issues = verdict?.issues ?? [];
              const isBlocked = issues.some((i) => i.blocking);
              const tone: StatusTone = verdict?.outcome ?? 'new';

              return (
                <TableRow
                  key={sheet.id}
                  // A left rule marks blocked rows without repainting the whole row red.
                  className={cn(
                    'hover:bg-muted/60',
                    isBlocked &&
                      'bg-destructive/[0.03] shadow-[inset_3px_0_0_var(--destructive)] hover:bg-destructive/[0.06]',
                  )}
                >
                  <TableCell className={cn(CELL, 'text-center')}>
                    <Checkbox
                      checked={selected.has(sheet.id)}
                      aria-label={`Select sheet ${sheet.sheetNumber ?? ''}`}
                      onCheckedChange={() => toggle(sheet.id)}
                    />
                  </TableCell>
                  <TableCell className={CELL}>
                    <Input
                      className={cn(CELL_INPUT, 'font-mono')}
                      value={sheet.sheetNumber ?? ''}
                      placeholder="required"
                      onChange={(e) => onUpdate([sheet.id], { sheetNumber: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className={cn(CELL, 'min-w-0 whitespace-normal')}>
                    <Input
                      className={cn(CELL_INPUT, 'w-full min-w-0')}
                      value={sheet.title ?? ''}
                      onChange={(e) => onUpdate([sheet.id], { title: e.target.value })}
                    />
                    {/* Full filename lives under title — wide enough to wrap, no extra row. */}
                    <div
                      className="mt-0.5 px-2.5 text-[11px] leading-snug break-all text-muted-foreground"
                      title={sheet.sourceFile}
                    >
                      {sheet.sourceFile}
                    </div>
                  </TableCell>
                  <TableCell className={CELL}>
                    <DisciplineField
                      value={sheet.discipline}
                      onChange={(value) => onUpdate([sheet.id], { discipline: value })}
                    />
                  </TableCell>
                  <TableCell className={cn(CELL, 'text-center')}>
                    <Input
                      className={cn(CELL_INPUT, 'w-full text-center')}
                      value={sheet.revision}
                      placeholder="auto"
                      onChange={(e) => onUpdate([sheet.id], { revision: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className={cn(CELL, 'text-center')}>
                    <Input
                      type="date"
                      className={cn(CELL_INPUT, 'w-full text-center')}
                      value={sheet.drawingDate ?? ''}
                      onChange={(e) =>
                        onUpdate([sheet.id], {
                          drawingDate: e.target.value ? e.target.value : null,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className={cn(CELL, 'text-center')}>
                    <Input
                      type="date"
                      className={cn(CELL_INPUT, 'w-full text-center')}
                      value={sheet.receivedDate ?? ''}
                      onChange={(e) =>
                        onUpdate([sheet.id], {
                          receivedDate: e.target.value ? e.target.value : null,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className={cn(CELL, 'whitespace-normal text-center')}>
                    <StatusBadge tone={tone}>
                      {OUTCOME_LABEL[verdict?.outcome ?? 'new']}
                    </StatusBadge>
                    {issues.map((issue) => (
                      <div
                        key={issue.code}
                        className={cn(
                          'mt-1 text-xs leading-snug break-words',
                          issue.blocking ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {issue.message}
                      </div>
                    ))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-4 border-t px-4 py-3">
        {(!summary.canUpload || blockedReason) && (
          <span className="text-sm text-muted-foreground">
            {blockedReason
              ? blockedReason
              : summary.blocked > 0
                ? `Resolve ${summary.blocked} sheet(s) before uploading.`
                : 'Nothing to upload — every sheet is already in Procore.'}
          </span>
        )}
        <Button
          disabled={!summary.canUpload || Boolean(blockedReason)}
          onClick={onUpload}
        >
          Upload {sheetCount(summary.new + summary.revision + summary.older + summary.unknown)}
        </Button>
      </div>
    </section>
  );
}
