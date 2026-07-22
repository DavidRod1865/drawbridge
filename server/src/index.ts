import Fastify from 'fastify';
import cookie from '@fastify/cookie';
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

await app.listen({ port: config.port, host: '0.0.0.0' });
