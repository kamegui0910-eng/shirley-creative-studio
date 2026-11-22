# Cloudflare Design sandbox

[Live Preview](https://shirley-design-intelligence-test.shirley-agent-gateway.workers.dev/) and REST share the same origin. The isolated Worker and its D1 database are both named `shirley-design-intelligence-test`. The public shell is stateless. Enter the operator credential in the Preview form to access its scoped data and save a recipe. Credentials are provided to operators through the private workspace and belong in each Agent host's secret store.

The live seed is synthetic. It includes two example style kits, six visible components, two isolation probes, 16 private media objects and an editable `demo-recipe`. R2 can serve the same authorized variant route when configured as `CACHE`. With `DESIGN_D1_CACHE=enabled`, media is stored in `preview_cache` and read by tenant, brand and cache key after the asset access check. D1 fallback supports up to 72 KiB per decoded object and is intended for low-volume test previews. Never put private files into the Worker public assets directory.

## Sandbox deployment and rollback

Use a dedicated sandbox D1 and Worker. The Cloudflare REST connector supports the steps below without sharing a CLI credential. Wrangler may also deploy from the repository configuration when operated with a scoped account credential.

1. Apply the two migrations in order. The isolated database records both in `d1_migrations`.
2. Run `node tools/export-test-fixtures.mjs` and submit the generated statements as a D1 REST query batch. For an authorized actual dataset, `node tools/export-d1.mjs` exports the index and `node tools/export-cache-d1.mjs` exports bound D1 preview queries. Treat both as private.
3. The REST deployment path uses `node tools/build-rest-worker.mjs`. Upload the generated module with the dedicated `DB` binding, the `DESIGN_D1_CACHE` flag and the `DESIGN_PRINCIPALS` secret. The build embeds only the four shell files. For Wrangler the shell is served by the existing `STATIC` binding.
4. Enable the sandbox's workers.dev URL. Verify with `DESIGN_API_BASE=<https-origin> node tools/smoke-cloud.mjs`, using `DESIGN_ACCESS_FILE` to point to a private JSON file with operator, Agent and isolation credentials. The smoke test creates a uniquely named test recipe.
5. Test rollback on an empty sandbox or after backing up data. Apply the down scripts in reverse order. Reset the corresponding migration history entries before reapplying. Dropping these tables deletes saved recipes, metadata and preview objects in the selected database.

The sandbox uses only Workers and D1 within documented free-tier limits. No plan upgrade, R2 activation or other paid product was purchased. An account invoice cannot be verified with the current Cloudflare OAuth credential.
