import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { config } from './config.ts';
import { authRoutes } from './routes/auth.ts';
import { proxyRoutes } from './routes/proxy.ts';

const app = Fastify({
  logger: {
    level: config.isProduction ? 'info' : 'debug',
    // Tokens must never reach the logs, even at debug level.
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});

await app.register(cookie);

// Every Procore call the proxy forwards is JSON (drawing_uploads was the last multipart
// caller; it moved to a JSON body once Procore confirmed that is the shape it wants), so
// Fastify's built-in JSON parser is all we need — no custom raw-body parser.

// The SPA runs on a separate origin in development, so it needs credentialed CORS.
// Reflecting a single configured origin (never '*') is what allows the session cookie
// to be sent at all.
app.addHook('onRequest', async (request, reply) => {
  reply.header('access-control-allow-origin', config.webOrigin);
  reply.header('access-control-allow-credentials', 'true');
  reply.header('vary', 'origin');

  if (request.method === 'OPTIONS') {
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');
    return reply.code(204).send();
  }
});

app.get('/api/health', async () => ({ ok: true, procoreEnv: config.procore.env }));

await app.register(authRoutes);
await app.register(proxyRoutes);

// In production the server is the single origin: it serves the built SPA alongside the
// `/api/*` routes above. This is what keeps the httpOnly session cookie same-origin (no
// CORS/SameSite dance) and the single-flight token refresh in one persistent process.
// In development the SPA is served by Vite on its own port, so we skip this entirely.
// web/dist relative to this file (server/src/index.ts): up to server/src, up to server,
// up to the repo root, then into web/dist. Resolved from import.meta.url so it holds no
// matter which directory the host process is started from.
const spaRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

// Serve the SPA only when a build is actually present. This supports two topologies from
// one codebase: a single-origin deploy that builds web/dist and serves it here, and an
// API-only deploy (SPA hosted elsewhere, e.g. Netlify) where dist is absent and we skip
// static serving entirely rather than 500 on a missing index.html.
if (config.isProduction && existsSync(spaRoot)) {
  await app.register(fastifyStatic, { root: spaRoot });

  // SPA fallback: any unmatched GET returns index.html so client-side routes work on a
  // hard refresh or deep link. An unmatched /api/* path is a real 404 — never answer a
  // fetch() with HTML, which would surface downstream as a confusing JSON parse error.
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
