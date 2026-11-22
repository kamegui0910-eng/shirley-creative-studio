# Integration Sprint 01

The same sandbox Worker and D1 host the public editor shell and authenticated REST API. The private Drive index is scoped separately from the synthetic fixtures. Use the separately issued Drive credentials for the `studio / shirley-drive` scope and the previous test credentials for the synthetic and isolation scopes.

`tools/export-incremental.mjs` exports bounded parameterized D1 batches from the verified Drive snapshot and private cache. It applies inserts and changes by stable IDs, keeps original rights notes in provenance, and retains explicit restrictions. Apply batches in numeric order to the verified sandbox. Replay is safe after a partial run. The exporter does not delete assets for records absent from an incremental snapshot. Keep exports, source JSON, previews and access files outside Git. Run migrations before deploying or importing. For previously applied migration 0003, leave its history entry in place.

## API compatibility

[OpenAPI](../openapi.json) is the single contract. Search keeps `assetId`, `name`, `style`, `category` and `q`, and accepts `styleId`, `categoryId` and `keyword` as aliases. It exposes `id`, `title`, `styleIds`, `categoryIds`, `summary` and `colors`. `color` is an exact case-insensitive six-digit hex match. Kit palette colors represent the documented style palette, while reference colors appear only when explicit in source data. Summary/tag text supplements the filename for keyword search. The standalone Muse dev-index export and its API compatibility remain unverified until that exact export is available.

Legacy four-field recipes remain supported. The editor persists optional canvas width, height and background, component transforms, ordered layer IDs, visibility, opacity, and theme colors and tokens. D1 snapshots each version in the same write transaction. `GET /design-recipes/{id}/history` lists versions, `GET /design-recipes/{id}/history/{version}` reads a snapshot and `POST /design-recipes/{id}/restore` takes the current `version` and `restoreVersion`. Restoring appends a version and preserves intervening revisions. Optimistic conflicts return 409.

Grok, Muse and Claude can resolve the Gateway PR #3 reference format `design-recipe:<id>` against this API with their brand-specific read-only credential. Read the brand from `/session`. Each host must load its credential privately and return its own HTTP result or Gateway receipt before claiming genuine Agent execution.

## Repeat deployment

Build with `node tools/build-rest-worker.mjs`. With a scoped Cloudflare API token, export `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `DESIGN_SANDBOX_DB_ID`, apply migrations to the designated test database, then run `node tools/deploy-sandbox.mjs deploy`. The command confirms the existing Worker-to-D1 binding and inherits its secret unless a private replacement principal manifest is supplied. To import, run `node tools/export-incremental.mjs` and `node tools/deploy-sandbox.mjs import`. The public repository workflow uses synthetic fixtures. The private cloud smoke runs separately with sandbox credentials and is never given to pull-request CI.
