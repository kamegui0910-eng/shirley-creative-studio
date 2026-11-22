---
name: playwright-e2e-static-app
description: Recipe for testing a no-build web UI with node:test + Playwright against a real dev server and a synthetic seed (no private data), plus cloud-sandbox pitfalls. Use when adding or debugging browser tests for Shirley Design Intelligence or similar static apps.
---

# Playwright E2E for a static app with a synthetic seed

## Pattern (proven in `design-intelligence/tests/ui.e2e.test.mjs`)
1. **Synthetic seed, not private data.** `tools/seed-demo.mjs` builds a small SQLite index + cache covering the edge cases you must test: restricted, commercial-ready, no-preview variant, preview row whose file is missing (404), thumbnail-only references, a browse-only style without palette, same file name in two kits, more rows than one page. `dev.mjs --demo` serves it.
2. **Spawn the real server** in `before()` on a random port with `DESIGN_DEV_TOKEN`, `DESIGN_DEV_DB`, `DESIGN_DEV_CACHE`; wait for the `Preview:` line; kill in `after()`.
3. **Playwright from ESM:** `createRequire(import.meta.url)('playwright')` inside try/catch and `{ skip }` when missing. Chromium is preinstalled in the cloud container: do not run `playwright install`.
4. **One browser context per test** (isolated localStorage), helper `withContext`. Collect `pageerror` and `console.error` (ignore "Failed to load resource" caused by intentional 404s) and assert it is empty.
5. **Wait on state, not time:** `waitForFunction` on card counts / `aria-busy` / `data-state`. Use short `waitForTimeout` only for canvas repaint (rAF + image decode).
6. **Assert canvas via pixels** (`getImageData`), not screenshots. Compare against the pure function used by the app (`tint(...)`).
7. **Failure paths via `page.route`:** abort `/assets/search*`, fulfill 503 on PUT, fulfill 401 mid-session. Unroute afterwards.
8. **Mobile:** context `{viewport:{390,844}, hasTouch:true, isMobile:true}`; assert no horizontal overflow (`scrollWidth - clientWidth <= 0`) and touch target height ≥ 40.
9. Take screenshots only to look at them (scratchpad dir, `deviceScaleFactor` 1).

## Product bugs this approach caught (check for regressions)
stale hit-test rects after add/remove · color input ignoring the coarse-pointer min-height · "新建" reusing the old style · conflict path silently adopting identical content (intended; tests must make the two edits differ).

## Sandbox pitfalls
- `git reset --hard` is denied by the auto-mode classifier; use `git merge --ff-only origin/<branch>` when the local branch has no own commits.
- Writing a script through a bash heredoc was blocked once as a "dangerous removal" false positive; create files with the Write tool and run them separately.
- Do not `git rm --cached` to "check" a file; use `git status`/`git diff`. (If staged by mistake: `git reset -q HEAD -- <path>`.)
- Node here is v22; `node:sqlite` works with an ExperimentalWarning; `--test-isolation=none` does not exist before Node 24.
- Stop background dev servers (`pkill -f tools/dev.mjs`) before re-running tests that spawn their own.
