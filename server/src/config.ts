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

/** Procore runs a separate sandbox host for development against test projects. */
const PROCORE_HOSTS = {
  sandbox: 'https://sandbox.procore.com',
  production: 'https://app.procore.com',
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
    host: PROCORE_HOSTS[procoreEnv],
    clientId: required('PROCORE_CLIENT_ID'),
    clientSecret: required('PROCORE_CLIENT_SECRET'),
    redirectUri: process.env.PROCORE_REDIRECT_URI ?? 'http://localhost:3001/api/auth/callback',
  },

  /**
   * 32-byte key, hex-encoded, used to encrypt the session cookie.
   * Generate with: openssl rand -hex 32
   */
  sessionKey: Buffer.from(required('SESSION_ENCRYPTION_KEY'), 'hex'),
} as const;

if (config.sessionKey.length !== 32) {
  throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes (64 hex characters).');
}
