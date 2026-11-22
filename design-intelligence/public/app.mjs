import { drawComponent } from './canvas.mjs';

const $ = id => document.getElementById(id);
const state = { token: '', styles: [], components: [], slot: -1, version: 0, id: '', cursor: null, search: 0, frame: 0, categoryRequest: 0, saving: false };
const urls = new WeakMap();
const status = message => { $('status').textContent = message; };
const run = action => Promise.resolve().then(action).catch(error => status(error.message));
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + state.token } });
  if (!response.ok) throw Error((await response.json().catch(() => null))?.error ?? '请求失败');
  return response;
}
async function data(path, options) { return (await api(path, options)).json(); }
function options(select, items) {
  select.replaceChildren(...items.map(item => new Option(item.label, item.id)));
}
function resetIdentity() {
  state.id = '';
  state.version = 0;
  $('recipeId').value = '';
}
async function categories() {
  const generation = ++state.categoryRequest;
  const style = $('style').value;
  const category = $('category');
  category.disabled = true;
  category.replaceChildren();
  const result = await data('/categories?style=' + encodeURIComponent(style));
  if (generation !== state.categoryRequest) return;
  options(category, [{ id: '', label: '全部分类' }, ...result.items]);
  category.disabled = false;
  await search();
}

async function search(append = false) {
  const generation = ++state.search;
  const library = $('library');
  if (!append) {
    for (const image of library.querySelectorAll('img')) if (urls.has(image)) URL.revokeObjectURL(urls.get(image));
    library.replaceChildren();
    state.cursor = null;
  }
  $('more').hidden = true;
  const params = new URLSearchParams({ style: $('style').value, kind: 'component', limit: '16' });
  if ($('category').value) params.set('category', $('category').value);
  if (state.cursor) params.set('cursor', state.cursor);
  const result = await data('/assets/search?' + params);
  if (generation !== state.search) return;
  state.cursor = result.nextCursor;
  $('more').hidden = !state.cursor;
  for (const item of result.items) {
    const button = document.createElement('button');
    button.className = 'card';
    const image = document.createElement('img');
    image.alt = '';
    button.append(image, item.name);
    button.onclick = () => run(() => {
      const component = { assetId: item.assetId, name: item.name };
      if (state.slot >= 0) state.components[state.slot] = component;
      else if (state.components.length < 12) state.components.push(component);
      else throw Error('配方最多可添加 12 个组件');
      refreshSlots();
      return paint();
    });
    library.append(button);
    run(async () => {
      const path = '/assets/' + item.assetId + '/preview';
      const response = await api(path);
      const blob = await response.blob();
      if (!image.isConnected) return;
      const url = URL.createObjectURL(blob);
      urls.set(image, url);
      image.src = url;
    });
  }
}
function refreshSlots() {
  const slots = $('slots');
  slots.replaceChildren();
  state.components.forEach((item, index) => {
    const button = document.createElement('button');
    button.textContent = item.name ?? ('组件 ' + (index + 1));
    button.setAttribute('aria-pressed', String(index === state.slot));
    button.onclick = () => { state.slot = state.slot === index ? -1 : index; refreshSlots(); };
    const remove = document.createElement('button');
    remove.textContent = '移除';
    remove.setAttribute('aria-label', '移除 ' + button.textContent);
    remove.onclick = () => run(() => {
      state.components.splice(index, 1);
      state.slot = -1;
      refreshSlots();
      return paint();
    });
    slots.append(button, remove);
  });
}
async function paint() {
  const generation = ++state.frame;
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const style = state.styles.find(item => item.id === $('style').value);
  const accent = $('accent').value;
  const images = await Promise.all(state.components.map(async item => {
    const response = await api('/assets/' + item.assetId + '/vector');
    let svg = await response.text();
    const original = style?.colors?.pink;
    if (original && /^#[a-f0-9]{6}$/i.test(original)) svg = svg.replace(new RegExp(original + '(?![0-9a-f])', 'gi'), accent);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }));
  if (generation !== state.frame) return;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!images.length) return;
  const columns = Math.min(4, Math.ceil(Math.sqrt(images.length)));
  const w = canvas.width / columns;
  const h = canvas.height / Math.ceil(images.length / columns);
  images.forEach((image, index) => drawComponent(ctx, image, index % columns * w + 12, Math.floor(index / columns) * h + 12, w - 24, h - 24));
}

$('login').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    state.token = $('token').value.trim();
    state.styles = (await data('/styles')).items.filter(item => item.colors);
    if (!state.styles.length) throw Error('当前品牌暂无组件风格');
    options($('style'), state.styles);
    $('accent').value = state.styles[0].colors.pink;
    $('login').hidden = true;
    $('workspace').hidden = false;
    $('token').value = '';
    status('');
    await Promise.all([categories(), paint()]);
  });
};
$('style').onchange = () => run(async () => {
  ++state.search;
  ++state.frame;
  $('more').hidden = true;
  if (state.components.length && !confirm('切换风格会清空画布。继续？')) {
    $('style').value = $('style').dataset.active || state.styles[0].id;
    await categories();
    return;
  }
  $('style').dataset.active = $('style').value;
  $('accent').value = state.styles.find(item => item.id === $('style').value).colors.pink;
  state.components = [];
  state.slot = -1;
  resetIdentity();
  refreshSlots();
  status('');
  await Promise.all([categories(), paint()]);
});
$('category').onchange = () => run(() => search());
$('more').onclick = () => run(() => search(true));
$('accent').oninput = () => run(paint);
$('save').onclick = () => run(async () => {
  if (state.saving) return;
  state.saving = true;
  const id = state.id || crypto.randomUUID();
  const body = JSON.stringify({ title: $('title').value.trim(), style: $('style').value, accent: $('accent').value, components: state.components, version: state.version });
  $('save').disabled = $('load').disabled = $('style').disabled = true;
  try {
    const result = await data('/design-recipes/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    state.id = result.id;
    state.version = result.version;
    $('recipeId').value = result.id;
    status('配方已保存 · 版本 ' + result.version);
  } finally {
    state.saving = false;
    $('save').disabled = $('load').disabled = $('style').disabled = false;
  }
});
$('load').onclick = () => run(async () => {
  const id = $('recipeId').value.trim();
  if (!/^[\w-]{1,100}$/.test(id)) throw Error('请输入有效的配方 ID');
  $('save').disabled = $('load').disabled = $('style').disabled = true;
  let result;
  try { result = await data('/design-recipes/' + id); }
  finally { $('save').disabled = $('load').disabled = $('style').disabled = false; }
  const recipe = result.document;
  $('style').value = $('style').dataset.active = recipe.style;
  $('accent').value = recipe.accent;
  $('title').value = recipe.title;
  $('recipeId').value = state.id = result.id;
  state.version = result.version;
  state.components = recipe.components;
  state.slot = -1;
  refreshSlots();
  await Promise.all([categories(), paint()]);
  status('已恢复配方 · 版本 ' + result.version);
});
