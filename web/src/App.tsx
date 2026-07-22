import { useEffect, useState } from 'react';
import { LoginScreen } from './components/LoginScreen.tsx';
import { ProjectPicker } from './components/ProjectPicker.tsx';
import { DropZone } from './components/DropZone.tsx';
import { ReviewTable } from './components/ReviewTable.tsx';
import { CreatableSelect } from './components/CreatableSelect.tsx';
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

export function App() {
  const { state, refresh, logout } = useAuth();
  const [selection, setSelection] = useState<{ company: Company; project: Project } | null>(null);
  const [areas, setAreas] = useState<DrawingArea[]>([]);
  const [sets, setSets] = useState<DrawingSet[]>([]);
  const [revisions, setRevisions] = useState<DrawingRevision[]>([]);
  // Drawing Set and Drawing Area are chosen once for the whole package rather than
  // per sheet: a package is uploaded into one set and one area in practice, and
  // repeating the choice on every row was pure friction.
  const [setId, setSetId] = useState<number | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);

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

  // Procore requires a drawing_date on every import, and it's the one field carried
  // through to the review. Prefill both dates with today; only blank fields are
  // touched, so a user edit is never overwritten and the effect can't loop.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const noDrawingDate = sheets.filter((s) => !s.drawingDate).map((s) => s.id);
    const noReceivedDate = sheets.filter((s) => !s.receivedDate).map((s) => s.id);
    if (noDrawingDate.length > 0) updateSheets(noDrawingDate, { drawingDate: today });
    if (noReceivedDate.length > 0) updateSheets(noReceivedDate, { receivedDate: today });
  }, [sheets, updateSheets]);

  async function startUpload(previous?: ReadonlyMap<string, SheetProgress>) {
    if (!selection || setId === null || areaId === null) return;

    setUploading(true);
    setUploadResult(null);

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
        drawingSetId: setId,
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

  if (state.status === 'loading') {
    return (
      <main className="centered">
        <p className="muted">Checking Procore session…</p>
      </main>
    );
  }

  if (state.status === 'anonymous') {
    return <LoginScreen {...(state.error ? { error: state.error } : {})} />;
  }

  const uploadBlocker =
    setId === null
      ? 'Choose a Drawing Set before uploading.'
      : areaId === null
        ? 'Choose a Drawing Area before uploading.'
        : null;

  return (
    <div className="app">
      <header className="app-header">
        <span className="wordmark">Drawbridge</span>
        {state.environment === 'sandbox' && <span className="badge">Sandbox</span>}
        <div className="spacer" />
        {selection && <span className="muted">{selection.project.name}</span>}
        {selection && (
          <button
            className="button subtle"
            onClick={() => {
              setSelection(null);
              setAreaId(null);
              setSetId(null);
              pkg.reset();
            }}
          >
            Change project
          </button>
        )}
        <button className="button subtle" onClick={() => void logout()}>
          Sign out
        </button>
      </header>

      <main className="app-body">
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
          <div className="workspace">
            {projectError && (
              <p className="error" role="alert">
                {projectError}
              </p>
            )}

            {loadingProject && <p className="muted">Loading drawing areas and revisions…</p>}

            {/* Area-first (per the concept workflow): the Set and Area are chosen before
                any files are added, so revision/discipline seeding matches on the first
                pass and the review screen is never shown against an unset area. */}
            {!uploading && !uploadResult && (
              <div className="package-bar">
                <label className="inline">
                  Drawing Set
                  <CreatableSelect
                    items={sets}
                    value={setId}
                    placeholder="Choose a set…"
                    createLabel="+ New Drawing Set…"
                    newLabel="New set name"
                    onCreate={(name) => createDrawingSet(selection.project.id, name)}
                    onChange={setSetId}
                    onCreated={(set) => setSets((current) => [...current, set])}
                  />
                </label>

                {sheets.length > 0 && (
                  <span className="muted">Applied to all {sheets.length} sheets.</span>
                )}
              </div>
            )}

            {/* Browse the project's Drawing Areas and see what each already holds before
                choosing one. Selecting an area also targets it for upload (the area-fanout
                effect stamps it onto every sheet), so browse and pick are one action. Only
                shown pre-upload; once files are added the ReviewTable takes over. */}
            {!uploading && !uploadResult && sheets.length === 0 && (
              <>
                <DrawingAreaBrowser
                  areas={areas}
                  selectedAreaId={areaId}
                  onSelect={setAreaId}
                  onCreate={(name) => createDrawingArea(selection.project.id, name)}
                  onCreated={(area) => setAreas((current) => [...current, area])}
                />
                {areaId !== null && (
                  <AreaDrawings revisions={revisions} sets={sets} areaId={areaId} />
                )}
              </>
            )}

            {sheets.length === 0 &&
              !uploading &&
              !uploadResult &&
              (setId === null || areaId === null ? (
                <p className="muted">Choose a Drawing Set and Drawing Area, then add your drawings.</p>
              ) : (
                <DropZone
                  onFiles={(files) => void pkg.addFiles(files)}
                  disabled={loadingProject || pkg.progress !== null}
                />
              ))}

            {pkg.progress && (
              <p className="muted">
                Parsing {pkg.progress.done + 1} of {pkg.progress.total}: {pkg.progress.current}
              </p>
            )}

            {pkg.problems.length > 0 && (
              <div className="error" role="alert">
                {pkg.problems.map((problem) => (
                  <div key={problem.file}>
                    <strong>{problem.file}</strong>: {problem.message}
                  </div>
                ))}
              </div>
            )}

            {(uploading || uploadResult) && (
              <UploadPanel
                projectId={selection.project.id}
                sheets={sheets}
                progress={uploadProgress}
                result={uploadResult}
                running={uploading}
                procoreUrl={
                  selection
                    ? `https://sandbox.procore.com/${selection.project.id}/project/drawing_areas`
                    : null
                }
                onRetry={() => void startUpload(uploadProgress)}
                onDone={() => {
                  setUploadResult(null);
                  setUploadProgress(new Map());
                  pkg.reset();
                }}
              />
            )}

            {sheets.length > 0 && !uploading && !uploadResult && (
              <ReviewTable
                sheets={sheets}
                existingRevisions={revisions}
                blockedReason={uploadBlocker}
                onUpdate={updateSheets}
                onUpload={() => void startUpload()}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
