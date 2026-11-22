// Asset detail dialog: SVG (theme applied) / PNG preview, rights & provenance, lineage, add/replace actions.
import { $, el, RIGHTS, REVIEW, KIND } from './core.mjs';
import { applyTheme } from './theme.mjs';

export function createDetail({ api, assets, store, actions }) {
  let seq = 0;
  const urls = [];
  const release = () => { for (const url of urls.splice(0)) URL.revokeObjectURL(url); };

  const row = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', {}, value));

  async function open(assetId) {
    const mine = ++seq;
    const dialog = $('detail');
    $('detail-title').textContent = '素材详情';
    $('detail-body').replaceChildren(el('p', { class: 'state', text: '加载中…' }));
    if (!dialog.open) dialog.showModal();
    try {
      const item = await api.json('/assets/' + encodeURIComponent(assetId));
      if (mine !== seq) return;
      render(item);
    } catch (error) {
      if (mine !== seq) return;
      $('detail-body').replaceChildren(el('div', { class: 'state', 'data-kind': 'error' }, el('p', { text: error.message }), el('button', { type: 'button', text: '重试', onclick: () => open(assetId) })));
    }
  }

  function render(item) {
    release();
    $('detail-title').textContent = item.name;
    const state = store.get();
    const style = state.styles.find(s => s.id === item.styles[0]);
    const hasVector = item.variants.some(v => v.kind === 'vector');
    const hasPreview = item.variants.some(v => v.kind === 'preview');
    const viewer = el('div', { class: 'viewer', 'data-state': 'loading' });
    const img = el('img', { alt: item.name + ' 预览' });
    viewer.append(img, el('p', { class: 'viewer-msg', text: '加载中…' }));
    let mode = hasVector ? 'vector' : 'preview';
    const modeButtons = el('div', { class: 'seg', role: 'group', 'aria-label': '预览方式' });
    const show = async next => {
      mode = next;
      modeButtons.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      viewer.dataset.state = 'loading';
      viewer.querySelector('.viewer-msg').textContent = '加载中…';
      try {
        let url = null;
        if (mode === 'vector') {
          const svg = applyTheme(await assets.vector(item.assetId), style, store.get().theme);
          url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          urls.push(url);
        } else url = await assets.preview(item.assetId);
        if (!url) throw Object.assign(Error('无缓存预览'), { kind: 'notfound' });
        img.src = url;
        viewer.dataset.state = 'ready';
      } catch (error) {
        viewer.dataset.state = 'error';
        viewer.querySelector('.viewer-msg').textContent = error.kind === 'notfound' ? '此素材暂无可用预览' : '预览加载失败：' + error.message;
      }
    };
    for (const [key, label, available] of [['vector', '矢量（应用当前主题）', hasVector], ['preview', 'PNG 预览', hasPreview]]) {
      if (available) modeButtons.append(el('button', { type: 'button', 'data-mode': key, 'aria-pressed': String(key === mode), text: label, onclick: () => show(key) }));
    }
    const rightsBadge = el('span', { class: 'badge', 'data-rights': item.rights, text: RIGHTS[item.rights] ?? item.rights });
    const publishable = item.rights === 'commercial_ready' && item.review === 'approved' && item.evidence?.trim();
    const notice = el('p', { class: publishable ? 'notice ok' : 'notice warn', text: publishable ? '已具备商用证据，可用于对外发布。' : '尚未满足商用条件（需权利为「可商用」、审核通过且有证据）。仅限内部预览。' });
    const taxonomy = (ids, labelOf) => ids.length ? ids.map(id => labelOf(id)).join('、') : '—';
    const styleLabel = id => state.styles.find(s => s.id === id)?.label ?? id;
    const meta = el('dl', { class: 'meta' },
      row('类型', KIND[item.kind] ?? item.kind), row('权利', rightsBadge), row('审核', REVIEW[item.review] ?? item.review),
      row('风格', taxonomy(item.styles, styleLabel)), row('分类', taxonomy(item.categories, id => id)),
      row('版本', String(item.version)), row('Drive 文件', el('code', { text: item.driveFileId })), row('素材 ID', el('code', { text: item.assetId })));
    const actionsRow = el('div', { class: 'row' });
    if (item.kind === 'component' && item.styles[0]) {
      const replacing = state.replacing;
      actionsRow.append(el('button', { type: 'button', class: 'primary', 'data-detail-add': '', text: replacing ? '替换选中组件' : '添加到配方', onclick: async () => { if (await actions.addAsset({ assetId: item.assetId, name: item.name }, item.styles[0])) $('detail').close(); } }));
    }
    const lineage = item.lineage.length ? el('section', {}, el('h3', { text: '血缘' }), el('ul', { class: 'plain' }, item.lineage.map(link =>
      el('li', {}, el('button', { type: 'button', class: 'link', text: link.assetId, onclick: () => open(link.assetId) }), ' · ' + link.relation)))) : null;
    const variants = el('section', {}, el('h3', { text: '变体' }), item.variants.length
      ? el('ul', { class: 'plain' }, item.variants.map(v => el('li', {}, v.kind + (v.driveFileId ? ' · Drive ' : ' · 仅缓存 '), v.driveFileId ? el('code', { text: v.driveFileId }) : null)))
      : el('p', { class: 'hint', text: '无变体' }));
    const sources = item.sources.length ? el('details', {}, el('summary', { text: `来源记录（${item.sources.length}）` }),
      item.sources.map(s => el('pre', { class: 'source', text: s.kind + '\n' + JSON.stringify(s.payload, null, 2) }))) : null;
    $('detail-body').replaceChildren(el('div', { class: 'detail-grid' },
      el('div', {}, viewer, modeButtons),
      el('div', {}, notice, meta, actionsRow)),
    lineage, variants, sources);
    if (hasVector || hasPreview) show(mode);
    else { viewer.dataset.state = 'error'; viewer.querySelector('.viewer-msg').textContent = '此素材暂无可用预览（仅有 Drive 缩略图）'; }
  }

  $('detail-close').onclick = () => $('detail').close();
  $('detail').addEventListener('close', () => { seq++; release(); });
  $('detail').addEventListener('click', event => { if (event.target === $('detail')) $('detail').close(); });
  return { open };
}
