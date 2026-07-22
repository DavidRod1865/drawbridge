/**
 * Revision comparison.
 *
 * This is the rule behind the concept's "warn about uploading older revisions". It is
 * the single most consequential piece of domain logic in Drawbridge: get it wrong in
 * one direction and users silently overwrite a newer sheet with a stale one; get it
 * wrong in the other and they are nagged on every legitimate upload until they stop
 * reading the warnings.
 *
 * There is no universal revision scheme in construction, so this cannot be inferred
 * from the Procore API — it has to encode how a given team actually labels sheets.
 */

/** How two revisions relate, from the perspective of the one being uploaded. */
export type RevisionComparison =
  | 'newer' // incoming supersedes what is in Procore — normal revision upload
  | 'same' // identical revision already present — duplicate, skip by default
  | 'older' // incoming is behind Procore — dangerous, requires explicit confirmation
  | 'unknown'; // schemes are not comparable — surface to the user, never guess

/**
 * Normalizes a raw revision label for comparison.
 * Strips common prefixes and whitespace so `Rev 3`, `REV-3`, and `3` align.
 */
export function normalizeRevision(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^(REV|REVISION|R)[\s._-]*/, '')
    .replace(/[\s._-]+/g, '');
}

/**
 * TODO(david): implement the comparison rule for your projects.
 *
 * `incoming` is the revision parsed from the PDF being uploaded.
 * `existing` is the current revision in Procore for the same sheet number.
 * Both arrive already passed through `normalizeRevision`.
 *
 * Things worth deciding deliberately:
 *
 *  - Numeric (`0`,`1`,`2`,`10`): must compare as numbers, or `10` sorts before `2`.
 *  - Alphabetic (`A`,`B`,`C`): lexicographic works, but watch for `Z` -> `AA`.
 *  - Issue codes (`IFC`, `IFB`, `IFP`, `ASI`): these encode project PHASE, not
 *    sequence. Do they carry an ordering on your projects, or should mixing them
 *    with numeric revisions return 'unknown' and defer to the user?
 *  - Mixed schemes on one sheet (`A` in Procore, `1` incoming) — this happens when a
 *    package moves from design to construction. Ordering these is a guess; 'unknown'
 *    is the honest answer and prompts the user rather than deciding for them.
 *
 * Returning 'unknown' liberally is safe: the review screen will ask. Returning a
 * confident wrong answer is what causes silent overwrites.
 */

const NUMERIC = /^\d+$/;
const ALPHABETIC = /^[A-Z]+$/;

export function compareRevisions(incoming: string, existing: string): RevisionComparison {
  if (incoming === existing) return 'same';

  // A sheet with no revision recorded in Procore is superseded by anything.
  if (existing === '') return 'newer';

  if (NUMERIC.test(incoming) && NUMERIC.test(existing)) {
    // Compare as numbers, not strings, so revision 10 beats revision 2.
    return Number(incoming) > Number(existing) ? 'newer' : 'older';
  }

  if (ALPHABETIC.test(incoming) && ALPHABETIC.test(existing)) {
    // Length first: sequences roll over Z -> AA, so the longer label is always later.
    if (incoming.length !== existing.length) {
      return incoming.length > existing.length ? 'newer' : 'older';
    }
    return incoming > existing ? 'newer' : 'older';
  }

  // Different schemes ('A' vs '1', or an issue code like 'IFC'). Any ordering here
  // would be invented, so let the review screen ask instead of guessing.
  return 'unknown';
}

/**
 * The revision an incoming sheet should carry, given what Procore already holds.
 *
 * `existing` is the current revision label in Procore, or null when the sheet is not
 * there at all. A sheet Procore has never seen starts at 0; anything else advances one
 * step from where Procore is.
 *
 * Returns null when the existing label follows no scheme we can advance (an issue code
 * like 'IFC'). The user fills it in rather than having a wrong value guessed for them.
 */
export function nextRevision(existing: string | null): string | null {
  if (existing === null) return '0';

  const normalized = normalizeRevision(existing);
  if (normalized === '') return '0';

  if (/^\d+$/.test(normalized)) return String(Number(normalized) + 1);

  // Cap at two letters: A..Z then AA..ZZ covers 700 revisions, far beyond any real
  // sheet. Three or more letters is an issue code ('IFC', 'ASI'), which has no
  // successor — advancing it would invent 'IFD'.
  if (/^[A-Z]{1,2}$/.test(normalized)) {
    // Spreadsheet-column arithmetic: Z advances to AA, AZ to BA.
    const chars = normalized.split('');
    let index = chars.length - 1;
    for (;;) {
      const current = chars[index] ?? 'A';
      if (current !== 'Z') {
        chars[index] = String.fromCharCode(current.charCodeAt(0) + 1);
        break;
      }
      chars[index] = 'A';
      index--;
      if (index < 0) {
        chars.unshift('A');
        break;
      }
    }
    return chars.join('');
  }

  return null;
}

/** Convenience wrapper that normalizes both sides before comparing. */
export function compareRawRevisions(incoming: string, existing: string): RevisionComparison {
  return compareRevisions(normalizeRevision(incoming), normalizeRevision(existing));
}
