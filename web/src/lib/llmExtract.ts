/**
 * LLM-assisted sheet metadata extraction (client side).
 *
 * The heavy lifting runs server-side (`/api/extract`) so the API key never reaches the
 * browser. This module is a thin, always-safe wrapper: it never throws, and returns
 * `null` whenever extraction is unavailable (no transport configured, LLM disabled on
 * the server, network error, rate limit exhausted) so PDF parsing degrades to its
 * positional heuristics.
 *
 * The transport is injectable, and left unset by default, so `node --test` runs fully
 * offline — the real HTTP transport is installed once at app startup, mirroring
 * `configurePdfWorker`.
 */

import { apiFetch, ProcoreApiError } from './api.ts';
import type { TextItem } from './sheetNumber.ts';

export interface LlmExtraction {
  sheetNumber: string | null;
  title: string | null;
}

/** Turns a page's positioned text into an extraction, or null when it can't. */
export type LlmTransport = (items: readonly TextItem[]) => Promise<LlmExtraction | null>;

let transport: LlmTransport | null = null;

/** Installs (or clears, with null) the extractor. Called once at app startup. */
export function configureLlmExtractor(fn: LlmTransport | null): void {
  transport = fn;
}

/**
 * Heuristic confidence at or above which the local result is trusted and the LLM is
 * skipped, set to the ~0.5 "show this to the user" review line from sheetNumber.ts.
 *
 * This gate exists to protect the provider's DAILY token budget: on clean vector
 * drawings the heuristics already score ~1.0 and are correct, so calling the LLM there
 * spends tokens for no gain. Restricting calls to sheets the heuristics are unsure about
 * is the only lever that reduces the *number* of calls (the region filter only reduces
 * tokens *per* call). When we do call, `reconcile` still lets the LLM answer win.
 */
export const LLM_CONFIDENCE_THRESHOLD = 0.5;

export function shouldQueryLlm(heuristicConfidence: number): boolean {
  return heuristicConfidence < LLM_CONFIDENCE_THRESHOLD;
}

/**
 * Circuit breaker. Extraction is one request *per sheet*, so a 200-page package is 200
 * requests — once the provider rate-limits us, every remaining sheet would be limited
 * too. Rather than wait on (or hammer) the limit sheet after sheet, the first 429 trips
 * this flag and the rest of the package falls straight back to the heuristics.
 */
let rateLimited = false;

/** Re-arms the breaker. Called at the start of each package parse (see `parseFile`). */
export function resetLlmCircuit(): void {
  rateLimited = false;
}

/**
 * The bottom-right corner where the title block (sheet number + title) sits. Only these
 * items are sent to the LLM. A full drawing page is thousands of tokens of schedules,
 * notes, and dimensions — enough to blow the provider's per-minute token limit on a
 * single dense sheet (observed: one page = 13k tokens vs an 8k TPM cap). The number and
 * title live in this corner, so restricting to it cuts tokens ~10x and removes noise.
 */
const TITLE_BLOCK_MIN_X = 0.72;
const TITLE_BLOCK_MIN_Y = 0.62;

/** Hard ceiling on how many corner items we send, in case a dense corner slips through. */
const MAX_TITLE_BLOCK_ITEMS = 80;

/** Filters page items down to the title-block corner, capped, nearest-corner first. */
export function titleBlockItems(items: readonly TextItem[]): TextItem[] {
  const region = items.filter(
    (item) => item.x >= TITLE_BLOCK_MIN_X && item.y >= TITLE_BLOCK_MIN_Y,
  );
  if (region.length <= MAX_TITLE_BLOCK_ITEMS) return region;
  // Too dense to send whole — keep the items closest to the bottom-right corner.
  return [...region]
    .sort((a, b) => b.x + b.y - (a.x + a.y))
    .slice(0, MAX_TITLE_BLOCK_ITEMS);
}

/**
 * Default transport: sends only the title-block corner to the server through `apiFetch`.
 * `maxAttempts: 1` is deliberate — we do NOT want apiFetch to sleep on a big `Retry-After`
 * and stall parsing; a rate limit should fail fast so `extractWithLlm` can trip the
 * breaker and move on. A 204 (LLM disabled server-side, or an empty corner) comes back
 * as `null`.
 */
export const httpLlmTransport: LlmTransport = (items) =>
  apiFetch<LlmExtraction | null>('/api/extract', {
    method: 'POST',
    body: { items: titleBlockItems(items) },
    maxAttempts: 1,
  });

/**
 * Runs the configured extractor. Returns null — never throws — on any failure, so a
 * degraded LLM never blocks parsing; the caller simply keeps the heuristic result. A
 * rate limit additionally trips the breaker so the rest of the package skips the LLM.
 */
export async function extractWithLlm(items: readonly TextItem[]): Promise<LlmExtraction | null> {
  if (!transport || rateLimited || items.length === 0) return null;
  try {
    return await transport(items);
  } catch (error) {
    if (error instanceof ProcoreApiError && error.status === 429) rateLimited = true;
    return null;
  }
}
