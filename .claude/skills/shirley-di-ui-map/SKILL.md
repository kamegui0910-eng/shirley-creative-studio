---
name: shirley-di-ui-map
description: Architecture map of the Shirley Design Intelligence Preview/Recipe Editor UI (design-intelligence/public). Use before modifying or extending that UI, its recipe/theme logic, or the Worker API contract, so you do not need to re-read every module.
---

# Shirley Design Intelligence UI map

Verified against PR #2 (branch `claude/shirley-preview-editor-5l9m6l`). If code and this file disagree, the code wins; fix this file.

## Shape
No-build ES modules under `design-intelligence/public/`. Strict CSP (`default-src 'self'; img-src 'self' blob:`): **no inline `<script>`, no `style="..."` attributes, no CDN**. Set styles via CSS classes or CSSOM. The Worker serves static files only for a fixed allowlist plus `^/ui/[\w-]+\.mjs$`; a new top-level file needs a Worker allowlist change, so put new modules in `public/ui/`.

| File | Role | DOM-free (unit-testable in Node)? |
|---|---|---|
| `app.mjs` | session/login, wiring, mobile tabs | no |
| `canvas.mjs` | `drawComponent`, `gridLayout`, `hitTest`, `paintRecipe` (Canvas 2D) | yes |
| `ui/api.mjs` | fetch wrapper, typed `ApiError.kind`, GET retry once, never retries PUT | yes |
| `ui/recipe.mjs` | pure recipe ops + undo/redo history (`commit/undo/redo`, coalesce key) | yes |
| `ui/theme.mjs` | palette/token overrides applied to SVG text, `tint`, `toCss` | yes |
| `ui/storage.mjs` | never-throwing localStorage: draft + per-style presets | yes |
| `ui/core.mjs` | `el()`, store, asset loader (preview blobs, vector text), banner/toast/confirm | partly |
| `ui/library.mjs` | Style × Category browse, search, pagination, lazy thumbs | no |
| `ui/detail.mjs` | asset detail dialog | no |
| `ui/editor.mjs` | slots, canvas painting, save/load/draft, export | no |
| `ui/themepanel.mjs` | color/token editors, presets, CSS export | no |

## Behaviors that are easy to break
- Persisted recipe = `{title, style, accent, components:[{assetId}], version}` only. `theme` lives on the in-memory recipe (undo/redo covers it) but is **not** sent. `accent` ⇔ palette primary key (`pink`, else first palette key).
- The theme panel follows the **recipe's** style, not the browsed library style. "新建" starts in the browsed style.
- New recipe id is generated client-side before the first PUT. On 409 the editor re-reads the recipe; identical content is adopted as saved (idempotent), otherwise banner offers save-as-new / load-latest and keeps local edits.
- Hit-testing must use `gridLayout(currentCount)`, not the last painted rects (stale after add/remove).
- `applyTheme` never rewrites `url(#id)` / `href="#id"` hex-like ids; a palette change flows through token defaults that equal a palette color, and explicit token overrides win.
- Preview 404 = "no preview" (not an error). `hasPreview:false` never requests the image.
- Coarse-pointer sizing rule must also list `input[type=color]` (its own `min-height` otherwise wins).

## Run and test (from `design-intelligence/`)
`npm run dev:demo` (synthetic index, prints a token) · `node --test` (Node 22 works; the package script's `--test-isolation=none` needs Node 24). See skill `playwright-e2e-static-app`.
