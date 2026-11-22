import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openIndex } from '../tools/import.mjs';
import { sqliteBinding } from '../tools/dev.mjs';
import worker, { tokenDigest, parseRecipeV2 } from '../src/worker.mjs';

const db = openIndex(':memory:');
const token = 'recipe-v2-owner-token-0001';
const readOnly = 'recipe-v2-reader-token-001';
let env;
before(async () => {
  db.exec(`
    INSERT INTO brands VALUES ('studio','shirley','{}'),('other','shirley','{}');
    INSERT INTO styles VALUES ('pixel','Pixel'),('ins','Ins');
    INSERT INTO assets VALUES
      ('studio','shirley','a1','d1','a.svg','component','1','unverified','indexed',NULL),
      ('studio','shirley','a2','d2','b.svg','component','1','unverified','indexed',NULL),
      ('studio','shirley','b1','d3','c.svg','component','1','unverified','indexed',NULL);
    INSERT INTO components VALUES ('studio','shirley','a1','icons/a.svg','p1','pixel'),('studio','shirley','a2','icons/b.svg','p2','pixel'),('studio','shirley','b1','icons/c.svg','p3','ins');
  `);
  env = { DB: sqliteBinding(db), DESIGN_REVISIONS: 'enabled', DESIGN_PRINCIPALS: JSON.stringify({
    [await tokenDigest(token)]: { tenantId: 'studio', brandId: 'shirley', write: true },
    [await tokenDigest(readOnly)]: { tenantId: 'studio', brandId: 'shirley', write: false }
  }) };
});
after(() => db.close());

const call = (path, { bearer = token, body, bindings = env } = {}) => worker.fetch(new Request('http://t.local' + path, {
  method: body ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + bearer }, body: body && JSON.stringify(body)
}), bindings);

export const layer = (id, over = {}) => ({ id, type: 'component', assetId: 'a1', x: 100, y: 120, w: 200, h: 200, scale: 1, rotation: 0, opacity: 1, visible: true, locked: false, colors: {}, ...over });
export const recipe = (over = {}) => ({
  schemaVersion: 2, version: 0, title: 'v2', style: 'pixel', accent: '#aabbcc', layout: 'free',
  canvas: { width: 1080, height: 1440, background: null }, theme: { colors: { pink: '#112233' }, tokens: { '--px-ink': '#445566' } },
  layers: [layer('l1'), layer('l2', { assetId: 'a2', rotation: 15.5 }), { id: 't1', type: 'text', x: 540, y: 80, scale: 1, rotation: 0, opacity: 1, visible: true, locked: false, text: '春季海报\n第二行', fontSize: 64, color: '#222222', weight: 'bold', align: 'center' }],
  ...over
});

test('v2: round-trips every field and derives components for v1 readers', async () => {
  const saved = await call('/design-recipes/r1', { body: recipe() });
  assert.equal(saved.status, 201);
  const view = await (await call('/design-recipes/r1')).json();
  assert.deepEqual(await saved.json(), view);
  assert.equal(view.document.schemaVersion, 2);
  assert.deepEqual(view.document.canvas, { width: 1080, height: 1440, background: null });
  assert.deepEqual(view.document.layers.map(l => l.id), ['l1', 'l2', 't1']);
  assert.equal(view.document.layers[1].rotation, 15.5);
  assert.equal(view.document.layers[2].text, '春季海报\n第二行');
  assert.deepEqual(view.document.theme, { colors: { pink: '#112233' }, tokens: { '--px-ink': '#445566' } });
  assert.deepEqual(view.document.components, [{ assetId: 'a1' }, { assetId: 'a2' }]);
  assert.deepEqual(await (await call('/design-recipes/r1/publication-check')).json(), { allowed: false, blockers: ['a1', 'a2'] });
});

test('v2: duplicate component layers are allowed; derived components are unique', async () => {
  const r = recipe({ layers: [layer('x'), layer('y'), layer('z')] });
  assert.equal((await call('/design-recipes/dup', { body: r })).status, 201);
  assert.deepEqual((await (await call('/design-recipes/dup')).json()).document.components, [{ assetId: 'a1' }]);
});

