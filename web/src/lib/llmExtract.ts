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
 * Heuristic confidence at or above which the local result is trusted outright and the
 * LLM is skipped. Set to the same ~0.5 "show this to the user" review line used in
 * sheetNumber.ts: an LLM call is only worth making on a sheet the heuristics were
 * already unsure about.
 *
 * This gate is per sheet, so a clean 60-page package where the heuristics are confident
 * makes few calls (or none) rather than 60 — which is what keeps large uploads under the
 * provider's per-minute limit.
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
 * Default transport: POSTs page text to the server through `apiFetch`. `maxAttempts: 1`
 * is deliberate — we do NOT want apiFetch to sleep on a big `Retry-After` and stall
 * parsing; a rate limit should fail fast so `extractWithLlm` can trip the breaker and
 * move on. A 204 (LLM disabled server-side) comes back as `null`.
 */
export const httpLlmTransport: LlmTransport = (items) =>
  apiFetch<LlmExtraction | null>('/api/extract', { method: 'POST', body: { items }, maxAttempts: 1 });

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
