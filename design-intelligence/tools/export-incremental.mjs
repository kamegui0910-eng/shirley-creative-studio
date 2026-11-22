import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [index = '.local/index.sqlite', cache = '.local/cache', output = '.local/incremental', targetBrand = 'shirley-drive'] = process.argv.slice(2);
if (!/^[\w-]{1,100}$/.test(targetBrand)) throw Error('Invalid brand');
mkdirSync(output, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(index, { readOnly: true });
const root = resolve(cache);
let batches = 0, rows = 0, buffer = [], weight = 0, objects = 0;
function flush() {
  if (!buffer.length) return;
  writeFileSync(join(output, 'batch-' + batches++ + '.json'), JSON.stringify({ batch: buffer }), { mode: 0o600 });
  buffer = [];
  weight = 0;
}
function upsert(table, columns, values, keys, preserve = []) {
  const changed = columns.filter(col => !keys.includes(col) && !preserve.includes(col));
  let update = changed.length
    ? 'DO UPDATE SET ' + changed.map(col => col + '=excluded.' + col).join(',') +
      ' WHERE ' + changed.map(col => table + '.' + col + ' IS NOT excluded.' + col).join(' OR ')
    : 'DO NOTHING';
  if (table === 'assets') {
    update = `DO UPDATE SET name=excluded.name,kind=excluded.kind,version=excluded.version,
      rights=CASE WHEN assets.rights='restricted' OR excluded.rights='restricted' THEN 'restricted'
        WHEN assets.version<>excluded.version THEN excluded.rights ELSE assets.rights END,
      review=CASE WHEN assets.version<>excluded.version OR assets.review='pending' THEN excluded.review ELSE assets.review END,
      evidence=CASE WHEN assets.version<>excluded.version OR (excluded.rights='restricted' AND assets.rights<>'restricted') THEN NULL ELSE assets.evidence END
      WHERE assets.name IS NOT excluded.name OR assets.kind IS NOT excluded.kind OR assets.version IS NOT excluded.version
        OR (excluded.rights='restricted' AND assets.rights<>'restricted') OR (assets.review='pending' AND excluded.review<>'pending')`;
  }
  const sql = 'INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')' +
    ' ON CONFLICT(' + keys.join(',') + ') ' + update;
  const query = { sql, params: values };
  const bytes = Buffer.byteLength(JSON.stringify(query));
  if (bytes > 103000) throw Error('D1 import row exceeds upload bound');
  if (weight + bytes > 46000 || buffer.length >= 55) flush();
  buffer.push(query);
  weight += bytes;
  rows++;
}
const tables = ['brands', 'styles', 'categories', 'assets', 'palettes', 'components', 'asset_tags', 'asset_sources', 'asset_lineage', 'classification_queue'];
for (const table of tables) {
  const tableInfo = db.prepare('PRAGMA table_info(' + table + ')').all();
  const columns = tableInfo.map(row => row.name);
  const keys = tableInfo.filter(row => row.pk).sort((a,b) => a.pk - b.pk).map(row => row.name);
  for (const original of db.prepare('SELECT * FROM ' + table).iterate()) {
    const row = { ...original };
    if (Object.hasOwn(row, 'brand_id')) row.brand_id = targetBrand;
    if (table === 'asset_sources' && ['main', 'studio'].includes(row.source_kind)) row.source_key = row.asset_id;
    const preserve = table === 'classification_queue' ? ['state', 'evidence'] : table === 'assets' ? ['rights', 'review', 'evidence'] : table === 'brands' ? ['rules'] : [];
    upsert(table, columns, columns.map(col => row[col]), keys, preserve);

  }
  flush();
}
const metadata = db.prepare(`SELECT a.tenant_id,a.asset_id,group_concat(s.payload,char(10)) AS payloads,p.colors
 FROM assets a LEFT JOIN asset_sources s USING(tenant_id,brand_id,asset_id)
 LEFT JOIN components c USING(tenant_id,brand_id,asset_id)
 LEFT JOIN palettes p ON p.tenant_id=a.tenant_id AND p.brand_id=a.brand_id AND p.style_id=c.style_id
 GROUP BY a.tenant_id,a.brand_id,a.asset_id`).all();
for (const row of metadata) {
  const payloads = row.payloads?.split('\n').map(JSON.parse) ?? [];
  const summary = payloads.map(item => item.summary ?? item.notes ?? item.description ?? item.use).find(value => typeof value === 'string') ?? null;
  const palette = Object.values(JSON.parse(row.colors ?? '{}'));
  const explicit = payloads.flatMap(item => Array.isArray(item.colors) ? item.colors : Object.values(item.colors ?? {}));
  const colors = [...new Set([...palette, ...explicit].filter(value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)).map(value => value.toLowerCase()))].sort();
  const keywords = payloads.map(item => JSON.stringify([item.tags, item.use, item.assetType, item.summary, item.notes, item.category])).join(' ').slice(0, 12000);
  const columns = ['tenant_id','brand_id','asset_id','summary','colors','keywords'];
  upsert('asset_search_metadata', columns, [row.tenant_id,targetBrand,row.asset_id,summary,JSON.stringify(colors),keywords], columns.slice(0,3));
}
flush();
const variants = db.prepare('SELECT * FROM asset_variants').all();
for (const row of variants) {
  if (!row.cache_key) continue;
  const path = resolve(root, row.cache_key);
  if (!path.startsWith(root + '/')) throw Error('Invalid cache key');
  const content = readFileSync(path).toString('base64');
  if (content.length > 98304) throw Error('Preview too large for D1 fallback');
  const columns = ['tenant_id','brand_id','cache_key','content_base64'];
  upsert('preview_cache', columns, [row.tenant_id,targetBrand,row.cache_key,content], columns.slice(0,3));
  objects++;
}
flush();
for (const row of variants) {
  row.brand_id = targetBrand;
  const columns = Object.keys(row);
  upsert('asset_variants', columns, Object.values(row), ['tenant_id','brand_id','variant_id']);
}
flush();
const assets = db.prepare('SELECT count(*) n,count(DISTINCT asset_id) uniqueCount FROM assets').get();
db.close();
const manifest = JSON.stringify({ batches, rows, objects, assets });
writeFileSync(join(output, 'counts.json'), manifest, { mode: 0o600 });
console.log(manifest);
