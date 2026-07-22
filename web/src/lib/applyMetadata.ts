/**
 * Matches uploaded sheets to their now-confirmed Procore drawing revisions, for the
 * post-OCR metadata PATCH (`ApplyMetadataPanel`).
 *
 * Registration always goes through Procore's OCR (see procore.ts), so sheets land in
 * "Items to Review" with none of the app's metadata attached. Once the user confirms a
 * sheet there, it becomes a real `DrawingRevision` and `updateDrawingRevision`
 * (procore.ts) can backfill the dates/revision label. This module is the pure matching
 * logic in between: given the sheets we uploaded and Procore's current revisions, decide
 * what to PATCH.
 *
 * Matching mirrors validation.ts: normalize sheet numbers and compare against only the
 * *current* revision for that number (`revision.current`). That "current" guard is the
 * important part — it's what keeps this from PATCHing a stale/superseded revision that
 * happens to share a sheet number. Confirming in the review queue always creates (or
 * promotes to) the current revision, so if the current revision for a number doesn't
 * look like the one we just uploaded, the honest answer is "not found yet", not a guess.
 */

import { normalizeSheetNumber } from './sheetNumber.ts';
import type { DrawingRevision, RevisionUpdate } from './procore.ts';
import type { PlannedSheet } from './validation.ts';

export type ApplyMetadataOutcome =
  | { sheetId: string; status: 'matched'; revisionId: number; update: RevisionUpdate }
  /** Already matches what we'd send — PATCHing again would be a harmless no-op, so skip it. */
  | { sheetId: string; status: 'already-applied'; revisionId: number }
  /** No current revision in Procore has this sheet number yet — not confirmed there. */
  | { sheetId: string; status: 'not-found' }
  /** Sheet is missing a field we need to identify or build the update (number or dates). */
  | { sheetId: string; status: 'missing-data' };

/**
 * Plans the PATCH for each sheet. `sheets` should be the batch that was registered with
 * Procore — this function does not fetch anything itself, it just matches what it's
 * given against the current revisions.
 */
export function planMetadataUpdates(
  sheets: readonly PlannedSheet[],
  currentRevisions: readonly DrawingRevision[],
): ApplyMetadataOutcome[] {
  // Same indexing approach as validation.ts: the current revision per (drawing area,
  // number), so a superseded older revision never masquerades as the one we just confirmed,
  // and a matching number in a different Drawing Area is not treated as the same sheet.
  const currentByAreaNumber = new Map<string, DrawingRevision>();
  for (const revision of currentRevisions) {
    if (!revision.current) continue;
    currentByAreaNumber.set(
      `${revision.drawing_area.id}:${normalizeSheetNumber(revision.number)}`,
      revision,
    );
  }

  return sheets.map((sheet): ApplyMetadataOutcome => {
    // All three fields are required to identify the sheet and build a RevisionUpdate;
    // a null sheetNumber can't be matched at all, and null dates can't be sent (the PATCH
    // body requires real values, not empty strings that would blank out Procore's data).
    if (!sheet.sheetNumber || !sheet.drawingDate || !sheet.receivedDate) {
      return { sheetId: sheet.id, status: 'missing-data' };
    }

    // Match within the sheet's own Drawing Area — a matching number elsewhere is not it.
    const current =
      sheet.drawingAreaId === null
        ? undefined
        : currentByAreaNumber.get(
            `${sheet.drawingAreaId}:${normalizeSheetNumber(sheet.sheetNumber)}`,
          );
    if (!current) {
      return { sheetId: sheet.id, status: 'not-found' };
    }

    const alreadyApplied =
      current.revision_number === sheet.revision &&
      current.drawing_date === sheet.drawingDate &&
      current.received_date === sheet.receivedDate;

    if (alreadyApplied) {
      return { sheetId: sheet.id, status: 'already-applied', revisionId: current.id };
    }

    return {
      sheetId: sheet.id,
      status: 'matched',
      revisionId: current.id,
      update: {
        drawingDate: sheet.drawingDate,
        receivedDate: sheet.receivedDate,
        revisionNumber: sheet.revision,
      },
    };
  });
}
