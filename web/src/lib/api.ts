/**
 * Client for our backend proxy.
 *
 * All Procore traffic goes through `/api/procore/*` so the browser never holds a
 * token. Requests are same-origin (Vite proxies /api in dev), so the httpOnly session
 * cookie rides along automatically.
 */

/** Thrown when the session is missing or unrecoverable; the UI returns to login. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('Not authenticated with Procore');
  }
}

export class ProcoreApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Procore API error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Procore requires a Procore-Company-Id header identifying which company a call acts
 * on. Read endpoints tolerate its absence; writes reject with a 400, so it is set once
 * when the user picks a company and attached to every request from then on.
 *
 * Backed by sessionStorage rather than a bare module variable: a bare `let` is reset to
 * null when Vite hot-reloads this module, while React keeps the already-selected
 * project mounted — so writes would silently lose the header after any edit to this
 * file. sessionStorage survives HMR and a same-tab reload, and clears with the tab.
 */
const COMPANY_KEY = 'db_company_id';

export function setCompanyId(id: number): void {
  sessionStorage.setItem(COMPANY_KEY, String(id));
}

function getCompanyId(): number | null {
  const stored = sessionStorage.getItem(COMPANY_KEY);
  return stored ? Number(stored) : null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Procore Idempotency-Token. Must be stable across retries so a re-sent request
   * dedupes instead of double-processing — generate it once at the call site, not
   * inside the retry loop.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Total attempts including the first. Retries apply to 429 and 5xx only. */
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 4;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/**
 * Retry delay for a failed attempt.
 *
 * Procore's own Retry-After header wins when present — guessing a shorter delay just
 * burns another request against a limit we already know we exceeded. Otherwise back
 * off exponentially with jitter, so a queue of parallel sheets that all hit the limit
 * at once does not retry in lockstep and re-trigger it.
 */
function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  const backoff = 500 * 2 ** (attempt - 1);
  return backoff + Math.random() * 250;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    idempotencyKey,
    signal,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const headers: Record<string, string> = {};
    if (body) headers['content-type'] = 'application/json';
    const companyId = getCompanyId();
    if (companyId !== null) headers['procore-company-id'] = String(companyId);
    // Same token every attempt (destructured once above) so retries dedupe.
    if (idempotencyKey) headers['idempotency-token'] = idempotencyKey;

    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body ? JSON.stringify(body) : null,
      ...(signal ? { signal } : {}),
    });

    if (response.ok) {
      // 204 and other empty responses would blow up response.json().
      const text = await response.text();
      return (text ? JSON.parse(text) : null) as T;
    }

    // The proxy refreshes tokens transparently, so a 401 reaching here means the
    // refresh token is spent too. Retrying cannot help.
    if (response.status === 401) throw new NotAuthenticatedError();

    const isRetryable = response.status === 429 || response.status >= 500;
    if (!isRetryable || attempt === maxAttempts) {
      throw new ProcoreApiError(response.status, await response.text());
    }

    lastError = new ProcoreApiError(response.status, response.statusText);
    await sleep(retryDelayMs(response, attempt), signal);
  }

  throw lastError;
}

/** Procore REST helper: `procore('v1.0/me')` -> GET /api/procore/v1.0/me */
export function procore<T>(path: string, options?: RequestOptions): Promise<T> {
  return apiFetch<T>(`/api/procore/${path}`, options);
}
