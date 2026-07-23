import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DisciplineField } from './DisciplineField.tsx';
import { StatusBadge, type StatusTone } from './StatusBadge.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { loadDocument, renderPageToCanvas } from '../lib/pdf.ts';
import type { Outcome, PlannedSheet, SheetVerdict } from '../lib/validation.ts';

// A pdf.js document proxy — inferred rather than importing pdfjs' own types, which live
// under a deep /types path (see pdf.ts). Held in a ref so it can be destroyed on change.
type PdfDoc = Awaited<ReturnType<typeof loadDocument>>;

// The three fields the preview lets a user correct, held as a draft until they commit.
interface SheetDraft {
  sheetNumber: string;
  title: string;
  discipline: string | null;
}

// Same labels the review table shows, kept in sync by eye — six short strings not worth
// a shared export and the coupling it would add.
const OUTCOME_LABEL: Record<Outcome, string> = {
  new: 'New',
  revision: 'Revision',
  duplicate: 'Duplicate',
  older: 'Older',
  unknown: 'Check',
  blocked: 'Needs fix',
};

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
// Breathing room around the page so it never touches the scroll container's edges.
const FIT_PADDING = 32;

interface Props {
  sheets: readonly PlannedSheet[];
  /** Index into `sheets` of the open sheet. The dialog is only mounted when this is >= 0. */
  index: number;
  files: ReadonlyMap<string, File>;
  verdicts: ReadonlyMap<string, SheetVerdict>;
  onUpdate: (ids: readonly string[], patch: Partial<PlannedSheet>) => void;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}

/**
 * Full-screen zoomable preview of one parsed sheet, so a user unsure of a guessed number
 * or title can read the title block and correct it before upload.
 *
 * Rendering discipline mirrors the rest of the app: only the open page's pdf.js document
 * is resident, and it is destroyed the moment the user pages to another sheet or closes.
 * Zoom re-renders the page at a higher scale (crisp text) rather than CSS-scaling one
 * bitmap (which blurs exactly where the user is trying to read).
 */
