import { useEffect, useState } from 'react';
import { ArrowLeftRight, Building2, ChevronRight, FolderOpen, Home, LogOut, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LoginScreen } from './components/LoginScreen.tsx';
import { ProjectPicker } from './components/ProjectPicker.tsx';
import { AddDrawingDialog } from './components/AddDrawingDialog.tsx';
import { ReviewTable } from './components/ReviewTable.tsx';
import { DrawingAreaBrowser } from './components/DrawingAreaBrowser.tsx';
import { AreaDrawings } from './components/AreaDrawings.tsx';
import { UploadPanel } from './components/UploadPanel.tsx';
import { useAuth } from './state/useAuth.ts';
import { usePackage } from './state/usePackage.ts';
import { NotAuthenticatedError, setCompanyId } from './lib/api.ts';
import { nextRevision } from './lib/revision.ts';
import {
  pageBytesFrom,
  putFileToStorage,
  runUpload,
  type SheetProgress,
  type UploadResult,
} from './lib/upload.ts';
import { normalizeSheetNumber } from './lib/sheetNumber.ts';
import {
  PENDING_DRAWING_SET_ID,
  isPendingDrawingSetId,
  resolveDrawingSetId,
} from './lib/pendingDrawingSet.ts';
import type { PlannedSheet } from './lib/validation.ts';
import {
  createDrawing,
  createDrawingArea,
  createDrawingSet,
  createDrawingUpload,
  createProjectUpload,
  listCurrentRevisions,
  listDrawingAreas,
  listDrawingSets,
  type Company,
  type DrawingArea,
  type DrawingRevision,
  type DrawingSet,
  type Project,
} from './lib/procore.ts';

/** Local calendar date as YYYY-MM-DD — the default for a fresh upload batch. */
const todayISO = () => new Date().toISOString().slice(0, 10);

