import { test } from 'node:test';
import assert from 'node:assert/strict';

// config.ts validates env at import time, so populate it before the dynamic import below.
process.env.PROCORE_CLIENT_ID ??= 'test-client-id';
process.env.PROCORE_CLIENT_SECRET ??= 'test-client-secret';
process.env.SESSION_ENCRYPTION_KEY ??= '0'.repeat(64);

const { seal, unseal } = await import('./session.ts');

const session = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  expiresAt: 1_800_000_000_000,
};

test('seal then unseal round-trips a session', () => {
  assert.deepEqual(unseal(seal(session)), session);
});

test('sealing is non-deterministic so cookies are not correlatable', () => {
  // A fresh random IV per seal means two identical sessions produce different
  // ciphertexts, denying an observer any equality signal between cookies.
  assert.notEqual(seal(session), seal(session));
});

test('tokens do not appear in plaintext within the cookie', () => {
  assert.ok(!seal(session).includes('refresh-xyz'));
});

test('a tampered cookie is rejected rather than partially trusted', () => {
  const sealed = seal(session);
  // Flip a character in the ciphertext body, past the iv and auth tag.
  const flipped = `${sealed.slice(0, -3)}${sealed.at(-3) === 'A' ? 'B' : 'A'}${sealed.slice(-2)}`;
  assert.equal(unseal(flipped), null);
});

test('truncated and malformed cookies return null', () => {
  assert.equal(unseal(''), null);
  assert.equal(unseal('not-base64url!!'), null);
  assert.equal(unseal(seal(session).slice(0, 10)), null);
});
