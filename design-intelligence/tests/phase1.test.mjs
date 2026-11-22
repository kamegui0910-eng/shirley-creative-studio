import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openIndex, importIndex } from '../tools/import.mjs';
import { sqliteBinding, localCache } from '../tools/dev.mjs';
import worker, { tokenDigest } from '../src/worker.mjs';

const db = openIndex(':memory:');
const token = 'test-studio-token-long';
const other = 'test-other-tenant-token';
const readOnly = 'test-readonly-token-long';
let env;
before(async () => {
  db.exec(`
    INSERT INTO brands VALUES ('studio','shirley','{}'),('other','shirley','{}'),('studio','private','{}');
    INSERT INTO styles VALUES ('pixel','Pixel'),('secret','Secret');
    INSERT INTO categories VALUES ('icon','Icon'),('frame','Frame');
    INSERT INTO assets VALUES
      ('studio','shirley','icon','drive1','same.svg','component','1','unverified','indexed',NULL),
      ('studio','shirley','frame','drive2','same.svg','component','1','restricted','indexed',NULL),
      ('other','shirley','secret','drive3','secret.svg','component','1','unverified','indexed',NULL),
      ('studio','private','private','drive4','private.svg','component','1','unverified','indexed',NULL);
    INSERT INTO components VALUES ('studio','shirley','icon','icons/same.svg','a','pixel'),
      ('studio','shirley','frame','frames/same.svg','b','pixel'),
      ('other','shirley','secret','icons/secret.svg','c','secret');
    INSERT INTO asset_tags VALUES
      ('studio','shirley','icon','pixel',NULL,'style:pixel'),('studio','shirley','icon',NULL,'icon','category:icon'),
      ('studio','shirley','frame','pixel',NULL,'style:pixel'),('studio','shirley','frame',NULL,'frame','category:frame'),
      ('other','shirley','secret','secret',NULL,'style:secret');
  `);
  env = { DB: sqliteBinding(db), DESIGN_PRINCIPALS: JSON.stringify({
    [await tokenDigest(token)]: { tenantId: 'studio', brandId: 'shirley', write: true },
    [await tokenDigest(other)]: { tenantId: 'other', brandId: 'shirley', write: true },
    [await tokenDigest(readOnly)]: { tenantId: 'studio', brandId: 'shirley', write: false }
  }) };
});
after(() => db.close());

function request(path, { bearer = token, body, ...headers } = {}, bindings = env) {
  return worker.fetch(new Request('http://test.local' + path, {
    method: body ? 'PUT' : 'GET', headers: { Authorization: bearer ? 'Bearer ' + bearer : '', ...headers },
    body: body && JSON.stringify(body)
  }), bindings);
}
const recipe = { version: 0, title: 'draft', style: 'pixel', accent: '#aabbcc', components: [{ assetId: 'icon' }, { assetId: 'frame' }] };

test('Style × Category, rights filter, pagination and same names', async () => {
  const result = await (await request('/assets/search?style=pixel&category=icon')).json();
  assert.deepEqual(result.items.map(x => x.assetId), ['icon']);
  const a = await (await request('/assets/search?style=pixel&limit=1')).json();
  const b = await (await request('/assets/search?style=pixel&limit=1&cursor=' + a.nextCursor)).json();
  assert.equal(a.items[0].name, b.items[0].name);
  assert.notEqual(a.items[0].assetId, b.items[0].assetId);
  assert.equal(b.nextCursor, null);
  assert.deepEqual((await (await request('/assets/search?rights=restricted')).json()).items.map(x => x.assetId), ['frame']);
});

test('Authorization isolates tenant and brand, ignores spoofed scope, and validates writes', async () => {
  assert.equal((await request('/styles', { bearer: null })).status, 401);
  assert.deepEqual((await (await request('/styles')).json()).items.map(x => x.id), ['pixel']);
  assert.equal((await request('/assets/secret', { 'X-Tenant-Id': 'other' })).status, 404);
  assert.equal((await request('/assets/private')).status, 404);
  assert.equal((await request('/assets/secret/vector')).status, 404);
  assert.equal((await request('/brands/private/design-rules')).status, 404);
  assert.equal((await request('/assets/search?tenantId=other')).status, 403);
  assert.equal((await request('/assets/search?brandId=private')).status, 403);
  assert.equal((await request('/design-recipes/refused', { body: recipe, bearer: readOnly })).status, 403);
  assert.equal((await request('/design-recipes/foreign', { body: { ...recipe, components: [{ assetId: 'secret' }] } })).status, 404);
});

