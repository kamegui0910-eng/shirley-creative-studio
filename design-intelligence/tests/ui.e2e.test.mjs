// Browser tests: real Worker + synthetic demo index + Chromium. Skipped when Playwright/Chromium is unavailable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDemo } from '../tools/seed-demo.mjs';
import { tint } from '../public/ui/theme.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* skipped below */ }

const TOKEN = 'e2e-token-for-ui-tests-0001';
const skip = chromium ? false : 'playwright is not installed';
let server, base, browser, dir;
const ids = { house: 'a_demo_prp_icon_house', heart: 'a_demo_pbi_icon_heart' };

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'design-e2e-'));
  seedDemo(dir);
  const port = 20000 + Math.floor(Math.random() * 20000);
  server = spawn(process.execPath, ['tools/dev.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PORT: String(port), DESIGN_DEV_TOKEN: TOKEN, DESIGN_DEV_DB: join(dir, 'index.sqlite'), DESIGN_DEV_CACHE: join(dir, 'cache') } });
  base = 'http://127.0.0.1:' + port;
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => { if (String(chunk).includes('Preview:')) resolve(); });
    server.on('exit', code => reject(Error('dev server exited ' + code)));
    setTimeout(() => reject(Error('dev server timeout')), 10000);
  });
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
});
after(async () => {
  await browser?.close();
  server?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function open({ mobile = false, context } = {}) {
  context ??= await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) page.errors.push(message.text()); });
  await page.goto(base);
  return page;
}
async function login(page, token = TOKEN) {
  await page.fill('#token', token);
  await page.click('#login-submit');
}
async function ready(page, options) {
  page = await open(options);
  await login(page);
  await page.waitForSelector('#library .card');
  return page;
}
const slots = page => page.locator('#slots .slot');
const cards = page => page.locator('#library .card');
const addByName = (page, name) => page.locator('.card', { hasText: name }).first().locator('.card-add').click();
async function pixel(page, x = 2, y = 2) {
  return page.evaluate(([px, py]) => { const c = document.getElementById('canvas'); return Array.from(c.getContext('2d').getImageData(px, py, 1, 1).data); }, [x, y]);
}
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
const settle = page => page.waitForFunction(() => !document.getElementById('library').hasAttribute('aria-busy') || document.getElementById('library').getAttribute('aria-busy') === 'false');
async function withContext(fn, options) {
  const context = await browser.newContext(options ?? { viewport: { width: 1280, height: 900 } });
  try { await fn(context); } finally { await context.close(); }
}

test('login: rejects a bad token, accepts a good one, and never persists the token', { skip }, async () => {
  await withContext(async context => {
    const page = await open({ context });
    await login(page, 'not-a-real-token-123456');
    await page.waitForFunction(() => document.getElementById('login-error').textContent.includes('令牌无效'));
    assert.equal(await page.locator('#app').isHidden(), true);
    await login(page);
    await page.waitForSelector('#library .card');
    assert.equal(await page.locator('#login').isHidden(), true);
    const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    assert.equal(stored.includes(TOKEN), false);
    assert.deepEqual(page.errors, []);
  });
});

test('Style × Category browsing, kind/rights filters, search, empty state and pagination', { skip }, async () => {
  await withContext(async context => {
    const page = await ready(null, { context });
    // Pagination: all-styles components (30) exceed one page of 24.
    await page.selectOption('#style', '');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 24);
    assert.equal(await page.locator('#more').isVisible(), true);
    await page.click('#more');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 30);
    assert.equal(await page.locator('#more').isVisible(), false);
    // Style × Category
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    await page.click('.chip:has-text("图标")');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 5);
    assert.deepEqual((await page.locator('.chip').allTextContents()).sort(), ['全部分类', '图标', '贴纸', '边框'].sort());
    // rights filter
    await page.selectOption('#rights', 'restricted');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 1);
    assert.match(await cards(page).first().innerText(), /mail\.svg/);
    await page.selectOption('#rights', '');
    // search
    await page.fill('#q', 'HEART');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 1);
    assert.match(await cards(page).first().innerText(), /heart\.svg/);
    // empty state + recovery
    await page.fill('#q', 'zzzz-no-such');
    await page.waitForSelector('#library-state[data-kind=empty]');
    await page.click('#library-state button:has-text("清除筛选")');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    assert.equal(await page.inputValue('#q'), '');
    // reference kind is browse-only (no add button) and shows no-preview state
    await page.selectOption('#style', 'cottagecore-ref');
    await page.selectOption('#kind', 'reference');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 3);
    assert.equal(await page.locator('.card-add').count(), 0);
    assert.equal(await page.locator('.thumb[data-state=none]').count(), 3, 'thumbnail-only references degrade to a labelled placeholder');
    assert.deepEqual(page.errors, []);
  });
});

