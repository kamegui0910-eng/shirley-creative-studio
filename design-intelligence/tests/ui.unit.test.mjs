import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/ui/recipe.mjs';
import * as T from '../public/ui/theme.mjs';
import { createApi, ApiError } from '../public/ui/api.mjs';
import { createStorage } from '../public/ui/storage.mjs';
import { gridLayout, hitTest } from '../public/canvas.mjs';
import worker from '../src/worker.mjs';

const style = {
  id: 'pixel', label: 'Pixel',
  colors: { pink: '#F6C3DA', ink: '#62344f', note: 'not-a-color' },
  tokens: { '--px-ink': '#62344f', '--px-radius': '2px' }
};

test('recipe: add/replace/remove/duplicate/move keep identity and limits', () => {
  let r = R.emptyRecipe({ style: 'pixel', accent: '#aabbcc' });
  for (const id of ['a', 'b', 'c']) r = R.addComponent(r, { assetId: id });
  r = R.replaceComponent(r, 1, { assetId: 'x' });
  assert.deepEqual(r.components.map(c => c.assetId), ['a', 'x', 'c']);
  r = R.duplicateComponent(r, 0);
  assert.deepEqual(r.components.map(c => c.assetId), ['a', 'a', 'x', 'c']);
  const moved = R.moveComponent(r, 3, -1);
  assert.deepEqual(moved.recipe.components.map(c => c.assetId), ['a', 'a', 'c', 'x']);
  assert.equal(moved.index, 2);
  assert.equal(R.moveComponent(r, 0, -1).index, 0, 'moving past the edge is a no-op');
  assert.deepEqual(R.removeComponent(r, 0).components.map(c => c.assetId), ['a', 'x', 'c']);
  assert.throws(() => R.removeComponent(r, 9), R.RecipeError);
  let full = R.emptyRecipe();
  for (let i = 0; i < R.MAX_COMPONENTS; i++) full = R.addComponent(full, { assetId: 'a' + i });
  assert.throws(() => R.addComponent(full, { assetId: 'z' }), /12/);
  assert.throws(() => R.duplicateComponent(full, 0), R.RecipeError);
});

test('recipe: payload matches the API contract and omits display-only fields', () => {
  const r = { ...R.emptyRecipe({ style: 'pixel', accent: '#aabbcc', title: '  hi ' }), version: 3, components: [{ assetId: 'a', name: 'A' }] };
  assert.deepEqual(R.toPayload(r), { title: 'hi', style: 'pixel', accent: '#aabbcc', components: [{ assetId: 'a' }], version: 3 });
  assert.deepEqual(R.validate(R.emptyRecipe()), ['请先选择风格', '画布为空，请至少添加一个组件']);
  assert.ok(R.validate({ ...r, title: ' ' }).includes('请填写配方名称'));
  const back = R.fromResult({ id: 'i', version: 3, document: { title: 't', style: 'pixel', accent: '#aabbcc', components: [{ assetId: 'a' }] } }, new Map([['a', 'A']]));
  assert.equal(back.components[0].name, 'A');
  assert.equal(R.fingerprint(back), R.fingerprint({ ...r, title: 't' }));
});

test('recipe: history undo/redo, coalescing, and new-edit clears redo', () => {
  let h = R.createHistory(R.emptyRecipe({ title: 'a' }));
  h = R.commit(h, { ...h.present, title: 'ab' }, 'title');
  h = R.commit(h, { ...h.present, title: 'abc' }, 'title');
  assert.equal(h.past.length, 1, 'typing coalesces into one step');
  h = R.undo(h);
  assert.equal(h.present.title, 'a');
  h = R.redo(h);
  assert.equal(h.present.title, 'abc');
  h = R.undo(h);
  h = R.commit(h, { ...h.present, title: 'z' });
  assert.equal(h.future.length, 0);
  assert.equal(R.undo(R.createHistory(R.emptyRecipe())).past.length, 0);
});

