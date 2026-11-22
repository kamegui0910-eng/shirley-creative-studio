// Pure Design Recipe model (schema v2) with undo/redo history. DOM-free.
// Persisted shape == PUT /design-recipes/{id} body (src/worker.mjs parseRecipeV2). Limits here MUST match RECIPE_LIMITS there;
// tests/recipe-v2.contract.test.mjs enforces that every document produced here passes the server validator.
import { gridLayout } from '../canvas.mjs';

export const MAX_COMPONENTS = 12;
export const MAX_TEXTS = 12;
export const MAX_LAYERS = 40;
export const SCHEMA_VERSION = 2;
export const CANVAS_PRESETS = [
  { id: 'landscape', label: '横版 4:3（640×480）', width: 640, height: 480 },
  { id: 'xhs', label: '小红书 3:4（1080×1440）', width: 1080, height: 1440 },
  { id: 'square', label: '方形 1:1（1080×1080）', width: 1080, height: 1080 },
  { id: 'story', label: '竖版 9:16（1080×1920）', width: 1080, height: 1920 }
];

export class RecipeError extends Error {}

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const num = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const makeId = () => 'l' + (globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10) ?? Math.random().toString(36).slice(2, 12));

export const emptyTheme = () => ({ colors: {}, tokens: {} });

// `title`/`style`/`accent` match the v1 header; `components` is not stored (the server derives it from layers).
export const emptyRecipe = ({ style = '', accent = '#ffffff', title = '新设计', canvas = { width: 640, height: 480 } } = {}) => ({
  id: '', version: 0, title, style, accent, layout: 'grid',
  canvas: { width: canvas.width, height: canvas.height, background: null }, theme: emptyTheme(), layers: []
});

export const componentLayers = recipe => recipe.layers.filter(layer => layer.type === 'component');
export const textLayers = recipe => recipe.layers.filter(layer => layer.type === 'text');

/* ---------- layer constructors ---------- */
const base = (id, type) => ({ id, type, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, visible: true, locked: false });

export const componentLayer = ({ assetId, name }, id = makeId()) =>
  ({ ...base(id, 'component'), assetId, name: name ?? undefined, w: 0, h: 0, colors: {} });

export function textLayer(recipe, { text = '新文字', color = '#222222' } = {}, id = makeId()) {
  const { width, height } = recipe.canvas;
  const offset = textLayers(recipe).length * Math.round(Math.min(width, height) / 12);
  return {
    ...base(id, 'text'), x: round(width / 2), y: round(height * 0.14 + offset), text, name: text.slice(0, 12),
    fontSize: Math.round(clamp(Math.min(width, height) / 10, 8, 400)), color, weight: 'bold', align: 'center'
  };
}

/* ---------- layout ---------- */
export function gridRects(recipe) {
  const { width, height } = recipe.canvas;
  return gridLayout(componentLayers(recipe).length, width, height);
}

// Component layers carry concrete x/y/w/h for storage; in grid mode those are recomputed from the grid.
function withGeometry(recipe) {
  if (recipe.layout !== 'grid') return recipe.layers;
  const cells = gridRects(recipe);
  let next = 0;
  return recipe.layers.map(layer => {
    if (layer.type !== 'component') return layer;
    const r = cells[next++];
    return { ...layer, x: round(r.x + r.w / 2), y: round(r.y + r.h / 2), w: round(r.w), h: round(r.h) };
  });
}

// Freeze the automatic arrangement into explicit positions (used when the user starts dragging).
export const toFreeLayout = recipe => recipe.layout === 'free' ? recipe : { ...recipe, layout: 'free', layers: withGeometry(recipe) };
export const toGridLayout = recipe => ({ ...recipe, layout: 'grid' });

function placeNew(recipe, layer) {
  if (recipe.layout === 'grid' || layer.type !== 'component') return layer;
  const { width, height } = recipe.canvas;
  const side = round(Math.min(width, height) / 3);
  const n = componentLayers(recipe).length;
  const step = Math.round(Math.min(width, height) / 20);
  return { ...layer, w: side, h: side, x: round(width / 2 + (n % 6) * step), y: round(height / 2 + (n % 6) * step) };
}