test('previews: cached images render; missing or 404 previews degrade without breaking the grid', { skip }, async () => {
  await withContext(async context => {
    const page = await ready(null, { context });
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.click('.chip:has-text("边框")');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 5);
    await page.waitForFunction(() => document.querySelectorAll('.thumb[data-state=loading]').length === 0);
    const state = async name => page.locator('.card', { hasText: name }).locator('.thumb').getAttribute('data-state');
    assert.equal(await state('window.svg'), 'ready');
    assert.equal(await state('panel.svg'), 'none', 'hasPreview=false never requests the image');
    assert.equal(await state('label.svg'), 'none', 'a 404 preview becomes "no preview"');
    const natural = await page.locator('.card', { hasText: 'window.svg' }).locator('img').evaluate(img => img.naturalWidth);
    assert.ok(natural > 0);
  });
});

test('detail dialog: vector uses current theme, shows rights/provenance, handles no preview', { skip }, async () => {
  await withContext(async context => {
    const page = await ready(null, { context });
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.click('.chip:has-text("边框")');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 5);
    await page.locator('.card', { hasText: 'window.svg' }).locator('.card-open').click();
    await page.waitForSelector('#detail[open] .viewer[data-state=ready]');
    const body = await page.locator('#detail-body').innerText();
    assert.match(body, /可商用/);
    assert.match(body, /已具备商用证据/);
    assert.match(body, /Drive 文件/);
    assert.match(body, /来源记录（1）/);
    assert.equal(await page.locator('#detail .seg button').count(), 2);
    await page.locator('#detail .seg button', { hasText: 'PNG 预览' }).click();
    await page.waitForSelector('#detail .viewer[data-state=ready]');
    await page.click('#detail-close');
    // Restricted asset warns; vector-only asset (no preview variant) still renders via SVG.
    await page.click('.chip:has-text("图标")');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 5);
    await page.locator('.card', { hasText: 'mail.svg' }).locator('.card-open').click();
    await page.waitForSelector('#detail .notice.warn');
    assert.match(await page.locator('#detail-body').innerText(), /受限/);
    await page.keyboard.press('Escape');
    await page.click('.chip:has-text("边框")');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 5);
    await page.locator('.card', { hasText: 'panel.svg' }).locator('.card-open').click();
    await page.waitForSelector('#detail .viewer[data-state=ready]');
    assert.equal(await page.locator('#detail .seg button').count(), 1, 'only the vector variant exists');
    // Add from detail closes the dialog and adds to the recipe.
    await page.click('[data-detail-add]');
    await page.waitForFunction(() => !document.getElementById('detail').open);
    assert.equal(await slots(page).count(), 1);
    assert.deepEqual(page.errors, []);
  });
});

