// Editor v2 browser tests. Backend: the real Worker code (tools/dev.mjs) over a SYNTHETIC index. Not the deployed API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startHarness, skip, TOKEN, READONLY, slots, addByName, cardCount, settle, saved, slotNames, canvasPng, toClient, readField, pointerDrag } from './e2e-harness.mjs';

let h;
before(async () => { if (!skip) h = await startHarness(); });
after(async () => { await h?.close(); });

const HOUSE = 'a_demo_ppr_icon_house', HEART = 'a_demo_ppr_icon_heart';
const pickPixel = async page => { await page.selectOption('#style', 'pink-pixel-retro'); await cardCount(page, 15); };
const field = (page, name) => readField(page, name);
const fieldValue = async (page, name) => Number(await field(page, name).inputValue());
const pngSize = bytes => ({ signature: bytes.subarray(0, 8).toString('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const download = async (page, trigger) => { const [file] = await Promise.all([page.waitForEvent('download'), trigger()]); return readFileSync(await file.path()); };
const deselect = async page => { await page.locator('#canvas').focus(); await page.keyboard.press('Escape'); await settle(page); };

test('full recipe: edit everything → save → refresh → reopen pixel-identical → undo history survives → continue → revisions', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await pickPixel(page);
    for (const name of ['house.svg', 'heart.svg', 'star.svg']) await addByName(page, name);
    await settle(page);
    // layout: drag the first layer (grid → free), then use the inspector for exact values
    await pointerDrag(page, await toClient(page, 160, 120, 640, 480), await toClient(page, 400, 300, 640, 480));
    assert.match(await page.locator('#layout-label').textContent(), /自由/);
    await field(page, 'rotation').fill('30');
    await field(page, 'scale').fill('150');
    await field(page, 'opacity').fill('80');
    await page.locator('#inspector [data-layer-color=pink]').fill('#33aa55');
    // text layer
    await page.click('#add-text');
    await page.locator('#inspector [data-field=text]').fill('春季\n上新');
    await field(page, 'fontSize').fill('48');
    // theme + canvas size + title
    await page.fill('#color-ink', '#0000ff');
    await page.fill('#title', '完整配方');
    await page.locator('#canvas-settings summary').click();
    await page.selectOption('#canvas-preset', 'xhs'); // last edit is visible, so undo after reload changes the picture
    await deselect(page);
    const before = await canvasPng(page);
    await page.click('#save');
    await saved(page, 1);
    const id = await page.inputValue('#recipeId');

    const server = (await h.api('/design-recipes/' + id)).json;
    const doc = server.document;
    assert.equal(doc.schemaVersion, 2);
    assert.deepEqual(doc.canvas, { width: 1080, height: 1440, background: null });
    assert.equal(doc.layout, 'free');
    assert.equal(doc.title, '完整配方');
    assert.deepEqual(doc.layers.map(l => l.type), ['component', 'component', 'component', 'text']);
    assert.deepEqual([doc.layers[0].rotation, doc.layers[0].scale, doc.layers[0].opacity, doc.layers[0].colors], [30, 1.5, 0.8, { pink: '#33aa55' }]);
    assert.equal(doc.layers[3].text, '春季\n上新');
    assert.equal(doc.layers[3].fontSize, Math.round(48 * Math.min(1080 / 640, 1440 / 480)), 'text scales with the canvas resize');
    assert.equal(doc.theme.colors.ink, '#0000ff');
    assert.equal(doc.components.length, 3);

    // refresh, log in again, reopen
    await page.reload();
    await page.fill('#token', TOKEN);
    await page.click('#login-submit');
    await page.waitForSelector('#library .card');
    assert.equal(await page.locator('#confirm[open]').count(), 0, 'a clean, saved recipe offers no draft');
    assert.match(await page.locator('#resume').innerText(), /继续上次编辑：完整配方/);
    await page.click('#resume button');
    await page.waitForFunction(() => document.getElementById('canvas-status').textContent.includes('已恢复配方'));
    assert.match(await page.locator('#canvas-status').innerText(), /保留了 \d+ 步撤销历史/);
    await settle(page);
    assert.equal(await page.inputValue('#title'), '完整配方');
    assert.equal(await slots(page).count(), 4);
    assert.equal(await canvasPng(page), before, 'reopened recipe renders pixel-identically');
    assert.match(await page.locator('#layout-label').textContent(), /自由/);
    assert.equal(await page.inputValue('#canvas-w'), '1080');

    // the local undo history came back: undo → dirty and different, redo → clean and identical
    assert.equal(await page.locator('#undo').isDisabled(), false);
    await page.click('#undo');
    await settle(page);
    assert.match(await page.locator('#dirty').innerText(), /未保存更改/);
    assert.notEqual(await canvasPng(page), before);
    await page.click('#redo');
    await settle(page);
    assert.match(await page.locator('#dirty').innerText(), /已保存 · v1/);
    assert.equal(await canvasPng(page), before);

    // continue editing → v2 → revisions
    await page.locator('#slots .slot-main').first().click();
    await field(page, 'opacity').fill('50');
    await page.click('#save');
    await saved(page, 2);
    assert.equal((await h.api('/design-recipes/' + id)).json.document.layers[0].opacity, 0.5);
    assert.deepEqual((await h.api(`/design-recipes/${id}/revisions`)).json.items.map(i => i.version), [2, 1]);
    await page.locator('#revisions-box summary').click();
    await page.waitForFunction(() => document.querySelectorAll('#revisions li').length === 2);
    await page.click('#revisions li:has-text("v1") button');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已载入 v1'));
    assert.match(await page.locator('#dirty').innerText(), /未保存更改/);
    await page.locator('#slots .slot-main').first().click();
    assert.equal(await fieldValue(page, 'opacity'), 80);
    await page.click('#undo');
    assert.match(await page.locator('#dirty').innerText(), /已保存 · v2/, 'loading a revision is one undoable step');
    assert.deepEqual(page.errors, []);
  });
});

