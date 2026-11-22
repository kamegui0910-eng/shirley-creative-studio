// Canvas stage: painting, pointer/touch editing (move, scale, rotate) and PNG export.
import { $, el } from './core.mjs';
import { paintRecipe, resolveGeometry, hitLayers, hitHandle, layerBox, scaleFromDrag, rotationFromDrag } from '../canvas.mjs';
import { applyTheme, themeKey, tint } from './theme.mjs';
import * as R from './recipe.mjs';

export function createStage({ store, assets, feedback, ops }) {
  const measureCtx = document.createElement('canvas').getContext('2d');
  const measure = (font, line) => { measureCtx.font = font; return measureCtx.measureText(line).width; };
  const images = new Map();
  let frame = 0;
  let queued = false;
  let drag = null;
  let dragSeq = 0;

  const geometry = recipe => resolveGeometry(recipe, measure);
  const background = recipe => recipe.canvas.background ?? tint(recipe.accent);

  function imageFor(layer, recipe) {
    const style = ops.styleOf(recipe.style);
    // A layer's own color overrides win over the recipe theme; tokens are recipe-wide.
    const theme = { colors: { ...recipe.theme.colors, ...layer.colors }, tokens: recipe.theme.tokens };
    const key = themeKey(style, theme) + '|' + layer.assetId;
    if (!images.has(key)) {
      const promise = (async () => {
        const svg = applyTheme(await assets.vector(layer.assetId), style, theme);
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          return image;
        } finally { URL.revokeObjectURL(url); }
      })();
      images.set(key, promise);
      promise.catch(() => images.delete(key));
      while (images.size > 160) images.delete(images.keys().next().value);
    }
    return images.get(key);
  }

  // The canvas keeps the recipe's aspect ratio, capped so tall formats stay usable on a phone.
  function fit(recipe) {
    const canvas = $('canvas');
    const { width, height } = recipe.canvas;
    const maxHeight = Math.max(320, window.innerHeight * 0.72);
    const cssWidth = Math.max(1, Math.min($('stage').clientWidth, maxHeight * width / height));
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cssWidth * dpr);
    const h = Math.round(w * height / width);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.style.width = cssWidth + 'px';
    canvas.style.aspectRatio = `${width} / ${height}`;
    return cssWidth;
  }

  async function paint() {
    const generation = ++frame;
    const recipe = ops.present();
    const cssWidth = fit(recipe);
    $('stage-empty').hidden = recipe.layers.length > 0;
    const loaded = await Promise.all(recipe.layers.map(layer => layer.type === 'component' ? imageFor(layer, recipe).catch(() => null) : null));
    if (generation !== frame) return;
    const canvas = $('canvas');
    paintRecipe(canvas.getContext('2d'), {
      recipe, background: background(recipe), images: loaded, geoms: geometry(recipe), selected: store.get().selected,
      scale: canvas.width / recipe.canvas.width, unit: recipe.canvas.width / cssWidth
    });
    const failed = recipe.layers.filter((layer, i) => layer.type === 'component' && !loaded[i]).length;
    const status = $('canvas-status');
    if (failed) {
      status.replaceChildren(`${failed} 个组件加载失败。`, el('button', { type: 'button', class: 'link', text: '重试', onclick: () => { images.clear(); schedule(); } }));
    } else if (status.querySelector('.link')) status.replaceChildren();
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  }

  const point = event => {
    const box = $('canvas').getBoundingClientRect();
    const { width, height } = ops.present().canvas;
    return { x: (event.clientX - box.left) * width / box.width, y: (event.clientY - box.top) * height / box.height, unit: width / box.width };
  };

  function down(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const p = point(event);
    const recipe = ops.present();
    const geoms = geometry(recipe);
    const selected = store.get().selected;
    let mode = null;
    let index = selected;
    const current = recipe.layers[selected];
    if (current && current.visible && !current.locked) mode = hitHandle(layerBox(current, geoms[selected]), p.x, p.y, p.unit, event.pointerType === 'touch' ? 26 : 16);
    if (!mode) {
      index = hitLayers(recipe.layers, geoms, p.x, p.y);
      if (index < 0) { store.set({ selected: -1, replacing: false }); return; }
      if (index !== selected) store.set({ selected: index });
      mode = recipe.layers[index].locked ? 'none' : 'move';
    }
    drag = { mode, index, start: p, recipe, layer: recipe.layers[index], geom: geoms[index], moved: false, key: 'drag' + (++dragSeq), unit: p.unit };
    try { $('canvas').setPointerCapture(event.pointerId); } catch { /* synthetic or already-ended pointer */ }
    event.preventDefault();
  }

  function move(event) {
    if (!drag || drag.mode === 'none') return;
    const p = point(event);
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3 * drag.unit) return; // a tap is not an edit
    drag.moved = true;
    try {
      let next;
      if (drag.mode === 'move') {
        // The first move freezes the automatic arrangement from the pre-drag state so other layers stay put.
        const base = R.toFreeLayout(drag.recipe);
        const layer = base.layers[drag.index];
        next = R.updateLayer(base, drag.index, { x: layer.x + dx, y: layer.y + dy });
      } else if (drag.mode === 'scale') {
        next = R.updateLayer(drag.recipe, drag.index, { scale: scaleFromDrag(layerBox(drag.layer, drag.geom), drag.start, p, drag.layer.scale) });
      } else {
        let rotation = rotationFromDrag(layerBox(drag.layer, drag.geom), p);
        if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
        next = R.updateLayer(drag.recipe, drag.index, { rotation });
      }
      ops.edit(next, drag.key);
    } catch (error) { feedback.toast(error.message); drag = null; }
  }
  const up = event => { if (drag) { try { $('canvas').releasePointerCapture(event.pointerId); } catch { /* not captured */ } } drag = null; };

  async function exportPng() {
    const recipe = ops.present();
    if (!recipe.layers.length) return;
    try {
      const loaded = await Promise.all(recipe.layers.map(layer => layer.type === 'component' ? imageFor(layer, recipe) : null));
      const scale = recipe.canvas.width < 1000 ? 2 : 1;
      const canvas = Object.assign(document.createElement('canvas'), { width: recipe.canvas.width * scale, height: recipe.canvas.height * scale });
      paintRecipe(canvas.getContext('2d'), { recipe, background: background(recipe), images: loaded, geoms: geometry(recipe), selected: -1, scale });
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('导出失败')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: (recipe.title.trim() || 'recipe').replace(/[\\/:*?"<>|]+/g, '-') + '.png' });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { feedback.toast('导出失败：部分组件无法加载，请先重试预览'); }
  }

  function init() {
    const canvas = $('canvas');
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    new ResizeObserver(schedule).observe($('stage'));
    window.addEventListener('resize', schedule);
    schedule();
  }

  return { init, schedule, exportPng, clearImages: () => images.clear(), geometry };
}
