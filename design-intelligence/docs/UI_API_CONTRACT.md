# Preview / Recipe Editor — API contract and handoff

Status legend: **Implemented** (in this PR, tested) · **Proposed** (needs the owner's decision; nothing depends on it yet) · **Unverified** (needs real data).

The UI consumes the Phase 1 Worker API as-is. It does not duplicate the asset database. All requests use `Authorization: Bearer <token>`; scope (tenant/brand/write) comes only from the server-side principal.

## 1. Endpoints the UI uses today (Implemented)

| Purpose | Request | Fields the UI reads |
|---|---|---|
| Styles + palette + tokens | `GET /styles` | `id, label, colors{name:#hex}, tokens{--name:value}, tokenCompatibility{status}` |
| Categories for a style | `GET /categories?style=` | `id, label` |
| Search / filter / paginate | `GET /assets/search?style&category&kind&rights&q&limit&cursor` | `assetId, name, kind, rights, review, hasPreview, nextCursor` |
| Card & detail previews | `GET /assets/{id}/preview` · `/vector` | image bytes; `404` = "no preview" (not an error state) |
| Detail | `GET /assets/{id}` | `+ version, driveFileId, styles[], categories[], variants[], lineage[], sources[].payload` |
| Recipe save / restore | `PUT /design-recipes/{id}` · `GET /design-recipes/{id}` | `{title, style, accent, components:[{assetId}], version}` |

UI behaviour that depends on the contract:
- `404` on preview/vector → placeholder ("无预览"), not retried. `5xx`/network on `GET` → one automatic retry, then an error state with a manual retry. `PUT` is never auto-retried.
- `409` on `PUT` → UI first re-reads the recipe; if the server copy equals the local content it adopts that version (idempotent recovery after a lost response), otherwise offers *save as new* / *load latest* and keeps local edits.
- A new recipe's `id` is generated client-side before the first `PUT` (UUID) so retries reuse it.
- `401` at any time → session cleared, back to the login screen. The token is held in memory only (optionally `sessionStorage`, opt-in).
- Palette key `pink` is treated as the primary color (the value persisted as `accent`); if absent, the first palette entry is used. Only 6-digit/3-digit hex values in `colors` are editable; other entries are ignored.
- Token switching: SVG `var(--name, fallback)` is resolved from the style's `tokens` plus local overrides; palette hex values are recolored in the SVG text. `url(#id)` and `href="#id"` references are never rewritten.

## 2. Worker change in this PR (needs Codex ack)

`src/worker.mjs`: the unauthenticated static allowlist now also admits `GET /ui/<name>.mjs` (regex `^/ui/[\w-]+\.mjs$`) so the UI modules under `public/ui/` are served. Everything else still requires a bearer token (covered by a unit test for traversal-like paths and other extensions). No API route changed. `tools/dev.mjs` gained `--demo`, `DESIGN_DEV_DB`, `DESIGN_DEV_CACHE`.

## 3. Proposed API additions (for Codex) — **Proposed, not implemented**

Ordered by user impact. None blocks the current UI.

1. **Persist layout and theme in the recipe document.** Today only `title, style, accent, components[assetId]` survive a round trip, so per-component position/scale and non-primary palette/token overrides are local-only (the UI says so). Suggest optional `components[].layout {x,y,scale,rotation}` and `theme {colors, tokens}` with the same validation style (bounded, hex-checked), versioned by the existing `version` column.
2. **Thumbnail endpoint.** `asset_variants` rows of kind `thumbnail` only carry a Drive ID, so reference assets show a placeholder. `GET /assets/{id}/thumbnail` served from the cache (like preview) would complete reference browsing.
3. **Richer search items.** Include `styles[]`/`categories[]` (ids) in `/assets/search` items so "add from all-styles search" needs no extra detail request; add category `label` to `/assets/{id}`; optional total count.
4. **Brand scope discovery.** `design-rules` needs a brand id the client cannot learn. `GET /brands/current` (or include `brandId` in `/styles`) lets the UI show rules and brand name.
5. **Recipe listing.** `GET /design-recipes?limit&cursor` (id, title, style, updatedAt) so users pick a recipe instead of pasting an ID.
6. **Search beyond names.** `q` is a name substring today; tags and source text would help once Muse fills descriptions.

## 4. Asset field alignment (for Muse) — **Unverified against real data**

The UI was built and tested on a synthetic index (`npm run dev:demo`); the private Drive-backed index was not available here. Please confirm on real data:

- `colors` in `/styles` is a flat `{name: "#hex"}` map and one key is the brand primary (`pink` assumed).
- `tokens` are CSS custom properties; SVGs that should respond to token switching use `var(--token, fallback)`. Assets with hard-coded hex only respond to palette switching.
- Duplicate names exist across kits (`house.svg` ×2). The UI disambiguates by style and `assetId`; human-readable titles or alt text per asset would be better than file names.
- Preview PNG ≥ 256 px square on a transparent background (the grid uses a checkerboard).
- `rights`/`review` vocabulary is rendered verbatim as: reference_only 仅参考, unverified 未验证, restricted 受限, commercial_ready 可商用; pending 待分类, indexed 已索引, approved 已审核. New values need a label (unknown values are shown raw).
- `sources[].payload` is shown as formatted JSON text (never as HTML).

## 5. Copy-paste handoff messages

**To Codex**

> Branch `claude/shirley-preview-editor-5l9m6l` (based on PR #1) adds the Preview/Recipe Editor UI under `design-intelligence/public/`. Please review `docs/UI_API_CONTRACT.md`: (a) ack the `/ui/*.mjs` static allowlist change in `src/worker.mjs`; (b) decide on proposals 1–5 in §3 — #1 (layout/theme in recipe document) and #2 (thumbnail endpoint) matter most. Tests: `npm test` (unit + Chromium E2E with a synthetic index; private-data baseline still skipped unless inputs exist).

**To Muse**

> Please check §4 of `design-intelligence/docs/UI_API_CONTRACT.md` against the real Drive-backed index and report any field that differs (palette shape, token usage inside SVGs, preview size, label vocabulary). Run `npm run dev:demo` to see how each field is displayed.
