/**
 * Procore OAuth 2.0 authorization-code flow.
 *
 * Procore ROTATES refresh tokens: redeeming one invalidates it and returns a fresh
 * pair. That makes concurrent refreshes actively dangerous — with an upload queue
 * running several sheets in parallel, every in-flight request hits expiry at the same
 * moment, and whichever refresh lands second presents an already-spent token and kills
 * the session mid-upload. `refreshSession` therefore single-flights.
 */

import { request } from 'undici';
import { config } from '../config.ts';
import type { Session } from './session.ts';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

/**
 * Refresh this many milliseconds before actual expiry. Without a buffer, a token that
 * passes the check and then expires in transit produces an avoidable 401.
 */
const EXPIRY_SKEW_MS = 60_000;

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.procore.clientId,
    redirect_uri: config.procore.redirectUri,
    response_type: 'code',
    state,
  });
  return `${config.procore.authHost}/oauth/authorize?${params}`;
}

async function requestToken(body: Record<string, string>): Promise<Session> {
  // Form-encoded, per RFC 6749 §4.1.3. The token endpoint is the one place OAuth
  // servers are strict about encoding, and a JSON body is a common cause of
  // "client authentication failed" even when the credentials themselves are correct.
  const form = new URLSearchParams({
    client_id: config.procore.clientId,
    client_secret: config.procore.clientSecret,
    ...body,
  });

  const response = await request(`${config.procore.authHost}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  if (response.statusCode >= 400) {
    const detail = await response.body.text();
    throw new OAuthError(`Procore token request failed (${response.statusCode}): ${detail}`);
  }

  const token = (await response.body.json()) as TokenResponse;
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

export class OAuthError extends Error {}

export function exchangeCode(code: string): Promise<Session> {
  return requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.procore.redirectUri,
  });
}

export function isExpired(session: Session): boolean {
  return Date.now() >= session.expiresAt - EXPIRY_SKEW_MS;
}

/**
 * In-flight refreshes keyed by the refresh token being redeemed. Concurrent callers
 * holding the same token await one shared request rather than racing.
 *
 * This is per-instance. It is deliberately not shared state: a multi-instance
 * deployment behind a sticky-session load balancer keeps the guarantee, and without
 * stickiness the worst case is a single failed refresh that the user retries by
 * re-authenticating. Introducing shared storage here would forfeit statelessness for
 * a rare, recoverable case.
 */
const inFlight = new Map<string, Promise<Session>>();

export function refreshSession(session: Session): Promise<Session> {
  const existing = inFlight.get(session.refreshToken);
  if (existing) return existing;

  const pending = requestToken({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  }).finally(() => {
    inFlight.delete(session.refreshToken);
  });

  inFlight.set(session.refreshToken, pending);
  return pending;
}
