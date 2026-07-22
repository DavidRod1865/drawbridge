/**
 * Sheet number recognition.
 *
 * Split into two layers on purpose:
 *
 *   parseSheetNumber  — "is this string a sheet number?"  (pure, heavily tested)
 *   pickSheetNumber   — "which candidate is THE sheet number?" (positional scoring)
 *
 * Everything downstream trusts the result, so a confident wrong answer here is worse
 * than no answer: it silently files a sheet under the wrong number. Candidates we are
 * unsure about are returned with low confidence for the review screen to flag rather
 * than being quietly accepted.
 */

export interface SheetNumberMatch {
  /** Exactly as printed on the sheet — this is what we send to Procore. */
  raw: string;
  /** Separator-stripped form used only for comparing against Procore. */
  normalized: string;
  /** Leading letters, e.g. 'A' in 'A-101'. Used to infer discipline. */
  discipline: string;
  /**
   * 0..1 — how strongly the string is *shaped* like a real sheet number,
   * independent of where it sits on the page.
   *
   * This exists because position alone is not decisive. On a real package, the
   * fragment 'S1' (from 'DOB NOW JOB #: M01335738-S1') sat marginally nearer the
   * corner than the true number 'M-105.00' and won on position by 0.015. Structure
   * separates them unambiguously where geometry could not.
   */
  specificity: number;
}

/**
 * Discipline prefix, optional separator, then the number. Trailing letter suffixes
 * ('A-101A') and decimal sub-sheets ('M2.1') are both common.
 */
const SHEET_NUMBER = /^([A-Z]{1,3})[-.\s]?(\d{1,4}(?:\.\d{1,2})?[A-Z]?)$/;

/**
 * Strings that match the shape but are not sheet numbers — title block labels that
 * happen to be letters followed by a number in adjacent text.
 */
const NOT_SHEET_NUMBERS = new Set(['NO', 'OF', 'PG', 'REV', 'DWG', 'SH', 'SHT']);

export function normalizeSheetNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-.\s]/g, '');
}

export function parseSheetNumber(text: string): SheetNumberMatch | null {
  const candidate = text.trim().toUpperCase();
  const match = candidate.match(SHEET_NUMBER);
  if (!match) return null;

  const [, discipline, number] = match;
  if (!discipline || !number) return null;
  if (NOT_SHEET_NUMBERS.has(discipline)) return null;

  // A four-digit number with no separator is more likely a year or a dimension than
  // a sheet ('A2024'). Real sheet numbers in that range use a separator.
  if (!/[-.\s]/.test(candidate) && number.length >= 4) return null;

  // Structural evidence, each independently observed on real sheet numbers.
  let specificity = 0.15; // a bare 'S1' floor
  if (/[-.\s]/.test(candidate)) specificity += 0.45; // 'M-105' beats 'M105'
  if (number.replace(/\D/g, '').length >= 3) specificity += 0.25; // 3+ digits
  if (number.includes('.')) specificity += 0.15; // sub-sheet, e.g. 'M-105.00'

  return {
    raw: text.trim(),
    normalized: normalizeSheetNumber(candidate),
    discipline,
    specificity: Math.min(1, specificity),
  };
}

/** A positioned piece of text extracted from a PDF page, in normalized 0..1 space. */
export interface TextItem {
  text: string;
  /** 0 = left edge, 1 = right edge. */
  x: number;
  /** 0 = TOP edge, 1 = bottom edge (screen orientation, not PDF orientation). */
  y: number;
}

export interface SheetNumberResult extends SheetNumberMatch {
  /** 0..1. Below ~0.5 means "show this to the user before uploading". */
  confidence: number;
}

/** Labels that sit immediately beside the sheet number in most title blocks. */
const LABEL_HINT = /\b(SHEET|SHT|DWG|DRAWING)\s*(NO|NUMBER|#)\b/;

/**
 * Chooses the most likely sheet number from a page's text.
 *
 * Scoring rather than first-match, because drawing callouts elsewhere on the sheet
 * ('SEE A-501') match the same pattern. Position is the strongest signal available:
 * the title block is bottom-right on essentially every architectural sheet.
 */
export function pickSheetNumber(items: readonly TextItem[]): SheetNumberResult | null {
  const hasLabel = items.some((item) => LABEL_HINT.test(item.text.toUpperCase()));

  let best: SheetNumberResult | null = null;

  for (const item of items) {
    const match = parseSheetNumber(item.text);
    if (!match) continue;

    // Bottom-right corner is the title block. Both terms are 0..1, so a sheet number
    // at the extreme bottom-right scores near 1.
    const position = (item.x + item.y) / 2;

    // Weighted equally: position locates the title block, structure identifies which
    // string in it is actually the number. Neither is sufficient alone — position
    // alone picks up stamp and job-number fragments crowded into the same corner.
    let confidence = position * 0.5 + match.specificity * 0.5;

    // A 'SHEET NO' label on the page is corroborating evidence for a bottom-right hit.
    if (hasLabel && item.x > 0.6 && item.y > 0.6) confidence = Math.min(1, confidence + 0.1);
    // Anything in the upper-left half is almost certainly a callout, not the number.
    if (item.x < 0.5 && item.y < 0.5) confidence *= 0.3;

    if (!best || confidence > best.confidence) {
      best = { ...match, confidence: Number(confidence.toFixed(3)) };
    }
  }

  return best;
}

/**
 * Maps a discipline prefix to the Procore drawing discipline name.
 * Procore auto-maps industry-standard abbreviations on its OCR path, but we bypass
 * that path, so nothing else will fill this in.
 */
const DISCIPLINES: Record<string, string> = {
  A: 'Architectural',
  C: 'Civil',
  E: 'Electrical',
  F: 'Fire Protection',
  G: 'General',
  I: 'Interiors',
  L: 'Landscape',
  M: 'Mechanical',
  P: 'Plumbing',
  Q: 'Equipment',
  S: 'Structural',
  T: 'Telecommunications',
};

export function disciplineFor(prefix: string): string {
  // Multi-letter prefixes ('AD' = architectural demolition) key off the first letter.
  return DISCIPLINES[prefix[0] ?? ''] ?? 'General';
}
