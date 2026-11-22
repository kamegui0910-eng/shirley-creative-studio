const rights = ['reference_only', 'unverified', 'restricted', 'commercial_ready'];
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (message, status) => json({ error: message }, status);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export async function tokenDigest(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authorize(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([\w.-]{16,512})$/i)?.[1];
  if (!token || !env.DESIGN_PRINCIPALS) return null;
  const principals = JSON.parse(env.DESIGN_PRINCIPALS);
  const digest = await tokenDigest(token);
  const scope = Object.hasOwn(principals, digest) ? principals[digest] : null;
  return validId(scope?.tenantId) && validId(scope?.brandId) ? scope : null;
}

async function boundedJSON(request) {
  if (!request.body) throw Error('Body required');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(body + decoder.decode());
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw Error('Body too large');
    }
    body += decoder.decode(value, { stream: true });
  }
}

// ---- Recipe document schema v2 (additive; v1 documents and v1 PUT bodies stay valid) ----
// v2 adds canvas, layout mode, theme and an ordered layer list. `components` is derived from component
// layers (unique assetIds, layer order) so v1 readers and publication-check keep working unchanged.
const HEX = /^#[a-f0-9]{6}$/i;
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const plainText = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const colorMap = (value, keyPattern, max) => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('colors');
  const entries = Object.entries(value);
  if (entries.length > max) throw Error('colors');
  for (const [key, color] of entries) if (!keyPattern.test(key) || !HEX.test(color)) throw Error('colors');
  return Object.fromEntries(entries.map(([key, color]) => [key, color.toLowerCase()]));
};
export const RECIPE_LIMITS = { layers: 40, components: 12, texts: 12 };

