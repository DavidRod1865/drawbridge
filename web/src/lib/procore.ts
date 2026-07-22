/**
 * Procore Drawings domain types and read calls.
 *
 * Only the fields Drawbridge actually uses are modelled. Procore returns far more;
 * narrowing here keeps it obvious what the app depends on.
 */

import { procore, ProcoreApiError } from './api.ts';

export interface Company {
  id: number;
  name: string;
}

export interface Project {
  id: number;
  name: string;
  project_number?: string;
}

export interface DrawingArea {
  id: number;
  name: string;
}

export interface DrawingSet {
  id: number;
  name: string;
  /** ISO date; Procore orders sets by this when presenting the drawing log. */
  effective_date?: string;
}

/**
 * A revision is the actual uploaded sheet. `revision_number` is the free-text label
 * ('A', '2', 'IFC') that feeds compareRevisions in ./revision.ts.
 */
export interface DrawingRevision {
  id: number;
  /** The parent Drawing this revision belongs to. Needed to upload a new revision of an
   *  existing sheet straight into the Drawings tool (the no-review direct path). */
  drawing_id: number;
  number: string; // sheet number, e.g. 'A-101'
  title: string;
  revision_number: string;
  // Procore returns these as nested objects (`{ id, ... }`), NOT flat `*_id` scalars.
  // Modeling them flat left `drawing_area.id` reading as undefined and broke area-scoped
  // revision matching — the same number in the wrong area silently failed to match.
  drawing_area: { id: number };
  drawing_set: { id: number };
  /** Procore derives discipline from the sheet-number prefix; adopted onto a matched
   *  sheet so the app shows the same discipline Procore keeps (`null` if unset). */
  discipline: { name: string } | null;
  current: boolean;
  /** Plain `yyyy-mm-dd`, as returned by GET — not an ISO datetime. */
  drawing_date: string;
  /** Plain `yyyy-mm-dd`, as returned by GET — not an ISO datetime. */
  received_date: string;
}

/**
 * Asserts a list endpoint actually returned a list.
 *
 * Added after a proxy bug returned a byte-indexed object instead of an array: the
 * response parsed as valid JSON, so the failure surfaced deep in a component as
 * `companies.find is not a function`. Checking at the boundary names the real problem.
 */
async function expectArray<T>(what: string, promise: Promise<T[]>): Promise<T[]> {
  const result = await promise;
  if (!Array.isArray(result)) {
    throw new TypeError(
      `Expected a list of ${what} from Procore but received ${typeof result}. ` +
        'This usually means the API proxy altered the response.',
    );
  }
  return result;
}

export const listCompanies = () => expectArray('companies', procore<Company[]>('v1.0/companies'));

export const listProjects = (companyId: number) =>
  expectArray('projects', procore<Project[]>(`v1.0/projects?company_id=${companyId}`));

export const listDrawingAreas = (projectId: number) =>
  expectArray(
    'drawing areas',
    procore<DrawingArea[]>(`v1.0/projects/${projectId}/drawing_areas`),
  );

export const listDrawingSets = (projectId: number) =>
  expectArray('drawing sets', procore<DrawingSet[]>(`v1.0/projects/${projectId}/drawing_sets`));

/**
 * Current revisions for the project — the baseline every validation decision is made
 * against. Fetched once per session and held in memory only.
 *
 * Procore paginates; a large project can exceed one page, and a missed page would look
 * exactly like "this sheet is new", causing a duplicate upload. So we page to the end
 * rather than trusting the first response.
 */
export async function listCurrentRevisions(projectId: number): Promise<DrawingRevision[]> {
  const PER_PAGE = 500;
  const all: DrawingRevision[] = [];

  for (let page = 1; ; page++) {
    const batch = await expectArray(
      'drawing revisions',
      procore<DrawingRevision[]>(
        `v1.0/projects/${projectId}/drawing_revisions?per_page=${PER_PAGE}&page=${page}`,
      ),
    );
    all.push(...batch);
    if (batch.length < PER_PAGE) return all;
  }
}