test('theme: normalizes hex and ignores non-color palette entries', () => {
  assert.equal(T.normalizeHex('#ABC'), '#aabbcc');
  assert.equal(T.normalizeHex('red'), null);
  assert.deepEqual(T.paletteOf(style).map(p => p.key), ['pink', 'ink']);
  assert.equal(T.primaryKey(style), 'pink');
  assert.equal(T.primaryKey({ colors: { a: '#000000' } }), 'a');
  assert.equal(T.primaryKey(null), null);
  assert.deepEqual(T.tokensOf(style).map(t => [t.name, t.isColor]), [['--px-ink', true], ['--px-radius', false]]);
});

test('theme: applyTheme recolors palette hex, resolves var() tokens, and never touches references', () => {
  const svg = '<svg><defs><linearGradient id="a1b2c3"/></defs>'
    + '<path fill="#F6C3DA" stroke="var(--px-ink, #000000)"/>'
    + '<rect fill="url(#a1b2c3)"/><use href="#f6c3da"/><circle fill="#f6c3da0"/></svg>';
  assert.equal(T.applyTheme(svg, style, T.emptyTheme()).includes('stroke="#62344f"'), true, 'default token resolves to kit value');
  const out = T.applyTheme(svg, style, { colors: { pink: '#112233' }, tokens: { '--px-ink': '#445566' } });
  assert.match(out, /fill="#112233"/);
  assert.match(out, /stroke="#445566"/);
  assert.match(out, /url\(#a1b2c3\)/);
  assert.match(out, /href="#f6c3da"/);
  assert.match(out, /fill="#f6c3da0"/, 'longer hex literal is not a palette match');
  // A palette change flows through a token whose default equals that palette color (no double mapping).
  const chained = T.applyTheme('<path fill="var(--p)"/>', { colors: { pink: '#f6c3da' }, tokens: { '--p': '#f6c3da' } }, { colors: { pink: '#000001' }, tokens: {} });
  assert.match(chained, /fill="#000001"/);
  assert.match(T.applyTheme('<path fill="var(--unknown, #123456)"/>', style, T.emptyTheme()), /fill="#123456"/);
});

test('theme: sanitize drops unknown keys, invalid values and no-op overrides', () => {
  const clean = T.sanitizeTheme({ colors: { pink: '#112233', ink: '#62344f', ghost: '#000000', note: '#ffffff' }, tokens: { '--px-ink': 'nope', '--px-radius': '#ffffff', '--x': '#fff' } }, style);
  assert.deepEqual(clean, { colors: { pink: '#112233' }, tokens: {} });
  assert.equal(T.isThemeDefault(clean), false);
  assert.equal(T.isThemeDefault(T.sanitizeTheme(null, style)), true);
  assert.equal(T.themeKey(style, { colors: { pink: '#112233' } }), T.themeKey(style, { colors: { pink: '#112233', ghost: '#000000' } }));
});

test('theme: CSS export includes effective palette and tokens; tint stays light', () => {
  const css = T.toCss(style, { colors: { pink: '#112233' }, tokens: { '--px-ink': '#445566' } });
  assert.match(css, /--palette-pink: #112233;/);
  assert.match(css, /--px-ink: #445566;/);
  assert.match(css, /--px-radius: 2px;/);
  assert.equal(T.tint('#000000', 1), '#ffffff');
  assert.equal(T.tint('bad'), T.tint('#ffffff'));
});

function fakeFetch(responses) {
  const calls = [];
  const impl = async (path, init) => {
    calls.push({ path, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(init);
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  };
  return { impl, calls };
}

test('api: sends bearer auth, maps statuses to typed errors, and fires auth callback', async () => {
  const seen = [];
  const { impl, calls } = fakeFetch([{ body: { ok: 1 } }, { status: 401 }, { status: 404 }, { status: 409 }, { status: 400 }]);
  const api = createApi({ getToken: () => 'tok', fetchImpl: impl, onAuthFailure: e => seen.push(e.kind) });
  assert.deepEqual(await api.json('/x'), { ok: 1 });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  for (const kind of ['auth', 'notfound', 'conflict', 'invalid']) {
    await assert.rejects(api.json('/x'), error => error instanceof ApiError && error.kind === kind);
  }
  assert.deepEqual(seen, ['auth']);
});

test('api: retries idempotent reads once on network/server failure but never retries writes', async () => {
  const net = new TypeError('failed');
  const a = fakeFetch([net, { body: { ok: 2 } }]);
  assert.deepEqual(await createApi({ getToken: () => 't', fetchImpl: a.impl, retryDelayMs: 0 }).json('/r'), { ok: 2 });
  assert.equal(a.calls.length, 2);
  const b = fakeFetch([{ status: 503 }, { status: 503 }]);
  await assert.rejects(createApi({ getToken: () => 't', fetchImpl: b.impl, retryDelayMs: 0 }).json('/r'), e => e.kind === 'server');
  assert.equal(b.calls.length, 2);
  const c = fakeFetch([net, { body: {} }]);
  await assert.rejects(createApi({ getToken: () => 't', fetchImpl: c.impl, retryDelayMs: 0 }).put('/w', {}), e => e.kind === 'network');
  assert.equal(c.calls.length, 1, 'PUT is not retried automatically');
  assert.equal(c.calls[0].init.method, 'PUT');
  assert.equal(c.calls[0].init.headers['Content-Type'], 'application/json');
});

test('api: timeout and caller abort are distinguished', async () => {
  const hang = init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))));
  const timeout = createApi({ getToken: () => 't', fetchImpl: fakeFetch([hang, hang]).impl, timeoutMs: 20, retryDelayMs: 0 });
  await assert.rejects(timeout.json('/slow'), e => e.kind === 'timeout');
  const controller = new AbortController();
  const api = createApi({ getToken: () => 't', fetchImpl: fakeFetch([hang]).impl });
  const pending = api.json('/slow', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, e => e.kind === 'abort');
});

test('storage: never throws and keeps presets per style', () => {
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const s = createStorage(broken);
  assert.equal(s.loadDraft(), null);
  assert.equal(s.saveDraft({ a: 1 }), false);
  assert.doesNotThrow(() => s.clearDraft());
  const mem = new Map();
  const ok = createStorage({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) });
  ok.savePreset('a', { name: 'one', theme: 1 });
  ok.savePreset('a', { name: 'one', theme: 2 });
  ok.savePreset('b', { name: 'two', theme: 3 });
  assert.deepEqual(ok.loadPresets('a'), [{ name: 'one', theme: 2 }]);
  ok.deletePreset('a', 'one');
  assert.deepEqual(ok.loadPresets('a'), []);
  assert.deepEqual(ok.loadPresets('b').length, 1);
  mem.set('shirley-di:presets:v1', '{bad json');
  assert.deepEqual(ok.loadPresets('a'), []);
});

test('canvas: grid layout and hit-testing', () => {
  assert.deepEqual(gridLayout(0), []);
  const one = gridLayout(1);
  assert.deepEqual(one[0], { x: 12, y: 12, w: 616, h: 456 });
  assert.equal(gridLayout(12).length, 12);
  const rects = gridLayout(4);
  assert.equal(hitTest(rects, rects[3].x + 1, rects[3].y + 1), 3);
  assert.equal(hitTest(rects, -5, -5), -1);
});

test('worker serves only the UI module directory as static assets without auth', async () => {
  const env = { STATIC: { fetch: async request => new Response('asset:' + new URL(request.url).pathname) }, DESIGN_PRINCIPALS: '{}' };
  const get = path => worker.fetch(new Request('http://t.local' + path), env);
  assert.equal(await (await get('/ui/theme.mjs')).text(), 'asset:/ui/theme.mjs');
  for (const path of ['/ui/../secret.mjs', '/ui/%2e%2e/x.mjs', '/ui/a/b.mjs', '/ui/x.json', '/ui/', '/assets/search']) {
    assert.equal((await get(path)).status, 401, path);
  }
});
