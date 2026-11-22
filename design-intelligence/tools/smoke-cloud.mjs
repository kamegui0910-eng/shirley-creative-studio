import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { designContext } from './agent-context.mjs';

const base = new URL(process.env.DESIGN_API_BASE);
assert.equal(base.protocol, 'https:');
assert.equal(base.pathname, '/');
const secrets = JSON.parse(readFileSync(process.env.DESIGN_ACCESS_FILE ?? '.local/cloud-test-access.json', 'utf8'));
const checks = [];
const request = async (path, { role = 'operator', status = 200, document, extra } = {}) => {
  const headers = new Headers(extra);
  if (role !== null) {
    assert.match(secrets[role] ?? '', /^[\w.-]{16,512}$/);
    headers.set('Authorization', 'Bearer ' + secrets[role]);
  }
  if (document) headers.set('Content-Type', 'application/json');
  const response = await fetch(new URL(path, base), {
    headers, method: document ? 'PUT' : 'GET', body: document && JSON.stringify(document), redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, status, role + ' ' + path);
  return response;
};
const json = async (...args) => (await request(...args)).json();

const shell = await request('/', { role: null });
assert.match(await shell.text(), /Design Intelligence/);
assert.match(shell.headers.get('content-security-policy'), /frame-ancestors 'none'/);
assert.match((await request('/app.mjs', { role: null })).headers.get('content-type'), /javascript/);
await request('/styles', { role: null, status: 401 });
await request('/assets/demo-0-icon/preview', { role: null, status: 401 });
checks.push('Preview shell and unauthenticated access');

const styles = (await json('/styles')).items;
assert.deepEqual(styles.map(x => x.id).sort(), ['pink-black-ins', 'pink-pixel-retro']);
const sample = (await json('/assets/search?style=pink-black-ins&category=icon&kind=component')).items;
assert.deepEqual(sample.map(x => x.assetId), ['demo-0-icon']);
const page = await json('/assets/search?style=pink-black-ins&limit=2');
const second = await json('/assets/search?style=pink-black-ins&limit=2&cursor=' + page.nextCursor);
assert.equal(page.items.length, 2);
assert.equal(second.items.length, 1);
assert.equal(second.nextCursor, null);
assert.equal((await json('/assets/search?rights=commercial_ready')).items.length, 0);
assert.equal((await json('/categories?style=pink-black-ins')).items.length, 3);
checks.push('D1 taxonomy, combined filters, rights and cursor');

const png = await request('/assets/demo-0-icon/preview');
assert.equal(png.headers.get('content-type'), 'image/png');
assert.equal(png.headers.get('cache-control'), 'private, no-store');
assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
const svg = await request('/assets/demo-0-icon/vector');
assert.match(svg.headers.get('content-security-policy'), /sandbox/);
assert.match(await svg.text(), /<svg\b/);
checks.push('Private D1 PNG and SVG fallback');

const recipeId = 'smoke-' + randomUUID();
const recipePath = '/design-recipes/' + recipeId;
const design = { title: 'Cloud verification', style: 'pink-black-ins', accent: '#c34283', components: [{ assetId: 'demo-0-icon' }] };
const created = await json(recipePath, { document: { ...design, version: 0 }, status: 201 });
assert.deepEqual(await json(recipePath), created);
const concurrent = await Promise.all([1, 2].map(async n => {
  const response = await fetch(new URL(recipePath, base), {
    method: 'PUT', headers: { Authorization: 'Bearer ' + secrets.operator, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...design, version: 1, title: 'Cloud verification ' + n }), signal: AbortSignal.timeout(15000)
  });
  return response.status;
}));
assert.deepEqual(concurrent.sort(), [200, 409]);
assert.deepEqual(await json(recipePath + '/publication-check'), { allowed: false, blockers: ['demo-0-icon'] });
checks.push('Recipe persistence, concurrent edits and publication denial');

for (const [role, tenant, brand, id] of [
  ['isolatedTenant', 'isolation-probe', 'shirley', 'probe-tenant'],
  ['isolatedBrand', 'studio', 'isolation-brand', 'probe-brand']
]) {
  assert.deepEqual(await json('/session', { role }), { tenantId: tenant, brandId: brand, write: true });
  assert.deepEqual((await json('/assets/search', { role })).items.map(x => x.assetId), [id]);
  for (const suffix of ['', '/preview', '/vector']) {
    await request('/assets/demo-0-icon' + suffix, { role, status: 404, extra: { 'X-Tenant-Id': 'studio', 'X-Brand-Id': 'shirley' } });
    await request('/assets/' + id + suffix, { status: 404 });
  }
  await request(recipePath, { role, status: 404 });
  await request(recipePath, { role, document: { ...design, version: 0 }, status: 404 });
}
await request('/assets/search?tenantId=isolation-probe', { status: 403 });
await request('/assets/search?brandId=isolation-brand', { status: 403 });
await request('/brands/isolation-brand/design-rules', { status: 404 });
checks.push('Cross-tenant and cross-brand asset, cache, rule and recipe isolation');

for (const role of ['grok', 'muse', 'claude']) {
  assert.deepEqual(await json('/session', { role }), { tenantId: 'studio', brandId: 'shirley', write: false });
  const reference = role === 'grok' ? { payloadRef: 'design-recipe:demo-recipe' } : 'design-recipe:demo-recipe';
  const context = await designContext(base.origin, secrets[role], reference);
  assert.equal(context.design.recipeId, 'demo-recipe');
  assert.equal(context.design.publicationAllowed, false);
  await request(recipePath, { role, document: { ...design, version: 2 }, status: 403 });
}
checks.push('Three distinct read-only Agent credentials and Gateway reference contract');
console.log(JSON.stringify({ origin: base.origin, passed: checks, recipeId }, null, 2));
