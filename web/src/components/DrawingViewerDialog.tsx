import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { drawingAssetUrl } from '../lib/api.ts';
import type { DrawingRevision } from '../lib/procore.ts';

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
// Breathing room so the sheet never touches the scroll container's edges.
const FIT_PADDING = 32;

interface Props {
  projectId: number;
  /** The sheets the viewer can page through — typically one discipline group. */
  rows: readonly DrawingRevision[];
  /** Index into `rows` of the open sheet. The dialog is only mounted when this is >= 0. */
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}

/**
 * Full-screen zoomable viewer for a drawing already in Procore.
 *
 * Unlike SheetPreviewDialog (which renders a local PDF the user is about to upload via
 * pdf.js), this shows Procore's own high-resolution PNG raster of the sheet, streamed
 * same-origin through /api/drawings. That keeps the viewer to a plain <img> — no pdf.js,
 * no canvas — because the file already exists rendered on Procore's side.
 *
 * Zoom scales the image via CSS width. The source is ~6400px wide, so magnifying to read
 * a title block stays legible; re-fetching a vector PDF per zoom step would be needless
 * work for a sheet Procore has already rasterized.
 */
export function DrawingViewerDialog({ projectId, rows, index, onIndexChange, onClose }: Props) {
  const row = rows[index];

  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Set on each sheet load, cleared after the first paint positions the view at the
  // title block — so later zooming never re-jumps the scroll.
  const initialScrollPendingRef = useRef(false);

  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Reset view state whenever the open sheet changes.
  useEffect(() => {
    setZoom(1);
    setLoading(true);
    setError(false);
    initialScrollPendingRef.current = true;
  }, [row?.id]);

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

  // Width the image is drawn at: fills the container at zoom 1, scales from there.
  const displayWidth = viewportWidth > 0 ? Math.max(1, (viewportWidth - FIT_PADDING) * zoom) : 0;

  const zoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP)), []);
  const fitWidth = useCallback(() => setZoom(1), []);

  const canPrev = index > 0;
  const canNext = index < rows.length - 1;

  // Arrow keys page between sheets.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft' && canPrev) onIndexChange(index - 1);
      if (event.key === 'ArrowRight' && canNext) onIndexChange(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, canPrev, canNext, onIndexChange]);

  // Ctrl/⌘ + wheel zooms; a plain wheel scrolls. Native non-passive listener so
  // preventDefault actually suppresses the browser's own page zoom (React binds onWheel
  // passively, where preventDefault would no-op).
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

  // Drag-to-pan — construction sheets are wider than any screen.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  function onPointerDown(event: React.PointerEvent) {
    const el = scrollRef.current;
    if (!el) return;
    // Don't hijack presses on the overlay controls. setPointerCapture would otherwise
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

  function onImageLoad() {
    setLoading(false);
    // One-time jump to the bottom-right title block, after the image has its real size.
    if (initialScrollPendingRef.current) {
      const el = scrollRef.current;
      if (el) {
        el.scrollLeft = el.scrollWidth;
        el.scrollTop = el.scrollHeight;
      }
      initialScrollPendingRef.current = false;
    }
  }

  if (!row) return null;

  const zoomPercent = Math.round(zoom * 100);
  const src = drawingAssetUrl(projectId, row.id, 'png');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[95vw]">
        <DialogTitle className="sr-only">
          {row.number} — {row.title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Zoomable view of the drawing sheet as stored in Procore.
        </DialogDescription>

        {/* Header: which sheet, and paging. pr-10 keeps nav clear of the dialog's close (X). */}
        <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-2 pr-12">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-sm font-semibold">{row.number}</span>
            <span className="truncate text-sm text-muted-foreground">{row.title}</span>
            {row.revision_number && (
              <span className="shrink-0 text-xs text-muted-foreground">Rev {row.revision_number}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {index + 1} of {rows.length}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => onIndexChange(index - 1)} disabled={!canPrev} aria-label="Previous sheet">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => onIndexChange(index + 1)} disabled={!canNext} aria-label="Next sheet">
              <ChevronRight />
            </Button>
          </div>
        </div>

        {/*
         * Stage wrapper. The scroll container (native scroll pans, drag pans, Ctrl+wheel
         * zooms) sits absolutely inside this non-scrolling wrapper so the overlaid hint
         * and zoom controls anchor to the *visible* stage. Nested inside the scroll
         * container they would anchor to its scrollHeight and scroll out of view the
         * moment the sheet grew taller than the viewport.
         */}
        <div className="relative min-h-0 flex-1 bg-muted/40">
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
                  <p className="text-sm text-muted-foreground">
                    This sheet's image isn't available from Procore yet.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid min-h-full place-items-center p-4">
                <img
                  ref={imgRef}
                  key={row.id}
                  src={src}
                  alt={`${row.number} ${row.title}`}
                  onLoad={onImageLoad}
                  onError={() => {
                    setLoading(false);
                    setError(true);
                  }}
                  draggable={false}
                  className="max-w-none rounded-sm bg-white shadow-md select-none"
                  style={displayWidth > 0 ? { width: `${displayWidth}px` } : undefined}
                />
              </div>
            )}
          </div>

          {loading && !error && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}

          {!error && (
            <>
              {/* How to drive the viewer — mouse/keyboard aren't discoverable on their own. */}
              <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border bg-card/95 px-3 py-1 text-[11px] whitespace-nowrap text-muted-foreground shadow-sm backdrop-blur">
                Drag to pan · Ctrl/⌘ + scroll to zoom · ← → to change sheet
              </div>

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
                <Button variant="ghost" size="sm" onClick={fitWidth} aria-label="Fit width" className="gap-1.5">
                  <Maximize2 />
                  Fit
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
