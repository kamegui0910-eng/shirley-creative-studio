---
name: shirley-di-ui-map
description: Architecture map of the Shirley Design Intelligence Preview/Recipe Editor UI (design-intelligence/public). Use before modifying or extending that UI, its recipe/theme logic, or the Worker API contract, so you do not need to re-read every module.
---

# Shirley Design Intelligence UI map

Verified against PR #2 (branch `claude/shirley-preview-editor-5l9m6l`), Sprint 01 (schema v2). If code and this file disagree, the code wins; fix this file.

## Shape
No-build ES modules under `design-intelligence/public/`. Strict CSP (`default-src 'self'; img-src 'self' blob:`): **no inline `<script>`, no `style="..."` attributes, no CDN**. Set styles via CSS classes or CSSOM. The Worker serves static files only for a fixed allowlist plus `^/ui/[\w-]+\.mjs$`; a new top-level file needs a Worker allowlist change, so put new modules in `public/ui/`.

| File | Role | DOM-free (unit-testable in Node)? |
|---|---|---|
| `app.mjs` | login, `/session`, brand rules, wiring, mobile tabs | no |
| `canvas.mjs` | geometry (grid, rotated hit-test, handles, drag math) + Canvas 2D painting of layers | yes (painting needs a ctx) |
| `ui/recipe.mjs` | **schema v2 model**: layers, layout grid/free, canvas, theme, sanitize, fingerprint, history pack/unpack | yes |
| `ui/theme.mjs` | palette/token overrides applied to SVG text, `tint`, `toCss` | yes |
| `ui/api.mjs` | fetch wrapper, typed `ApiError.kind`, GET retry once, never retries PUT | yes |
| `ui/storage.mjs` | never-throwing localStorage: draft, per-recipe history, last recipe, presets | yes |
| `ui/core.mjs` | `el()`, store, asset loader, banner/toast/confirm | partly |
| `ui/library.mjs` | Style × Category browse, search, pagination, lazy thumbs, race guards | no |
| `ui/detail.mjs` | asset detail dialog | no |
| `ui/editor.mjs` | layer ops, save/load/draft/revisions, wires stage + inspector | no |
| `ui/stage.mjs` | canvas painting, pointer/touch move·scale·rotate, PNG export | no |
| `ui/inspector.mjs` | layer properties, per-instance colors, text props, canvas settings | no |
| `ui/themepanel.mjs` | palette/token editors, presets, CSS export | no |

## Behaviors that are easy to break
- **One protocol:** the persisted recipe is schema v2 (`docs/UI_API_CONTRACT.md` §2). `parseRecipeV2` in `src/worker.mjs` and `ui/recipe.mjs` must agree; `tests/recipe-v2.contract.test.mjs` enforces it. Change both or neither.
- `id`/`version` are identity, not content: undo/redo must keep them (`keepIdentity`), otherwise undoing past the first save makes the next save create a new recipe.
- After a v2 PUT, check `document.schemaVersion === 2`; an older Worker silently drops v2 fields. Never mark that as saved.
- Grid mode: component positions are recomputed (`withGeometry`); the first real drag calls `toFreeLayout` from the **pre-drag** recipe. A tap (movement < 3px) must not edit or add history. A whole drag/nudge is one undo step (coalesce key).
- Hit-testing uses current geometry (`resolveGeometry`), never the last painted frame. Canvas size is variable (presets); use `recipe.canvas`, not constants.
- The theme panel follows the **recipe's** style, not the browsed library style. "新建" starts in the browsed style and keeps the canvas size.
- Category/search races: requests are aborted and results ignored when the style/filters changed; stale chips are never shown while loading.
- Preview 404 = "no preview", not an error. `hasPreview:false` never requests the image. Unknown `rights/review` values render raw.
- `innerText` of an element inside a closed `<details>` is empty; use `textContent` in tests.
- Synthetic `PointerEvent`s have no active pointer id: `setPointerCapture` must stay in try/catch.
- Coarse-pointer sizing must also list `input[type=color]`; checkboxes are intentionally 18px.

## Run and test (from `design-intelligence/`)
`npm run dev:demo` (synthetic index, prints a token; revisions on) · `node --test` (Node 22 works; the package script's `--test-isolation=none` needs Node 24). Deployed API: `tests/cloud.e2e.test.mjs` (needs `DESIGN_API_BASE` + `DESIGN_API_TOKEN`; the token is injected server-side by `dev.mjs --upstream`). See skill `playwright-e2e-static-app`.