test('canvas gestures: tap is not an edit; drag/scale/rotate are single undo steps; lock and hide are respected', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await pickPixel(page);
    await addByName(page, 'house.svg');
    await addByName(page, 'heart.svg');
    await settle(page);
    const at = (x, y) => toClient(page, x, y, 640, 480);
    // two cards in a 2-column grid: centers (160,240) and (480,240)
    await pointerDrag(page, await at(160, 240), await at(160, 240), { steps: 1 });
    assert.equal(await page.locator('.slot[data-selected=true]').count(), 1, 'tap selects');
    assert.match(await page.locator('#layout-label').textContent(), /自动排列/, 'tap does not freeze the layout');
    await page.click('#undo');
    assert.equal(await slots(page).count(), 1, 'the tap added no history step: undo removed the last add');
    await page.click('#redo');
    await settle(page);

    await pointerDrag(page, await at(160, 240), await at(300, 120));
    assert.equal(Math.round(await fieldValue(page, 'x')), 300);
    assert.equal(Math.round(await fieldValue(page, 'y')), 120);
    assert.match(await page.locator('#layout-label').textContent(), /自由/);
    await page.click('#undo');
    assert.match(await page.locator('#layout-label').textContent(), /自动排列/, 'one undo reverts the whole drag including the layout freeze');
    await page.click('#redo');
    await settle(page);

    // scale handle (bottom-right corner) and rotate handle (above the box)
    const box = { cx: 300, cy: 120, w: 296, h: 456 };
    await pointerDrag(page, await at(box.cx + box.w / 2, box.cy + box.h / 2), await at(box.cx + box.w, box.cy + box.h));
    assert.ok(await fieldValue(page, 'scale') > 120, 'dragging the corner outwards scales up');
    await field(page, 'scale').fill('100');
    const unit = 640 / (await page.locator('#canvas').boundingBox()).width;
    await pointerDrag(page, await at(box.cx, box.cy - box.h / 2 - 26 * unit), await at(box.cx + 200, box.cy));
    assert.ok(Math.abs(await fieldValue(page, 'rotation') - 90) <= 2, 'rotate handle follows the pointer angle');

    // lock: no gesture edits, inspector geometry disabled, selection frame still shows
    await page.getByRole('button', { name: '锁定 house.svg' }).click();
    const xBefore = await fieldValue(page, 'x');
    await pointerDrag(page, await at(300, 120), await at(100, 400));
    assert.equal(await fieldValue(page, 'x'), xBefore);
    assert.equal(await field(page, 'x').isDisabled(), true);
    await page.getByRole('button', { name: '解锁 house.svg' }).click();
    assert.equal(await field(page, 'x').isDisabled(), false);

    // hide: the layer is not drawn and cannot be hit
    await deselect(page);
    const shown = await canvasPng(page);
    await page.getByRole('button', { name: '隐藏 heart.svg' }).click();
    await settle(page);
    assert.equal(await page.locator('.slot[data-hidden=true]').count(), 1);
    const hidden = await canvasPng(page);
    assert.notEqual(hidden, shown, 'a hidden layer is not drawn');
    await page.getByRole('button', { name: '显示 heart.svg' }).click();
    await settle(page);
    assert.equal(await canvasPng(page), shown, 'showing it again restores the exact picture');
    assert.deepEqual(page.errors, []);
  });
});

