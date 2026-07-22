/**
 * Encrypted cookie session.
 *
 * The Procore tokens live in the cookie itself rather than in server-side storage
 * keyed by a session id. That is what keeps the server stateless: any instance can
 * serve any request, and a restart loses nothing.
 *
 * AES-256-GCM is used rather than plain AES so that tampering is detected. A cookie
 * modified by the client fails the authentication tag check and is rejected outright,
 * instead of decrypting into attacker-influenced plaintext.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.ts';

export const SESSION_COOKIE = 'db_session';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, the standard nonce size for GCM
const TAG_LENGTH = 16;

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

export function seal(session: Session): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, config.sessionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ]);
  // iv || tag || ciphertext — the tag is fixed-width so this splits unambiguously.
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function unseal(raw: string): Session | null {
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length <= IV_LENGTH + TAG_LENGTH) return null;

    const decipher = createDecipheriv(
      ALGORITHM,
      config.sessionKey,
      buf.subarray(0, IV_LENGTH),
    );
    decipher.setAuthTag(buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));

    const plaintext = Buffer.concat([
      decipher.update(buf.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]).toString('utf8');

    return JSON.parse(plaintext) as Session;
  } catch {
    // Tampered, truncated, or encrypted under a rotated key. All mean "no session".
    return null;
  }
}

export function setSession(reply: FastifyReply, session: Session): void {
  reply.setCookie(SESSION_COOKIE, seal(session), {
    httpOnly: true, // never readable from JS, so XSS cannot exfiltrate Procore tokens
    secure: config.isProduction,
    sameSite: 'lax', // 'lax' still permits the top-level OAuth redirect back from Procore
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // bounded by the refresh token's own lifetime anyway
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSession(request: FastifyRequest): Session | null {
  const raw = request.cookies[SESSION_COOKIE];
  return raw ? unseal(raw) : null;
}