test('Recipe save, recovery, optimistic concurrency, and publication rejection', async () => {
  const saved = await request('/design-recipes/sample', { body: recipe });
  assert.equal(saved.status, 201);
  const recovered = await (await request('/design-recipes/sample')).json();
  assert.deepEqual(await saved.json(), recovered);
  assert.equal((await request('/design-recipes/sample', { bearer: other })).status, 404);
  const changes = await Promise.all(['first', 'second'].map(title =>
    request('/design-recipes/sample', { body: { ...recipe, title, version: 1 } })));
  assert.deepEqual(changes.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual(await (await request('/design-recipes/sample/publication-check')).json(),
    { allowed: false, blockers: ['icon', 'frame'] });
  assert.throws(() => db.exec("UPDATE assets SET rights='commercial_ready' WHERE asset_id='icon'"));
});

test('Migration rollback and reapply preserve unrelated tables', () => {
  const scratch = openIndex(':memory:');
  scratch.exec('CREATE TABLE unrelated (id INTEGER); INSERT INTO unrelated VALUES (1)');
  const readSQL = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  scratch.exec(readSQL('../rollback/0003_recipe_revisions.sql'));
  scratch.exec(readSQL('../rollback/0002_preview_cache.sql'));
  scratch.exec(readSQL('../rollback/0001_index.sql'));
  assert.deepEqual(scratch.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(x => x.name), ['unrelated']);
  scratch.exec(readSQL('../migrations/0001_index.sql'));
  scratch.exec(readSQL('../migrations/0002_preview_cache.sql'));
  scratch.exec(readSQL('../migrations/0003_recipe_revisions.sql'));
  assert.equal(scratch.prepare('SELECT id FROM unrelated').get().id, 1);
  assert.deepEqual(scratch.prepare('PRAGMA foreign_key_check').all(), []);
  scratch.close();
});

const input = process.env.DESIGN_TEST_INPUT ?? '.local/input';
const cache = process.env.DESIGN_TEST_CACHE ?? '.local/cache';
test('Drive baseline: exact source preservation, all kits, thumbnails, queue, cache, and repeatability',
  { skip: !existsSync(input + '/inventory.json') && !process.env.DESIGN_TEST_INPUT }, async () => {
    const actual = openIndex(':memory:');
    const inventory = JSON.parse(readFileSync(input + '/inventory.json'));
    const load = suffix => JSON.parse(readFileSync(input + '/' + inventory.find(x => x.path.endsWith(suffix)).id));
    const counts = { main: 150, studio: 9, components: 94, thumbnails: 9, queued: 72, previews: 94 };
    assert.deepEqual(importIndex(actual, input, cache), counts);
    assert.deepEqual(importIndex(actual, input, cache), counts);
    const source = kind => actual.prepare('SELECT payload FROM asset_sources WHERE source_kind=? ORDER BY CAST(source_key AS INTEGER)').all(kind).map(row => JSON.parse(row.payload));
    assert.deepEqual(source('main'), load(' library-index.json').items);
    assert.deepEqual(source('studio'), load('studio-library-index.json').references);
    assert.deepEqual(source('studio').map(row => row.thumbnailFileId).sort(), actual.prepare("SELECT drive_id FROM asset_variants WHERE kind='thumbnail' ORDER BY drive_id").all().map(row => row.drive_id));
    assert.equal(actual.prepare("SELECT COUNT(*) n FROM assets a JOIN asset_variants v ON v.drive_id=a.drive_id WHERE v.kind='thumbnail'").get().n, 0);
    assert.equal(actual.prepare("SELECT COUNT(*) n FROM classification_queue WHERE state='pending'").get().n, 72);
    assert.equal(actual.prepare("SELECT COUNT(DISTINCT asset_id) n FROM components").get().n, 94);
    assert.equal(actual.prepare("SELECT COUNT(*) n FROM components WHERE logical_path='icons/house.svg'").get().n, 2);
    assert.deepEqual(actual.prepare('SELECT count(*) n FROM components GROUP BY style_id ORDER BY n').all().map(row => row.n), [40, 54]);
    assert.equal(actual.prepare("SELECT COUNT(*) n FROM assets WHERE rights='commercial_ready'").get().n, 0);
    assert.deepEqual(actual.prepare('PRAGMA foreign_key_check').all(), []);
    const style = actual.prepare("SELECT tokens,token_compatibility FROM palettes WHERE style_id='pink-pixel-retro'").get();
    assert.equal(JSON.parse(style.tokens)['--px-ink'], '#62344f');
    assert.equal(JSON.parse(style.token_compatibility).status, 'unresolved');
    const bindings = { ...env, DB: sqliteBinding(actual), CACHE: localCache(cache) };
    for (const { asset_id } of actual.prepare('SELECT asset_id FROM components').iterate()) {
      const png = await request('/assets/' + asset_id + '/preview', {}, bindings);
      assert.equal(png.status, 200);
      assert.equal(png.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
    const staging = mkdtempSync(join(tmpdir(), 'design-rights-'));
    try {
      symlinkSync(resolve(input, 'inventory.json'), join(staging, 'inventory.json'));
      for (const row of inventory) {
        if (existsSync(join(input, row.id))) symlinkSync(resolve(input, row.id), join(staging, row.id));
      }
      const file = inventory.find(row => row.area === 'reference' && row.created_time?.startsWith('2026-11-14'));
      writeFileSync(join(staging, 'descriptions.json'), JSON.stringify({ [file.id]: '禁止转载、禁二创' }));
      importIndex(actual, staging, cache);
      assert.equal(actual.prepare('SELECT rights FROM assets WHERE drive_id=?').get(file.id).rights, 'restricted');
      assert.equal(actual.prepare("SELECT count(*) n FROM classification_queue WHERE state='pending'").get().n, 72);
    } finally {
      rmSync(staging, { recursive: true, force: true });
      actual.close();
    }
  });
