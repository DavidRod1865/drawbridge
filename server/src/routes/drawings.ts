/**
 * Streams a Procore-hosted drawing render (PNG / PDF / thumbnail) back to the browser
 * same-origin.
 *
 * Why this exists: a drawing revision carries signed URLs to its rasters/PDF, but they
 * live on Procore's File Access Service (`*.procore.com/fas/...`), which refuses
 * cross-origin reads — a plain <img src> or fetch() from the SPA fails on CORS/origin.
 * So the file has to be pulled through the same origin the SPA is served from.
 *
 * Statelessness is preserved: bytes are streamed straight through, never written to disk
 * or cached. Procore stays the single source of truth for drawings.
 *
 * The client sends only projectId/revisionId/kind — never the signed URL. This route
 * fetches the revision itself and reads the URL server-side, so the short-lived `sig`
 * token never lands in our request paths or access logs.
 */

import { request as undiciRequest } from 'undici';
import type { FastifyInstance } from 'fastify';
import { ensureFreshSession } from './proxy.ts';
import { config } from '../config.ts';

// The viewable renders a revision exposes, mapped to the field that holds each one.
// An allowlist, so `kind` can never name an arbitrary property of the revision.
const ASSET_FIELDS = {
  png: 'png_url',
  pdf: 'pdf_url',
  thumbnail: 'thumbnail_url',
  large_thumbnail: 'large_thumbnail_url',
} as const;

type AssetKind = keyof typeof ASSET_FIELDS;

/** True for an `https://…procore.com` URL — the only host we send the bearer token to. */
function isProcoreHost(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'procore.com' || url.hostname.endsWith('.procore.com'))
  );
}

/**
 * Guards against SSRF: the URL we start from comes from Procore's response, but we still
 * only ever begin from https on a procore.com host. A compromised or spoofed response
 * can't turn this route into an open proxy to the internet or the internal network.
 */
function isProcoreFileUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return isProcoreHost(new URL(value));
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 5;

/**
 * Fetches a drawing asset, following Procore's File Access Service redirect chain.
 *
 * The FAS URL requires the OAuth bearer, then 302-redirects to a long presigned storage
 * URL (S3) that is self-authenticating. So we send the bearer only while we're still on a
 * procore.com host and drop it the moment we follow off it — forwarding the token to S3
 * would leak it and can break S3's own signature check. Only https is ever followed.
 */
async function fetchAsset(startUrl: string, bearer: string) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error(`refusing non-https redirect to ${parsed.protocol}`);
    const headers = isProcoreHost(parsed) ? { authorization: `Bearer ${bearer}` } : {};
    const response = await undiciRequest(url, { headers });

    const isRedirect = response.statusCode >= 300 && response.statusCode < 400;
    const location = response.headers['location'];
    if (isRedirect && typeof location === 'string') {
      // Drain the redirect body so the connection can be reused, then follow.
      await response.body.dump();
      url = new URL(location, url).toString();
      continue;
    }
    return response;
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}

export async function drawingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { projectId: string; revisionId: string; kind: string };
    Querystring: { company?: string };
  }>(
    '/api/drawings/:projectId/:revisionId/:kind',
    async (request, reply) => {
      const { projectId, revisionId, kind } = request.params;

      const field = ASSET_FIELDS[kind as AssetKind];
      if (!field) {
        return reply.code(400).send({ error: 'unknown_asset_kind' });
      }

      const session = await ensureFreshSession(request, reply);
      if (!session) {
        return reply.code(401).send({ error: 'not_authenticated' });
      }

      // Hop 1: read the revision to get its signed asset URL. Procore's project-scoped
      // reads 404 without a Procore-Company-Id header. An <img> request can't send that
      // header, so the client passes the company id in the query string and we set it here
      // (validated to a positive integer, so the value can't inject a header).
      const revisionHeaders: Record<string, string> = {
        authorization: `Bearer ${session.accessToken}`,
      };
      const companyId = Number(request.query.company);
      if (Number.isInteger(companyId) && companyId > 0) {
        revisionHeaders['Procore-Company-Id'] = String(companyId);
      }

      const revisionUrl =
        `${config.procore.apiHost}/rest/v1.0/projects/${projectId}` +
        `/drawing_revisions/${revisionId}`;
      const revisionResponse = await undiciRequest(revisionUrl, {
        headers: revisionHeaders,
      });

      if (revisionResponse.statusCode >= 400) {
        const detail = await revisionResponse.body.text();
        request.log.warn(
          { projectId, revisionId, status: revisionResponse.statusCode, procoreSaid: detail.slice(0, 400) },
          'Could not load drawing revision for asset stream',
        );
        return reply.code(revisionResponse.statusCode).send({ error: 'revision_unavailable' });
      }

      const revision = (await revisionResponse.body.json()) as Record<string, unknown>;
      const assetUrl = revision[field];
      if (!isProcoreFileUrl(assetUrl)) {
        // No render yet (Procore may still be processing), or an unexpected host.
        return reply.code(404).send({ error: 'asset_not_available' });
      }

      // Hop 2: fetch the file, following FAS's authenticated redirect to storage. The FAS
      // URL needs the bearer (its query `sig` alone returns 401); it then 302s to a
      // presigned S3 URL fetched without the token (see fetchAsset).
      let assetResponse;
      try {
        assetResponse = await fetchAsset(assetUrl, session.accessToken);
      } catch (cause) {
        request.log.warn({ err: cause, projectId, revisionId, kind }, 'Drawing asset fetch failed');
        return reply.code(502).send({ error: 'asset_fetch_failed' });
      }
      if (assetResponse.statusCode >= 300) {
        request.log.warn(
          { projectId, revisionId, kind, status: assetResponse.statusCode },
          'Procore file service rejected the asset fetch',
        );
        return reply.code(502).send({ error: 'asset_fetch_failed' });
      }

      // Stream the bytes straight back. Buffer (not ArrayBuffer): Fastify forwards a
      // Buffer untouched but JSON-serializes an ArrayBuffer, corrupting binary payloads.
      // A short private cache lets the viewer's zoom re-renders reuse the image without
      // re-hitting Procore, while the signed URL is still valid.
      return reply
        .code(200)
        .type(String(assetResponse.headers['content-type'] ?? 'application/octet-stream'))
        .header('cache-control', 'private, max-age=300')
        .send(Buffer.from(await assetResponse.body.arrayBuffer()));
    },
  );
}
