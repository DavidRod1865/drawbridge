/**
 * Environment configuration.
 *
 * Drawbridge is stateless: these few secrets are the entire server-side state.
 * There is no database URL here, and there never should be.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

/**
 * Procore hosts, per environment.
 *
 * `auth` serves the OAuth flow (authorize + token); `api` serves the REST API. In
 * SANDBOX both live on one host, which is why a single host sufficed for a long time. In
 * PRODUCTION they are DIFFERENT: `app.procore.com` is the web/login host, and the REST API
 * lives on `api.procore.com`. Pointing REST calls at `app.procore.com` in production makes
 * some endpoints (e.g. the projects collection) 404 with "Item not found" while others
 * (e.g. /companies) still work — a legacy surface that only partially overlaps the real
 * API. Confirmed 2026-07-22: the identical GET /rest/v1.0/projects?company_id=... returns
 * the full list on api.procore.com but 404s on app.procore.com.
 */
const PROCORE_HOSTS = {
  sandbox: { auth: 'https://sandbox.procore.com', api: 'https://sandbox.procore.com' },
  production: { auth: 'https://app.procore.com', api: 'https://api.procore.com' },
} as const;

export type ProcoreEnv = keyof typeof PROCORE_HOSTS;

const procoreEnv = (process.env.PROCORE_ENV ?? 'sandbox') as ProcoreEnv;
if (!(procoreEnv in PROCORE_HOSTS)) {
  throw new Error(`PROCORE_ENV must be one of: ${Object.keys(PROCORE_HOSTS).join(', ')}`);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',

  procore: {
    env: procoreEnv,
    // authHost: OAuth authorize + token exchange. apiHost: the REST API. Same host in
    // sandbox, different in production (see PROCORE_HOSTS). PROCORE_API_HOST overrides the
    // REST host if Procore ever moves it again.
    authHost: PROCORE_HOSTS[procoreEnv].auth,
    apiHost: process.env.PROCORE_API_HOST ?? PROCORE_HOSTS[procoreEnv].api,
    clientId: required('PROCORE_CLIENT_ID'),
    clientSecret: required('PROCORE_CLIENT_SECRET'),
    redirectUri: process.env.PROCORE_REDIRECT_URI ?? 'http://localhost:3001/api/auth/callback',
  },

  /**
   * 32-byte key, hex-encoded, used to encrypt the session cookie.
   * Generate with: openssl rand -hex 32
   */
  sessionKey: Buffer.from(required('SESSION_ENCRYPTION_KEY'), 'hex'),

  /**
   * Optional LLM used to improve sheet number/title extraction. Null when no key is
   * configured — the app then falls back to the positional heuristics, so this is a
   * pure enhancement and never a boot requirement. Provider-agnostic on purpose: any
   * OpenAI-compatible endpoint works, so switching providers is a base-URL/model change,
   * not a code change. Defaults target Groq's free tier.
   */
  llm: process.env.LLM_API_KEY
    ? {
        apiKey: process.env.LLM_API_KEY,
        baseUrl: process.env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1',
        // On Groq, strict JSON-schema Structured Outputs (which extract.ts relies on)
        // are supported ONLY by the gpt-oss models — a llama/qwen model here would 400.
        model: process.env.LLM_MODEL ?? 'openai/gpt-oss-20b',
      }
    : null,
} as const;

if (config.sessionKey.length !== 32) {
  throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes (64 hex characters).');
}
