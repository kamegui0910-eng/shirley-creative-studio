// Pure Design Recipe model with undo/redo. Persisted shape matches PUT /design-recipes/{id}:
// { title, style, accent, components: [{assetId}], version }. Names are display-only.

export const MAX_COMPONENTS = 12;

export class RecipeError extends Error {}

// `theme` holds local color/token overrides. It travels with undo/redo but is not part of the server payload;
// only `accent` (the primary palette color) is persisted.
export const emptyRecipe = ({ style = '', accent = '#ffffff', title = '新设计' } = {}) =>
  ({ id: '', version: 0, title, style, accent, components: [], theme: { colors: {}, tokens: {} } });

export const withTheme = (recipe, theme, accent) => ({ ...recipe, theme, accent: accent ?? recipe.accent });

export function fingerprint(recipe) {
  return JSON.stringify([recipe.title.trim(), recipe.style, recipe.accent, recipe.components.map(c => c.assetId)]);
}

export function addComponent(recipe, component) {
  if (recipe.components.length >= MAX_COMPONENTS) throw new RecipeError('配方最多可添加 ' + MAX_COMPONENTS + ' 个组件');
  return { ...recipe, components: [...recipe.components, component] };
}

function check(recipe, index) {
  if (!Number.isInteger(index) || index < 0 || index >= recipe.components.length) throw new RecipeError('组件位置无效');
}

export function replaceComponent(recipe, index, component) {
  check(recipe, index);
  return { ...recipe, components: recipe.components.map((item, i) => i === index ? component : item) };
}

export function removeComponent(recipe, index) {
  check(recipe, index);
  return { ...recipe, components: recipe.components.filter((_, i) => i !== index) };
}

export function duplicateComponent(recipe, index) {
  check(recipe, index);
  if (recipe.components.length >= MAX_COMPONENTS) throw new RecipeError('配方最多可添加 ' + MAX_COMPONENTS + ' 个组件');
  const components = [...recipe.components];
  components.splice(index + 1, 0, { ...components[index] });
  return { ...recipe, components };
}

// Returns the recipe and the new index of the moved item.
export function moveComponent(recipe, index, delta) {
  check(recipe, index);
  const target = index + delta;
  if (target < 0 || target >= recipe.components.length) return { recipe, index };
  const components = [...recipe.components];
  [components[index], components[target]] = [components[target], components[index]];
  return { recipe: { ...recipe, components }, index: target };
}

export function validate(recipe) {
  const problems = [];
  if (!recipe.title.trim()) problems.push('请填写配方名称');
  if (recipe.title.trim().length > 120) problems.push('名称不能超过 120 字');
  if (!recipe.style) problems.push('请先选择风格');
  if (!recipe.components.length) problems.push('画布为空，请至少添加一个组件');
  if (!/^#[0-9a-f]{6}$/i.test(recipe.accent)) problems.push('主色格式无效');
  return problems;
}

export function toPayload(recipe) {
  return {
    title: recipe.title.trim(), style: recipe.style, accent: recipe.accent,
    components: recipe.components.map(({ assetId }) => ({ assetId })), version: recipe.version
  };
}

export function fromResult(result, names = new Map()) {
  const doc = result.document;
  return {
    id: result.id, version: result.version, title: doc.title, style: doc.style, accent: doc.accent,
    components: doc.components.map(({ assetId }) => ({ assetId, name: names.get(assetId) })),
    theme: { colors: {}, tokens: {} }
  };
}

// History: { past, present, future }. `coalesce` merges consecutive edits of one field (typing, color drag).
export const createHistory = present => ({ past: [], present, future: [], key: null });

export function commit(history, next, coalesce = null) {
  if (next === history.present) return history;
  if (coalesce && history.key === coalesce) return { ...history, present: next, future: [] };
  return { past: [...history.past.slice(-99), history.present], present: next, future: [], key: coalesce };
}

export function undo(history) {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past.at(-1), future: [history.present, ...history.future], key: null };
}

export function redo(history) {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1), key: null };
}

// A save/load establishes a new baseline: keep identity changes out of the undo stack.
export const reset = present => createHistory(present);
