import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const migrations = ['0001_index.sql', '0002_preview_cache.sql', '0003_recipe_search.sql'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assetId = id => 'a_' + hash(id).slice(0, 32);
const slug = value => /^[a-z][a-z0-9-]*$/.test(value) ? value : 't-' + hash(value).slice(0, 16);
const restricted = /(?:严禁|禁止|禁|不得|不允许)[\s／/、]*[转轉]载|(?:严禁|禁止|禁|不得|不允许)[\s／/、]*(?:二创|二次创作)|no[ -](?:repost|derivatives)/i;
const folders = { icons: 'icons 交互图标', frames: 'frames 边框面板', stickers: 'stickers 装饰贴纸' };

export function openIndex(path) {
  const db = new DatabaseSync(path);
  const tables = ['brands', 'preview_cache', 'recipe_versions'];
  db.exec('BEGIN');
  try {
    for (const [index, migration] of migrations.entries()) {
      const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(tables[index]);
      if (!exists) db.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

export function importIndex(db, input, cache, { tenant = 'studio', brand = 'shirley', batch = '2026-11-14' } = {}) {
  const read = id => {
    if (!/^[\w-]+$/.test(id)) throw Error('Invalid Drive ID');
    return readFileSync(join(input, id));
  };
  if (![tenant, brand].every(value => /^[\w-]{1,100}$/.test(value))) throw Error('Invalid import scope');
  const descriptionsPath = join(input, 'descriptions.json');
  const descriptions = existsSync(descriptionsPath) ? JSON.parse(readFileSync(descriptionsPath, 'utf8')) : {};
  const inventory = JSON.parse(readFileSync(join(input, 'inventory.json'), 'utf8'));
  const byId = new Map(inventory.map(row => [row.id, row]));
  const unique = (predicate, label) => {
    const matches = inventory.filter(predicate);
    if (matches.length !== 1) throw Error('Expected one Drive match for ' + label);
    return matches[0];
  };
  const load = row => JSON.parse(read(row.id));
  const mainFile = unique(row => row.area === 'ui' && / library-index\.json$/.test(row.path), 'main index');
  const studioFile = unique(row => row.path === 'studio-library-index.json', 'studio index');
  const main = load(mainFile);
  const studio = load(studioFile);
  const catalogFiles = inventory.filter(row => row.area === 'ui' && row.path.endsWith('/catalog.json'));
  const put = (table, values, conflict = 'ON CONFLICT DO NOTHING') =>
    db.prepare('INSERT INTO ' + table + ' VALUES (' + values.map(() => '?').join(',') + ') ' + conflict).run(...values);
  const scope = [tenant, brand];
  const saveSource = (id, kind, key, payload) =>
    put('asset_sources', [...scope, id, kind, key, JSON.stringify(payload)],
      'ON CONFLICT(tenant_id,brand_id,source_kind,source_key) DO UPDATE SET payload=excluded.payload');
  const tag = (id, axis, label) => {
    if (typeof label !== 'string' || !label.trim() || label.includes('待确认')) return;
    const key = slug(label);
    put(axis === 'style' ? 'styles' : 'categories', [key, label]);
    put('asset_tags', [...scope, id, axis === 'style' ? key : null, axis === 'category' ? key : null, axis + ':' + key]);
  };
  const add = (driveId, name, kind, version, review, rights, metadata) => {
    const id = assetId(driveId);
    if (!byId.has(driveId)) throw Error('Missing Drive file ' + driveId);
    const status = restricted.test(JSON.stringify([metadata, descriptions[driveId]])) ? 'restricted' : rights;
    put('assets', [...scope, id, driveId, name, kind, String(version ?? byId.get(driveId).modified_time ?? '1'), status, review, null],
      "ON CONFLICT(tenant_id,brand_id,asset_id) DO UPDATE SET version=excluded.version,name=excluded.name,rights=CASE WHEN assets.rights='restricted' OR excluded.rights='restricted' THEN 'restricted' WHEN assets.version<>excluded.version THEN excluded.rights ELSE assets.rights END,review=CASE WHEN assets.version<>excluded.version OR assets.review='pending' THEN excluded.review ELSE assets.review END,evidence=CASE WHEN assets.version<>excluded.version THEN NULL ELSE assets.evidence END");
    return id;
  };
  const variant = (id, kind, driveId, key, mime) => put('asset_variants',
    [...scope, id, id + ':' + kind, kind, driveId, key, mime],
    'ON CONFLICT(tenant_id,brand_id,variant_id) DO UPDATE SET cache_key=excluded.cache_key,drive_id=excluded.drive_id,mime_type=excluded.mime_type');
  const counts = { main: main.items.length, studio: studio.references.length, components: 0, thumbnails: 0, queued: 0, previews: 0 };
  const indexed = new Set();
  const importedVectors = new Set();
  db.exec('BEGIN IMMEDIATE');
  try {
    put('brands', [...scope, JSON.stringify({ name: 'Shirley', usage: 'internal-preview', commercialEvidenceRequired: true })]);
    for (const [i, row] of main.items.entries()) {
      indexed.add(row.driveFileId);
      const id = add(row.driveFileId, row.name, 'reference', null, 'indexed', 'reference_only', row);
      saveSource(id, 'main', String(i), row);
      tag(id, 'category', row.assetType === 'component' ? 'component-reference' : row.assetType);
      if (typeof row.output === 'string') {
        const explicitKit = row.output.match(/\b(pink-black-ins|pink-pixel-retro)\/catalog\.json\b/);
        if (explicitKit) tag(id, 'style', explicitKit[1]);
      }
    }
    for (const [i, row] of studio.references.entries()) {
      indexed.add(row.sourceFileId);
      const id = add(row.sourceFileId, row.name, 'reference', row.sourceModifiedTime, 'indexed', 'reference_only', row);
      saveSource(id, 'studio', String(i), row);
      tag(id, 'style', row.tags?.style);
      tag(id, 'category', row.tags?.cuisine);
      if (row.thumbnailFileId) {
        const thumb = byId.get(row.thumbnailFileId);
        if (!thumb) throw Error('Missing studio thumbnail ' + row.thumbnailFileId);
        indexed.add(thumb.id);
        variant(id, 'thumbnail', thumb.id, null, thumb.mime_type);
        counts.thumbnails++;
      }
    }
    for (const file of catalogFiles) {
      const catalog = load(file);
      const kitFolder = dirname(file.path);
      const style = catalog.kit;
      put('styles', [style, kitFolder.replace(/^\d+\s+/, '')], 'ON CONFLICT(id) DO UPDATE SET label=excluded.label');
      const cssFile = unique(row => row.path === kitFolder + '/kit.css', kitFolder + '/kit.css');
      const css = read(cssFile.id).toString().replace(/\/\*[\s\S]*?\*\//g, '');
      const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(([, key, value]) => [key, value.trim()]));
      put('palettes', [...scope, style, JSON.stringify(catalog.palette), JSON.stringify(tokens), cssFile.id,
        catalog.tokenSource ? JSON.stringify({ original: catalog.tokenSource, status: 'unresolved', replacement: 'kit.css' }) : null],
      'ON CONFLICT(tenant_id,brand_id,style_id) DO UPDATE SET colors=excluded.colors,tokens=excluded.tokens,token_source=excluded.token_source,token_compatibility=excluded.token_compatibility');
      for (const row of catalog.items) {
        const [folder, name, extra] = row.file.split('/');
        if (!Object.hasOwn(folders, folder) || !name || extra !== undefined) throw Error('Invalid Catalog path ' + row.file);
        const physical = kitFolder + '/' + folders[folder] + '/' + name;
        const vector = unique(item => item.path === physical, physical);
        if (importedVectors.has(vector.id)) throw Error('Duplicate Catalog vector ' + physical);
        importedVectors.add(vector.id);
        const id = add(vector.id, name, 'component', vector.modified_time ?? catalog.version, 'indexed', 'unverified', row);
        put('components', [...scope, id, row.file, physical, style]);
        tag(id, 'style', style);
        tag(id, 'category', row.category);
        saveSource(id, 'catalog', style + '/' + row.file, row);
        const references = Array.isArray(row.source) ? row.source : [...String(row.source).matchAll(/IMG_(\d+)(?:-(\d+))?/g)]
          .flatMap(([, start, end]) => Array.from({ length: Math.max(1, Math.min(100, Number(end ?? start) - Number(start) + 1)) }, (_, i) => 'IMG_' + (Number(start) + i)));
        for (const source of references) {
          const matches = inventory.filter(item => indexed.has(item.id) && basename(item.path, '.JPG').toUpperCase() === source.toUpperCase().replace(/\.JPG$/i, ''));
          if (matches.length === 1) put('asset_lineage', [...scope, id, assetId(matches[0].id), 'visual_reference']);
        }
        const bytes = read(vector.id);
        const svg = bytes.toString('utf8');
        if (!/<svg\b/.test(svg) || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<\s*(?:[\w-]+:)?(?:script|foreignObject|image)\b|\bon\w+\s*=|@import|\b(?:href|src)\s*=\s*["'](?!#)|url\(\s*(?!#)/i.test(svg)) {
          throw Error('Unsupported SVG content: ' + physical);
        }
        const key = tenant + '/' + brand + '/' + id + '/' + hash(bytes);
        const svgFile = join(cache, key + '.svg');
        const pngFile = join(cache, key + '.png');
        mkdirSync(dirname(svgFile), { recursive: true });
        if (!existsSync(svgFile)) writeFileSync(svgFile, bytes);
        if (!existsSync(pngFile)) {
          execFileSync('inkscape', [svgFile, '--export-width=256', '--export-filename=' + pngFile + '.tmp.png'], { stdio: 'ignore', timeout: 15000 });
          renameSync(pngFile + '.tmp.png', pngFile);
        }
        variant(id, 'vector', vector.id, key + '.svg', 'image/svg+xml');
        variant(id, 'preview', null, key + '.png', 'image/png');
        counts.components++;
        counts.previews++;
      }
    }
    if (inventory.filter(row => row.area === 'ui' && row.path.endsWith('.svg')).some(row => !importedVectors.has(row.id))) {
      throw Error('Drive vector missing from Catalog');
    }
    for (const row of inventory.filter(item => item.area === 'reference' && item.created_time?.startsWith(batch) && !indexed.has(item.id) && /^(image|video)\//.test(item.mime_type))) {
      const id = add(row.id, basename(row.path), 'reference', row.modified_time, 'pending', 'unverified', row);
      const media = row.mime_type.split('/')[0];
      tag(id, 'category', media);
      saveSource(id, 'drive-metadata', row.id, { ...row, description: descriptions[row.id] ?? null });
      put('classification_queue', [...scope, id, 'pending', JSON.stringify({ source: 'drive-metadata', verifiedMediaCategory: media, contentLabels: [] })]);
      counts.queued++;
    }
    for (const [key, value] of Object.entries({ 'drive-baseline': counts, 'local-manifest-159': { status: 'pending_reconciliation' } })) {
      put('sync_state', [...scope, key, JSON.stringify(value)], 'ON CONFLICT(tenant_id,brand_id,source) DO UPDATE SET state=excluded.state');
    }
    db.exec('COMMIT');
    return counts;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [input = '.local/input', database = '.local/index.sqlite', cache = '.local/cache'] = process.argv.slice(2);
  mkdirSync(dirname(database), { recursive: true });
  const db = openIndex(database);
  try {
    console.log(JSON.stringify(importIndex(db, input, cache), null, 2));
  } finally {
    db.close();
  }
}