export function parseRecipeV2(body) {
  try {
    if (body.schemaVersion !== 2) throw Error('schemaVersion');
    if (!plainText(body.title, 1, 120) || !validId(body.style) || !HEX.test(body.accent)) throw Error('header');
    const canvas = body.canvas;
    if (!canvas || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 64 || canvas.width > 4096 ||
        canvas.height < 64 || canvas.height > 4096 || !(canvas.background === null || HEX.test(canvas.background))) throw Error('canvas');
    if (!['grid', 'free'].includes(body.layout)) throw Error('layout');
    const theme = { colors: colorMap(body.theme?.colors, /^[\w-]{1,40}$/, 32), tokens: colorMap(body.theme?.tokens, /^--[\w-]{1,60}$/, 64) };
    if (!Array.isArray(body.layers) || body.layers.length < 1 || body.layers.length > RECIPE_LIMITS.layers) throw Error('layers');
    const ids = new Set();
    const counts = { component: 0, text: 0 };
    const layers = body.layers.map(layer => {
      if (!layer || typeof layer !== 'object' || !validId(layer.id) || layer.id.length > 40 || ids.has(layer.id)) throw Error('layer');
      ids.add(layer.id);
      if (!Object.hasOwn(counts, layer.type)) throw Error('layer type');
      counts[layer.type]++;
      if (!finite(layer.x, -8192, 8192) || !finite(layer.y, -8192, 8192) || !finite(layer.scale, 0.05, 20) ||
          !finite(layer.rotation, -360, 360) || !finite(layer.opacity, 0, 1) || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') throw Error('transform');
      if (layer.name !== undefined && !plainText(layer.name, 0, 120)) throw Error('name');
      const common = { id: layer.id, type: layer.type, x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, opacity: layer.opacity, visible: layer.visible, locked: layer.locked };
      if (layer.name) common.name = layer.name;
      if (layer.type === 'component') {
        if (!validId(layer.assetId) || !finite(layer.w, 1, 8192) || !finite(layer.h, 1, 8192)) throw Error('component');
        return { ...common, assetId: layer.assetId, w: layer.w, h: layer.h, colors: colorMap(layer.colors, /^[\w-]{1,40}$/, 16) };
      }
      if (!plainText(layer.text, 1, 500) || !finite(layer.fontSize, 8, 400) || !HEX.test(layer.color) ||
          !['normal', 'bold'].includes(layer.weight) || !['left', 'center', 'right'].includes(layer.align)) throw Error('text');
      return { ...common, text: layer.text, fontSize: layer.fontSize, color: layer.color.toLowerCase(), weight: layer.weight, align: layer.align };
    });
    if (counts.component > RECIPE_LIMITS.components || counts.text > RECIPE_LIMITS.texts) throw Error('limits');
    const components = [...new Set(layers.filter(layer => layer.type === 'component').map(layer => layer.assetId))].map(assetId => ({ assetId }));
    return { document: { schemaVersion: 2, title: body.title, style: body.style, accent: body.accent.toLowerCase(), canvas: { width: canvas.width, height: canvas.height, background: canvas.background === null ? null : canvas.background.toLowerCase() }, layout: body.layout, theme, layers, components } };
  } catch (error) {
    return { error: error.message };
  }
}

const recipeView = row => ({ id: row.id, version: row.version, updatedAt: row.updated_at, document: JSON.parse(row.document) });
const assetColumns = 'a.asset_id AS assetId, a.name, a.drive_id AS driveFileId, a.version, a.kind, a.rights, a.review';

async function route(request, env, url, scope) {
  const { pathname: path, searchParams: params } = url;
  const { tenantId, brandId } = scope;
  const keys = [tenantId, brandId];
  const select = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  const all = async (sql, ...args) => (await select(sql, ...args).all()).results;
  const one = (sql, ...args) => select(sql, ...args).first();
  const where = 'tenant_id=? AND brand_id=?';
  const getAsset = id => one('SELECT ' + assetColumns + ', a.evidence FROM assets a WHERE a.tenant_id=? AND a.brand_id=? AND a.asset_id=?', ...keys, id);
  if (params.has('tenantId') && params.get('tenantId') !== tenantId || params.has('brandId') && params.get('brandId') !== brandId) {
    return failure('Scope forbidden', 403);
  }
  if (request.method === 'GET') {
    if (path === '/session') return json({ tenantId, brandId, write: scope.write === true });
    if (path === '/styles') {
      const rows = await all('SELECT DISTINCT s.id,s.label,p.colors,p.tokens,p.token_compatibility FROM styles s JOIN asset_tags t ON t.style_id=s.id LEFT JOIN palettes p ON p.style_id=s.id AND p.tenant_id=t.tenant_id AND p.brand_id=t.brand_id WHERE t.tenant_id=? AND t.brand_id=? ORDER BY s.label', ...keys);
      return json({ items: rows.map(row => ({ id: row.id, label: row.label, colors: JSON.parse(row.colors), tokens: JSON.parse(row.tokens), tokenCompatibility: JSON.parse(row.token_compatibility) })) });
    }
    if (path === '/categories') {
      const style = params.get('style');
      const filter = style ? ' AND EXISTS (SELECT 1 FROM asset_tags s WHERE s.tenant_id=t.tenant_id AND s.brand_id=t.brand_id AND s.asset_id=t.asset_id AND s.style_id=?)' : '';
      return json({ items: await all('SELECT DISTINCT c.id,c.label FROM categories c JOIN asset_tags t ON c.id=t.category_id WHERE t.tenant_id=? AND t.brand_id=?' + filter + ' ORDER BY c.label', ...keys, ...(style ? [style] : [])) });
    }
    if (path === '/assets/search') {
      const limit = Number(params.get('limit') ?? 24);
      const cursor = params.get('cursor') ?? '';
      const kind = params.get('kind');
      const right = params.get('rights');
      const term = params.get('q') ?? '';
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || cursor && !validId(cursor) ||
          right && !rights.includes(right) || kind && !['component', 'reference'].includes(kind) || term.length > 150) return failure('Invalid filter', 400);
      const clauses = ['a.tenant_id=?', 'a.brand_id=?', 'a.asset_id>?'];
      const bindings = [...keys, cursor];
      for (const [param, column] of [['style', 'style_id'], ['category', 'category_id']]) {
        const values = [...new Set(params.getAll(param))];
        if (values.length > 10 || values.some(value => !validId(value))) return failure('Invalid taxonomy filter', 400);
        if (!values.length) continue;
        clauses.push('EXISTS (SELECT 1 FROM asset_tags t WHERE t.tenant_id=a.tenant_id AND t.brand_id=a.brand_id AND t.asset_id=a.asset_id AND t.' + column + ' IN (' + values.map(() => '?').join(',') + '))');
        bindings.push(...values);
      }
      for (const [value, clause] of [[kind, 'a.kind=?'], [right, 'a.rights=?'], [term, 'instr(lower(a.name),lower(?))>0']]) {
        if (value) { clauses.push(clause); bindings.push(value); }
      }
      const rows = await all('SELECT ' + assetColumns + ', EXISTS (SELECT 1 FROM asset_variants v WHERE v.tenant_id=a.tenant_id AND v.brand_id=a.brand_id AND v.asset_id=a.asset_id AND v.kind=\'preview\') AS hasPreview FROM assets a WHERE ' + clauses.join(' AND ') + ' ORDER BY a.asset_id LIMIT ?', ...bindings, limit + 1);
      const items = rows.slice(0, limit).map(row => ({ ...row, hasPreview: Boolean(row.hasPreview) }));
      return json({ items, nextCursor: rows.length > limit ? items.at(-1).assetId : null });
    }
    const asset = path.match(/^\/assets\/([\w-]+)(?:\/(preview|vector))?$/);
    if (asset) {
      const [, id, variant] = asset;
      const record = await getAsset(id);
      if (!record) return failure('Asset not found', 404);
      if (variant) {
        const row = await one('SELECT cache_key,mime_type FROM asset_variants WHERE ' + where + ' AND asset_id=? AND kind=?', ...keys, id, variant);
        if (!row?.cache_key) return failure('Preview unavailable', 404);
        const object = env.CACHE && await env.CACHE.get(row.cache_key);
        let body = object?.body;
        if (!body && env.DESIGN_D1_CACHE === 'enabled') {
          const cached = await one('SELECT content_base64 FROM preview_cache WHERE ' + where + ' AND cache_key=?', ...keys, row.cache_key);
          if (cached) body = Uint8Array.from(atob(cached.content_base64), character => character.charCodeAt(0));
        }
        if (!body) return failure('Preview unavailable', 404);
        return new Response(body, { headers: {
          'Content-Type': row.mime_type, 'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'"
        } });
      }
      const tags = await all('SELECT style_id,category_id FROM asset_tags WHERE ' + where + ' AND asset_id=?', ...keys, id);
      const variants = await all('SELECT kind,drive_id AS driveFileId FROM asset_variants WHERE ' + where + ' AND asset_id=?', ...keys, id);
      const sources = await all('SELECT source_kind AS kind,payload FROM asset_sources WHERE ' + where + ' AND asset_id=? ORDER BY source_kind,source_key', ...keys, id);
      const lineage = await all('SELECT source_id AS assetId,relation FROM asset_lineage WHERE ' + where + ' AND asset_id=?', ...keys, id);
      return json({ ...record, styles: tags.map(row => row.style_id).filter(Boolean), categories: tags.map(row => row.category_id).filter(Boolean), variants, lineage,
        sources: sources.map(row => ({ ...row, payload: JSON.parse(row.payload) })) });
    }
    const brand = path.match(/^\/brands\/([\w-]+)\/design-rules$/);
    if (brand) {
      if (brand[1] !== brandId) return failure('Brand not found', 404);
      const row = await one('SELECT rules FROM brands WHERE ' + where, ...keys);
      return row ? json({ tenantId, brandId, rules: JSON.parse(row.rules) }) : failure('Brand not found', 404);
    }
  }

  const recipe = path.match(/^\/design-recipes\/([\w-]{1,100})(\/publication-check|\/revisions(?:\/(\d{1,9}))?)?$/);
  if (!recipe) return failure('Route not found', 404);
  const [, id, suffix, revision] = recipe;
  const publication = suffix === '/publication-check';
  const revisions = suffix?.startsWith('/revisions');
  if (revisions && env.DESIGN_REVISIONS !== 'enabled') return failure('Route not found', 404);
  const readRecipe = () => one('SELECT * FROM design_recipes WHERE ' + where + ' AND id=?', ...keys, id);
  if (request.method === 'GET') {
    const row = await readRecipe();
    if (!row) return failure('Recipe not found', 404);
    if (revisions) {
      if (revision === undefined) {
        const rows = await all('SELECT version,updated_at,json_extract(document,\'$.title\') AS title FROM design_recipe_revisions WHERE ' + where + ' AND id=? ORDER BY version DESC LIMIT 50', ...keys, id);
        return json({ items: rows.map(item => ({ version: item.version, updatedAt: item.updated_at, title: item.title })) });
      }
      const old = await one('SELECT * FROM design_recipe_revisions WHERE ' + where + ' AND id=? AND version=?', ...keys, id, Number(revision));
      return old ? json(recipeView(old)) : failure('Revision not found', 404);
    }
    const result = recipeView(row);
    if (!publication) return json(result);
    const blockers = [];
    for (const component of result.document.components) {
      const asset = await getAsset(component.assetId);
      if (asset?.rights !== 'commercial_ready' || asset.review !== 'approved' || !asset.evidence?.trim()) blockers.push(component.assetId);
    }
    return json({ allowed: blockers.length === 0, blockers });
  }
  if (request.method !== 'PUT' || suffix) return failure('Method not allowed', 405);
  if (scope.write !== true) return failure('Write forbidden', 403);
  let body;
  try { body = await boundedJSON(request); } catch { return failure('Invalid recipe body', 400); }
  if (!body || typeof body !== 'object' || !Number.isSafeInteger(body.version) || body.version < 0) return failure('Invalid recipe', 400);
  let document;
  if (body.schemaVersion === undefined) {
    if (typeof body.title !== 'string' ||
        body.title.length < 1 || body.title.length > 120 || !validId(body.style) || !Array.isArray(body.components) ||
        body.components.length < 1 || body.components.length > 12 || !/^#[a-f0-9]{6}$/i.test(body.accent)) return failure('Invalid recipe', 400);
    const components = [];
    for (const item of body.components) {
      if (!validId(item?.assetId)) return failure('Invalid component', 400);
      const row = await one('SELECT 1 FROM components WHERE ' + where + ' AND asset_id=? AND style_id=?', ...keys, item.assetId, body.style);
      if (!row) return failure('Component not found in style', 404);
      components.push({ assetId: item.assetId });
    }
    document = JSON.stringify({ title: body.title, style: body.style, accent: body.accent, components });
  } else {
    const parsed = parseRecipeV2(body);
    if (parsed.error) return failure('Invalid recipe', 400);
    for (const item of parsed.document.components) {
      const row = await one('SELECT 1 FROM components WHERE ' + where + ' AND asset_id=? AND style_id=?', ...keys, item.assetId, body.style);
      if (!row) return failure('Component not found in style', 404);
    }
    document = JSON.stringify(parsed.document);
  }
  const now = new Date().toISOString();
  const saved = body.version === 0
    ? await one('INSERT INTO design_recipes VALUES (?,?,?,1,?,?) ON CONFLICT DO NOTHING RETURNING *', ...keys, id, document, now)
    : await one('UPDATE design_recipes SET version=version+1,document=?,updated_at=? WHERE ' + where + ' AND id=? AND version=? RETURNING *', document, now, ...keys, id, body.version);
  if (saved && env.DESIGN_REVISIONS === 'enabled') {
    try { await select('INSERT OR IGNORE INTO design_recipe_revisions VALUES (?,?,?,?,?,?)', ...keys, id, saved.version, saved.document, saved.updated_at).run(); }
    catch { console.error({ event: 'design_revision_error' }); }
  }
  return saved ? json(recipeView(saved), body.version === 0 ? 201 : 200) : failure('Recipe version conflict', 409);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (['/', '/index.html', '/app.mjs', '/canvas.mjs', '/style.css'].includes(url.pathname) || /^\/ui\/[\w-]+\.mjs$/.test(url.pathname)) return env.STATIC.fetch(request);
      const scope = await authorize(request, env);
      if (!scope) return failure('Authentication required', 401);
      return await route(request, env, url, scope);
    } catch (error) {
      console.error({ event: 'design_api_error', name: error.name });
      return failure('Design API error', 500);
    }
  }
};
