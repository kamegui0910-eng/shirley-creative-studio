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
    if (size > 16384) {
      await reader.cancel();
      throw Error('Body too large');
    }
    body += decoder.decode(value, { stream: true });
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
        const object = row?.cache_key && env.CACHE && await env.CACHE.get(row.cache_key);
        if (!object) return failure('Preview unavailable', 404);
        return new Response(object.body, { headers: {
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

  const recipe = path.match(/^\/design-recipes\/([\w-]{1,100})(\/publication-check)?$/);
  if (!recipe) return failure('Route not found', 404);
  const [, id, publication] = recipe;
  const readRecipe = () => one('SELECT * FROM design_recipes WHERE ' + where + ' AND id=?', ...keys, id);
  if (request.method === 'GET') {
    const row = await readRecipe();
    if (!row) return failure('Recipe not found', 404);
    const result = recipeView(row);
    if (!publication) return json(result);
    const blockers = [];
    for (const component of result.document.components) {
      const asset = await getAsset(component.assetId);
      if (asset?.rights !== 'commercial_ready' || asset.review !== 'approved' || !asset.evidence?.trim()) blockers.push(component.assetId);
    }
    return json({ allowed: blockers.length === 0, blockers });
  }
  if (request.method !== 'PUT' || publication) return failure('Method not allowed', 405);
  if (scope.write !== true) return failure('Write forbidden', 403);
  let body;
  try { body = await boundedJSON(request); } catch { return failure('Invalid recipe body', 400); }
  if (!body || !Number.isSafeInteger(body.version) || body.version < 0 || typeof body.title !== 'string' ||
      body.title.length < 1 || body.title.length > 120 || !validId(body.style) || !Array.isArray(body.components) ||
      body.components.length < 1 || body.components.length > 12 || !/^#[a-f0-9]{6}$/i.test(body.accent)) return failure('Invalid recipe', 400);
  const components = [];
  for (const item of body.components) {
    if (!validId(item?.assetId)) return failure('Invalid component', 400);
    const row = await one('SELECT 1 FROM components WHERE ' + where + ' AND asset_id=? AND style_id=?', ...keys, item.assetId, body.style);
    if (!row) return failure('Component not found in style', 404);
    components.push({ assetId: item.assetId });
  }
  const document = JSON.stringify({ title: body.title, style: body.style, accent: body.accent, components });
  const now = new Date().toISOString();
  const saved = body.version === 0
    ? await one('INSERT INTO design_recipes VALUES (?,?,?,1,?,?) ON CONFLICT DO NOTHING RETURNING *', ...keys, id, document, now)
    : await one('UPDATE design_recipes SET version=version+1,document=?,updated_at=? WHERE ' + where + ' AND id=? AND version=? RETURNING *', document, now, ...keys, id, body.version);
  return saved ? json(recipeView(saved), body.version === 0 ? 201 : 200) : failure('Recipe version conflict', 409);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (['/', '/index.html', '/app.mjs', '/canvas.mjs', '/style.css'].includes(url.pathname)) return env.STATIC.fetch(request);
      const scope = await authorize(request, env);
      if (!scope) return failure('Authentication required', 401);
      return await route(request, env, url, scope);
    } catch (error) {
      console.error({ event: 'design_api_error', name: error.name });
      return failure('Design API error', 500);
    }
  }
};
