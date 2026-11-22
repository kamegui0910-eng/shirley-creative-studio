import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const [source = '.local/index.sqlite', target = '.local/seed.sql'] = process.argv.slice(2);
const db = new DatabaseSync(source, { readOnly: true });
const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'";
const tables = ['brands','assets','asset_variants','styles','categories','asset_tags','palettes','components','asset_sources','asset_lineage','classification_queue','sync_state'];
const statements = [];
for (const table of tables) {
  for (const row of db.prepare('SELECT * FROM ' + table).iterate()) {
    statements.push('INSERT INTO ' + table + ' VALUES (' + Object.values(row).map(quote).join(',') + ') ON CONFLICT DO NOTHING;');
  }
}
writeFileSync(target, statements.join('\n') + '\n', { mode: 0o600 });
db.close();