test('keyboard: Alt+Arrow nudges (one coalesced step), Ctrl+Z undoes, Delete removes', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await pickPixel(page);
    await addByName(page, 'house.svg');
    await settle(page);
    await page.locator('#canvas').focus();
    const x0 = Math.round(await fieldValue(page, 'x'));
    for (let i = 0; i < 5; i++) await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    assert.equal(Math.round(await fieldValue(page, 'x')), x0 + 5);
    await page.locator('#canvas').focus();
    await page.keyboard.press('Control+z');
    assert.match(await page.locator('#layout-label').textContent(), /自动排列/, 'the nudges were one coalesced step');
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Delete');
    assert.equal(await slots(page).count(), 0);
  });
});

test('races: slow category/search responses for an old style never show stale chips or cards', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await page.route(/\/categories\?style=pink-pixel-retro$/, async route => { await new Promise(r => setTimeout(r, 900)); route.continue(); });
    await page.route(/\/assets\/search\?.*style=pink-pixel-retro/, async route => { await new Promise(r => setTimeout(r, 1300)); route.continue(); });
    await page.selectOption('#style', 'pink-pixel-retro');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#categories .chip').count(), 0, 'no stale/clickable chips while categories load');
    await page.selectOption('#style', 'pink-black-ins');
    await cardCount(page, 15);
    await page.waitForTimeout(1600); // the slow pixel responses arrive now and must be ignored
    const owners = await page.$$eval('#library .card', cards => cards.map(c => c.dataset.asset.split('_')[2]));
    assert.deepEqual([...new Set(owners)], ['pbi']);
    assert.equal(await page.locator('#categories .chip').count(), 4);
    assert.equal(await page.inputValue('#style'), 'pink-black-ins');

    // a stale category filter is cleared by a style change; a slow search for a cleared term is ignored
    await page.click('.chip:has-text("图标")');
    await cardCount(page, 5);
    await page.selectOption('#style', 'pink-pixel-retro');
    await cardCount(page, 15);
    assert.equal(await page.locator('.chip[aria-pressed=true]').innerText(), '全部分类');
    await page.unroute(/\/assets\/search\?.*style=pink-pixel-retro/);
    await page.route(/\/assets\/search\?.*q=house/, async route => { await new Promise(r => setTimeout(r, 900)); route.continue(); });
    await page.fill('#q', 'house');
    await page.waitForTimeout(350);
    await page.fill('#q', '');
    await cardCount(page, 15);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#library .card').count(), 15, 'late "house" response did not replace the full list');
    assert.deepEqual(page.errors, []);
  });
});