export function SheetPreviewDialog({
  sheets,
  index,
  files,
  verdicts,
  onUpdate,
  onIndexChange,
  onClose,
}: Props) {
  const sheet = sheets[index];

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  // Bumped on every sheet load; a resolved async render for a stale token is discarded so
  // fast prev/next paging never paints the wrong sheet.
  const loadTokenRef = useRef(0);
  // The load token still awaiting its one-time scroll to the title block. Set on load,
  // cleared after the first render positions the view — so zooming later never re-jumps.
  const initialScrollTokenRef = useRef(-1);

  // Edits are held here, keyed by sheet id, and only pushed to the table on Update.
  // Closing (Cancel / X / Escape) drops them, so the table keeps what it already had.
  // Keeping a map (not a single draft) lets the user page through sheets editing several,
  // then commit or discard them all at once.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, SheetDraft>>(new Map());

  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the open sheet's page. Depends on the sheet id (a stable string), not the sheet
  // object, so editing its number/title in the sidebar never reloads the document.
  useEffect(() => {
    if (!sheet) return;
    const token = ++loadTokenRef.current;
    // Open looking at the bottom-right title block — where the sheet number and title the
    // user is here to confirm actually live.
    initialScrollTokenRef.current = token;
    setLoading(true);
    setError(null);
    setPageSize(null);
    setZoom(1);

    const file = files.get(sheet.id);
    if (!file) {
      setError('The source file is no longer available. Re-add it to preview.');
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const doc = await loadDocument(await file.arrayBuffer());
        if (token !== loadTokenRef.current) {
          await doc.destroy();
          return;
        }
        docRef.current = doc;
        const page = await doc.getPage(sheet.pageIndex + 1);
        const viewport = page.getViewport({ scale: 1 });
        if (token !== loadTokenRef.current) return;
        setPageSize({ width: viewport.width, height: viewport.height });
      } catch {
        if (token === loadTokenRef.current) {
          setError('Could not render this page.');
          setLoading(false);
        }
      }
    })();

    return () => {
      // Tearing down (or moving to the next sheet) invalidates the in-flight render and
      // releases the worker's copy of the document.
      loadTokenRef.current++;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [sheet?.id, sheet?.pageIndex, files]);

  // Track the scroll container's width so "fit" always fills it, even on window resize.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scale that makes the page fill the available width at zoom 1.
  const fitScale =
    pageSize && viewportWidth > 0
      ? Math.max(0.05, (viewportWidth - FIT_PADDING) / pageSize.width)
      : 1;

  // Render (and re-render on zoom / resize) at device resolution. Debounced so a burst of
  // wheel-zoom ticks collapses into one render.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || !pageSize || !sheet) return;

    const token = loadTokenRef.current;
    const dpr = window.devicePixelRatio || 1;
    const scale = fitScale * zoom * dpr;

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const dims = await renderPageToCanvas(doc, sheet.pageIndex + 1, canvas, scale);
          if (token !== loadTokenRef.current) return;
          canvas.style.width = `${dims.width}px`;
          canvas.style.height = `${dims.height}px`;
          setLoading(false);

          // One-time jump to the bottom-right title block, only on this sheet's first
          // render — after the canvas has its real size so scrollWidth/Height are known.
          if (initialScrollTokenRef.current === token) {
            const el = scrollRef.current;
            if (el) {
              el.scrollLeft = el.scrollWidth;
              el.scrollTop = el.scrollHeight;
            }
            initialScrollTokenRef.current = -1;
          }
        } catch {
          if (token === loadTokenRef.current) {
            setError('Could not render this page.');
            setLoading(false);
          }
        }
      })();
    }, 60);

    return () => window.clearTimeout(handle);
  }, [pageSize, zoom, fitScale, sheet?.pageIndex]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP)), []);
  const fitWidth = useCallback(() => setZoom(1), []);

  const canPrev = index > 0;
  const canNext = index < sheets.length - 1;

  // Arrow keys page between sheets — but never while the user is typing in an edit field,
  // where the arrows must move the caret instead.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (typing) return;
      if (event.key === 'ArrowLeft' && canPrev) onIndexChange(index - 1);
      if (event.key === 'ArrowRight' && canNext) onIndexChange(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, canPrev, canNext, onIndexChange]);

  // Ctrl/⌘ + wheel zooms; a plain wheel scrolls (pans) natively. A native, non-passive
  // listener is required: React binds onWheel passively, so preventDefault would no-op
  // there and the browser's own page zoom would fire underneath us.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => {
        const next = event.deltaY < 0 ? z * ZOOM_STEP : z / ZOOM_STEP;
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag-to-pan by nudging the scroll offset — construction drawings are wider than any
  // screen, so grabbing and dragging is the expected gesture.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  function onPointerDown(event: React.PointerEvent) {
    const el = scrollRef.current;
    if (!el) return;
    // Don't hijack presses on the overlay zoom controls. setPointerCapture would otherwise
    // redirect the resulting click to this container, so the zoom buttons never fire.
    if ((event.target as HTMLElement).closest('button')) return;
    // Left button only — right-click / middle-click shouldn't start a pan.
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent) {
    const el = scrollRef.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  }
  function onPointerUp(event: React.PointerEvent) {
    drag.current = null;
    scrollRef.current?.releasePointerCapture(event.pointerId);
  }

  if (!sheet) return null;

  const verdict = verdicts.get(sheet.id);
  const tone: StatusTone = verdict?.outcome ?? 'new';
  const zoomPercent = Math.round(fitScale * zoom * 100);

  // Show the draft for this sheet if one exists, otherwise the table's committed values.
  const draft = drafts.get(sheet.id);
  const sheetNumberValue = draft ? draft.sheetNumber : sheet.sheetNumber ?? '';
  const titleValue = draft ? draft.title : sheet.title ?? '';
  const disciplineValue = draft ? draft.discipline : sheet.discipline;
  const hasEdits = drafts.size > 0;

  // Seed a draft from the current sheet on first edit, then patch the changed field.
  function editField(patch: Partial<SheetDraft>) {
    if (!sheet) return;
    const current = sheet;
    setDrafts((existing) => {
      const next = new Map(existing);
      const base = next.get(current.id) ?? {
        sheetNumber: current.sheetNumber ?? '',
        title: current.title ?? '',
        discipline: current.discipline,
      };
      next.set(current.id, { ...base, ...patch });
      return next;
    });
  }

  // Update: push every drafted sheet to the table in one go, then return to it.
  function commit() {
    for (const [id, d] of drafts) {
      onUpdate([id], { sheetNumber: d.sheetNumber, title: d.title, discipline: d.discipline });
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[95vw]"
      >
        <DialogTitle className="sr-only">
          Preview {sheet.sheetNumber ?? sheet.sourceFile}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Zoomable preview of the drawing to confirm its sheet number and title.
        </DialogDescription>

        <div className="flex min-h-0 flex-1">
          {/*
           * Canvas stage. The scroll container sits absolutely inside this non-scrolling
           * cell so the overlaid hint and zoom controls anchor to the *visible* stage.
           * Nested inside the scroll container they anchored to its scrollHeight and — since
           * this preview opens scrolled to the bottom-right title block — sat far off-screen.
           */}
          <div className="relative min-w-0 flex-1 bg-muted/40">
            <div
              ref={scrollRef}
              className="absolute inset-0 cursor-grab overflow-auto active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {error ? (
                <div className="grid h-full place-items-center p-6">
                  <div className="flex max-w-sm flex-col items-center gap-2 text-center">
                    <AlertTriangle className="size-6 text-muted-foreground" aria-hidden />
                    <p className="text-sm text-muted-foreground">{error}</p>
                  </div>
                </div>
              ) : (
                <div className="grid min-h-full place-items-center p-4">
                  {/* select-none so dragging to pan never starts a text selection. */}
                  <canvas
                    ref={canvasRef}
                    className="max-w-none rounded-sm bg-white shadow-md select-none"
                  />
                </div>
              )}
            </div>

            {loading && !error && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
              </div>
            )}

            {/* Zoom controls, pinned bottom-center of the stage so they never scroll away. */}
            {!error && (
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur">
                <Button variant="ghost" size="icon-sm" onClick={zoomOut} aria-label="Zoom out">
                  <ZoomOut />
                </Button>
                <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                  {zoomPercent}%
                </span>
                <Button variant="ghost" size="icon-sm" onClick={zoomIn} aria-label="Zoom in">
                  <ZoomIn />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fitWidth}
                  aria-label="Fit width"
                  className="gap-1.5"
                >
                  <Maximize2 />
                  Fit
                </Button>
              </div>
            )}
          </div>

          {/* Sidebar: edit metadata against the drawing, and page between sheets.
              pr-10 on the header row keeps the nav buttons clear of the dialog's close (X),
              which floats over the top-right corner. */}
          <aside className="flex w-72 shrink-0 flex-col gap-4 border-l bg-card p-4">
            <div className="flex items-center justify-between gap-2 pr-10">
              <span className="text-xs text-muted-foreground">
                Sheet {index + 1} of {sheets.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => onIndexChange(index - 1)}
                  disabled={!canPrev}
                  aria-label="Previous sheet"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => onIndexChange(index + 1)}
                  disabled={!canNext}
                  aria-label="Next sheet"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge tone={tone}>{OUTCOME_LABEL[verdict?.outcome ?? 'new']}</StatusBadge>
              {sheet.needsOcr ? (
                <span className="text-xs text-muted-foreground">
                  No text found — check the number and title.
                </span>
              ) : (
                sheet.confidence < 0.5 && (
                  <span className="text-xs text-muted-foreground">Low confidence — please verify.</span>
                )
              )}
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Sheet #</Label>
              <Input
                className="font-mono"
                value={sheetNumberValue}
                placeholder="required"
                onChange={(e) => editField({ sheetNumber: e.target.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Title</Label>
              <Input
                value={titleValue}
                onChange={(e) => editField({ title: e.target.value })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Discipline</Label>
              <DisciplineField
                value={disciplineValue}
                onChange={(value) => editField({ discipline: value })}
              />
            </div>

            <div className="mt-auto grid gap-3">
              <div
                className="text-[11px] leading-snug break-all text-muted-foreground"
                title={sheet.sourceFile}
              >
                {sheet.sourceFile}
              </div>
              {/* Nothing reaches the table until Update; Cancel returns with the originals. */}
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button size="sm" onClick={commit} disabled={!hasEdits}>
                  Update
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
