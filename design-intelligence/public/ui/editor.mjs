// Design Recipe editor: layers, history, save/restore, local draft + history recovery, server revisions.
// Canvas painting and pointer editing live in stage.mjs; the property panel in inspector.mjs.
import { $, el } from './core.mjs';
import * as R from './recipe.mjs';
import { createStage } from './stage.mjs';
import { createInspector } from './inspector.mjs';
import { effectiveColors, primaryKey, sanitizeTheme, emptyTheme, paletteOf } from './theme.mjs';

const ID = /^[\w-]{1,100}$/;
const uuid = () => globalThis.crypto?.randomUUID?.() ?? ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

export function createEditor({ api, assets, store, storage, feedback, actions }) {
  const names = new Map();
  let draftTimer = 0;
  let slotsSignature = '';

  const present = () => store.get().history.present;
  const styleOf = id => store.get().styles.find(s => s.id === id) ?? null;
  const dirty = () => R.fingerprint(present()) !== store.get().savedFp;
  const hasWork = () => present().layers.length > 0 && dirty();
  const canWrite = () => store.get().session?.write !== false;
  const labelOf = layer => layer.name || (layer.type === 'text' ? layer.text.slice(0, 12) : layer.assetId);

  function edit(next, coalesce = null, patch = {}) {
    const { history, selected } = store.get();
    const clamp = Math.min(selected, next.layers.length - 1);
    store.set({ history: R.commit(history, next, coalesce), selected: patch.selected ?? clamp, ...patch });
  }
  const guard = fn => { try { fn(); } catch (error) { feedback.toast(error.message); } };

  const stage = createStage({ store, assets, feedback, ops: { present, styleOf, edit } });
  const inspector = createInspector({ store, ops: {
    styleOf,
    update(patch, coalesce) {
      const index = store.get().selected;
      if (index < 0) return;
      guard(() => {
        const { _freeze, ...rest } = patch;
        let recipe = present();
        if (_freeze && recipe.layout === 'grid' && recipe.layers[index].type === 'component') recipe = R.toFreeLayout(recipe);
        edit(R.updateLayer(recipe, index, rest), coalesce);
      });
    },
    center: index => stage.geometry(present())[index] ?? { cx: 0, cy: 0 },
    effectiveColor: key => effectiveColors(styleOf(present().style), present().theme)[key],
    setCanvas: (spec, coalesce = null) => guard(() => edit(R.setCanvas(present(), spec), coalesce))
  } });

  /* ---------- theme ---------- */
  function setTheme(theme, coalesce = 'theme') {
    const recipe = present();
    const style = styleOf(recipe.style);
    const clean = sanitizeTheme(theme, style);
    const key = primaryKey(style);
    edit(R.withTheme(recipe, clean, key ? effectiveColors(style, clean)[key] : recipe.accent), coalesce);
  }

  /* ---------- layer operations ---------- */
  function freshRecipe(styleId, title, canvas) {
    const style = styleOf(styleId);
    const key = primaryKey(style);
    return R.emptyRecipe({ style: styleId, title, canvas, accent: key ? effectiveColors(style, emptyTheme())[key] : '#ffffff' });
  }

  async function addAsset(component, styleId) {
    try {
      let style = styleId;
      if (!style) style = (await api.json('/assets/' + encodeURIComponent(component.assetId))).styles[0];
      const styleRecord = styleOf(style);
      if (!styleRecord?.colors) { feedback.toast('此素材所在风格暂无配色，无法加入配方'); return false; }
      let recipe = present();
      if (recipe.style !== style) {
        if (recipe.layers.length && !await feedback.confirm(`当前配方使用「${styleOf(recipe.style)?.label ?? recipe.style}」。添加「${styleRecord.label}」的组件会清空画布并开始新配方。继续？`, '清空并切换')) return false;
        recipe = freshRecipe(style, recipe.title, recipe.canvas);
        store.set({ history: R.createHistory(recipe), savedFp: R.fingerprint(recipe), selected: -1, replacing: false });
      }
      names.set(component.assetId, component.name);
      const { selected, replacing } = store.get();
      if (replacing && selected >= 0 && recipe.layers[selected]?.type === 'component') {
        edit(R.replaceComponent(recipe, selected, component), null, { replacing: false });
        feedback.toast('已替换为 ' + component.name);
      } else {
        const next = R.addComponent(recipe, component);
        edit(next, null, { selected: next.layers.length - 1 });
        feedback.toast('已添加 ' + component.name);
      }
      return true;
    } catch (error) {
      feedback.toast(error.message);
      return false;
    }
  }

  function addText() {
    guard(() => {
      const recipe = present();
      if (!recipe.style) { feedback.toast('请先在素材库选择风格'); return; }
      const next = R.addLayer(recipe, R.textLayer(recipe));
      edit(next, null, { selected: next.layers.length - 1 });
    });
  }

  function select(index) {
    const { selected } = store.get();
    const next = selected === index ? -1 : index;
    store.set({ selected: next, replacing: next === -1 ? false : store.get().replacing });
  }
  const remove = index => guard(() => edit(R.removeLayer(present(), index), null, { selected: -1, replacing: false }));
  const duplicate = index => guard(() => edit(R.duplicateLayer(present(), index), null, { selected: index + 1 }));
  const move = (index, delta) => guard(() => { const out = R.moveLayer(present(), index, delta); edit(out.recipe, null, { selected: out.index }); });
  const toggle = (index, field) => guard(() => edit(R.updateLayer(present(), index, { [field]: !present().layers[index][field] })));

  async function confirmDiscard(message) {
    return !hasWork() || feedback.confirm(message, '放弃更改', '返回');
  }

  /* ---------- rendering of lists and state ---------- */
  function renderSlots() {
    const { history, selected, replacing } = store.get();
    const layers = history.present.layers;
    const signature = JSON.stringify([layers.map(l => [l.id, labelOf(l), l.type, l.visible, l.locked, l.type === 'component' ? l.assetId : '']), selected, replacing]);
    $('tab-count').textContent = layers.length ? `(${layers.length})` : '';
    $('replace-hint').hidden = !replacing;
    if (signature === slotsSignature) return;
    slotsSignature = signature;
    $('slots').replaceChildren(...layers.map((layer, index) => {
      const label = labelOf(layer);
      const lead = layer.type === 'component'
        ? el('img', { alt: '', width: 32, height: 32 })
        : el('span', { class: 'glyph', text: 'T', 'aria-hidden': 'true' });
      if (layer.type === 'component') assets.preview(layer.assetId).then(url => { if (url) lead.src = url; }, () => {});
      const small = (text, aria, run, extra = {}) => el('button', { type: 'button', class: 'small', text, 'aria-label': aria + ' ' + label, onclick: run, ...extra });
      return el('li', { class: 'slot', 'data-selected': String(index === selected), 'data-type': layer.type, 'data-hidden': String(!layer.visible) },
        el('button', { type: 'button', class: 'slot-main', 'aria-pressed': String(index === selected), onclick: () => select(index) }, lead, el('span', { text: `${index + 1}. ${label}` })),
        small('↑', '上移', () => move(index, -1), { disabled: index === 0 }),
        small('↓', '下移', () => move(index, 1), { disabled: index === layers.length - 1 }),
        small('复制', '复制', () => duplicate(index)),
        layer.type === 'component' ? small(index === selected && replacing ? '取消替换' : '替换', '替换', () => { store.set({ selected: index, replacing: !(index === selected && replacing) }); }) : null,
        small(layer.visible ? '隐藏' : '显示', layer.visible ? '隐藏' : '显示', () => toggle(index, 'visible')),
        small(layer.locked ? '解锁' : '锁定', layer.locked ? '解锁' : '锁定', () => toggle(index, 'locked')),
        small('移除', '移除', () => remove(index)));
    }));
  }

  function renderMeta() {
    const { history, saving, session } = store.get();
    const recipe = history.present;
    const pill = $('dirty');
    const state = !recipe.layers.length && !recipe.id ? '' : !recipe.id ? 'new' : dirty() ? 'dirty' : 'saved';
    pill.dataset.state = state;
    pill.textContent = { '': '', new: '未保存', dirty: '有未保存更改', saved: '已保存 · v' + recipe.version }[state];
    pill.hidden = !state;
    $('mode-pill').hidden = canWrite();
    $('mode-pill').textContent = '只读令牌';
    if ($('title') !== document.activeElement) $('title').value = recipe.title;
    $('recipeId').placeholder = recipe.id ? '' : '保存后生成';
    if ($('recipeId') !== document.activeElement && recipe.id) $('recipeId').value = recipe.id;
    const problems = R.validate(recipe);
    if (!canWrite()) problems.unshift('当前令牌为只读，无法保存（仍可编辑、导出 PNG）');
    $('save-problems').textContent = problems.join('；');
    $('save').disabled = saving || problems.length > 0;
    $('save').textContent = saving ? '保存中…' : '保存配方';
    $('load').disabled = saving;
    $('undo').disabled = !history.past.length;
    $('redo').disabled = !history.future.length;
    $('clear').disabled = !recipe.layers.length;
    $('export').disabled = !recipe.layers.length;
    void session;
  }

  /* ---------- local persistence: draft + per-recipe undo history ---------- */
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistLocal, 400);
  }
  function persistLocal() {
    const { history, savedFp } = store.get();
    const recipe = history.present;
    const entry = { savedAt: new Date().toISOString(), id: recipe.id, version: recipe.version, savedFp, history: R.packHistory(history) };
    if (hasWork()) storage.saveDraft(entry);
    else storage.clearDraft();
    if (recipe.id && recipe.layers.length) storage.saveHistory(recipe.id, entry);
  }

  /* ---------- server persistence ---------- */
  async function hydrateNames(recipe) {
    await Promise.all(recipe.layers.filter(l => l.type === 'component' && !l.name && !names.has(l.assetId)).map(async layer => {
      try { names.set(layer.assetId, (await api.json('/assets/' + encodeURIComponent(layer.assetId))).name); } catch { /* shown by id */ }
    }));
    return { ...recipe, layers: recipe.layers.map(l => l.type === 'component' && !l.name && names.has(l.assetId) ? { ...l, name: names.get(l.assetId) } : l) };
  }

  async function save(asNew = false) {
    let recipe = present();
    if (R.validate(recipe).length || store.get().saving || !canWrite()) return;
    if (asNew) recipe = { ...recipe, id: '', version: 0 };
    // Generate the id before the request so a retry after a lost response reuses the same id.
    if (!recipe.id) { recipe = { ...recipe, id: uuid(), version: 0 }; store.set({ history: { ...store.get().history, present: recipe } }); }
    store.set({ saving: true });
    try {
      const result = await api.put('/design-recipes/' + recipe.id, R.toPayload(recipe));
      if (result.document?.schemaVersion !== R.SCHEMA_VERSION) legacyServer(result);
      else {
        markSaved(result);
        feedback.hideBanner();
        $('canvas-status').textContent = '配方已保存 · 版本 ' + result.version;
        refreshRevisions();
      }
    } catch (error) {
      await onSaveError(error, recipe);
    } finally { store.set({ saving: false }); }
  }

  // An older Worker silently stores only title/style/accent/components. Never mark that as "saved".
  function legacyServer(result) {
    const { history } = store.get();
    store.set({ history: { ...history, present: { ...history.present, id: result.id, version: result.version } } });
    feedback.banner('服务端尚未升级到完整配方格式：画布尺寸、图层位置、文字和主题没有被保存（仅保存了风格、主色和组件列表）。你的完整编辑仍保留在本地草稿中。', []);
  }

  function markSaved(result) {
    const { history } = store.get();
    const recipe = { ...history.present, id: result.id, version: result.version };
    store.set({ history: { ...history, present: recipe }, savedFp: R.fingerprint(recipe) });
    storage.clearDraft();
    storage.saveLast({ id: recipe.id, title: recipe.title });
    persistLocal();
  }

  async function onSaveError(error, recipe) {
    if (error.kind === 'conflict') {
      // A lost response can leave the save applied server-side: adopt it if the content is identical.
      try {
        const latest = await api.json('/design-recipes/' + recipe.id);
        if (latest.document?.schemaVersion === R.SCHEMA_VERSION && R.fingerprint(R.fromResult(latest)) === R.fingerprint(recipe)) {
          markSaved(latest);
          $('canvas-status').textContent = '配方已保存 · 版本 ' + latest.version;
          return;
        }
      } catch { /* fall through to the conflict prompt */ }
      feedback.banner('版本冲突：此配方已在别处更新。你的修改仍保留在本地。', [
        { label: '另存为新配方', run: () => save(true) },
        { label: '载入最新版本', run: () => load(recipe.id, { force: true }) }
      ]);
    } else if (error.kind === 'forbidden') {
      store.set({ session: { ...store.get().session, write: false } });
      feedback.banner('当前令牌没有保存权限（只读）。你的编辑仍保留在本地，可导出 PNG。', []);
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
      let recipe = await hydrateNames(R.fromResult(result, names));
      if (result.document.schemaVersion !== R.SCHEMA_VERSION) {
        // v1 document: only the accent exists, so derive the theme from it.
        const key = primaryKey(style);
        const base = paletteOf(style).find(p => p.key === key)?.value;
        recipe = { ...recipe, theme: key && base && recipe.accent !== base ? sanitizeTheme({ colors: { [key]: recipe.accent } }, style) : emptyTheme() };
      }
      const fp = R.fingerprint(recipe);
      // Restore this recipe's undo history only if it ends exactly at what the server has now.
      const stored = storage.loadHistory(id);
      const restored = R.unpackHistory(stored?.history);
      const usable = restored && R.fingerprint(restored.present) === fp;
      const history = usable ? { ...restored, present: { ...restored.present, id, version: result.version } } : R.createHistory(recipe);
      store.set({ history, savedFp: fp, selected: -1, replacing: false });
      storage.clearDraft();
      storage.saveLast({ id, title: recipe.title });
      await actions.syncLibraryStyle(recipe.style);
      feedback.hideBanner();
      $('resume').hidden = true;
      $('canvas-status').textContent = `已恢复配方 · 版本 ${result.version}` + (usable && history.past.length ? `（保留了 ${history.past.length} 步撤销历史）` : '');
      refreshRevisions();
    } catch (error) {
      feedback.banner(error.kind === 'notfound' ? '未找到该配方 ID，请检查后重试。' : '恢复失败：' + error.message, error.retryable ? [{ label: '重试', run: () => load(id, { force }) }] : []);
    } finally { store.set({ saving: false }); }
  }

  async function newRecipe() {
    if (!await confirmDiscard('当前配方有未保存更改，新建会放弃这些更改。继续？')) return;
    // A new recipe starts in the style currently being browsed (when it has a palette) and keeps the canvas size.
    const browsed = actions.browsedStyle?.();
    const recipe = freshRecipe(styleOf(browsed)?.colors ? browsed : present().style, '新设计', present().canvas);
    store.set({ history: R.createHistory({ ...recipe, canvas: { ...recipe.canvas, background: null } }), savedFp: R.fingerprint(recipe), selected: -1, replacing: false });
    $('recipeId').value = '';
    storage.clearDraft();
    refreshRevisions();
  }

  async function offerDraft() {
    const draft = storage.loadDraft();
    const restored = R.unpackHistory(draft?.history) ?? (draft?.recipe ? { past: [], present: R.sanitizeRecipe(draft.recipe), future: [], key: null } : null);
    const recipe = restored?.present;
    if (!recipe || !recipe.layers.length || !styleOf(recipe.style)) { offerResume(); return; }
    const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString('zh-CN') : '';
    if (!await feedback.confirm(`发现未保存的本地草稿（${when}，${recipe.layers.length} 个图层）。恢复吗？`, '恢复草稿', '丢弃草稿')) { storage.clearDraft(); offerResume(); return; }
    for (const layer of recipe.layers) if (layer.type === 'component' && layer.name) names.set(layer.assetId, layer.name);
    store.set({ history: restored, savedFp: typeof draft.savedFp === 'string' ? draft.savedFp : '', selected: -1, replacing: false });
    await actions.syncLibraryStyle(recipe.style);
    refreshRevisions();
  }

  function offerResume() {
    const last = storage.loadLast();
    if (!last?.id || !ID.test(last.id) || present().layers.length) { $('resume').hidden = true; return; }
    $('resume').replaceChildren(`继续上次编辑：${String(last.title ?? last.id).slice(0, 40)} `, el('button', { type: 'button', class: 'link', text: '载入', onclick: () => load(last.id) }));
    $('resume').hidden = false;
  }

  /* ---------- server revisions (feature-flagged on the Worker) ---------- */
  async function refreshRevisions() {
    const id = present().id;
    const list = $('revisions');
    const note = $('revisions-note');
    if (!id) { list.replaceChildren(); note.textContent = '保存后可查看服务端版本历史。撤销/重做历史会在刷新后保留（本机）。'; return; }
    try {
      const { items } = await api.json(`/design-recipes/${encodeURIComponent(id)}/revisions`);
      if (id !== present().id) return;
      note.textContent = items.length ? '载入某个版本后，它会成为一次可撤销的编辑；保存会生成新版本，不会改写历史。' : '暂无历史版本。';
      list.replaceChildren(...items.map(item => el('li', {},
        `v${item.version} · ${item.title} · ${new Date(item.updatedAt).toLocaleString('zh-CN')} `,
        el('button', { type: 'button', class: 'link', text: `载入 v${item.version}`, onclick: () => restoreRevision(id, item.version) }))));
    } catch (error) {
      list.replaceChildren();
      note.textContent = error.kind === 'notfound' ? '服务端未启用版本历史；仍可使用本机撤销历史（刷新后保留）。' : '版本历史加载失败：' + error.message;
    }
  }

  async function restoreRevision(id, version) {
    try {
      const result = await api.json(`/design-recipes/${encodeURIComponent(id)}/revisions/${version}`);
      const recipe = await hydrateNames(R.fromResult(result, names));
      edit({ ...recipe, id: present().id, version: present().version }, null, { selected: -1, replacing: false });
      feedback.toast(`已载入 v${version}，保存后生成新版本`);
    } catch (error) { feedback.toast('载入失败：' + error.message); }
  }

  /* ---------- wiring ---------- */
  function init() {
    store.subscribe((state, previous) => {
      renderMeta();
      renderSlots();
      if (state.history.present !== previous.history.present) scheduleDraft();
      if (state.history.present !== previous.history.present || state.selected !== previous.selected) stage.schedule();
      if (state.history.present.style !== previous.history.present.style) stage.clearImages();
    });
    stage.init();
    inspector.init();
    $('title').oninput = () => edit({ ...present(), title: $('title').value }, 'title');
    $('title').onblur = () => renderMeta();
    $('undo').onclick = () => store.set({ history: R.undo(store.get().history) });
    $('redo').onclick = () => store.set({ history: R.redo(store.get().history) });
    $('add-text').onclick = addText;
    $('auto-arrange').onclick = () => edit(R.toGridLayout(present()));
    $('clear').onclick = async () => { if (await feedback.confirm('清空画布上的所有图层？可用「撤销」找回。', '清空')) edit({ ...present(), layers: [] }, null, { selected: -1, replacing: false }); };
    $('export').onclick = stage.exportPng;
    $('save').onclick = () => save();
    $('load').onclick = () => load($('recipeId').value);
    $('recipeId').onkeydown = event => { if (event.key === 'Enter') load($('recipeId').value); };
    $('new').onclick = newRecipe;
    $('revisions-box').addEventListener('toggle', () => { if ($('revisions-box').open) refreshRevisions(); });
    $('canvas').addEventListener('keydown', event => {
      const count = present().layers.length;
      const index = store.get().selected;
      if (!count) return;
      if (event.altKey && event.key.startsWith('Arrow') && index >= 0) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        guard(() => {
          const base = present().layers[index].type === 'component' ? R.toFreeLayout(present()) : present();
          const layer = base.layers[index];
          edit(R.updateLayer(base, index, { x: layer.x + dx, y: layer.y + dy }), `nudge:${layer.id}`);
        });
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); store.set({ selected: (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count }); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && index >= 0) { event.preventDefault(); remove(index); }
      else if (event.key === 'Escape') store.set({ selected: -1, replacing: false });
    });
    document.addEventListener('keydown', event => {
      const typing = event.target.closest?.('input, textarea, select');
      if (typing || !(event.ctrlKey || event.metaKey) || $('app').hidden) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); store.set({ history: R.undo(store.get().history) }); }
      else if (key === 'y' || key === 'z') { event.preventDefault(); store.set({ history: R.redo(store.get().history) }); }
    });
    window.addEventListener('beforeunload', event => { persistLocal(); if (hasWork()) { event.preventDefault(); event.returnValue = ''; } });
    renderMeta();
    renderSlots();
  }

  const reset = recipe => store.set({ history: R.createHistory(recipe), savedFp: R.fingerprint(recipe), selected: -1, replacing: false });
  return { init, addAsset, setTheme, load, offerDraft, freshRecipe, reset, repaint: () => { stage.clearImages(); stage.schedule(); }, present, hasWork, refreshRevisions };
}
