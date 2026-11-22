// Design Recipe editor: slots, undo/redo, Canvas 2D composition, save/restore, local draft recovery, PNG export.
import { $, el } from './core.mjs';
import { STAGE, gridLayout, hitTest, paintRecipe } from '../canvas.mjs';
import * as R from './recipe.mjs';
import { applyTheme, effectiveColors, primaryKey, sanitizeTheme, themeKey, tint, emptyTheme, paletteOf } from './theme.mjs';

const ID = /^[\w-]{1,100}$/;
const uuid = () => globalThis.crypto?.randomUUID?.() ?? ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

export function createEditor({ api, assets, store, storage, feedback, actions }) {
  const names = new Map();
  const images = new Map(); // themeKey|assetId -> Promise<HTMLImageElement>
  let frame = 0;
  let paintQueued = false;
  let lastImages = [];
  let draftTimer = 0;

  const present = () => store.get().history.present;
  const styleOf = id => store.get().styles.find(s => s.id === id) ?? null;
  const dirty = () => R.fingerprint(present()) !== store.get().savedFp;
  const hasWork = () => present().components.length > 0 && dirty();

  function replaceHistory(history, patch = {}) { store.set({ history, ...patch }); }
  function edit(next, coalesce = null, patch = {}) {
    const { history, selected } = store.get();
    const clamp = Math.min(selected, next.components.length - 1);
    store.set({ history: R.commit(history, next, coalesce), selected: patch.selected ?? clamp, ...patch });
  }

  /* ---------- theme ---------- */
  function setTheme(theme, coalesce = 'theme') {
    const recipe = present();
    const style = styleOf(recipe.style);
    const clean = sanitizeTheme(theme, style);
    const key = primaryKey(style);
    const accent = key ? effectiveColors(style, clean)[key] : recipe.accent;
    edit(R.withTheme(recipe, clean, accent), coalesce);
  }

  /* ---------- recipe operations ---------- */
  function freshRecipe(styleId, title) {
    const style = styleOf(styleId);
    const key = primaryKey(style);
    return R.emptyRecipe({ style: styleId, title, accent: key ? effectiveColors(style, emptyTheme())[key] : '#ffffff' });
  }

  async function addAsset(component, styleId) {
    try {
      let style = styleId;
      if (!style) style = (await api.json('/assets/' + encodeURIComponent(component.assetId))).styles[0];
      const styleRecord = styleOf(style);
      if (!styleRecord?.colors) { feedback.toast('此素材所在风格暂无配色，无法加入配方'); return false; }
      let recipe = present();
      if (recipe.style !== style) {
        if (recipe.components.length && !await feedback.confirm(`当前配方使用「${styleOf(recipe.style)?.label ?? recipe.style}」。添加「${styleRecord.label}」的组件会清空画布并开始新配方。继续？`, '清空并切换')) return false;
        recipe = freshRecipe(style, recipe.title);
        store.set({ history: R.createHistory(recipe), savedFp: R.fingerprint(recipe), selected: -1, replacing: false });
      }
      names.set(component.assetId, component.name);
      const { selected, replacing } = store.get();
      if (replacing && selected >= 0 && selected < recipe.components.length) {
        edit(R.replaceComponent(recipe, selected, component), null, { replacing: false });
        feedback.toast('已替换为 ' + component.name);
      } else {
        const next = R.addComponent(recipe, component);
        edit(next, null, { selected: next.components.length - 1 });
        feedback.toast('已添加 ' + component.name);
      }
      return true;
    } catch (error) {
      feedback.toast(error.message);
      return false;
    }
  }

  const selectedIndex = () => store.get().selected;
  function select(index) {
    const { selected } = store.get();
    const next = selected === index ? -1 : index;
    store.set({ selected: next, replacing: next === -1 ? false : store.get().replacing });
  }
  const guard = fn => { try { fn(); } catch (error) { feedback.toast(error.message); } };
  const remove = index => guard(() => edit(R.removeComponent(present(), index), null, { selected: -1, replacing: false }));
  const duplicate = index => guard(() => edit(R.duplicateComponent(present(), index), null, { selected: index + 1 }));
  const move = (index, delta) => guard(() => { const out = R.moveComponent(present(), index, delta); edit(out.recipe, null, { selected: out.index }); });

  async function confirmDiscard(message) {
    return !hasWork() || feedback.confirm(message, '放弃更改', '返回');
  }

  /* ---------- rendering ---------- */
  function imageFor(assetId) {
    const recipe = present();
    const style = styleOf(recipe.style);
    const key = themeKey(style, recipe.theme) + '|' + assetId;
    if (!images.has(key)) {
      const promise = (async () => {
        const svg = applyTheme(await assets.vector(assetId), style, recipe.theme);
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
      while (images.size > 120) images.delete(images.keys().next().value);
    }
    return images.get(key);
  }

  function fitCanvas() {
    const canvas = $('canvas');
    const width = Math.max(1, Math.round($('stage').clientWidth * (window.devicePixelRatio || 1)));
    if (canvas.width !== width) { canvas.width = width; canvas.height = Math.round(width * STAGE.height / STAGE.width); }
  }

  async function paint() {
    const generation = ++frame;
    const recipe = present();
    const canvas = $('canvas');
    fitCanvas();
    $('stage-empty').hidden = recipe.components.length > 0;
    const loaded = await Promise.all(recipe.components.map(c => imageFor(c.assetId).catch(() => null)));
    if (generation !== frame) return;
    lastImages = loaded;
    paintRecipe(canvas.getContext('2d'), { background: tint(recipe.accent), images: loaded, selected: store.get().selected, scale: canvas.width / STAGE.width });
    const failed = loaded.filter(image => !image).length;
    const status = $('canvas-status');
    status.replaceChildren();
    if (failed) status.append(`${failed} 个组件加载失败。`, el('button', { type: 'button', class: 'link', text: '重试', onclick: () => { images.clear(); schedulePaint(); } }));
  }
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paint(); });
  }

  function renderSlots() {
    const { history, selected, replacing } = store.get();
    const items = history.present.components;
    $('slots').replaceChildren(...items.map((item, index) => {
      const label = item.name ?? names.get(item.assetId) ?? item.assetId;
      const thumb = el('img', { alt: '', width: 32, height: 32 });
      assets.preview(item.assetId).then(url => { if (url) thumb.src = url; }, () => {});
      const small = (text, aria, run, extra = {}) => el('button', { type: 'button', class: 'small', text, 'aria-label': aria + ' ' + label, onclick: run, ...extra });
      return el('li', { class: 'slot', 'data-selected': String(index === selected) },
        el('button', { type: 'button', class: 'slot-main', 'aria-pressed': String(index === selected), onclick: () => select(index) }, thumb, el('span', { text: `${index + 1}. ${label}` })),
        small('↑', '上移', () => move(index, -1), { disabled: index === 0 }),
        small('↓', '下移', () => move(index, 1), { disabled: index === items.length - 1 }),
        small('复制', '复制', () => duplicate(index)),
        small(index === selected && replacing ? '取消替换' : '替换', '替换', () => { store.set({ selected: index, replacing: !(index === selected && replacing) }); }),
        small('移除', '移除', () => remove(index)));
    }));
    $('replace-hint').hidden = !replacing;
    $('tab-count').textContent = items.length ? `(${items.length})` : '';
  }

  function renderMeta() {
    const { history, savedFp, saving } = store.get();
    const recipe = history.present;
    const pill = $('dirty');
    const state = !recipe.components.length && !recipe.id ? '' : !recipe.id ? 'new' : dirty() ? 'dirty' : 'saved';
    pill.dataset.state = state;
    pill.textContent = { '': '', new: '未保存', dirty: '有未保存更改', saved: '已保存 · v' + recipe.version }[state];
    pill.hidden = !state;
    if ($('title') !== document.activeElement) $('title').value = recipe.title;
    $('recipeId').placeholder = recipe.id ? '' : '保存后生成';
    if ($('recipeId') !== document.activeElement && recipe.id) $('recipeId').value = recipe.id;
    const problems = R.validate(recipe);
    $('save-problems').textContent = problems.join('；');
    $('save').disabled = saving || problems.length > 0;
    $('save').textContent = saving ? '保存中…' : '保存配方';
    $('load').disabled = saving;
    $('undo').disabled = !history.past.length;
    $('redo').disabled = !history.future.length;
    $('clear').disabled = !recipe.components.length;
    $('export').disabled = !recipe.components.length;
    void savedFp;
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const recipe = present();
      if (hasWork()) storage.saveDraft({ savedAt: new Date().toISOString(), recipe });
      else if (!recipe.components.length || !dirty()) storage.clearDraft();
    }, 400);
  }

  /* ---------- persistence ---------- */
  async function hydrateNames(recipe) {
    await Promise.all(recipe.components.filter(c => !c.name && !names.has(c.assetId)).map(async c => {
      try { names.set(c.assetId, (await api.json('/assets/' + encodeURIComponent(c.assetId))).name); } catch { /* shown by id */ }
    }));
    return { ...recipe, components: recipe.components.map(c => ({ ...c, name: c.name ?? names.get(c.assetId) })) };
  }

  async function save(asNew = false) {
    let recipe = present();
    if (R.validate(recipe).length || store.get().saving) return;
    if (asNew) recipe = { ...recipe, id: '', version: 0 };
    // Generate the id before the request so a retry after a lost response reuses the same id.
    if (!recipe.id) { recipe = { ...recipe, id: uuid(), version: 0 }; replaceHistory({ ...store.get().history, present: recipe }); }
    store.set({ saving: true });
    try {
      const result = await api.put('/design-recipes/' + recipe.id, R.toPayload(recipe));
      markSaved(result);
      feedback.hideBanner();
      $('canvas-status').textContent = '配方已保存 · 版本 ' + result.version;
    } catch (error) {
      await onSaveError(error, recipe);
    } finally { store.set({ saving: false }); }
  }

  function markSaved(result) {
    const { history } = store.get();
    const recipe = { ...history.present, id: result.id, version: result.version };
    store.set({ history: { ...history, present: recipe }, savedFp: R.fingerprint(recipe) });
    storage.clearDraft();
  }

  async function onSaveError(error, recipe) {
    if (error.kind === 'conflict') {
      // A lost response can leave the save applied server-side: adopt it if the content is identical.
      try {
        const latest = await api.json('/design-recipes/' + recipe.id);
        if (R.fingerprint(R.fromResult(latest)) === R.fingerprint(recipe)) { markSaved(latest); $('canvas-status').textContent = '配方已保存 · 版本 ' + latest.version; return; }
      } catch { /* fall through to the conflict prompt */ }
      feedback.banner('版本冲突：此配方已在别处更新。你的修改仍保留在本地。', [
        { label: '另存为新配方', run: () => save(true) },
        { label: '载入最新版本', run: () => load(recipe.id, { force: true }) }
      ]);
    } else if (error.kind === 'auth') { /* handled by the session */ }
    else feedback.banner('保存失败：' + error.message + '。本地草稿已保留。', error.retryable ? [{ label: '重试保存', run: () => save() }] : []);
  }

  async function load(id, { force = false } = {}) {
    id = id.trim();
    if (!ID.test(id)) { feedback.toast('请输入有效的配方 ID'); return; }
    if (!force && !await confirmDiscard('当前配方有未保存更改，恢复其他配方会放弃这些更改。继续？')) return;
    store.set({ saving: true });
    try {
      const result = await api.json('/design-recipes/' + encodeURIComponent(id));
      const style = styleOf(result.document.style);
      if (!style) throw Object.assign(Error('配方使用的风格当前不可用'), { kind: 'invalid' });
      let recipe = await hydrateNames(R.fromResult(result));
      // Re-apply the persisted accent onto the primary palette color.
      const key = primaryKey(style);
      const base = paletteOf(style).find(p => p.key === key)?.value;
      const theme = key && base && recipe.accent !== base ? sanitizeTheme({ colors: { [key]: recipe.accent } }, style) : emptyTheme();
      recipe = { ...recipe, theme };
      store.set({ history: R.createHistory(recipe), savedFp: R.fingerprint(recipe), selected: -1, replacing: false });
      storage.clearDraft();
      await actions.syncLibraryStyle(recipe.style);
      feedback.hideBanner();
      $('canvas-status').textContent = '已恢复配方 · 版本 ' + result.version;
    } catch (error) {
      feedback.banner(error.kind === 'notfound' ? '未找到该配方 ID，请检查后重试。' : '恢复失败：' + error.message, error.retryable ? [{ label: '重试', run: () => load(id, { force }) }] : []);
    } finally { store.set({ saving: false }); }
  }

  async function newRecipe() {
    if (!await confirmDiscard('当前配方有未保存更改，新建会放弃这些更改。继续？')) return;
    // A new recipe starts in the style currently being browsed (when it has a palette).
    const browsed = actions.browsedStyle?.();
    const recipe = freshRecipe(styleOf(browsed)?.colors ? browsed : present().style, '新设计');
    store.set({ history: R.createHistory(recipe), savedFp: R.fingerprint(recipe), selected: -1, replacing: false });
    $('recipeId').value = '';
    storage.clearDraft();
  }

  async function offerDraft() {
    const draft = storage.loadDraft();
    const recipe = draft?.recipe;
    if (!recipe || !Array.isArray(recipe.components) || !recipe.components.length || !styleOf(recipe.style)) return;
    const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString('zh-CN') : '';
    if (!await feedback.confirm(`发现未保存的本地草稿（${when}，${recipe.components.length} 个组件）。恢复吗？`, '恢复草稿', '丢弃草稿')) { storage.clearDraft(); return; }
    const style = styleOf(recipe.style);
    const clean = R.emptyRecipe({ style: recipe.style, accent: recipe.accent, title: String(recipe.title ?? '新设计').slice(0, 120) });
    const next = { ...clean, id: ID.test(recipe.id ?? '') ? recipe.id : '', version: Number.isSafeInteger(recipe.version) ? recipe.version : 0,
      components: recipe.components.filter(c => c && typeof c.assetId === 'string' && ID.test(c.assetId)).slice(0, R.MAX_COMPONENTS).map(c => ({ assetId: c.assetId, name: typeof c.name === 'string' ? c.name : undefined })),
      theme: sanitizeTheme(recipe.theme, style) };
    for (const c of next.components) if (c.name) names.set(c.assetId, c.name);
    store.set({ history: R.createHistory(next), savedFp: '', selected: -1, replacing: false });
    await actions.syncLibraryStyle(next.style);
  }

  async function exportPng() {
    const recipe = present();
    if (!recipe.components.length) return;
    try {
      const loaded = await Promise.all(recipe.components.map(c => imageFor(c.assetId)));
      const canvas = Object.assign(document.createElement('canvas'), { width: STAGE.width * 2, height: STAGE.height * 2 });
      paintRecipe(canvas.getContext('2d'), { background: tint(recipe.accent), images: loaded, selected: -1, scale: 2 });
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('导出失败')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: (recipe.title.trim() || 'recipe').replace(/[\\/:*?"<>|]+/g, '-') + '.png' });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) { feedback.toast('导出失败：部分组件无法加载，请先重试预览'); }
  }

  /* ---------- wiring ---------- */
  function init() {
    store.subscribe((state, previous) => {
      renderMeta();
      if (state.history.present.components !== previous.history.present.components || state.selected !== previous.selected || state.replacing !== previous.replacing) renderSlots();
      if (state.history.present !== previous.history.present || state.selected !== previous.selected) schedulePaint();
      if (state.history.present !== previous.history.present) scheduleDraft();
    });
    $('title').oninput = () => edit({ ...present(), title: $('title').value }, 'title');
    $('title').onblur = () => renderMeta();
    $('undo').onclick = () => { replaceHistory(R.undo(store.get().history)); };
    $('redo').onclick = () => { replaceHistory(R.redo(store.get().history)); };
    $('clear').onclick = async () => { if (await feedback.confirm('清空画布上的所有组件？可用「撤销」找回。', '清空')) edit({ ...present(), components: [] }, null, { selected: -1, replacing: false }); };
    $('export').onclick = exportPng;
    $('save').onclick = () => save();
    $('load').onclick = () => load($('recipeId').value);
    $('recipeId').onkeydown = event => { if (event.key === 'Enter') load($('recipeId').value); };
    $('new').onclick = newRecipe;
    $('canvas').addEventListener('click', event => {
      const box = $('canvas').getBoundingClientRect();
      // Layout from the current component count, not the last painted frame, so clicks are right while a repaint is pending.
      const index = hitTest(gridLayout(present().components.length), (event.clientX - box.left) / box.width * STAGE.width, (event.clientY - box.top) / box.height * STAGE.height);
      if (index >= 0) select(index); else store.set({ selected: -1, replacing: false });
    });
    $('canvas').addEventListener('keydown', event => {
      const count = present().components.length;
      const index = selectedIndex();
      if (!count) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); store.set({ selected: (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count }); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && index >= 0) { event.preventDefault(); remove(index); }
      else if (event.key === 'Escape') store.set({ selected: -1, replacing: false });
    });
    document.addEventListener('keydown', event => {
      const typing = event.target.closest?.('input, textarea, select');
      if (typing || !(event.ctrlKey || event.metaKey) || $('app').hidden) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); replaceHistory(R.undo(store.get().history)); }
      else if (key === 'y' || key === 'z') { event.preventDefault(); replaceHistory(R.redo(store.get().history)); }
    });
    window.addEventListener('beforeunload', event => { if (hasWork()) { event.preventDefault(); event.returnValue = ''; } });
    new ResizeObserver(() => schedulePaint()).observe($('stage'));
    renderMeta();
    renderSlots();
    schedulePaint();
  }

  const reset = recipe => store.set({ history: R.createHistory(recipe), savedFp: R.fingerprint(recipe), selected: -1, replacing: false });
  return { init, addAsset, setTheme, load, offerDraft, freshRecipe, reset, repaint: () => { images.clear(); schedulePaint(); }, present, hasWork };
}
