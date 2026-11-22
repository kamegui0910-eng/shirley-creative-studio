import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [index = '.local/index.sqlite', cache = '.local/cache', output = '.local/cache-seed.json'] = process.argv.slice(2);
const db = new DatabaseSync(index, { readOnly: true });
const rows = db.prepare('SELECT DISTINCT tenant_id, brand_id, cache_key FROM asset_variants WHERE cache_key IS NOT NULL').all();
const root = resolve(cache);
const queries = rows.map(({ tenant_id, brand_id, cache_key }) => {
  const path = resolve(root, cache_key);
  if (!path.startsWith(root + '/')) throw Error('Invalid cache path');
  const content = readFileSync(path).toString('base64');
  if (!content.length || content.length > 98304) throw Error('Object exceeds D1 preview limit: ' + cache_key);
  return {
    sql: 'INSERT INTO preview_cache VALUES (?,?,?,?) ON CONFLICT(tenant_id,brand_id,cache_key) DO UPDATE SET content_base64=excluded.content_base64',
    params: [tenant_id, brand_id, cache_key, content]
  };
});
writeFileSync(output, JSON.stringify(queries), { mode: 0o600 });
db.close();
console.log('Cache objects: ' + queries.length);