test('v2: optimistic concurrency and revisions history (feature-flagged)', async () => {
  assert.equal((await call('/design-recipes/rev', { body: recipe({ title: 'one' }) })).status, 201);
  assert.equal((await call('/design-recipes/rev', { body: recipe({ title: 'two', version: 1 }) })).status, 200);
  assert.equal((await call('/design-recipes/rev', { body: recipe({ title: 'stale', version: 1 }) })).status, 409);
  const list = await (await call('/design-recipes/rev/revisions')).json();
  assert.deepEqual(list.items.map(i => [i.version, i.title]), [[2, 'two'], [1, 'one']]);
  assert.equal((await (await call('/design-recipes/rev/revisions/1')).json()).document.title, 'one');
  assert.equal((await call('/design-recipes/rev/revisions/9')).status, 404);
  assert.equal((await call('/design-recipes/nope/revisions')).status, 404);
  assert.equal((await call('/design-recipes/rev/revisions', { bindings: { ...env, DESIGN_REVISIONS: undefined } })).status, 404, 'route is absent until the flag is on');
});

test('v2: rejects malformed documents with 400 and unknown/foreign components with 404', async () => {
  const bad = {
    'wrong schemaVersion': { schemaVersion: 3 }, 'canvas too small': { canvas: { width: 10, height: 10, background: null } },
    'canvas non-integer': { canvas: { width: 100.5, height: 100, background: null } }, 'bad layout': { layout: 'masonry' },
    'bad accent': { accent: 'red' }, 'empty layers': { layers: [] }, 'too many layers': { layers: Array.from({ length: 41 }, (_, i) => layer('n' + i)) },
    'too many components': { layers: Array.from({ length: 13 }, (_, i) => layer('c' + i)) },
    'duplicate layer id': { layers: [layer('same'), layer('same')] }, 'bad scale': { layers: [layer('s', { scale: 0 })] },
    'NaN-like x': { layers: [layer('s', { x: 1e9 })] }, 'string x': { layers: [layer('s', { x: '5' })] },
    'bad opacity': { layers: [layer('s', { opacity: 2 })] }, 'bad rotation': { layers: [layer('s', { rotation: 720 })] },
    'component without size': { layers: [layer('s', { w: 0 })] }, 'unknown layer type': { layers: [{ ...layer('s'), type: 'video' }] },
    'bad theme color': { theme: { colors: { pink: 'nope' }, tokens: {} } }, 'bad token name': { theme: { colors: {}, tokens: { px: '#ffffff' } } },
    'empty text': { layers: [{ ...recipe().layers[2], text: '' }] }, 'text too long': { layers: [{ ...recipe().layers[2], text: 'x'.repeat(501) }] },
    'control char in text': { layers: [{ ...recipe().layers[2], text: 'a\u0000b' }] }, 'bad font size': { layers: [{ ...recipe().layers[2], fontSize: 2 }] },
    'bad align': { layers: [{ ...recipe().layers[2], align: 'justify' }] }, 'bad layer id': { layers: [layer('bad id!')] }
  };
  for (const [name, patch] of Object.entries(bad)) assert.equal((await call('/design-recipes/bad', { body: recipe(patch) })).status, 400, name);
  assert.equal((await call('/design-recipes/bad', { body: recipe({ layers: [layer('f', { assetId: 'b1' })] }) })).status, 404, 'component from another style');
  assert.equal((await call('/design-recipes/bad', { body: recipe({ layers: [layer('f', { assetId: 'zzz' })] }) })).status, 404);
  assert.equal((await call('/design-recipes/bad')).status, 404, 'nothing was stored');
});

test('v2: write scope, v1 compatibility, and oversize bodies', async () => {
  assert.equal((await call('/design-recipes/ro', { body: recipe(), bearer: readOnly })).status, 403);
  const v1 = await call('/design-recipes/legacy', { body: { version: 0, title: 'old', style: 'pixel', accent: '#aabbcc', components: [{ assetId: 'a1' }] } });
  assert.equal(v1.status, 201);
  assert.deepEqual((await v1.json()).document, { title: 'old', style: 'pixel', accent: '#aabbcc', components: [{ assetId: 'a1' }] });
  // a v1 document can be upgraded in place by a v2 save
  assert.equal((await call('/design-recipes/legacy', { body: recipe({ version: 1 }) })).status, 200);
  assert.equal((await call('/design-recipes/huge', { body: recipe({ pad: 'x'.repeat(70000) }) })).status, 400);
});

test('parseRecipeV2 normalizes colors and drops unknown fields', () => {
  const { document, error } = parseRecipeV2(recipe({ accent: '#AABBCC', injected: 'x', layers: [layer('l', { evil: 1, colors: { Pink: '#FFFFFF' } })] }));
  assert.equal(error, undefined);
  assert.equal(document.accent, '#aabbcc');
  assert.deepEqual(document.layers[0].colors, { Pink: '#ffffff' });
  assert.equal('evil' in document.layers[0], false);
  assert.equal('injected' in document, false);
});
