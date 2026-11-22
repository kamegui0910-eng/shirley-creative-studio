import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const [catalogPath, manifestPath, dbPath = '.local/index.sqlite', privatePath] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const catalog = read(catalogPath).records;
const manifests = read(manifestPath);
const db = new DatabaseSync(dbPath, { readOnly: true });
const components = db.prepare('SELECT asset_id,logical_path,style_id FROM components').all();
const publicKey = row => (row.style_id === 'pink-black-ins' ? 'ins:' : 'px:') + row.logical_path.replace('/', ':').replace(/\.svg$/, '');
const byPublicId = new Map(components.map(row => [publicKey(row), row.asset_id]));
assert.equal(catalog.length, 94);
assert.equal(byPublicId.size, 94);
assert.equal(new Set(catalog.map(row => row.id)).size, 94);
assert.deepEqual(new Set(catalog.map(row => row.id)), new Set(byPublicId.keys()));
assert.equal(manifests.length, 94);
assert.ok(manifests.every(row => row.status === 'ok' && row.pngBytes > 0));
assert.deepEqual(new Set(manifests.map(row => row.id)), new Set(byPublicId.keys()));
const assets = db.prepare('SELECT asset_id,drive_id,version,rights,review FROM assets').all();
const byDrive = new Map(assets.map(row => [row.drive_id,row]));
const queue = db.prepare('SELECT count(*) n FROM classification_queue').get().n;
assert.equal(byDrive.size, 325);
assert.equal(queue, 72);
if (privatePath) {
  const records = read(privatePath).records;
  assert.equal(records.length, 325);
  assert.equal(new Set(records.map(row => row.driveFileId)).size, 325);
  assert.equal(records.filter(row => row.reviewStatus === 'classified-unreviewed').length, 72);
  assert.ok(records.every(row => byDrive.has(row.driveFileId)));
}
console.log(JSON.stringify({ publicMatches:94, previewsInManifest:94, driveIndex:assets.length, pendingQueue:queue,
  privateMuseRowsCompared:privatePath ? 325 : 0 }, null, 2));
