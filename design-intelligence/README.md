# Shirley Design Intelligence Phase 1

Independent design index, Worker and Canvas 2D preview. Google Drive remains the source of record. Files in the frozen Creative Studio application are outside this package.

## Run locally

Requires Node 24+ and Inkscape. From this directory run:

```sh
npm run import
npm test
npm run dev
```

Open the loopback URL printed by the server and enter its locally generated token. The library reads SQLite and local SVG/PNG cache files. Each save uses the last recipe version, and the recipe ID restores the editable composition. The browser uses SVG image decoding and Canvas 2D. The renderer is isolated from the editor state for a later Fabric.js integration.

### Read-only Drive input

The importer expects `.local/input/inventory.json`, an array of `{id,path,mime_type,created_time,modified_time,area}` rows. `area` is `ui` for the two-kit library and `reference` for the reference folder. List these two folders with pagination, preserving physical paths. Save the main index, Studio index, both Catalogs, both kit CSS files and all SVG bytes locally using the Drive ID as the filename. Optionally provide `descriptions.json` as an object keyed by Drive ID. No other media bytes are needed for the import. These files contain private data and are Git-ignored. The baseline test automatically runs when inputs are present. Set `DESIGN_TEST_INPUT` to require explicit fixtures in CI.

Asset identity is derived from the Drive ID. Original index rows and Catalog rows are retained as provenance. Existing Studio thumbnails reference Drive IDs. Components point to exact Catalog and Drive paths, with any unresolved source text preserved. Classification records identify verified MIME families and retain uncertain content for review. The 159-row local manifest stays pending reconciliation. The importer never sets a commercial approval and revokes evidence when an asset version changes. Publication check verifies every recipe component against current rights, approved review and evidence.

### Cloudflare sandbox

The committed configuration uses a placeholder D1 ID for local development. In an authorized sandbox, replace it with the sandbox D1 ID and supply a private R2 bucket binding named `CACHE`. The Node development server provides a filesystem compatible binding when R2 is unavailable. A deployed Worker needs a populated cache binding for the two image endpoints. Store `DESIGN_PRINCIPALS` as a Worker secret, a JSON object mapping SHA-256 hashes of securely generated bearer tokens to `{tenantId,brandId,write}`. The API only takes scope from this mapping. Use a unique token per client and brand.

1. Apply `migrations/0001_index.sql` to a new sandbox D1 with Wrangler.
2. Run `node tools/export-d1.mjs` and import the generated `.local/seed.sql`. The export seeds an empty D1 and is repeat-safe for identical input. Use a reviewed update migration for subsequent changes to an existing live index.
3. Upload `.local/cache` to the private bucket preserving relative paths, then deploy the Worker with its static asset directory. Keep source data and derived assets out of the public asset directory.
4. Verify the six required endpoints, private cache fetches and recipe save/recovery with sandbox credentials. `rollback/0001_index.sql` removes the Phase 1 schema. For a sandbox containing saved recipes, back up before applying this down migration. Wrangler migration history is separate, so reapply the schema explicitly or recreate the disposable sandbox for rollback testing.

The portable [Design Skill](skills/design-intelligence/SKILL.md) documents paginated REST access and the existing Gateway handoff. [OpenAPI](openapi.json) is the contract for other clients and future MCP tools.