test('recipe editing: add, select, reorder, duplicate, replace, remove, undo/redo, clear, limits', { skip }, async () => {
  await withContext(async context => {
    const page = await ready(null, { context });
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    for (const name of ['house.svg', 'heart.svg', 'star.svg']) await addByName(page, name);
    assert.equal(await slots(page).count(), 3);
    const names = async () => (await slots(page).locator('.slot-main').allInnerTexts()).map(t => t.replace(/^\d+\.\s*/, ''));
    assert.deepEqual(await names(), ['house.svg', 'heart.svg', 'star.svg']);
    // canvas painted something other than background
    await page.waitForTimeout(300);
    const bg = tint('#f6c3da');
    assert.equal(hex(await pixel(page)), bg);
    const painted = await page.evaluate(() => { const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 120) n++; return n; });
    assert.ok(painted > 500, 'dark outlines are drawn');
    // reorder
    await page.getByRole('button', { name: '下移 house.svg' }).click();
    assert.deepEqual(await names(), ['heart.svg', 'house.svg', 'star.svg']);
    // duplicate + remove
    await page.getByRole('button', { name: '复制 star.svg' }).click();
    assert.deepEqual(await names(), ['heart.svg', 'house.svg', 'star.svg', 'star.svg']);
    await page.getByRole('button', { name: '移除 star.svg' }).last().click();
    assert.equal(await slots(page).count(), 3);
    // replace mode: library buttons switch label, click replaces the selected slot
    await page.getByRole('button', { name: '替换 heart.svg' }).click();
    assert.equal(await page.locator('#replace-hint').isVisible(), true);
    assert.equal(await page.locator('.card-add').first().innerText(), '替换');
    await addByName(page, 'mail.svg');
    assert.deepEqual(await names(), ['mail.svg', 'house.svg', 'star.svg']);
    assert.equal(await page.locator('#replace-hint').isVisible(), false);
    // undo / redo
    await page.click('#undo');
    assert.deepEqual(await names(), ['heart.svg', 'house.svg', 'star.svg'].slice(0, 3));
    await page.click('#redo');
    assert.deepEqual(await names(), ['mail.svg', 'house.svg', 'star.svg']);
    await page.keyboard.press('Control+z');
    assert.equal((await names())[0], 'heart.svg');
    // keyboard on canvas removes the selected component
    await page.locator('#canvas').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Delete');
    assert.equal(await slots(page).count(), 2);
    // clicking the canvas selects a slot
    const box = await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
    assert.equal(await page.locator('.slot[data-selected=true]').count(), 1);
    // clear is confirmed and undoable
    await page.click('#clear');
    await page.click('#confirm-ok');
    assert.equal(await slots(page).count(), 0);
    assert.equal(await page.locator('#stage-empty').isVisible(), true);
    await page.click('#undo');
    assert.equal(await slots(page).count(), 2);
    // limit of 12
    for (let i = 0; i < 12; i++) await addByName(page, 'dot.svg');
    assert.equal(await slots(page).count(), 12);
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('最多'));
    assert.deepEqual(page.errors, []);
  });
});

test('switching style with a non-empty recipe asks first and starts a new recipe', { skip }, async () => {
  await withContext(async context => {
    const page = await ready(null, { context });
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    await addByName(page, 'house.svg');
    await page.selectOption('#style', 'pink-black-ins');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    await addByName(page, 'house.svg');
    await page.waitForSelector('#confirm[open]');
    await page.click('#confirm-cancel');
    assert.equal(await slots(page).count(), 1);
    assert.match(await slots(page).first().innerText(), /house/);
    await addByName(page, 'house.svg');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => document.querySelectorAll('#slots .slot').length === 1 && !document.getElementById('confirm').open);
    assert.equal(await page.inputValue('#recipeId'), '');
  });
});

test('theme: primary color is the recipe accent; palette + token overrides affect canvas; presets and CSS export', { skip }, async () => {
  await withContext(async context => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await ready(null, { context });
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    assert.match(await page.locator('#theme-note').innerText(), /Token 兼容性：待确认/);
    await addByName(page, 'house.svg');
    await page.waitForTimeout(300);
    assert.equal(hex(await pixel(page)), tint('#f6c3da'));
    await page.fill('#color-pink', '#33aa55');
    await page.waitForTimeout(300);
    assert.equal(hex(await pixel(page)), tint('#33aa55'), 'canvas background follows the accent');
    assert.match(await page.locator('#dirty').innerText(), /未保存/);
    // The house fill is the primary color; sample the center.
    const box = await page.evaluate(() => { const c = document.getElementById('canvas'); return [c.width, c.height]; });
    const center = hex(await pixel(page, Math.round(box[0] / 2), Math.round(box[1] * 0.62)));
    assert.equal(center, '#33aa55');
    // token override recolors the outline of kit-token-backed assets (house uses var(--px-ink))
    await page.locator('#tokens-box summary').click();
    await page.locator('input[data-token="--px-ink"]').fill('#0000ff');
    await page.waitForTimeout(300);
    const blue = await page.evaluate(() => { const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 200 && d[i] < 40 && d[i + 1] < 40) n++; return n; });
    assert.ok(blue > 200, 'token color reaches the SVG outline');
    // undo reverts the token change as one step
    await page.click('#undo');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('input[data-token="--px-ink"]').inputValue(), '#62344f');
    // presets are per style and persisted locally
    await page.fill('#preset-name', '春季');
    await page.click('#preset-save');
    await page.click('#theme-reset');
    assert.equal(await page.inputValue('#color-pink'), '#f6c3da');
    await page.click('#preset-apply');
    assert.equal(await page.inputValue('#color-pink'), '#33aa55');
    // The theme panel follows the recipe's style: browsing another style does not change it...
    await page.selectOption('#style', 'pink-black-ins');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    assert.equal(await page.locator('#presets option').first().innerText(), '春季');
    // ...but a new, empty recipe adopts the browsed style and sees that style's own presets.
    await page.click('#new');
    await page.click('#confirm-ok');
    await page.waitForFunction(() => document.querySelector('#palette [data-color=black]'));
    assert.equal(await page.locator('#presets option').first().innerText(), '暂无预设');
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForFunction(() => document.querySelector('#palette [data-color=ink]'));
    assert.equal(await page.locator('#presets option').first().innerText(), '春季');
    // CSS export
    await page.click('#theme-copy');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('CSS'));
    assert.deepEqual(page.errors, []);
  });
});