/* ---------- structural edits ---------- */
function limits(recipe, type) {
  if (recipe.layers.length >= MAX_LAYERS) throw new RecipeError('图层最多 ' + MAX_LAYERS + ' 个');
  if (type === 'component' && componentLayers(recipe).length >= MAX_COMPONENTS) throw new RecipeError('配方最多可添加 ' + MAX_COMPONENTS + ' 个组件');
  if (type === 'text' && textLayers(recipe).length >= MAX_TEXTS) throw new RecipeError('文字图层最多 ' + MAX_TEXTS + ' 个');
}

export function addLayer(recipe, layer) {
  limits(recipe, layer.type);
  return { ...recipe, layers: [...recipe.layers, placeNew(recipe, layer)] };
}
export const addComponent = (recipe, component, id) => addLayer(recipe, componentLayer(component, id));

function check(recipe, index) {
  if (!Number.isInteger(index) || index < 0 || index >= recipe.layers.length) throw new RecipeError('图层位置无效');
}

// Replacing keeps the instance's transform, opacity and per-layer colors; only the asset changes.
export function replaceComponent(recipe, index, component) {
  check(recipe, index);
  if (recipe.layers[index].type !== 'component') throw new RecipeError('只能替换组件图层');
  if (recipe.layers[index].locked) throw new RecipeError('图层已锁定');
  return { ...recipe, layers: recipe.layers.map((l, i) => i === index ? { ...l, assetId: component.assetId, name: component.name } : l) };
}

export function removeLayer(recipe, index) {
  check(recipe, index);
  return { ...recipe, layers: recipe.layers.filter((_, i) => i !== index) };
}
export const removeComponent = removeLayer;

export function duplicateLayer(recipe, index, id = makeId()) {
  check(recipe, index);
  limits(recipe, recipe.layers[index].type);
  const source = recipe.layers[index];
  const shift = recipe.layout === 'free' || source.type === 'text' ? Math.round(Math.min(recipe.canvas.width, recipe.canvas.height) / 25) : 0;
  const copy = { ...source, id, x: round(source.x + shift), y: round(source.y + shift), locked: false };
  if (source.colors) copy.colors = { ...source.colors };
  const layers = [...recipe.layers];
  layers.splice(index + 1, 0, copy);
  return { ...recipe, layers };
}
export const duplicateComponent = duplicateLayer;

// Later layers are drawn on top. Returns the recipe and the moved layer's new index.
export function moveLayer(recipe, index, delta) {
  check(recipe, index);
  const target = index + delta;
  if (target < 0 || target >= recipe.layers.length) return { recipe, index };
  const layers = [...recipe.layers];
  [layers[index], layers[target]] = [layers[target], layers[index]];
  return { recipe: { ...recipe, layers }, index: target };
}
export const moveComponent = moveLayer;

const TRANSFORM = ['x', 'y', 'w', 'h', 'scale', 'rotation', 'text', 'fontSize', 'weight', 'align'];
export function clampLayer(layer) {
  const out = { ...layer };
  out.x = round(clamp(num(out.x, 0), -8192, 8192));
  out.y = round(clamp(num(out.y, 0), -8192, 8192));
  out.scale = round(clamp(num(out.scale, 1), 0.05, 20), 3);
  out.rotation = round(((num(out.rotation, 0) + 180) % 360 + 360) % 360 - 180, 1);
  out.opacity = round(clamp(num(out.opacity, 1), 0, 1), 2);
  if (out.type === 'component') { out.w = round(clamp(num(out.w, 0), 0, 8192)); out.h = round(clamp(num(out.h, 0), 0, 8192)); }
  else out.fontSize = Math.round(clamp(num(out.fontSize, 32), 8, 400));
  return out;
}

export function updateLayer(recipe, index, patch) {
  check(recipe, index);
  const layer = recipe.layers[index];
  if (layer.locked && Object.keys(patch).some(key => TRANSFORM.includes(key))) throw new RecipeError('图层已锁定，先解锁再编辑');
  if (patch.text !== undefined && (!patch.text.length || patch.text.length > 500)) throw new RecipeError('文字需为 1–500 字');
  if (patch.color !== undefined && !HEX.test(patch.color)) throw new RecipeError('颜色格式无效');
  const next = clampLayer({ ...layer, ...patch });
  if (layer.type === 'text' && patch.text !== undefined && (layer.name ?? '') === layer.text.slice(0, 12)) next.name = patch.text.slice(0, 12);
  return { ...recipe, layers: recipe.layers.map((l, i) => i === index ? next : l) };
}

