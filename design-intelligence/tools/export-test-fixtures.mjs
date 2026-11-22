import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Synthetic sandbox records with no private Drive IDs, names or art.
const statements = [];
const put = (table, ...params) => statements.push({
  sql: 'INSERT INTO ' + table + ' VALUES (' + params.map(() => '?').join(',') + ') ON CONFLICT DO NOTHING',
  params
});
const demo = ['studio', 'shirley'];
const tenantProbe = ['isolation-probe', 'shirley'];
const brandProbe = ['studio', 'isolation-brand'];
put('brands', ...demo, JSON.stringify({ name: 'Shirley Design Sandbox', fixture: 'synthetic', publish: 'disabled' }));
put('brands', ...tenantProbe, '{"name":"Tenant isolation fixture"}');
put('brands', ...brandProbe, '{"name":"Brand isolation fixture"}');
const kits = [
  { id: 'pink-black-ins', label: '粉黑 INS', ink: '#241d26', pink: '#f6c3da' },
  { id: 'pink-pixel-retro', label: '粉色像素复古', ink: '#62344f', pink: '#f4a6c8' }
];
for (const { id, label, ink, pink } of kits) {
  put('styles', id, label);
  put('palettes', ...demo, id, JSON.stringify({ ink, pink }), '{}', null, null);
}
for (const [id, label] of [['icon', '图标'], ['frame', '边框'], ['sticker', '贴纸']]) put('categories', id, label);
const shapes = {
  icon: '<path d="M20 55 50 25 80 55V80H20Z" fill="ACCENT" stroke="INK" stroke-width="5"/>',
  frame: '<rect x="10" y="20" width="80" height="60" rx="6" fill="ACCENT" stroke="INK" stroke-width="4"/><path d="M10 36h80" stroke="INK" stroke-width="4"/>',
  sticker: '<path d="m50 13 10 25 28 3-21 18 6 27-23-14-23 14 6-27-21-18 28-3Z" fill="ACCENT" stroke="INK" stroke-width="4"/>'
};
const dir = mkdtempSync(join(tmpdir(), 'design-demo-'));
try {
  const records = kits.flatMap((kit, index) => Object.keys(shapes).map(category => ({ scope: demo, kit, id: 'demo-' + index + '-' + category, category })));
  records.push({ scope: tenantProbe, kit: kits[0], id: 'probe-tenant', category: 'icon' });
  records.push({ scope: brandProbe, kit: kits[0], id: 'probe-brand', category: 'icon' });
  for (const { scope, kit, id, category } of records) {
    const name = category + '.svg';
    put('assets', ...scope, id, 'synthetic-' + id, name, 'component', '1', 'unverified', 'indexed', null);
    put('components', ...scope, id, category + '/' + name, 'synthetic/' + id + '.svg', kit.id);
    put('asset_tags', ...scope, id, kit.id, null, 'style:' + kit.id);
    put('asset_tags', ...scope, id, null, category, 'category:' + category);
    const key = scope.join('/') + '/' + id;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
      shapes[category].replace('ACCENT', kit.pink).replaceAll('INK', kit.ink) + '</svg>';
    writeFileSync(join(dir, 'sample.svg'), svg);
    execFileSync('inkscape', [join(dir, 'sample.svg'), '--export-width=120', '--export-filename=' + join(dir, 'sample.png')], { stdio: 'ignore' });
    for (const [kind, ext, mime, content] of [
      ['vector', 'svg', 'image/svg+xml', Buffer.from(svg)],
      ['preview', 'png', 'image/png', readFileSync(join(dir, 'sample.png'))]
    ]) {
      const cacheKey = key + '.' + ext;
      put('asset_variants', ...scope, id, id + ':' + kind, kind, null, cacheKey, mime);
      put('preview_cache', ...scope, cacheKey, content.toString('base64'));
    }
  }
  put('design_recipes', ...demo, 'demo-recipe', 1, JSON.stringify({
    title: 'Sandbox recipe', style: kits[0].id, accent: kits[0].pink, components: [{ assetId: 'demo-0-icon' }]
  }), '2026-11-22T00:00:00.000Z');
  writeFileSync(process.argv[2] ?? '.local/synthetic-cloud-seed.json', JSON.stringify(statements), { mode: 0o600 });
  console.log('Synthetic statements: ' + statements.length);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
