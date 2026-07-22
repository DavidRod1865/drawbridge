/**
 * Pre-upload validation.
 *
 * Diffs the parsed package against what is already in Procore and decides what may
 * upload, what needs confirmation, and what must be fixed first.
 *
 * The distinction that matters is blocking vs. warning. Blocking issues are ones
 * where uploading would create something wrong in Procore that is tedious to unwind
 * (a sheet with no number, two sheets claiming the same number). Warnings are cases
 * where the user may legitimately know better than we do.
 */

import { compareRawRevisions } from './revision.ts';
import { normalizeSheetNumber } from './sheetNumber.ts';
import type { DrawingRevision } from './procore.ts';

/**
 * A parsed sheet plus the user's edits, as it will be uploaded.
 *
 * Drawing Area and Drawing Set are chosen once for the whole package rather than per
 * sheet, so neither appears in this file's verdicts — App gates the upload on them.
 */
export interface PlannedSheet {
  /** Stable identity for React keys and selection: `${sourceFile}#${pageIndex}`. */
  id: string;
  sourceFile: string;
  /** Folder the file came from, used as the default Drawing Area grouping. */
  folder: string;
  pageIndex: number;
  sheetNumber: string | null;
  title: string | null;
  discipline: string | null;
  revision: string;
  drawingDate: string | null;
  receivedDate: string | null;
  drawingAreaId: number | null;
  /** 0..1 from the parser; low values are surfaced, not silently trusted. */
  confidence: number;
  needsOcr: boolean;
}

export type IssueCode =
  | 'missing-number'
  | 'needs-ocr'
  | 'duplicate-in-upload'
  | 'low-confidence'
  | 'same-revision'
  | 'older-revision'
  | 'unknown-revision-order';

export interface Issue {
  code: IssueCode;
  /** Blocking issues disable upload entirely; warnings only need acknowledgement. */
  blocking: boolean;
  message: string;
}

/** What will happen to this sheet in Procore if uploaded. */
export type Outcome = 'new' | 'revision' | 'duplicate' | 'older' | 'unknown' | 'blocked';

export interface SheetVerdict {
  outcome: Outcome;
  issues: Issue[];
}

/**
 * Confidence under this is shown for confirmation. Set from observed behaviour on a
 * real package: correct picks scored 0.94+, while a wrong pick that beat the true
 * number on position alone still reached 0.956 — so this threshold catches careless
 * misses, not confident errors. Confident errors are why every field stays editable.
 */
const LOW_CONFIDENCE = 0.6;

export function validateSheets(
  sheets: readonly PlannedSheet[],
  existing: readonly DrawingRevision[],
): Map<string, SheetVerdict> {
  // Index Procore's current revisions by (drawing area, normalized sheet number) so that
  // 'M-105.00' and 'M105.00' resolve to the same drawing, WITHOUT letting the same number
  // in a different Drawing Area collide. Procore drawings are area-scoped and reuse numbers
  // freely across areas (Shop Drawings especially); keying by number alone would collapse
  // those to one entry and mis-match a sheet against another area's drawing.
  const currentByAreaNumber = new Map<string, DrawingRevision>();
  for (const revision of existing) {
    if (!revision.current) continue;
    currentByAreaNumber.set(
      `${revision.drawing_area.id}:${normalizeSheetNumber(revision.number)}`,
      revision,
    );
  }

  // Detect collisions within this upload before comparing against Procore. Two files
  // claiming one sheet number is always a mistake — usually overlapping folders.
  const idsByNumber = new Map<string, string[]>();
  for (const sheet of sheets) {
    if (!sheet.sheetNumber) continue;
    const key = normalizeSheetNumber(sheet.sheetNumber);
    idsByNumber.set(key, [...(idsByNumber.get(key) ?? []), sheet.id]);
  }

  const verdicts = new Map<string, SheetVerdict>();

  for (const sheet of sheets) {
    const issues: Issue[] = [];

    if (sheet.needsOcr) {
      issues.push({
        code: 'needs-ocr',
        blocking: true,
        message: 'Scanned sheet — no readable text. Enter the sheet number manually.',
      });
    }

    if (!sheet.sheetNumber) {
      issues.push({
        code: 'missing-number',
        blocking: true,
        message: 'No sheet number found. Enter one to upload this sheet.',
      });
    } else if (sheet.confidence > 0 && sheet.confidence < LOW_CONFIDENCE) {
      issues.push({
        code: 'low-confidence',
        blocking: false,
        message: 'Sheet number is a low-confidence guess. Please verify.',
      });
    }

    const key = sheet.sheetNumber ? normalizeSheetNumber(sheet.sheetNumber) : null;
    const collisions = key ? (idsByNumber.get(key) ?? []) : [];
    if (collisions.length > 1) {
      issues.push({
        code: 'duplicate-in-upload',
        blocking: true,
        message: `Sheet number used by ${collisions.length} sheets in this upload.`,
      });
    }

    // Compare against Procore only once the sheet is otherwise coherent, and only within
    // the sheet's own Drawing Area — a matching number in another area is a different sheet.
    let outcome: Outcome = 'new';
    const current =
      key && sheet.drawingAreaId !== null
        ? currentByAreaNumber.get(`${sheet.drawingAreaId}:${key}`)
        : undefined;

    if (current) {
      switch (compareRawRevisions(sheet.revision, current.revision_number)) {
        case 'newer':
          outcome = 'revision';
          break;
        case 'same':
          outcome = 'duplicate';
          issues.push({
            code: 'same-revision',
            blocking: false,
            message: `Revision ${current.revision_number} is already in Procore. Skipped by default.`,
          });
          break;
        case 'older':
          outcome = 'older';
          issues.push({
            code: 'older-revision',
            blocking: false,
            message: `Procore has revision ${current.revision_number}, newer than this one. Confirm before uploading.`,
          });
          break;
        case 'unknown':
          outcome = 'unknown';
          issues.push({
            code: 'unknown-revision-order',
            blocking: false,
            message: `Cannot tell whether this supersedes revision ${current.revision_number}. Confirm before uploading.`,
          });
          break;
      }
    }

    if (issues.some((issue) => issue.blocking)) outcome = 'blocked';
    verdicts.set(sheet.id, { outcome, issues });
  }

  return verdicts;
}

export interface PlanSummary {
  total: number;
  new: number;
  revision: number;
  duplicate: number;
  older: number;
  unknown: number;
  blocked: number;
  /** True when nothing blocking remains and at least one sheet would upload. */
  canUpload: boolean;
}

export function summarize(verdicts: Map<string, SheetVerdict>): PlanSummary {
  const counts = { new: 0, revision: 0, duplicate: 0, older: 0, unknown: 0, blocked: 0 };
  for (const verdict of verdicts.values()) counts[verdict.outcome]++;

  const uploadable = counts.new + counts.revision + counts.older + counts.unknown;
  return {
    total: verdicts.size,
    ...counts,
    // Mirrors the concept's rule: nothing uploads until every sheet is resolvable.
    canUpload: counts.blocked === 0 && uploadable > 0,
  };
}