test('duplicate assets: same name in two kits and the same asset twice stay distinguishable', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await page.selectOption('#style', '');
    await page.fill('#q', 'house');
    await cardCount(page, 2);
    const titles = await page.$$eval('#library .card-open', nodes => nodes.map(n => n.title));
    assert.equal(new Set(titles).size, 2, 'two "house.svg" with different asset ids');
    await page.locator('.card').first().locator('.card-add').click(); // style resolved through the detail endpoint
    await page.waitForFunction(() => document.querySelectorAll('#slots .slot').length === 1);
    await page.locator('.card').first().locator('.card-add').click();
    await page.waitForFunction(() => document.querySelectorAll('#slots .slot').length === 2);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#slots .slot')].length);
    assert.equal(ids, 2, 'the same asset can be used twice as separate layers');
    await page.getByRole('button', { name: '复制 house.svg' }).first().click();
    assert.equal(await slots(page).count(), 3);
    await page.locator('.card').nth(1).locator('.card-add').click();
    await page.waitForSelector('#confirm[open]');
    assert.match(await page.locator('#confirm-text').innerText(), /清空画布并开始新配方/, 'a house from the other kit asks before replacing the recipe');
    await page.click('#confirm-cancel');
    assert.equal(await slots(page).count(), 3);
  });
});

test('failure handling: asset load failure draws a placeholder with retry; export refuses incomplete art', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await pickPixel(page);
    let fail = true;
    await page.route('**/assets/*/vector', route => fail ? route.abort() : route.continue());
    await addByName(page, 'house.svg');
    await page.waitForFunction(() => document.getElementById('canvas-status').textContent.includes('加载失败'), null, { timeout: 15000 });
    await page.click('#export');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('导出失败'));
    fail = false;
    await page.click('#canvas-status .link');
    await page.waitForFunction(() => !document.getElementById('canvas-status').textContent.includes('加载失败'));
    await settle(page);
    const bytes = await download(page, () => page.click('#export'));
    assert.equal(pngSize(bytes).signature, '89504e470d0a1a0a');
  });
});

test('PNG export matches the canvas size (default ×2, large formats ×1) and is not blank', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await pickPixel(page);
    await addByName(page, 'house.svg');
    await addByName(page, 'heart.svg');
    await page.click('#add-text');
    await settle(page);
    const small = await download(page, () => page.click('#export'));
    assert.deepEqual(pngSize(small), { signature: '89504e470d0a1a0a', width: 1280, height: 960 });
    await page.locator('#canvas-settings summary').click();
    await page.selectOption('#canvas-preset', 'xhs');
    await settle(page);
    const big = await download(page, () => page.click('#export'));
    assert.deepEqual(pngSize(big), { signature: '89504e470d0a1a0a', width: 1080, height: 1440 });
    assert.ok(small.length > 3000 && big.length > 3000, 'content was drawn');
    const blank = await download(page, async () => { await page.fill('#canvas-w', '64'); await page.fill('#canvas-h', '64'); await page.press('#canvas-h', 'Tab'); await settle(page); await page.click('#export'); });
    assert.equal(pngSize(blank).width, 128);
    assert.ok(blank.length < big.length);
  });
});

test('read-only token: can browse, edit and export, but cannot save (UI and server agree)', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx, { token: READONLY });
    await pickPixel(page);
    await addByName(page, 'house.svg');
    assert.equal(await page.locator('#mode-pill').isVisible(), true);
    assert.equal(await page.locator('#save').isDisabled(), true);
    assert.match(await page.locator('#save-problems').innerText(), /只读/);
    assert.equal(await page.locator('#export').isDisabled(), false);
    const forbidden = await h.api('/design-recipes/ro-check', { token: READONLY, body: { schemaVersion: 2, version: 0, title: 't', style: 'pink-pixel-retro', accent: '#f6c3da', layout: 'grid', canvas: { width: 640, height: 480, background: null }, theme: { colors: {}, tokens: {} }, layers: [{ id: 'a', type: 'component', assetId: HOUSE, x: 0, y: 0, w: 10, h: 10, scale: 1, rotation: 0, opacity: 1, visible: true, locked: false, colors: {} }] } });
    assert.equal(forbidden.status, 403);
  });
});

