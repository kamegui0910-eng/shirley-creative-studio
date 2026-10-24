# Shirley Creative Studio V0.5.0 — private library integration

Status: code deployed; website OAuth, live visual AI, and cross-device acceptance are NOT complete. Do not describe this release as completed automatic sync.

## Existing project preservation

`index.html` and `try.html` retain the original editor, templates, local references, cases, backup/export, positioning lock, and composition layers. No private images, reference analyses, tokens, API keys, client secrets, or backups are included in this repository. A visual reference is not an executable preset. Reference selection never changes image pixels. Actual previews continue using bounded built-in global adjustments and explicit user actions; no semantic retouching or reconstruction is implemented.

## Missing configuration

1. Google Cloud project with Drive API enabled and an OAuth **Web application** client. Configure the consent screen and add the intended account as a test user if the app remains in Testing. Authorized JavaScript origin: `https://kamegui0910-eng.github.io` (no repository path). Use Google Identity Services token model, not a client secret. Set the public client ID in `cloud-config.js` so all devices get the same default, or save it once in this browser's connection settings. No client secret belongs in GitHub or the browser.
2. User grants `https://www.googleapis.com/auth/drive.readonly`. The existing connected ChatGPT Drive account does not grant this website permission. Drive has no read-only folder-specific OAuth scope; readonly allows reading accessible Drive files, while this code queries only the preset folder. `drive.file` alone cannot discover arbitrary pre-existing children in that folder. No write/share/delete permission is requested. Existing default folder ownership is verified against the signed-in account. The account email saved locally is not a secret.
3. A separately hosted HTTPS visual-analysis gateway and service-side AI credentials/billing. GitHub Pages cannot run `ai-gateway.mjs`. ChatGPT subscription quota is not assumed to be API credit. Optional gateway implementation is provided for Node >=22, uses no external package, keeps credentials in server environment, restricts the caller account and origin, verifies Google authorization, rate limits, and requests structured visual comparison with `store:false`. It does not store images or log tokens. Configure `OPENAI_API_KEY`, `OPENAI_MODEL` (a currently available vision + structured-output model), `ALLOWED_GOOGLE_EMAIL`, optional `ALLOWED_ORIGIN`, `PORT`; place behind HTTPS. Set `aiEndpoint` to its `/analyze` URL. Do not put API keys in this public repository, URL parameters, localStorage, or chat.

## Private Drive structure (already prepared)

The 9 original JPGs, full backup, and full original manual-analysis file remain private and unchanged. The folder now additionally contains `studio-library-index.json` (26 KB), and nine independent `studio-thumb-*.jpg` files (360px). Sharing permissions were checked: index and all nine thumbnails remain unshared. Index stable IDs are `drive:<originalFileId>`; it links originals, thumbnail IDs, original modification times, analysis ID/version, source attribution, full notes, suitability constraints, legacy IDs, and original SHA256 checksums. No private index or thumbnail is served from GitHub Pages.

## Implemented startup/sync behavior

- Reuse saved folder/client configuration; cache references and thumbnails in IndexedDB. Only OAuth access token stays in memory; it is never saved or exported. Google token expiry/browser reopen may require a fresh user-initiated sign-in. No recurring folder-link entry or JSON restoration is needed once OAuth is configured.
- After authorization, check the folder, lightweight index and manual analysis. Cache their versions and download only changed thumbnail files. Do not download the large backup or originals during routine startup. Originals are requested only by the explicit original-view button.
- Foreground checks are throttled to one per minute while token is valid; refresh button is supplemental. No background permission popups.
- New/updated source files are discovered by Drive file ID, not guessed filenames. Filename is only a unique migration join for the supplied legacy manual JSON. Explicit legacy IDs/checksum preserve identity. Repeated reads do not create duplicate records; previous analyses remain in version history. Remote removals are marked and cached, never used as a reason to delete local records.
- New files lacking notes/thumbnail, modified originals with stale analysis, or modified manual notes needing suitability-rule review are marked **partial / pending review**, not full success. To activate a new reference, add its notes and index entry with source file ID and thumbnail file ID. Update index sourceModifiedTime/analysisVersion and structured conditions only after reviewing the changed source/notes. This release discovers arbitrary additions automatically but does not invent manual analyses or write thumbnails back to Drive.
- Network, 401, 403, incomplete lists, invalid/duplicate index, missing analysis, and AI errors retain cache and last successful sync time. Failures are never presented as an empty library or successful sync. Browser-private-mode storage restrictions are shown explicitly. Cached private photos remain on the device after disconnecting; disconnect only clears the in-memory token.

## Recommendations and editing

Upload triggers a recommendation report automatically. Without the gateway it explicitly displays **temporary rule mode**, keeps semantic fields `待确认`, uses confirmed tags + manual conditions and only weak brightness/contrast evidence. It never claims pixel statistics understand food or visual style. The environment-only arcade reference is excluded for food scenes; direct-flash references are penalized for non-flash originals. Unknown light/WB remain unknown. Updated notes invalidate the previous structured constraint snapshot until reviewed. The matcher returns up to three eligible references, never fills the list with excluded samples. Full notes, conditions, dependencies, sources, limitations and ordinal confidence are displayed.

When configured, the gateway receives a reduced original plus all reference thumbnails and full notes (max 24 references, explicit limit), compares them jointly, and returns evidence-linked tags and suitability reasons. Unknown/duplicate reference IDs and ungrounded tag fields are rejected. Hard manual exclusions still apply after AI. AI failure visibly falls back to rules. No automatic original overwrite, no generative image edit, no food/person/room reconstruction. Cuisine is a semantic/protection layer, visual style owns global tone, layout owns borders/text; exposure or saturation are not added independently by each layer.

## Tests actually run on 2026-10-24

- Read all 9 real original JPGs, full human-analysis JSON and full backup privately through the connected Drive account; inspected real structures and images.
- Verified private index and nine thumbnails after upload.
- `SHIRLEY_FIXTURE_DIR=/private/fixture/path node cloud-tests.cjs`: 24 assertions using the actual 9 reference records and thumbnails; adapter identity migration, repeat sync/no repeated media reads, reload/cache restore, new/updated files, old notes history, removal preservation, original changes, auth/network/permission failures, food-vs-environment exclusion, soft-light flash demotion, sashimi preference, unknown labels, AI response validation. Transport is a controlled test double, NOT real website OAuth.
- `node cloud-tests.cjs`: 21 synthetic assertions for portable regression tests.
- `node cloud-gateway-tests.mjs`: 6 mocked origin/auth/account/config/upstream/secret-isolation checks. No live paid AI call.
- JavaScript syntax checks for all modules and all existing inline scripts.

## Acceptance still required

After the missing OAuth/gateway configuration is supplied: perform real website Google consent, fetch all nine reference records, close/reopen, add/update actual Drive content and verify deduplication, test revoked grant/offline/AI failures through actual services, and verify iPhone Safari plus another browser using the same account. These are not replaceable by connector access, mocked transport tests, or desktop phone-layout preview. iPhone OAuth popup behavior, Safari IndexedDB retention, real touch scrolling and image downloads/sharing remain device acceptance items.

Official API references: https://developers.google.com/identity/oauth2/web/guides/use-token-model ; https://developers.google.com/workspace/drive/api/guides/api-specific-auth ; https://developers.openai.com/api/docs/guides/images-vision ; https://developers.openai.com/api/docs/guides/structured-outputs .