export function App() {
  const { state, refresh, logout } = useAuth();
  const [selection, setSelection] = useState<{ company: Company; project: Project } | null>(null);
  const [areas, setAreas] = useState<DrawingArea[]>([]);
  // Procore Drawing Sets only — never holds the session draft.
  const [sets, setSets] = useState<DrawingSet[]>([]);
  const [revisions, setRevisions] = useState<DrawingRevision[]>([]);
  // Drawing Set and Drawing Area are chosen once for the whole package rather than
  // per sheet: a package is uploaded into one set and one area in practice, and
  // repeating the choice on every row was pure friction.
  const [setId, setSetId] = useState<number | null>(null);
  // Name for a set typed via "+ New" that has not been POSTed to Procore yet.
  // Cleared on discard / project change; materialized in startUpload.
  const [pendingSetName, setPendingSetName] = useState<string | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  // The "Add drawings" wizard (Drawing Set → upload). Opened from the area view.
  const [addOpen, setAddOpen] = useState(false);
  // Batch dates chosen in the wizard, stamped onto every new sheet (default today).
  const [drawingDate, setDrawingDate] = useState(todayISO);
  const [receivedDate, setReceivedDate] = useState(todayISO);

  // Upload run state. Progress is kept across attempts so a retry resumes rather than
  // restarting — re-running a completed sheet would duplicate it in Procore.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<ReadonlyMap<string, SheetProgress>>(
    new Map(),
  );
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const pkg = usePackage();
  const { sheets, updateSheets } = pkg;

  useEffect(() => {
    if (!selection) return;
    setLoadingProject(true);
    setProjectError(null);

    Promise.all([
      listDrawingAreas(selection.project.id),
      listDrawingSets(selection.project.id),
      listCurrentRevisions(selection.project.id),
    ])
      .then(([nextAreas, nextSets, nextRevisions]) => {
        setAreas(nextAreas);
        setSets(nextSets);
        setRevisions(nextRevisions);
      })
      .catch((cause: unknown) => {
        if (cause instanceof NotAuthenticatedError) {
          void refresh();
          return;
        }
        setProjectError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoadingProject(false));
  }, [selection, refresh]);

  // The package-level Drawing Area choice fans out to every sheet, so per-sheet
  // validation still sees an explicit assignment.
  useEffect(() => {
    if (areaId === null || sheets.length === 0) return;
    const stale = sheets.filter((sheet) => sheet.drawingAreaId !== areaId).map((s) => s.id);
    if (stale.length > 0) updateSheets(stale, { drawingAreaId: areaId });
  }, [areaId, sheets, updateSheets]);

  /**
   * Seeds each freshly-parsed sheet from what Procore already holds in the SELECTED
   * Drawing Area: the revision label (a sheet Procore has never seen starts at 0, an
   * existing one advances from its current revision) and the existing drawing's
   * discipline (so the app shows what Procore keeps rather than our parsed guess — a
   * revision cannot override discipline at upload).
   *
   * Both are area-scoped, which is correct because the Area is chosen before files are
   * added: the match is right on the first pass, no recompute-on-change needed. Only a
   * blank-revision sheet is touched, so a user edit is never overwritten and the effect
   * cannot loop (a seeded sheet is not revisited).
   */
  useEffect(() => {
    if (sheets.length === 0) return;

    const currentByAreaNumber = new Map<string, DrawingRevision>();
    for (const revision of revisions) {
      if (revision.current) {
        currentByAreaNumber.set(
          `${revision.drawing_area.id}:${normalizeSheetNumber(revision.number)}`,
          revision,
        );
      }
    }

    for (const sheet of sheets) {
      if (sheet.revision !== '' || !sheet.sheetNumber || sheet.drawingAreaId === null) continue;
      const existing = currentByAreaNumber.get(
        `${sheet.drawingAreaId}:${normalizeSheetNumber(sheet.sheetNumber)}`,
      );
      const suggested = nextRevision(existing?.revision_number ?? null);

      const patch: Partial<PlannedSheet> = {};
      if (suggested !== null) patch.revision = suggested; // else: unrecognized scheme, leave it
      if (existing?.discipline && existing.discipline.name !== sheet.discipline) {
        patch.discipline = existing.discipline.name;
      }
      if (Object.keys(patch).length > 0) updateSheets([sheet.id], patch);
    }
  }, [areaId, sheets, revisions, updateSheets]);

  // Once parsing yields sheets, the wizard's job is done — close it so the review
  // table (rendered underneath) takes over. The dialog only tracks its own step.
  useEffect(() => {
    if (sheets.length > 0) setAddOpen(false);
  }, [sheets.length]);

  // Procore requires a drawing_date on every import. Stamp the wizard's chosen dates
  // (defaulting to today) onto any sheet still missing them; only blank fields are
  // touched, so a per-row edit in the review table is never overwritten and the effect
  // can't loop. Empty strings are skipped so clearing a date leaves it genuinely blank.
  useEffect(() => {
    const noDrawingDate = sheets.filter((s) => !s.drawingDate).map((s) => s.id);
    const noReceivedDate = sheets.filter((s) => !s.receivedDate).map((s) => s.id);
    if (drawingDate && noDrawingDate.length > 0) updateSheets(noDrawingDate, { drawingDate });
    if (receivedDate && noReceivedDate.length > 0) updateSheets(noReceivedDate, { receivedDate });
  }, [sheets, drawingDate, receivedDate, updateSheets]);

  function clearPendingSet() {
    setPendingSetName(null);
    if (setId !== null && isPendingDrawingSetId(setId)) setSetId(null);
  }

  function handleSetChange(id: number) {
    // Picking a real Procore set drops any unused draft so it cannot linger in the list.
    if (!isPendingDrawingSetId(id)) setPendingSetName(null);
    setSetId(id);
  }

  function handleAddOpenChange(open: boolean) {
    setAddOpen(open);
    // Cancelled without producing sheets: the draft never became a Procore set.
    if (!open && sheets.length === 0) clearPendingSet();
  }

  /** Reset the in-project workspace to its landing (area browser), keeping the project. */
  function returnHome() {
    setAreaId(null);
    setSetId(null);
    setPendingSetName(null);
    setDrawingDate(todayISO());
    setReceivedDate(todayISO());
    setUploadResult(null);
    setUploadProgress(new Map());
    setAddOpen(false);
    pkg.reset();
  }

  /** Leave the project entirely — back to the picker to change company or project. */
  function changeProject() {
    returnHome();
    setSelection(null);
  }

  async function startUpload(previous?: ReadonlyMap<string, SheetProgress>) {
    if (!selection || setId === null || areaId === null) return;

    setUploading(true);
    setUploadResult(null);
    setProjectError(null);

    // Materialize a session-only draft in Procore before any bytes move. Failure here
    // aborts cleanly — nothing has been uploaded yet.
    let drawingSetId: number;
    try {
      const resolved = await resolveDrawingSetId({
        setId,
        pendingName: pendingSetName,
        create: (name) => createDrawingSet(selection.project.id, name),
      });
      drawingSetId = resolved.id;
      if (resolved.created) {
        const created = resolved.created;
        setSets((current) => [...current, created]);
        setPendingSetName(null);
        setSetId(created.id);
      }
    } catch (cause) {
      setUploading(false);
      setProjectError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    // Map each sheet that is a revision of a drawing already in Procore to that Drawing's
    // id, so the upload assigns the new revision directly (no OCR review) instead of
    // creating a fresh Drawing. Scoped to the SELECTED Drawing Area: drawings are
    // area-scoped in Procore and the same number can exist in several areas, so only
    // current revisions in this area may match (the same rule validation applies).
    const currentDrawingIdByNumber = new Map<string, number>();
    for (const revision of revisions) {
      if (revision.current && revision.drawing_area.id === areaId) {
        currentDrawingIdByNumber.set(normalizeSheetNumber(revision.number), revision.drawing_id);
      }
    }
    const existingDrawingIdBySheetId = new Map<string, number>();
    for (const sheet of sheets) {
      if (!sheet.sheetNumber) continue;
      const drawingId = currentDrawingIdByNumber.get(normalizeSheetNumber(sheet.sheetNumber));
      if (drawingId !== undefined) existingDrawingIdBySheetId.set(sheet.id, drawingId);
    }

    const result = await runUpload(
      {
        projectId: selection.project.id,
        drawingSetId,
        drawingAreaId: areaId,
        sheets,
        existingDrawingIdBySheetId,
        ...(previous ? { previous } : {}),
        onProgress: setUploadProgress,
      },
      {
        createProjectUpload,
        createDrawing,
        createDrawingUpload,
        putFile: putFileToStorage,
        pageBytes: pageBytesFrom(pkg.filesById.current),
      },
    );

    setUploadResult(result);
    setUploadProgress(result.progress);
    setUploading(false);
  }

  // Dropdown shows Procore sets plus the in-session draft (if any). The draft uses a
  // sentinel id so CreatableSelect can select it without a Procore POST.
  const setsForPicker: readonly DrawingSet[] =
    pendingSetName === null
      ? sets
      : [...sets, { id: PENDING_DRAWING_SET_ID, name: pendingSetName }];

  if (state.status === 'loading') {
    return (
      <main className="blueprint-grid grid min-h-screen place-items-center p-6">
        <p className="text-sm text-muted-foreground">Checking Procore session…</p>
      </main>
    );
  }

  if (state.status === 'anonymous') {
    return <LoginScreen {...(state.error ? { error: state.error } : {})} />;
  }

  // Deep links to the Procore Drawings tool must follow the active environment — the
  // API host is switched server-side by PROCORE_ENV, but this client-built URL isn't,
  // so derive it from the environment the server reported.
  const procoreHost =
    state.environment === 'production' ? 'https://app.procore.com' : 'https://sandbox.procore.com';

  const uploadBlocker =
    setId === null
      ? 'Choose a Drawing Set before uploading.'
      : areaId === null
        ? 'Choose a Drawing Area before uploading.'
        : null;

  return (
    <div className="blueprint-grid flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-card/90 px-4 py-2.5 backdrop-blur sm:px-6">
        {/* App name — always visible. */}
        <span className="font-heading text-lg font-semibold tracking-tight">Drawbridge</span>
        {state.environment === 'sandbox' && (
          <Badge
            variant="secondary"
            className="rounded-full font-mono text-[10px] tracking-[0.12em] uppercase"
          >
            Sandbox
          </Badge>
        )}

        {/* Where you are: Company › Project. */}
        {selection && (
          <>
            <Separator orientation="vertical" className="mx-1 hidden h-5! sm:block" />
            <div className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate text-muted-foreground">{selection.company.name}</span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="max-w-[220px] truncate font-medium">{selection.project.name}</span>
            </div>
          </>
        )}

        <div className="flex-1" />

        {selection && (
          <>
            <Button variant="ghost" size="sm" onClick={returnHome}>
              <Home aria-hidden />
              <span className="hidden sm:inline">Home</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={changeProject}>
              <ArrowLeftRight aria-hidden />
              <span className="hidden sm:inline">Change project</span>
            </Button>
            <Separator orientation="vertical" className="mx-0.5 h-5!" />
          </>
        )}
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          <LogOut aria-hidden />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </header>

      <main
        className={
          sheets.length > 0 || uploading || uploadResult
            ? 'grid w-full flex-1 content-start px-3 pt-4 pb-6'
            : 'grid flex-1 content-start justify-items-center px-6 pt-6 pb-8'
        }
      >
        {!selection ? (
          <ProjectPicker
            onSelect={(company, project) => {
              // Must be set before any write call; Procore rejects those without it.
              setCompanyId(company.id);
              setSelection({ company, project });
            }}
            onSessionLost={() => void refresh()}
          />
        ) : (
          <div
            className={
              sheets.length > 0 || uploading || uploadResult
                ? 'grid w-full gap-4'
                : 'grid w-full max-w-[1360px] gap-4'
            }
          >
            {projectError && (
              <Alert variant="destructive">
                <AlertDescription>{projectError}</AlertDescription>
              </Alert>
            )}

            {loadingProject && (
              <p className="text-sm text-muted-foreground">Loading drawing areas and revisions…</p>
            )}

            {/* Area-first (per the concept workflow): the Area is chosen before any files
                are added, so revision/discipline seeding matches on the first pass and the
                review screen is never shown against an unset area. The Drawing Set and the
                upload now live in the "Add drawings" wizard, opened from here. */}
            {!uploading && !uploadResult && sheets.length === 0 && (
              <>
                <DrawingAreaBrowser
                  areas={areas}
                  selectedAreaId={areaId}
                  onSelect={setAreaId}
                  onCreate={(name) => createDrawingArea(selection.project.id, name)}
                  onCreated={(area) => setAreas((current) => [...current, area])}
                />
                {areaId !== null ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="font-heading text-sm font-semibold tracking-tight">
                        Drawings in this area
                      </h2>
                      <Button onClick={() => setAddOpen(true)}>
                        <Plus />
                        Add drawing
                      </Button>
                    </div>
                    <AreaDrawings revisions={revisions} sets={sets} areaId={areaId} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Choose a Drawing Area to see its drawings and add new ones.
                  </p>
                )}
              </>
            )}

            {pkg.problems.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription className="grid gap-1">
                  {pkg.problems.map((problem) => (
                    <div key={problem.file}>
                      <strong>{problem.file}</strong>: {problem.message}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {(uploading || uploadResult) && (
              <UploadPanel
                sheets={sheets}
                progress={uploadProgress}
                result={uploadResult}
                running={uploading}
                procoreUrl={
                  selection
                    ? `${procoreHost}/${selection.project.id}/project/drawing_areas`
                    : null
                }
                onRetry={() => void startUpload(uploadProgress)}
                onDone={() => {
                  setUploadResult(null);
                  setUploadProgress(new Map());
                  setDrawingDate(todayISO());
                  setReceivedDate(todayISO());
                  pkg.reset();
                }}
              />
            )}

            {sheets.length > 0 && !uploading && !uploadResult && (
              <ReviewTable
                sheets={sheets}
                existingRevisions={revisions}
                blockedReason={uploadBlocker}
                drawingSetName={setsForPicker.find((set) => set.id === setId)?.name ?? null}
                drawingAreaName={areas.find((area) => area.id === areaId)?.name ?? null}
                onUpdate={updateSheets}
                onUpload={() => void startUpload()}
              />
            )}

            <AddDrawingDialog
              open={addOpen}
              onOpenChange={handleAddOpenChange}
              sets={setsForPicker}
              setId={setId}
              onSetChange={handleSetChange}
              onCreateSet={async (name) => {
                // Prefer an existing Procore match over a twin draft — CreatableSelect
                // already checks items, but setsForPicker may only hold the prior draft.
                const existing = sets.find(
                  (set) => set.name.trim().toLowerCase() === name.trim().toLowerCase(),
                );
                if (existing) return existing;

                setPendingSetName(name);
                return { id: PENDING_DRAWING_SET_ID, name };
              }}
              onCreatedSet={(set) => {
                // Real Procore sets (matched above) join the list; the pending sentinel
                // is already exposed via setsForPicker / pendingSetName.
                if (!isPendingDrawingSetId(set.id)) {
                  setSets((current) =>
                    current.some((s) => s.id === set.id) ? current : [...current, set],
                  );
                }
              }}
              drawingDate={drawingDate}
              receivedDate={receivedDate}
              onDrawingDateChange={setDrawingDate}
              onReceivedDateChange={setReceivedDate}
              onFiles={(files) => void pkg.addFiles(files)}
              parsing={pkg.progress}
              problems={pkg.problems}
            />
          </div>
        )}
      </main>
    </div>
  );
}
