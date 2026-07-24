/**
 * Sheet metadata extraction via an OpenAI-compatible LLM (Groq/Cerebras by default).
 *
 * The browser does all PDF parsing, but it cannot hold the LLM API key, so this route
 * is the thin authenticating hop: it takes the page's already-extracted text fragments,
 * asks the model for the sheet number and title, and returns a typed object.
 *
 * Like the Procore proxy, it does not cache or persist. Only sheet *text* is sent
 * upstream — never the drawing file, which still PUTs straight to S3. When no key is
 * configured the route answers 204 so the client transparently falls back to its
 * positional heuristics.
 */

import { request as undiciRequest } from 'undici';
import type { FastifyInstance } from 'fastify';
import { readSession } from '../auth/session.ts';
import { config } from '../config.ts';

interface TextItem {
  text: string;
  x: number;
  y: number;
}

interface ExtractBody {
  items?: TextItem[];
}

/**
 * Strict JSON Schema the model must conform to. `strict: true` makes Groq enforce this
 * server-side with no retry/validation loop — the response is guaranteed to be exactly
 * this shape, so the client never parses free-form prose. `null` is allowed because a
 * confident wrong answer is worse than an honest "unsure" that falls back to review.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    sheetNumber: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
  },
  required: ['sheetNumber', 'title'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  'You identify the drawing sheet number and title from the text of one construction',
  'drawing sheet. Each line is a text fragment prefixed with its normalized position',
  '(x,y), where (0.0,0.0) is the top-left of the page and (1.0,1.0) is the bottom-right.',
  'The title block sits in the bottom-right corner, so the true sheet number and title',
  'are almost always there.',
  '',
  'The sheet number looks like "A-101", "M-105.00", "S-201", "E-001" — a discipline',
  'letter, an optional separator, then a number. Do NOT return drawing callouts such as',
  '"SEE A-501" (these sit in the page body, upper/left), permit or job numbers, or',
  'title-block labels ("SHEET NO", "SCALE", "DATE").',
  '',
  'The title is the descriptive, usually all-caps phrase naming the sheet, e.g.',
  '"FIRST FLOOR PLAN" or "MECHANICAL FLOOR PLAN". It sits just above the sheet number.',
  '',
  'Return null for either field you are not confident about rather than guessing.',
].join('\n');

export async function extractRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ExtractBody }>('/api/extract', async (request, reply) => {
    // Don't leave an open relay to our rate-limited LLM key: require a session. No
    // Procore call is made, so a bare readSession (no refresh) is enough.
    if (!readSession(request)) {
      return reply.code(401).send({ error: 'not_authenticated' });
    }

    // Optional feature: with no key configured, tell the client to fall back cleanly.
    if (!config.llm) return reply.code(204).send();

    const items = request.body?.items;
    if (!Array.isArray(items) || items.length === 0) return reply.code(204).send();

    // The client already restricts this to the title-block corner; this cap is a final
    // guard so a pathological page can never exceed the provider's per-minute token limit.
    const MAX_PROMPT_CHARS = 2000;
    const pageText = items
      .map((item) => `(${item.x.toFixed(2)},${item.y.toFixed(2)}) ${item.text}`)
      .join('\n')
      .slice(0, MAX_PROMPT_CHARS);

    const upstream = await undiciRequest(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.llm.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0, // deterministic: the same sheet should extract the same way
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: pageText },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'sheet_metadata', schema: RESPONSE_SCHEMA, strict: true },
        },
      }),
    });

    if (upstream.statusCode >= 400) {
      const detail = await upstream.body.text();
      request.log.warn(
        { status: upstream.statusCode, llmSaid: detail.slice(0, 500) },
        'LLM extraction request failed',
      );
      // Pass Groq's rate-limit signal through so the client's api.ts backoff can pace a
      // large batch instead of hammering the limit.
      const retryAfter = upstream.headers['retry-after'];
      if (typeof retryAfter === 'string') reply.header('retry-after', retryAfter);
      return reply.code(upstream.statusCode).send({ error: 'llm_error' });
    }

    const data = (await upstream.body.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return reply.code(204).send();

    // Structured Outputs returns the object as a JSON *string* in message.content.
    try {
      const parsed = JSON.parse(content) as { sheetNumber?: unknown; title?: unknown };
      return reply.send({
        sheetNumber: typeof parsed.sheetNumber === 'string' ? parsed.sheetNumber : null,
        title: typeof parsed.title === 'string' ? parsed.title : null,
      });
    } catch {
      // Malformed content despite the schema — degrade to heuristics rather than 500.
      return reply.code(204).send();
    }
  });
}
