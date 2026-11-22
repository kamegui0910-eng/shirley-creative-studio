# Preview / Recipe Editor — API contract and handoff (Sprint 01)

Status legend: **Implemented** (in this branch, tested) · **Proposed** (needs the owner's decision) · **Unverified** (not exercised against the real thing).

The UI consumes the Design API as-is plus one additive extension (recipe schema v2). It does not duplicate the asset database. All requests use `Authorization: Bearer <token>`; scope (tenant/brand/write) comes only from the server-side principal.

## 1. Endpoints the UI uses

| Purpose | Request | Notes |
|---|---|---|
| Scope + write permission | `GET /session` | `{tenantId, brandId, write}`. `write:false` → UI shows a read-only badge and disables Save. A Worker without it answers 404 → UI assumes write access (a `403` on save is then handled). |
| Brand rules | `GET /brands/{brandId}/design-rules` | Shown read-only in the theme panel. |
| Styles + palette + tokens | `GET /styles` | `id, label, colors{name:#hex}, tokens{--name:value}, tokenCompatibility` |
| Categories | `GET /categories?style=` | |
| Search | `GET /assets/search?style&category&kind&rights&q&limit&cursor` | |
| Previews | `GET /assets/{id}/preview` · `/vector` | `404` = "no preview" (placeholder, not an error). |
| Detail | `GET /assets/{id}` | |
| Recipe | `PUT` / `GET /design-recipes/{id}` | v1 and v2 bodies, see §2. |
| History | `GET /design-recipes/{id}/revisions[/{version}]` | **Only if the Worker has `DESIGN_REVISIONS=enabled` and migration 0003.** `404` → UI says "server history disabled" and relies on local undo history. |

Behaviour that depends on the contract: 404 preview → placeholder; `5xx`/network on `GET` → one automatic retry; `PUT` is never auto-retried; `409` → UI re-reads and adopts the server copy if identical (lost-response recovery), otherwise offers *save as new* / *load latest* and keeps local edits; `403` on save → read-only banner; `401` → back to login. The recipe `id` is generated client-side before the first `PUT`.

## 2. Recipe document schema v2 (Implemented — one protocol, enforced on both sides)

Additive: v1 bodies (`{title, style, accent, components[assetId], version}`) still work unchanged; a v2 save upgrades the stored document in place. A v2 body adds `schemaVersion: 2` and:

| Field | Rule |
|---|---|
| `canvas` | `{width, height}` integers 64–4096, `background` `#rrggbb` or `null` (null = tint of the accent) |
| `layout` | `"grid"` (components auto-arranged; positions stored as computed) or `"free"` |
| `theme` | `{colors:{paletteKey:#hex}, tokens:{--name:#hex}}`; ≤32 / ≤64 entries. `accent` stays the primary palette color |
| `layers[]` | 1–40, **order = z-order** (later on top); ≤12 component + ≤12 text layers; unique `id` |
| layer (all) | `x,y` (center, ±8192), `scale` 0.05–20, `rotation` −360–360°, `opacity` 0–1, `visible`, `locked`, optional `name` ≤120 |
| component layer | `assetId`, `w,h` base box 1–8192, `colors{paletteKey:#hex}` per-instance overrides (≤16) |
| text layer | `text` 1–500 chars (no control chars), `fontSize` 8–400, `color`, `weight` normal/bold, `align` left/center/right |

Server derives `components` (unique assetIds in layer order) so v1 readers and `publication-check` keep working; every component asset must belong to `style` (404 otherwise). Unknown fields are dropped. Body limit raised 16 KiB → 64 KiB.

**Where it is enforced:** server `parseRecipeV2` in `src/worker.mjs` (inline, because `tools/build-rest-worker.mjs` concatenates that single file); client `public/ui/recipe.mjs`. `tests/recipe-v2.contract.test.mjs` proves every document the editor can produce passes the server validator, limits are equal, and a server round trip leaves the editor fingerprint unchanged (no phantom "unsaved changes").

**Undo/redo history:** not part of the document. It is kept locally per recipe (last 30 steps, survives refresh; restored only if its end state equals the server copy) and the server optionally keeps one revision per save (`design_recipe_revisions`, flag-gated). Loading a revision is an undoable edit; saving creates a new version, never rewrites history.

**Silent-downgrade guard:** an older Worker stores only v1 fields. After a v2 `PUT` the UI checks `document.schemaVersion === 2`; if not, it shows a banner, keeps the recipe "unsaved" and keeps the full local draft. OpenAPI: `RecipeInputV2`, `RecipeLayer`, `RecipeDocumentV2`, revisions routes.

## 3. Changes made to Codex-owned files (need Codex ack before merge)

| File | Change |
|---|---|
| `src/worker.mjs` | `/ui/<name>.mjs` static allowlist; `parseRecipeV2` + v2 branch in `PUT`; flag-gated `…/revisions` routes and revision insert; body limit 64 KiB |
| `migrations/0003_recipe_revisions.sql`, `rollback/0003_…` | new table `design_recipe_revisions` (FK to `design_recipes`) |
| `tools/import.mjs` | `openIndex` also applies 0003 |
| `tools/dev.mjs` | `--demo`, `--upstream` mode, read-only test principal, `.run()` on the SQLite binding |
| `tools/build-rest-worker.mjs` | embeds `public/ui/*.mjs` (verified: the built module loads) |
| `tests/phase1.test.mjs` | rollback test includes 0003 |
| `openapi.json` | v2 schemas, revisions routes |

**Suggested integration order:** (1) Codex reviews/merges this branch into `codex/design-intelligence-phase1`; (2) apply migration 0003 to the sandbox D1 and set `DESIGN_REVISIONS=enabled`; (3) rebuild and redeploy (`node tools/build-rest-worker.mjs`), which also ships the new UI shell; (4) run the deployed-API E2E (§5).

## 4. Not confirmed with Codex / Muse

No live channel to either agent was available in this session, so nothing below was negotiated; it is a proposal, not an agreement. Please answer in the PR.

**Codex:** (a) is the v2 schema acceptable as the single protocol (field names, limits, `components` derived server-side)? (b) revisions: keep flag-gated table, or prefer another design? (c) did the deployed sandbox ever get `DESIGN_REVISIONS`/0003? (d) a `GET /design-recipes` listing and a `/assets/{id}/thumbnail` endpoint remain open proposals from Sprint 0.

**Muse:** the 325-record index and 94 SVG previews were not available here. Please confirm on real data: palette shape (`colors` flat `{name:"#hex"}`, primary key `pink`), tokens used as `var(--x, fallback)` inside SVGs, preview size/transparency, `rights`/`review` vocabulary (unknown values render raw), and which fields identify duplicates (the UI shows `name · assetId` as tooltip and keeps same-asset-twice as separate layers).

## 5. Verification matrix — what each test run actually proves

| Run | Backend | Data | Status |
|---|---|---|---|
| Unit + contract (`ui.unit`, `editor-model.unit`, `recipe-v2.contract`) | none / validator import | — | Implemented |
| Worker v2 (`recipe-v2.worker`) | real Worker code, SQLite | synthetic | Implemented |
| Browser E2E (`ui.e2e`, `editor-v2.e2e`) | real Worker code via `tools/dev.mjs` | **synthetic** | Implemented |
| `[contract mock]` test (older Worker drops v2) | Playwright route mock | — | Implemented |
| `upstream-proxy.test` + `cloud.e2e.test` self-check | local worker as "upstream" | synthetic | Implemented (validates the harness, **not** the cloud) |
| `tests/cloud.e2e.test.mjs` against the deployed Cloudflare API | deployed Worker + D1 | Codex's synthetic seed | **Not run**: the sandbox host was allow-listed, but no API token is available to this session |

Run it with: `DESIGN_API_BASE=<origin> DESIGN_API_TOKEN=<operator token> node --test tests/cloud.e2e.test.mjs` (add `DESIGN_E2E_WRITE=1` to create one test recipe; the API has no delete). It prints the server's `schemaVersion` and asserts the UI behaves correctly either way.

## 6. Copy-paste handoff messages

**To Codex**

> PR #2 (`claude/shirley-preview-editor-5l9m6l`) now includes recipe schema v2, flag-gated revisions (migration 0003) and a deployed-API E2E. Read `design-intelligence/docs/UI_API_CONTRACT.md` §2–§4. Please: ack or amend the v2 schema in the PR (the editor and `parseRecipeV2` must stay identical), merge the base, apply 0003 + `DESIGN_REVISIONS=enabled` to the sandbox, rebuild/redeploy with `tools/build-rest-worker.mjs`, then run `tests/cloud.e2e.test.mjs` with an operator token (§5) and paste the output.

**To Muse**

> Please check §4 (Muse) of `design-intelligence/docs/UI_API_CONTRACT.md` against the real 325-record index and 94 SVG previews, and reply with any field that differs. `npm run dev:demo` shows how each field renders.
