/**
 * OAuth entry, callback, session status, and logout.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { authorizeUrl, exchangeCode, isExpired } from '../auth/oauth.ts';
import { clearSession, readSession, setSession } from '../auth/session.ts';
import { config } from '../config.ts';

const STATE_COOKIE = 'db_oauth_state';

/** Constant-time compare that tolerates differing lengths without throwing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/login', async (_request, reply) => {
    // The `state` parameter defends against CSRF on the callback. We stash it in a
    // short-lived cookie rather than server memory so this stays stateless and works
    // across instances.
    const state = randomBytes(16).toString('base64url');

    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 600, // ten minutes is ample for a login round trip
    });

    return reply.redirect(authorizeUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/callback',
    async (request, reply) => {
      const { code, state, error } = request.query;

      if (error) {
        return reply.redirect(`${config.webOrigin}/?auth_error=${encodeURIComponent(error)}`);
      }

      const expectedState = request.cookies[STATE_COOKIE];
      if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
        return reply.redirect(`${config.webOrigin}/?auth_error=invalid_state`);
      }
      reply.clearCookie(STATE_COOKIE, { path: '/' });

      try {
        setSession(reply, await exchangeCode(code));
        return reply.redirect(`${config.webOrigin}/`);
      } catch (cause) {
        // `err`, not `cause`: pino only serializes Errors under its `err` key.
        request.log.error({ err: cause }, 'Procore code exchange failed');
        return reply.redirect(`${config.webOrigin}/?auth_error=exchange_failed`);
      }
    },
  );

  /** Lets the SPA decide between the login screen and the project picker on boot. */
  app.get('/api/auth/status', async (request) => {
    const session = readSession(request);
    if (!session) return { authenticated: false };

    return {
      authenticated: true,
      // Expired-but-refreshable still counts as authenticated; the proxy will refresh
      // transparently on the next call.
      expired: isExpired(session),
      environment: config.procore.env,
    };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSession(reply);
    return { ok: true };
  });
}
