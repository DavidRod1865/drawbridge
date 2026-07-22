import { useEffect, useState } from 'react';
import { CreatableSelect } from './CreatableSelect.tsx';
import { DropZone } from './DropZone.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { DrawingSet } from '../lib/procore.ts';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sets: readonly DrawingSet[];
  setId: number | null;
  onSetChange: (id: number) => void;
  /** Creates (or drafts) a set and resolves to it — App may defer the Procore POST. */
  onCreateSet: (name: string) => Promise<DrawingSet>;
  /** Lifts a newly resolved set into App state when it is a real Procore resource. */
  onCreatedSet: (set: DrawingSet) => void;
  /** Batch dates (YYYY-MM-DD) stamped onto every sheet in this upload. */
  drawingDate: string;
  receivedDate: string;
  onDrawingDateChange: (value: string) => void;
  onReceivedDateChange: (value: string) => void;
  onFiles: (files: File[]) => void;
  /** Parse progress from the package store while sheets are being read. */
  parsing: { done: number; total: number; current: string } | null;
  problems: readonly { file: string; message: string }[];
  busy?: boolean;
}

/**
 * Two-step "add drawings" wizard: pick the Drawing Set, then upload files.
 *
 * The Drawing Set and the upload used to sit inline; folding them into a guided modal
 * keeps the workspace focused on browsing the area's existing drawings until the user
 * deliberately starts adding. The dialog owns only which step is showing — the parsed
 * package lives in App, which closes this once sheets appear (see the effect there).
 */
export function AddDrawingDialog({
  open,
  onOpenChange,
  sets,
  setId,
  onSetChange,
  onCreateSet,
  onCreatedSet,
  drawingDate,
  receivedDate,
  onDrawingDateChange,
  onReceivedDateChange,
  onFiles,
  parsing,
  problems,
  busy,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);

  // Reopen always starts at step 1; the chosen set persists in App, so returning users
  // still see their previous pick pre-filled on step 1.
  useEffect(() => {
    if (open) setStep(1);
  }, [open]);

  const selectedSet = sets.find((set) => set.id === setId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add drawings</DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Choose the Drawing Set and dates for these sheets.'
              : 'Drop in the PDFs — multi-page files are split into sheets automatically.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step rail */}
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={cn(step === 1 && 'text-foreground')}>1 · Details</span>
          <span className="h-px flex-1 bg-border" />
          <span className={cn(step === 2 && 'text-foreground')}>2 · Upload</span>
        </div>

        {step === 1 ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                Drawing Set
              </span>
              <CreatableSelect
                items={sets}
                value={setId}
                placeholder="Choose a set…"
                createLabel="+ New Drawing Set…"
                newLabel="New set name"
                onCreate={onCreateSet}
                onChange={onSetChange}
                onCreated={onCreatedSet}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                  Drawing date
                </span>
                <Input
                  type="date"
                  className="h-[34px]"
                  value={drawingDate}
                  onChange={(event) => onDrawingDateChange(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                  Received date
                </span>
                <Input
                  type="date"
                  className="h-[34px]"
                  value={receivedDate}
                  onChange={(event) => onReceivedDateChange(event.target.value)}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Applied to every sheet in this upload — you can still adjust individual rows in the
              review table.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 py-2">
            {selectedSet && (
              <p className="text-xs text-muted-foreground">
                Uploading into <span className="font-medium text-foreground">{selectedSet.name}</span>.
              </p>
            )}
            <DropZone onFiles={onFiles} disabled={busy || parsing !== null} />
            {parsing && (
              <p className="text-sm text-muted-foreground">
                Parsing {parsing.done + 1} of {parsing.total}: {parsing.current}
              </p>
            )}
            {problems.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription className="grid gap-1">
                  {problems.map((problem) => (
                    <div key={problem.file}>
                      <strong>{problem.file}</strong>: {problem.message}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {step === 1 ? (
            <>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button disabled={setId === null} onClick={() => setStep(2)}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
