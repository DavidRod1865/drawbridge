/**
 * Thin authenticating proxy to the Procore REST API.
 *
 * Its only jobs are to attach the bearer token, keep the token fresh, and forward.
 * It deliberately does not cache, transform, or persist responses — the browser holds
 * whatever project state it needs for the session.
 *
 * Drawing FILES never pass through here. The browser PUTs bytes straight to the
 * presigned S3 URL Procore hands back, so "no stored drawings" is a property of the
 * data path rather than a policy we have to enforce.
 */

import { request as undiciRequest } from 'undici';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isExpired, refreshSession } from '../auth/oauth.ts';
import { readSession, setSession, clearSession, type Session } from '../auth/session.ts';
import { config } from '../config.ts';

/** Hop-by-hop and body-framing headers that must not be forwarded verbatim. */
const STRIPPED_HEADERS = new Set([
  'host',
  'cookie',
  'connection',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
]);

/** Shapes a request body for undici without altering already-encoded payloads. */
function forwardBody(body: unknown): Buffer | string | null {
  if (body === null || body === undefined || body === '') return null;
  if (Buffer.isBuffer(body)) return body; // pre-encoded bytes — never re-serialize
  if (typeof body === 'string') return body; // already encoded
  return JSON.stringify(body); // plain object → JSON
}

/**
 * Returns a usable session, refreshing and re-issuing the cookie if needed.
 * Returns null when there is no session at all, or the refresh token is spent.
 */
async function ensureFreshSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Session | null> {
  const session = readSession(request);
  if (!session) return null;
  if (!isExpired(session)) return session;

  try {
    const refreshed = await refreshSession(session);
    setSession(reply, refreshed);
    return refreshed;
  } catch (cause) {
    // Under pino's `err` key so the Error actually serializes — any other key
    // stringifies an Error to `{}` and the reason (e.g. invalid_grant) is lost.
    request.log.warn({ err: cause }, 'Procore token refresh failed; clearing session');
    clearSession(reply);
    return null;
  }
}

export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  app.all<{ Params: { '*': string } }>('/api/procore/*', async (request, reply) => {
    const session = await ensureFreshSession(request, reply);
    if (!session) {
      return reply.code(401).send({ error: 'not_authenticated' });
    }

    const path = request.params['*'];
    const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
    const target = `${config.procore.apiHost}/rest/${path}${query}`;

    const headers: Record<string, string> = { authorization: `Bearer ${session.accessToken}` };
    for (const [key, value] of Object.entries(request.headers)) {
      if (!STRIPPED_HEADERS.has(key) && typeof value === 'string') {
        headers[key] = value;
      }
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const upstream = await undiciRequest(target, {
      method: request.method as 'GET',
      headers,
      // Buffer  -> pre-encoded bytes, forwarded untouched.
      // string  -> already-encoded body, passed as-is.
      // object  -> a JSON payload to serialize.
      // null    -> no body (undici distinguishes this from an unset option).
      body: forwardBody(hasBody ? request.body : null),
    });

    // Surface Procore's rate-limit signal so the upload queue can back off intelligently
    // rather than guessing at a retry delay.
    const retryAfter = upstream.headers['retry-after'];
    if (typeof retryAfter === 'string') {
      reply.header('retry-after', retryAfter);
    }

    // Log the request that Procore rejected alongside its complaint. Procore's write
    // endpoints disagree about parameter nesting, and pairing the sent body with the
    // returned error is the only reliable way to tell which shape an endpoint wants.
    if (upstream.statusCode >= 400) {
      const detail = await upstream.body.text();
      request.log.warn(
        {
          method: request.method,
          path,
          status: upstream.statusCode,
          // Decode any binary body to text so the log stays readable; other bodies
          // (JSON objects, encoded strings) log as-is.
          sent: Buffer.isBuffer(request.body)
            ? request.body.toString('utf8').slice(0, 1200)
            : hasBody
              ? request.body
              : undefined,
          procoreSaid: detail.slice(0, 800),
        },
        'Procore rejected a request',
      );
      return reply
        .code(upstream.statusCode)
        .type(String(upstream.headers['content-type'] ?? 'application/json'))
        .send(detail);
    }

    // Buffer, not ArrayBuffer. Fastify passes a Buffer through untouched, but has no
    // special case for ArrayBuffer and JSON-serializes it instead — turning Procore's
    // array response into {"0":91,"1":123,...}. That still parses as valid JSON on the
    // client, so the corruption surfaces far away as a confusing shape error.
    return reply
      .code(upstream.statusCode)
      .type(String(upstream.headers['content-type'] ?? 'application/json'))
      .send(Buffer.from(await upstream.body.arrayBuffer()));
  });
}
