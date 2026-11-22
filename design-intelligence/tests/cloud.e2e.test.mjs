// Browser E2E against a DEPLOYED Design API. Skipped unless credentials are supplied.
//   DESIGN_API_BASE=https://<worker-origin> DESIGN_API_TOKEN=<operator token> node --test tests/cloud.e2e.test.mjs
//   add DESIGN_E2E_WRITE=1 to also save one recipe (the API has no delete; it creates "UI E2E <timestamp>").
// The UI is served locally; tools/dev.mjs forwards API calls to the origin and injects the token server-side.
// Assertions are invariants (the real index size/content is not assumed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = process.env.DESIGN_API_BASE, TOKEN = process.env.DESIGN_API_TOKEN, WRITE = process.env.DESIGN_E2E_WRITE === '1';
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* skipped */ }
const skip = !BASE || !TOKEN ? 'set DESIGN_API_BASE and DESIGN_API_TOKEN to run against a deployed API' : !chromium ? 'playwright is not installed' : false;
let server, browser, local;

before(async () => {
  if (skip) return;
  const port = 50000 + Math.floor(Math.random() * 10000);
  local = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['tools/dev.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PORT: String(port), DESIGN_UPSTREAM: BASE, DESIGN_API_TOKEN: TOKEN, NODE_USE_ENV_PROXY: '1' } });
  await new Promise((resolve, reject) => { server.stdout.on('data', c => String(c).includes('Preview:') && resolve()); server.on('exit', code => reject(Error('dev server exited ' + code))); setTimeout(() => reject(Error('timeout')), 10000); });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(options) {
  const ctx = await browser.newContext(options ?? { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(local);
  await page.fill('#token', 'ui-e2e-placeholder-token'); // ignored: the dev server injects the real token
  await page.click('#login-submit');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  return { ctx, page };
}
const settled = (page, timeout = 60000) => page.waitForFunction(() => !document.querySelector('#library .thumb[data-state=loading]') && document.getElementById('library').getAttribute('aria-busy') === 'false', null, { timeout });

test('[deployed API] browse real assets: styles, filters, search, previews, detail, add, export', { skip }, async t => {
  const { ctx, page } = await open();
  try {
    const session = await page.evaluate(() => fetch('/session').then(r => r.ok ? r.json() : null));
    t.diagnostic('session ' + JSON.stringify(session));
    assert.equal(await page.locator('#mode-pill').isVisible(), session ? session.write === false : false, 'read-only badge matches /session');
    const styleOptions = await page.$$eval('#style option', o => o.map(x => ({ value: x.value, text: x.textContent })));
    t.diagnostic('styles ' + JSON.stringify(styleOptions.map(o => o.value)));
    assert.ok(styleOptions.length > 1, 'at least one style besides "all"');
    await settled(page);
    const cards = await page.locator('#library .card').count();
    t.diagnostic('first page cards: ' + cards);
    if (!cards) { assert.equal(await page.locator('#library-state[data-kind=empty]').count(), 1, 'an empty library shows the empty state'); return; }
    const names = await page.$$eval('#library .card-name', n => n.map(x => x.textContent.trim()));
    assert.ok(names.every(Boolean), 'every card has a name');
    const states = await page.$$eval('#library .thumb', n => n.map(x => x.dataset.state));
    t.diagnostic('preview states ' + JSON.stringify(states.reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {})));
    assert.equal(states.filter(s => s === 'error').length, 0, 'no preview failed to load');
    // search for a real name finds it
    const needle = names[0].slice(0, Math.min(5, names[0].length));
    await page.fill('#q', needle);
    await page.waitForTimeout(600);
    await settled(page);
    assert.ok((await page.$$eval('#library .card-name', n => n.map(x => x.textContent.toLowerCase()))).some(x => x.includes(needle.toLowerCase())));
    await page.fill('#q', '');
    await settled(page);
    // detail
    await page.locator('#library .card-open').first().click();
    await page.waitForSelector('#detail[open] .viewer[data-state=ready], #detail[open] .viewer[data-state=error]', { timeout: 30000 });
    assert.match(await page.locator('#detail-body').innerText(), /Drive 文件/);
    await page.click('#detail-close');
    // add a component and export if one exists
    const add = page.locator('#library .card-add').first();
    if (await add.count()) {
      await add.click();
      await page.waitForFunction(() => document.querySelectorAll('#slots .slot').length === 1, null, { timeout: 30000 });
      await page.waitForTimeout(800);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
      assert.equal(readFileSync(await download.path()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
    assert.deepEqual(page.errors, []);
  } finally { await ctx.close(); }
});

test('[deployed API] save → refresh → reopen (writes one recipe; needs DESIGN_E2E_WRITE=1)', { skip: skip || (WRITE ? false : 'set DESIGN_E2E_WRITE=1 to create a test recipe') }, async t => {
  const { ctx, page } = await open();
  try {
    await settled(page);
    const add = page.locator('#library .card-add');
    assert.ok(await add.count() > 0, 'the deployed index has at least one addable component');
    for (let i = 0; i < Math.min(2, await add.count()); i++) await add.nth(i).click();
    await page.click('#add-text');
    await page.fill('#title', 'UI E2E ' + new Date().toISOString());
    await page.waitForTimeout(800);
    await page.click('#save');
    await page.waitForFunction(() => /已保存 · v1/.test(document.getElementById('dirty').textContent) || !document.getElementById('banner').hidden, null, { timeout: 30000 });
    const id = await page.inputValue('#recipeId');
    const doc = (await page.evaluate(i => fetch('/design-recipes/' + i).then(r => r.json()), id)).document;
    t.diagnostic('server schemaVersion=' + (doc.schemaVersion ?? 1));
    if (doc.schemaVersion !== 2) {
      // Older deployed Worker: the UI must say so and must NOT claim the full recipe was saved.
      assert.match(await page.locator('#banner-text').innerText(), /服务端尚未升级/);
      assert.match(await page.locator('#dirty').innerText(), /未保存更改/);
      return;
    }
    assert.equal(doc.layers.length, 3);
    await page.reload();
    await page.fill('#token', 'ui-e2e-placeholder-token');
    await page.click('#login-submit');
    await page.waitForSelector('#library .card', { timeout: 30000 });
    await page.fill('#recipeId', id);
    await page.click('#load');
    await page.waitForFunction(() => document.getElementById('canvas-status').textContent.includes('已恢复配方'), null, { timeout: 30000 });
    assert.equal(await page.locator('#slots .slot').count(), 3);
    assert.match(await page.locator('#dirty').innerText(), /已保存 · v1/);
    assert.deepEqual(page.errors, []);
  } finally { await ctx.close(); }
});
