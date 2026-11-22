import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const origin = new URL(process.env.DESIGN_API_BASE);
assert.equal(origin.protocol, 'https:');
const trusted = JSON.parse(readFileSync('.local/drive-test-access.json'));
const isolation = JSON.parse(readFileSync('.local/cloud-test-access.json'));
const api = async (path, { token = trusted.operator, status = 200, data, method = 'GET' } = {}) => {
  const response = await fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(20000), method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data && JSON.stringify(data) });
  assert.equal(response.status, status, method + ' ' + path);
  return response;
};
const json = async (...args) => (await api(...args)).json();
assert.deepEqual(await json('/session'), { tenantId: 'studio', brandId: 'shirley-drive', write: true });
const items = [];
let cursor = '';
do {
  const result = await json('/assets/search?limit=100&cursor=' + cursor);
  items.push(...result.items);
  cursor = result.nextCursor;
} while (cursor);
const expectedAssets = process.env.DESIGN_EXPECTED_ASSETS;
if (expectedAssets) assert.equal(items.length, Number(expectedAssets));
else assert.ok(items.length >= 325, 'verified Drive baseline must remain intact');
const unique = new Set(items.map(item => item.assetId)).size;
assert.equal(unique, items.length);
const components = items.filter(x => x.kind === 'component');
assert.equal(components.length, 94);
const sample = components.find(item => item.colors.length && item.styleIds.length && item.categoryIds.length);
assert.ok(sample);
const params = new URLSearchParams({ styleId: sample.styleIds[0], categoryId: sample.categoryIds[0], color: sample.colors[0].toUpperCase(), keyword: sample.name });
assert.ok((await json('/assets/search?' + params)).items.some(item => item.assetId === sample.assetId));
const reference = items.find(item => item.kind === 'reference' && item.summary?.length > 6);
assert.ok(reference);
const phrase = reference.summary.slice(0, 12);
assert.ok((await json('/assets/search?' + new URLSearchParams({ keyword: phrase, limit: 100 }))).items.some(item => item.assetId === reference.assetId));
assert.equal(sample.title, sample.name);
assert.equal(sample.id, sample.assetId);

const asset = '/assets/' + sample.assetId;
await api(asset + '/vector', { token: null, status: 401 });
for (const token of [isolation.isolatedTenant, isolation.isolatedBrand, isolation.operator]) {
  await api(asset, { token, status: 404 });
  await api(asset + '/preview', { token, status: 404 });
}
let media = 0;
for (let i=0; i<components.length; i+=6) {
  await Promise.all(components.slice(i,i+6).map(async item => {
    const svg = await api('/assets/' + item.assetId + '/vector');
    assert.match(svg.headers.get('content-type'), /image\/svg/);
    assert.match(await svg.text(), /<svg\b/);
    const png = await api('/assets/' + item.assetId + '/preview');
    assert.equal(png.headers.get('cache-control'), 'private, no-store');
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    media++;
  }));
}
const id = 'drive-smoke-' + randomUUID();
const path = '/design-recipes/' + id;
const document = { title: 'Drive integration smoke', style: sample.styleIds[0], accent: '#eb92b2',
  layout: { width: 800, height: 600, background: '#ffe0ee' },
  components: [{ assetId: sample.assetId, layout: { x: .45,y: .55,scale: 1.25,rotation: 15 } }],
  layers: [{ id: 'layer-a', componentIndex: 0, opacity: .65, visible: true }],
  theme: { colors: { pink: '#eb92b2' }, tokens: { '--accent': '#eb92b2' } } };
assert.deepEqual((await json(path, { method: 'PUT', data: { ...document, version: 0 }, status: 201 })).document, document);
const writes = await Promise.all([1,2].map(async i => {
  const res = await fetch(new URL(path,origin), {method:'PUT',headers:{Authorization:'Bearer '+trusted.operator,'Content-Type':'application/json'},
    body:JSON.stringify({...document,title:'Concurrent '+i,version:1})});
  return res.status;
}));
assert.deepEqual(writes.sort(),[200,409]);
assert.deepEqual((await json(path + '/history')).items.map(x=>x.version), [2,1]);
assert.deepEqual((await json(path + '/history/1')).document, document);
const restored = await json(path + '/restore', { method:'POST', data:{ version:2,restoreVersion:1 } });
assert.equal(restored.version,3);
assert.deepEqual((await json(path)).document,document);
await api(path + '/history', { token: isolation.operator, status: 404 });
for (const token of [trusted.grok,trusted.muse,trusted.claude]) {
  assert.equal((await json(path,{token})).version, 3);
  await api(path+'/restore',{token,status:403,method:'POST',data:{version:3,restoreVersion:1}});
}
console.log(JSON.stringify({ assets:items.length, unique, scopedVectorPngPairs:media, recipeVersion:restored.version, isolated:true, roleCredentialHTTP:3 }));