test('[contract mock] an older Worker that drops v2 fields is detected: never reported as saved', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await pickPixel(page);
    await addByName(page, 'house.svg');
    await page.route('**/design-recipes/*', route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'legacy1', version: 1, updatedAt: 'x', document: { title: 't', style: 'pink-pixel-retro', accent: '#f6c3da', components: [{ assetId: HOUSE }] } }) })
      : route.continue());
    await page.click('#save');
    await page.waitForFunction(() => document.getElementById('banner-text').textContent.includes('服务端尚未升级'));
    await page.waitForTimeout(700);
    assert.match(await page.locator('#dirty').innerText(), /未保存更改/, 'still dirty: the full edit exists only locally');
    assert.equal(await page.evaluate(() => localStorage.getItem('shirley-di:draft:v1') !== null), true, 'local draft is kept');
  });
});

test('a v1 recipe opens as an equivalent grid, can be edited, and is upgraded to v2 on save', { skip }, async () => {
  await h.withContext(async ctx => {
    const put = await h.api('/design-recipes/legacy-v1', { body: { version: 0, title: '旧配方', style: 'pink-pixel-retro', accent: '#33aa55', components: [{ assetId: HOUSE }, { assetId: HEART }] } });
    assert.equal(put.status, 201);
    const page = await h.open(ctx);
    await page.fill('#recipeId', 'legacy-v1');
    await page.click('#load');
    await page.waitForFunction(() => document.getElementById('canvas-status').textContent.includes('已恢复配方'));
    assert.deepEqual(await slotNames(page), ['house.svg', 'heart.svg']);
    assert.match(await page.locator('#layout-label').textContent(), /自动排列/);
    assert.equal(await page.inputValue('#color-pink'), '#33aa55', 'v1 accent becomes the primary theme color');
    assert.match(await page.locator('#dirty').innerText(), /已保存 · v1/);
    await page.click('#add-text');
    await page.click('#save');
    await saved(page, 2);
    const doc = (await h.api('/design-recipes/legacy-v1')).json.document;
    assert.equal(doc.schemaVersion, 2);
    assert.deepEqual(doc.components, [{ assetId: HOUSE }, { assetId: HEART }]);
    assert.equal(doc.layers.length, 3);
  });
});

test('mobile: touch select/drag, tall canvas fits the screen, inspector and export work', { skip }, async () => {
  await h.withContext(async ctx => {
    const page = await h.open(ctx);
    await page.locator('.card', { hasText: 'house.svg' }).first().locator('.card-add').tap();
    await page.locator('.card', { hasText: 'heart.svg' }).first().locator('.card-add').tap();
    await page.click('#tabs [data-tab=canvas]');
    await page.locator('#canvas-settings summary').tap();
    await page.selectOption('#canvas-preset', 'story');
    await settle(page);
    const box = await page.locator('#canvas').boundingBox();
    assert.ok(box.height <= 844 * 0.72 + 2 && box.width <= 390, `9:16 canvas is capped (${box.width}×${box.height})`);
    assert.equal(await page.locator('#canvas').evaluate(c => getComputedStyle(c).touchAction), 'none');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(await overflow() <= 0);
    // tap selects the first layer (grid cell 1 of 2 on a 1080×1920 canvas), touch drag moves it
    const at = (x, y) => toClient(page, x, y, 1080, 1920);
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const start = await at(270, 960);
    await page.touchscreen.tap(start.x, start.y);
    assert.equal(await page.locator('.slot[data-selected=true]').count(), 1);
    await pointerDrag(page, start, await at(400, 1200), { pointerType: 'touch' });
    assert.match(await page.locator('#layout-label').textContent(), /自由/);
    assert.ok(await overflow() <= 0, 'inspector adds no horizontal overflow');
    const inspector = await page.locator('#inspector').boundingBox();
    assert.ok(inspector.x >= 0 && inspector.x + inspector.width <= 390.5);
    const tiny = await page.$$eval('#inspector input:not([type=range]):not([type=checkbox]), #inspector select, #slots button', nodes => nodes.map(n => n.getBoundingClientRect().height).filter(v => v < 36));
    assert.deepEqual(tiny, [], 'touch targets are at least 36px');
    const bytes = await download(page, () => page.locator('#export').tap());
    assert.deepEqual(pngSize(bytes), { signature: '89504e470d0a1a0a', width: 1080, height: 1920 });
    assert.deepEqual(page.errors, []);
  }, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
});
