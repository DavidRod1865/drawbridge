# Drawbridge

A **stateless** guided upload portal for [Procore's](https://www.procore.com/) Drawings
tool. Drawbridge validates a drawing package in the browser, then uploads sheets directly
to Procore via its REST API.

There is no database and no stored drawings — **Procore is the single source of truth.**
Drawing bytes are PUT straight from the browser to the presigned S3 URL Procore returns;
they never pass through Drawbridge's server. Access/refresh tokens live inside an
encrypted session cookie, so any server instance can serve any request and a restart
loses nothing.

## How it works

1. **Sign in** with Procore (OAuth). The server exchanges the code and stashes the
   tokens in an AES-256-GCM-encrypted, httpOnly cookie.
2. **Pick a project** and **drop a PDF** package.
3. The browser **parses and validates** locally: it reads sheet numbers and revision
   labels from each page, splits multi-page PDFs into one upload per sheet, and diffs the
   package against the project's current Procore revisions (new vs. revision vs.
   duplicate vs. older).
4. You **review** anything the parser was unsure about, then **upload**. Sheets that
   carry a number and discipline get a Drawing created up front so Procore files the
   revision straight into the Drawings tool; sheets missing a discipline fall back to
   Procore's OCR "Items to Review" queue.

## Architecture

npm workspaces monorepo with two packages:

- **`server/`** — a Fastify auth service plus a thin authenticating proxy to Procore.
  Runs TypeScript directly on Node (no build step). It attaches the bearer token,
  transparently refreshes expired tokens, and forwards requests to `/api/procore/*`. It
  does not cache, transform, or persist anything.
- **`web/`** — a React 19 + Vite SPA that does all the interesting work: PDF parsing,
  sheet-number recognition, revision comparison, validation, and upload orchestration.

The browser only ever talks to same-origin `/api/*`; in dev, Vite proxies that to the
server so the session cookie rides along with no CORS fuss.

### Where the domain logic lives (`web/src/lib`)

| Module | Responsibility |
| --- | --- |
| `sheetNumber.ts` | Recognizes and scores sheet numbers from PDF text (structure + title-block position). A confident wrong answer is worse than none, so uncertain picks score low and get sent to review. |
| `revision.ts` | Compares revision labels (numeric / alphabetic / issue-code schemes) to decide new vs. revision vs. duplicate vs. older. Returns `'unknown'` rather than guess an ordering that could silently overwrite. **The most consequential piece of domain logic.** |
| `pdf.ts` | Local parsing with `pdfjs-dist`; page splitting with `pdf-lib` (each sheet needs its own single-page upload). |
| `validation.ts` | Diffs the parsed package against current Procore revisions. Distinguishes **blocking** issues (disable upload) from **warnings** (need acknowledgement). |
| `upload.ts` | The upload queue. Per sheet: create Project Upload → PUT bytes to S3, then one batch call registers every sheet with the Drawings tool. Retries resume mid-sheet without re-sending bytes or double-registering. |
| `procore.ts` / `api.ts` | Procore API client. `api.ts` retries 429/5xx honoring `Retry-After` and attaches the required `Procore-Company-Id` header. |

## Getting started

Requires Node 20+ (22+ recommended — the server relies on Node type-stripping to run
TypeScript directly).

```bash
npm install

# Configure secrets
cp .env.example .env         # then fill it in — see below
```

You'll need a Procore app from the [Developer Portal](https://developers.procore.com) to
get a client ID/secret, and a session key:

```bash
openssl rand -hex 32         # value for SESSION_ENCRYPTION_KEY
```

The server throws on boot if the Procore secrets or a 32-byte `SESSION_ENCRYPTION_KEY`
are missing (see `server/src/config.ts`). Config is read from `.env.local` then `.env`.

## Commands

Run from the repo root. `dev` / `test` / `typecheck` fan out to both workspaces.

```bash
npm run dev          # server (:3001) + web (:5173) together
npm test             # run all tests in both workspaces
npm run typecheck    # tsc --noEmit in both workspaces
npm run build        # build the web SPA
```

Per-workspace / single test:

```bash
npm run dev --workspace=server            # just the API
node --test web/src/lib/revision.test.ts  # one test file (tests use node:test)
```

## Toolchain notes

The server has **no build step** — TypeScript runs directly on Node via type-stripping.
This constrains the source: no enums, no parameter properties, and **relative imports
must include the `.ts` extension** (`./config.ts`). tsconfig is strict, including
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. See `CLAUDE.md` for the full
rundown and the hard-won Procore API quirks.