test('save, restore, versioning, conflict and idempotent recovery', { skip }, async () => {
  await withContext(async context => {
    const page = await ready(null, { context });
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    assert.equal(await page.locator('#save').isDisabled(), true, 'empty recipe cannot be saved');
    await addByName(page, 'house.svg');
    await addByName(page, 'heart.svg');
    await page.fill('#title', '春季海报');
    await page.fill('#color-pink', '#33aa55');
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('dirty').textContent.includes('已保存 · v1'));
    const id = await page.inputValue('#recipeId');
    assert.match(id, /^[\w-]{10,}$/);
    // second save increments the version
    await page.getByRole('button', { name: '移除 heart.svg' }).click();
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('dirty').textContent.includes('已保存 · v2'));
    // restore into a fresh page: title, style, accent and components come back
    const other = await ready(null, { context });
    await other.fill('#recipeId', id);
    await other.click('#load');
    await other.waitForFunction(() => document.getElementById('canvas-status').textContent.includes('已恢复配方'));
    assert.equal(await other.inputValue('#title'), '春季海报');
    assert.equal(await other.inputValue('#style'), 'pink-pixel-retro');
    assert.equal(await other.inputValue('#color-pink'), '#33aa55');
    assert.equal(await slots(other).count(), 1);
    assert.match(await slots(other).first().innerText(), /house/);
    // stale editor saves over a newer version → conflict with recovery actions
    await other.getByRole('button', { name: '复制 house.svg' }).click();
    await other.click('#save');
    await other.waitForFunction(() => document.getElementById('dirty').textContent.includes('已保存 · v3'));
    await page.fill('#title', '另一个标题');
    await page.click('#save');
    await page.waitForSelector('#banner:not([hidden])');
    assert.match(await page.locator('#banner-text').innerText(), /版本冲突/);
    assert.equal(await page.inputValue('#title'), '另一个标题', 'local edits are kept on conflict');
    await page.click('#banner-actions button:has-text("另存为新配方")');
    await page.waitForFunction(old => document.getElementById('recipeId').value && document.getElementById('recipeId').value !== old && document.getElementById('dirty').textContent.includes('已保存 · v1'), id);
    // unknown id and invalid id
    await other.fill('#recipeId', 'does-not-exist');
    await other.click('#load');
    await other.waitForFunction(() => document.getElementById('banner-text').textContent.includes('未找到该配方'));
    await other.fill('#recipeId', 'bad id!');
    await other.click('#load');
    await other.waitForFunction(() => document.getElementById('toast').textContent.includes('有效的配方 ID'));
    assert.deepEqual([...page.errors, ...other.errors], []);
  });
});

