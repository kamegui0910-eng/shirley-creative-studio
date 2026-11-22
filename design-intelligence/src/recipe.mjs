export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const hex = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const range = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

function dictionary(value, key, validate) {
  if (!record(value)) throw Error('Invalid theme map');
  const pairs = Object.entries(value);
  if (pairs.length > 32 || pairs.some(([name, item]) => !key.test(name) || !validate(item))) throw Error('Invalid theme value');
  return Object.fromEntries(pairs);
}

export function recipeDocument(body) {
  if (!record(body) || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120 ||
      !validId(body.style) || !hex(body.accent) || !Array.isArray(body.components) ||
      body.components.length < 1 || body.components.length > 12) throw Error('Invalid recipe');
  const components = body.components.map(item => {
    if (!validId(item?.assetId)) throw Error('Invalid component');
    if (item.layout === undefined) return { assetId: item.assetId };
    const { x, y, scale, rotation } = item.layout ?? {};
    if (!range(x,-1,2) || !range(y,-1,2) || !range(scale,0.05,8) || !range(rotation,-360,360)) throw Error('Invalid component layout');
    return { assetId: item.assetId, layout: { x,y,scale,rotation } };
  });
  const document = { title: body.title.trim(), style: body.style, accent: body.accent, components };
  if (body.layout !== undefined) {
    const { width, height, background } = body.layout ?? {};
    if (!Number.isInteger(width) || !range(width,64,2048) || !Number.isInteger(height) || !range(height,64,2048) ||
        (background !== undefined && !hex(background))) throw Error('Invalid canvas layout');
    document.layout = { width, height, ...(background === undefined ? {} : { background }) };
  }
  if (body.theme !== undefined) {
    if (!record(body.theme)) throw Error('Invalid theme');
    document.theme = {
      colors: dictionary(body.theme.colors ?? {}, /^[A-Za-z][\w-]{0,63}$/, hex),
      tokens: dictionary(body.theme.tokens ?? {}, /^--[A-Za-z][\w-]{0,63}$/, item =>
        typeof item === 'string' && /^[\w#.,%()+/ -]{1,100}$/.test(item) && !/url\s*\(/i.test(item))
    };
  }
  if (body.layers !== undefined) {
    if (!Array.isArray(body.layers) || body.layers.length !== components.length) throw Error('Invalid layers');
    const ids = new Set(), indices = new Set();
    document.layers = body.layers.map(layer => {
      const { id, componentIndex, opacity = 1, visible = true } = layer ?? {};
      if (!validId(id) || ids.has(id) || !Number.isInteger(componentIndex) || !range(componentIndex, 0, components.length-1) ||
          indices.has(componentIndex) || !range(opacity,0,1) || typeof visible !== 'boolean') throw Error('Invalid layer');
      ids.add(id); indices.add(componentIndex);
      return { id, componentIndex, opacity, visible };
    });
  }
  return document;
}
