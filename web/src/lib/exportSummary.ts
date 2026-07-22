/**
 * Reference-table export for the OCR review queue.
 *
 * Registration always goes through bare `upload_uuids` (see procore.ts), so none of the
 * app's collected metadata (sheet number, title, revision, dates) reaches Procore at
 * upload time — the sheets land in "Items to Review" bare. `updateDrawingRevision`
 * (procore.ts) backfills that metadata via PATCH once a sheet is confirmed there, but a
 * user may confirm sheets in Procore's UI before or without running that backfill. This
 * module is the manual fallback for that case: a copyable/downloadable table the user
 * can reference while confirming sheets by hand in Procore's review screen. Pure and
 * stateless — no fetch, just formats what's already in memory.
 */

import type { PlannedSheet } from './validation.ts';

/** Column order matches Procore's own review screen, left to right. */
const HEADERS = ['Sheet Number', 'Title', 'Revision', 'Drawing Date', 'Received Date'];

function rowsFor(sheets: readonly PlannedSheet[]): string[][] {
  return sheets.map((sheet) => [
    sheet.sheetNumber ?? '',
    sheet.title ?? '',
    sheet.revision,
    sheet.drawingDate ?? '',
    sheet.receivedDate ?? '',
  ]);
}

/**
 * Tab-separated so pasting into a spreadsheet (or Procore's own grid, if it accepts
 * paste) splits into columns automatically.
 */
export function sheetsToTsv(sheets: readonly PlannedSheet[]): string {
  const rows = [HEADERS, ...rowsFor(sheets)];
  return rows.map((row) => row.join('\t')).join('\n');
}

/**
 * A field needs quoting the moment it contains the delimiter, a quote, or a newline —
 * otherwise it would silently split into extra columns/rows when opened in a
 * spreadsheet. Embedded quotes are doubled per RFC 4180.
 */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function sheetsToCsv(sheets: readonly PlannedSheet[]): string {
  const rows = [HEADERS, ...rowsFor(sheets)];
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}