// Changing canvas size keeps the composition: positions scale per axis, sizes by the smaller ratio.
export function setCanvas(recipe, { width, height, background }) {
  const w = Math.round(clamp(num(width, recipe.canvas.width), 64, 4096));
  const h = Math.round(clamp(num(height, recipe.canvas.height), 64, 4096));
  const rx = w / recipe.canvas.width, ry = h / recipe.canvas.height, rs = Math.min(rx, ry);
  const layers = recipe.layers.map(layer => clampLayer({
    ...layer, x: layer.x * rx, y: layer.y * ry,
    ...(layer.type === 'component' ? { w: layer.w * rs, h: layer.h * rs } : { fontSize: layer.fontSize * rs })
  }));
  const bg = background === undefined ? recipe.canvas.background : background;
  return { ...recipe, canvas: { width: w, height: h, background: bg === null || HEX.test(bg) ? bg : recipe.canvas.background }, layers };
}

export const withTheme = (recipe, theme, accent) => ({ ...recipe, theme, accent: accent ?? recipe.accent });

/* ---------- validation & serialization ---------- */
export function validate(recipe) {
  const problems = [];
  if (!recipe.title.trim()) problems.push('请填写配方名称');
  if (recipe.title.trim().length > 120) problems.push('名称不能超过 120 字');
  if (!recipe.style) problems.push('请先选择风格');
  if (!recipe.layers.length) problems.push('画布为空，请至少添加一个图层');
  if (!HEX.test(recipe.accent)) problems.push('主色格式无效');
  return problems;
}

export function toPayload(recipe) {
  const layers = withGeometry(recipe).map(layer => {
    const { name, ...rest } = layer;
    const out = layer.type === 'component'
      ? { ...rest, w: Math.max(1, rest.w), h: Math.max(1, rest.h), colors: { ...layer.colors } } : { ...rest };
    if (name) out.name = name;
    return out;
  });
  return {
    schemaVersion: SCHEMA_VERSION, version: recipe.version, title: recipe.title.trim(), style: recipe.style, accent: recipe.accent,
    layout: recipe.layout, canvas: { ...recipe.canvas }, theme: { colors: { ...recipe.theme.colors }, tokens: { ...recipe.theme.tokens } }, layers
  };
}

// Everything that is persisted except the version: equal fingerprints mean "nothing to save".
export function fingerprint(recipe) {
  const { version, ...rest } = toPayload(recipe);
  void version;
  return JSON.stringify(rest, (key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1)) : value);
}

function sanitizeLayer(raw, used) {
  if (!raw || typeof raw !== 'object') return null;
  let id = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) && !used.has(raw.id) ? raw.id : makeId();
  while (used.has(id)) id = makeId();
  const common = {
    id, type: raw.type, x: num(raw.x, 0), y: num(raw.y, 0), scale: num(raw.scale, 1), rotation: num(raw.rotation, 0), opacity: num(raw.opacity, 1),
    visible: raw.visible !== false, locked: raw.locked === true
  };
  if (typeof raw.name === 'string' && raw.name.length <= 120 && raw.name) common.name = raw.name;
  if (raw.type === 'component') {
    if (typeof raw.assetId !== 'string' || !/^[\w-]{1,100}$/.test(raw.assetId)) return null;
    const colors = Object.fromEntries(Object.entries(raw.colors ?? {}).filter(([k, v]) => /^[\w-]{1,40}$/.test(k) && HEX.test(v)).slice(0, 16).map(([k, v]) => [k, v.toLowerCase()]));
    used.add(id);
    return clampLayer({ ...common, assetId: raw.assetId, w: num(raw.w, 0), h: num(raw.h, 0), colors });
  }
  if (raw.type === 'text') {
    if (typeof raw.text !== 'string' || !raw.text.length || raw.text.length > 500) return null;
    used.add(id);
    return clampLayer({ ...common, text: raw.text, fontSize: num(raw.fontSize, 32), color: HEX.test(raw.color) ? raw.color.toLowerCase() : '#222222',
      weight: raw.weight === 'normal' ? 'normal' : 'bold', align: ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'center' });
  }
  return null;
}