/**
 * Procore is inconsistent about whether create endpoints want the resource nested
 * under its own key or the attributes at the top level — nesting alone returned
 * {"errors":{"name":["can't be blank"]}}. Sending both satisfies either reading, and
 * Procore ignores the parameter it does not recognize.
 */
export const createDrawingArea = (projectId: number, name: string) =>
  procore<DrawingArea>(`v1.0/projects/${projectId}/drawing_areas`, {
    method: 'POST',
    body: { name, drawing_area: { name } },
  });

export const createDrawingSet = (projectId: number, name: string) =>
  procore<DrawingSet>(`v1.0/projects/${projectId}/drawing_sets`, {
    method: 'POST',
    body: { name, drawing_set: { name } },
  });

/** A Drawing (the parent record a revision hangs off), as returned by createDrawing. */
export interface CreatedDrawing {
  id: number;
  number: string;
  title: string;
  discipline: string | null;
}

/**
 * Creates a Drawing with an authoritative number, title, and discipline — the values we
 * supply here are NOT re-derived by OCR. Uploading a sheet against the returned `id` (via
 * `drawing_id` in `drawing_log_imports`) lands it in the Drawings tool with this metadata
 * intact, bypassing the OCR/"Items to Review" rewrite.
 *
 * VERIFIED SHAPE (sandbox 2026-07-21, from the Create Drawing API reference): the endpoint
 * is area-scoped `v1.0/drawing_areas/{id}/drawings`, and `drawing_discipline` is an object
 * `{ name }` nested INSIDE `drawing` — a sibling `drawing_discipline`, a `discipline_id`,
 * or a bare string all return `400 "Drawing Discipline can't be blank"`. The discipline
 * name is matched against the project's `drawing_disciplines` (Procore creates it if new).
 */
export const createDrawing = (
  drawingAreaId: number,
  drawing: { number: string; title?: string; disciplineName: string },
) =>
  procore<CreatedDrawing>(`v1.0/drawing_areas/${drawingAreaId}/drawings`, {
    method: 'POST',
    body: {
      drawing: {
        number: drawing.number,
        ...(drawing.title === undefined ? {} : { title: drawing.title }),
        drawing_discipline: { name: drawing.disciplineName },
      },
    },
  });

// ---------------------------------------------------------------- upload sequence

/** Presigned destination for one file. Procore returns S3 POST policy fields. */
export interface ProjectUpload {
  uuid: string;
  url: string;
  fields?: Record<string, string>;
}

export const createProjectUpload = (projectId: number, filename: string, size: number) =>
  procore<ProjectUpload>(`v1.0/projects/${projectId}/uploads`, {
    method: 'POST',
    body: { response_filename: filename, response_content_type: 'application/pdf', size },
  });

/**
 * One sheet's metadata for the drawing-upload batch. `uploadUuid` + `drawingDate` are
 * required by Procore; the rest are sent when we have them.
 *
 * `drawingDate`/`receivedDate` are ISO datetimes (`2026-07-21T12:00:00Z`), NOT the plain
 * `yyyy-mm-dd` that `updateDrawingRevision` (below) and GET use — this endpoint wants the
 * datetime form. The caller (`upload.ts`) does the conversion.
 */
export interface DrawingLogImport {
  uploadUuid: string;
  drawingDate: string;
  title?: string;
  revisionNumber?: string;
  receivedDate?: string;
  /**
   * When set, the file is assigned as a new revision of this existing Drawing and skips
   * the OCR review (the "direct" path). `defaultRevision` (the new revision's label) is
   * required by Procore whenever `drawingId` is present. Absent both fields, the entry is
   * a plain OCR import that routes through Items to Review.
   */
  drawingId?: number;
  defaultRevision?: string;
}

