# Reuse-first integration status

## P0 · Reconciliation and restore

- Creative Studio PR #1 was the integration base. Claude PR #2 is merged into that branch. Muse PR #3 was open during verification. The Muse public catalog and manifest were reconciled by kit, category and basename against existing stable IDs. All 94 matched. The live private index contains 325 unique assets and 72 pending review entries. Muse's separate private classifications were unavailable for a record-by-record rights and review comparison.
- Preserve existing asset IDs and Recipe references. Resolve a future Muse private delivery by Drive ID, retain the full rights/review/source/version in provenance and treat an explicit restriction conservatively. No automated commercial promotion or unreviewed overwrite. `tools/reconcile-muse.mjs` accepts an optional local private catalog for exact comparison. Existing asset/source records survived the additive migration.
- Private baseline includes the previous Worker version, a D1 Time Travel bookmark and a local SQLite backup. To roll back this sprint, first return test Worker traffic to the previous deployment. The 0004 down migration only removes the intake, analysis and DNA extension tables. Export any new records first. Recipe and asset IDs continue to use migration 0003 and earlier. Time Travel affects the entire database and is for recovery after a verified need.

## P1 · Intake and visual analysis

- Authenticated bulk intake in the existing editor. PNG, JPEG and WebP, up to 30 files per batch and 25 MiB each. The client uses official Drive resumable sessions with SHA-256, confirmed byte ranges, checkpointing, duplicate lookup and retry against a reselected file. Session links remain in the active browser tab and are removed after success. The Drive access token is cleared after the operation. An existing credential must have write access to the configured private intake folder.
- Registration verifies the provider's parent, app fingerprint, file type and size before inserting a scoped reference. The D1 batch prevents duplicate index entries. Cross-device simultaneous Drive uploads and provider CORS remain unverified.
- The analyzer emits measured palette tokens, dimensions and a 4 × 4 edge-density layout profile. The registered file version and analyzer version key the results. New uploads display colors and layout in the editor. Existing rendered vector previews can be backfilled from the private cache. All historical records were included in the plan. The 231 references without locally available preview pixels remain pending for private retrieval and format handling. Raster font families, semantic component bounds, and style inference remain unverified.
- Rollback is the 0004 down script after taking the previous Worker live. A Google Drive file remains an original after a D1 rollback.

## P2 · Retrieval and Design DNA

- The same Design API now exposes text and image lookup and brand-scoped DNA overrides. Matches return per-signal contributions from keyword/summary, image color and edge geometry, and selected brand styles. Commercial-purpose results require the existing `commercial_ready` state. Restricted records are excluded from recommendations. The current in-D1 implementation evaluates at most 500 scoped candidates; `exhaustive` shows whether that bound was crossed.
- Browser image queries extract features locally. No Google token or reference pixels go to an external model through the recommendation route. The current results use measured geometry and lexical signals. Model-based semantic similarity and Agent-host executions remain unverified.
- Global defaults are shared source configuration. Each brand may override weights, palette, or style priorities using its own write credential. D1 stores the tenant-and-brand-scoped override.
- Workers AI has a free daily allocation, while Workers pricing lists Vectorize under Workers Paid. The connected account returned no existing Vectorize index, so no service was created. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Workers and Vectorize pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## P3 · Internal marketing export

- `node tools/render-marketing.mjs <recipe.json> <new-output-dir>` renders editable JSON scene lists with PNG/JPEG imagery, scene captions, brand colors, and aspect-ratio presets. Include `brandKit` details for decor, cuisine, and composition as evidence notes. The renderer preserves each source image's aspect ratio and retains explicit pending verification per scene.
- Outputs include MP4, PNG cover, editable SRT and ffprobe QA. The private test render uses three real Design component previews. Restaurant-specific official same-business and same-dish sources, food recomposition, creative Agent benchmarking, and authorized publishing remain unverified. There is no publishing integration in this increment.
- Rollback consists of removing the CLI code from the branch. Source images and the editable recipe persist independently of exports.

## Registry and handoff

Use the [Skill Registry](skill-registry.md) and [OpenAPI](../openapi.json). A Gateway-approved handoff should carry task IDs, limited asset IDs, expected output and explicit uncertainty. Grant only the task's existing brand credential. Do not embed authorization tokens, private source listings, or private screenshot bytes in a handoff packet.