const sanitizeColors = (map, pattern, max) => Object.fromEntries(Object.entries(map && typeof map === 'object' ? map : {})
  .filter(([k, v]) => pattern.test(k) && HEX.test(v)).slice(0, max).map(([k, v]) => [k, v.toLowerCase()]));

// Tolerant reader for untrusted stored data (drafts, local history) and for v1 documents ({components} only).
export function sanitizeRecipe(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.style !== 'string' || !/^[\w-]{1,100}$/.test(raw.style)) return null;
  const canvas = {
    width: Math.round(clamp(num(raw.canvas?.width, 640), 64, 4096)), height: Math.round(clamp(num(raw.canvas?.height, 480), 64, 4096)),
    background: HEX.test(raw.canvas?.background) ? raw.canvas.background.toLowerCase() : null
  };
  const recipe = {
    id: typeof raw.id === 'string' && /^[\w-]{1,100}$/.test(raw.id) ? raw.id : '', version: Number.isSafeInteger(raw.version) && raw.version >= 0 ? raw.version : 0,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : '新设计', style: raw.style, accent: HEX.test(raw.accent) ? raw.accent.toLowerCase() : '#ffffff',
    layout: raw.layout === 'free' ? 'free' : 'grid', canvas,
    theme: { colors: sanitizeColors(raw.theme?.colors, /^[\w-]{1,40}$/, 32), tokens: sanitizeColors(raw.theme?.tokens, /^--[\w-]{1,60}$/, 64) }, layers: []
  };
  const used = new Set();
  const source = Array.isArray(raw.layers) ? raw.layers : Array.isArray(raw.components) ? raw.components.map(c => ({ ...c, type: 'component' })) : [];
  const counts = { component: 0, text: 0 };
  for (const item of source) {
    const layer = sanitizeLayer(item, used);
    if (!layer || recipe.layers.length >= MAX_LAYERS || counts[layer.type] >= (layer.type === 'component' ? MAX_COMPONENTS : MAX_TEXTS)) continue;
    counts[layer.type]++;
    recipe.layers.push(layer);
  }
  return recipe;
}

// Server result -> editor recipe. v1 documents (no layers) open as an automatic grid with identical content.
export function fromResult(result, names = new Map()) {
  const doc = result.document;
  const recipe = sanitizeRecipe({ ...doc, id: result.id, version: result.version, layout: doc.schemaVersion === 2 ? doc.layout : 'grid' });
  if (!recipe) throw new RecipeError('配方内容无法识别');
  recipe.layers = recipe.layers.map(layer => layer.type === 'component' && !layer.name && names.has(layer.assetId) ? { ...layer, name: names.get(layer.assetId) } : layer);
  recipe.layers = withGeometry(recipe);
  return recipe;
}

/* ---------- history ---------- */
export const createHistory = present => ({ past: [], present, future: [], key: null });

export function commit(history, next, coalesce = null) {
  if (next === history.present) return history;
  if (coalesce && history.key === coalesce) return { ...history, present: next, future: [] };
  return { past: [...history.past.slice(-99), history.present], present: next, future: [], key: coalesce };
}
// id and version identify the saved recipe, not its content: undo/redo must never roll them back,
// otherwise undoing past the first save would turn the next save into a brand-new recipe.
const keepIdentity = (snapshot, current) => ({ ...snapshot, id: current.id, version: current.version });
export function undo(history) {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: keepIdentity(history.past.at(-1), history.present), future: [history.present, ...history.future], key: null };
}
export function redo(history) {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: keepIdentity(history.future[0], history.present), future: history.future.slice(1), key: null };
}
export const reset = present => createHistory(present);

export const HISTORY_STORE_LIMIT = 30;
export const packHistory = (history, limit = HISTORY_STORE_LIMIT) =>
  ({ past: history.past.slice(-limit), present: history.present, future: history.future.slice(0, limit) });

export function unpackHistory(raw) {
  const present = sanitizeRecipe(raw?.present);
  if (!present) return null;
  const list = items => (Array.isArray(items) ? items : []).map(sanitizeRecipe).filter(Boolean);
  return { past: list(raw.past).slice(-HISTORY_STORE_LIMIT), present, future: list(raw.future).slice(0, HISTORY_STORE_LIMIT), key: null };
}
