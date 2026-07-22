# Changelog

All notable changes to Drawbridge are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-07-22

A full front-end redesign plus a guided upload flow. No changes to the stateless data
path — drawings still upload straight from the browser to Procore.

### Added

- **Design system** — migrated the SPA to Tailwind CSS v4 + shadcn/ui with a "blueprint"
  theme (safety-orange accent on cool slate, Bricolage Grotesque / Geist / IBM Plex Mono,
  a faint drafting-grid shell). A dark theme is defined and ready behind a `.dark` root.
- **Add-drawings wizard** — a two-step modal: choose the Drawing Set and set the batch
  Drawing date / Received date (Step 1), then upload PDFs (Step 2). Closes itself once
  parsing produces sheets.
- **Deferred Drawing Set creation** — a new Drawing Set typed via "+ New" is held as a
  session-only draft and only created in Procore at upload time, so an unused set never
  leaks into the project.
- **Review table dates** — editable Drawing date and Received columns, prefilled from the
  wizard's batch dates and overridable per row.
- **Header context** — a Company › Project breadcrumb with Home, Change project, and Sign
  out actions; the app name stays visible and the Sandbox badge reflects `PROCORE_ENV`.

### Changed

- Every component now uses shadcn primitives; the custom dropdown was rebuilt on Radix
  Popover + cmdk Command (filtering, grouping, and keyboard nav for free) while keeping
  its existing API.
- The review table header now names the destination (Drawing Set and Drawing Area) and
  pluralizes counts correctly.

### Removed

- The post-upload "Apply dates & revisions" panel (`ApplyMetadataPanel`) — no longer
  needed now that dates and revisions are captured before upload.
- The legacy hand-written `web/src/styles.css`.

### Fixed

- The "Open in Procore" link now follows the active environment (`app.procore.com` in
  production, `sandbox.procore.com` otherwise) instead of always linking to sandbox.
- Sheet # and date column widths in the review table no longer clip their contents.
- The project-picker card no longer stretches to full viewport height.

## [0.2.0] — Prior baseline

- Drawing-area browser with per-discipline drawing tables.
- Stateless guided upload portal for Procore's Drawings tool: local parsing, validation,
  and direct browser-to-Procore upload via the AES-256-GCM session cookie and the thin
  authenticating proxy.

[0.3.0]: https://github.com/DavidRod1865/drawbridge/releases/tag/v0.3.0