/**
 * Registers uploaded files with the Drawings tool.
 *
 * ENVELOPE (resolved 2026-07-21 by Procore API Support, verified 201 → `ready_for_review`):
 * this endpoint wants a plain **`application/json`** body with a nested `drawing_upload`
 * object and a `drawing_log_imports` array — NOT `multipart/form-data`. The long-running
 * 500s that made this look like a Procore defect/outage were entirely caused by sending it
 * as a multipart `drawing_upload` string field: Procore's multipart parsing of the nested
 * array errored server-side before validation (so even a missing-parameter probe 500'd),
 * while bare `upload_uuids` survived only because it is a flat value. As JSON,
 * `drawing_log_imports` works AND carries our metadata (title/revision/dates) up front.
 *
 * It still routes the package through OCR into "Items to Review" (status `ready_for_review`),
 * so the OCR-first UX is unchanged — the difference is the sheet metadata now rides along
 * instead of being backfilled afterward. See memory `procore-drawing-uploads-endpoint-facts`.
 */
export const createDrawingUpload = (
  projectId: number,
  drawingAreaId: number,
  drawingSetId: number,
  imports: readonly DrawingLogImport[],
) =>
  procore<{ id: number }>(`v1.1/projects/${projectId}/drawing_uploads`, {
    method: 'POST',
    body: {
      drawing_upload: {
        drawing_area_id: drawingAreaId,
        drawing_set_id: drawingSetId,
        drawing_log_imports: imports.map((entry) => ({
          upload_uuid: entry.uploadUuid,
          drawing_date: entry.drawingDate,
          // exactOptionalPropertyTypes: only include a key when we actually have a value,
          // never `field: undefined` (which would serialize to null and blank Procore's OCR).
          ...(entry.title === undefined ? {} : { title: entry.title }),
          ...(entry.revisionNumber === undefined ? {} : { revision_number: entry.revisionNumber }),
          ...(entry.receivedDate === undefined ? {} : { received_date: entry.receivedDate }),
          ...(entry.drawingId === undefined ? {} : { drawing_id: entry.drawingId }),
          ...(entry.defaultRevision === undefined ? {} : { default_revision: entry.defaultRevision }),
        })),
      },
    },
    idempotencyKey: crypto.randomUUID(),
  });

// -------------------------------------------------------------- post-OCR metadata

/** Fields Drawbridge can backfill onto an already-created drawing revision. */
export interface RevisionUpdate {
  drawingDate: string;
  receivedDate: string;
  revisionNumber: string;
}

/**
 * PATCHes an existing drawing revision's dates and revision label.
 *
 * Verified in a sandbox probe (2026-07-21, see plan
 * `review-application-i-want-refactored-crescent.md` Part 2a): `PATCH
 * v1.0/projects/{projectId}/drawing_revisions/{revisionId}` with this nested JSON body
 * returns 200 and the fields verifiably change on re-read.
 *
 * CRITICAL QUIRK, unlike `createDrawingArea`/`createDrawingSet` above: this endpoint
 * does NOT accept the "send both nested and top-level" trick. Top-level
 * `revision_date`/`received_date`/`revision_number` were tested and return 200 but
 * silently no-op — the resource is unchanged. Only the nested `drawing_revision: {...}`
 * shape actually writes. Do not add a top-level fallback here; it would look like it
 * worked (200) while doing nothing.
 *
 * `v1.1` of this path 404s — this resource only exists at `v1.0`, unlike
 * `drawing_uploads` which is `v1.1`. Dates are plain `yyyy-mm-dd` strings, matching what
 * GET returns — NOT the ISO-datetime format `createDrawingUpload` sends.
 */
export const updateDrawingRevision = (
  projectId: number,
  revisionId: number,
  update: RevisionUpdate,
) =>
  procore<DrawingRevision>(`v1.0/projects/${projectId}/drawing_revisions/${revisionId}`, {
    method: 'PATCH',
    body: {
      drawing_revision: {
        drawing_date: update.drawingDate,
        received_date: update.receivedDate,
        revision_number: update.revisionNumber,
      },
    },
  });