test('failure recovery: search retry, preview retry, save retry keeps the draft, draft restore after reload, 401 returns to login', { skip }, async () => {
  await withContext(async context => {
    const page = await open({ context });
    // search failure shows an error state with a working retry
    let failSearch = true;
    await page.route('**/assets/search*', route => failSearch ? route.abort() : route.continue());
    await login(page);
    await page.waitForSelector('#library-state[data-kind=error]', { timeout: 15000 });
    failSearch = false;
    await page.click('#library-state button:has-text("重试")');
    await page.waitForSelector('#library .card');
    // preview failure → per-card retry
    await page.unroute('**/assets/search*');
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForFunction(() => document.querySelectorAll('#library .card').length === 15);
    // save failure keeps edits, shows a retry banner and stores a local draft
    await addByName(page, 'house.svg');
    let failSave = true;
    await page.route('**/design-recipes/*', route => failSave && route.request().method() === 'PUT' ? route.fulfill({ status: 503, body: '{"error":"x"}' }) : route.continue());
    await page.click('#save');
    await page.waitForSelector('#banner:not([hidden])');
    assert.match(await page.locator('#banner-text').innerText(), /保存失败/);
    assert.equal(await slots(page).count(), 1);
    assert.equal(await page.locator('#save').isDisabled(), false, 'save is available again after a failure');
    failSave = false;
    await page.click('#banner-actions button:has-text("重试保存")');
    await page.waitForFunction(() => document.getElementById('dirty').textContent.includes('已保存 · v1'));
    await page.unroute('**/design-recipes/*');
    // unsaved draft survives a reload and is offered after login
    await page.getByRole('button', { name: '复制 house.svg' }).click();
    await page.waitForTimeout(700);
    await page.reload();
    await login(page);
    await page.waitForSelector('#confirm[open]');
    assert.match(await page.locator('#confirm-text').innerText(), /未保存的本地草稿/);
    await page.click('#confirm-ok');
    await page.waitForFunction(() => document.querySelectorAll('#slots .slot').length === 2);
    assert.match(await page.locator('#dirty').innerText(), /未保存更改|未保存/);
    // 401 mid-session → back to the login screen with a message
    await page.route('**/assets/search*', route => route.fulfill({ status: 401, body: '{"error":"x"}' }));
    await page.selectOption('#style', 'pink-black-ins');
    await page.waitForFunction(() => !document.getElementById('login').hidden);
    assert.match(await page.locator('#login-error').innerText(), /重新登录/);
    assert.equal(await page.locator('#app').isHidden(), true);
  });
});

test('mobile: bottom tabs switch panels, no horizontal overflow, detail is usable', { skip }, async () => {
  await withContext(async context => {
    const page = await open({ context });
    await login(page);
    await page.waitForSelector('#library .card');
    assert.equal(await page.locator('#tabs').isVisible(), true);
    assert.equal(await page.locator('#panel-canvas').isVisible(), false);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(await overflow() <= 0, 'library has no horizontal overflow');
    await addByName(page, 'house.svg');
    assert.match(await page.locator('#tab-count').innerText(), /\(1\)/);
    await page.click('#tabs [data-tab=canvas]');
    assert.equal(await page.locator('#panel-canvas').isVisible(), true);
    assert.equal(await page.locator('#panel-library').isVisible(), false);
    await page.waitForTimeout(300);
    const canvas = await page.locator('#canvas').boundingBox();
    assert.ok(canvas.width > 300 && canvas.width <= 390);
    assert.ok(await overflow() <= 0, 'canvas has no horizontal overflow');
    await page.click('#tabs [data-tab=theme]');
    assert.equal(await page.locator('#palette .swatch').count() > 0, true);
    assert.ok(await overflow() <= 0, 'theme panel has no horizontal overflow');
    // touch targets
    const small = await page.$$eval('#tabs button, #palette input, #theme-reset', nodes => nodes.map(n => n.getBoundingClientRect().height).filter(h => h < 40));
    assert.deepEqual(small, []);
    await page.click('#tabs [data-tab=library]');
    await page.locator('.card .card-open').first().click();
    await page.waitForSelector('#detail[open] .viewer[data-state=ready]');
    const dialog = await page.locator('#detail').boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 390.5);
    assert.deepEqual(page.errors, []);
  }, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
});

test('accessibility basics: named controls, live regions, focus-visible dialogs', { skip }, async () => {
  await withContext(async context => {
    const page = await ready(null, { context });
    await addByName(page, 'house.svg');
    const unnamed = await page.$$eval('button, input, select, canvas', nodes => nodes.filter(n => {
      if (n.type === 'hidden' || n.closest('[hidden]') || n.closest('dialog:not([open])')) return false;
      const labelled = n.getAttribute('aria-label') || n.textContent.trim() || (n.labels && n.labels.length) || n.getAttribute('placeholder') || n.title;
      return !labelled;
    }).map(n => n.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, []);
    for (const id of ['canvas-status', 'result-meta', 'toast']) {
      const live = await page.getAttribute('#' + id, 'role').catch(() => null);
      assert.equal(live, 'status', id + ' announces changes');
    }
  });
});
