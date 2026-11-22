// Style × Category browsing, search/filter, lazy previews, pagination, and loading/empty/error states.
import { $, el, RIGHTS, KIND } from './core.mjs';

const PAGE = 24;

export function createLibrary({ api, assets, store, actions }) {
  const view = { style: '', category: '', kind: 'component', rights: '', q: '' };
  let controller = null;
  let cursor = null;
  let loading = false;
  let total = 0;
  let searchTimer = 0;
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); entry.target.load?.(); }
    }, { rootMargin: '200px' })
    : null;

  const setState = (kind, message, action) => {
    const box = $('library-state');
    box.hidden = !kind;
    box.dataset.kind = kind ?? '';
    box.replaceChildren();
    if (!kind) return;
    box.append(el('p', { text: message }));
    if (action) box.append(el('button', { type: 'button', text: action.label, onclick: action.run }));
  };

  function card(item) {
    const isComponent = item.kind === 'component';
    const image = el('img', { alt: '', width: 96, height: 96, decoding: 'async' });
    const frame = el('div', { class: 'thumb', 'data-state': item.hasPreview ? 'loading' : 'none' }, image, el('span', { class: 'thumb-label', text: item.hasPreview ? '' : '无预览' }));
    const load = async () => {
      if (!item.hasPreview) return;
      try {
        const url = await assets.preview(item.assetId);
        if (!frame.isConnected) return;
        if (!url) { frame.dataset.state = 'none'; frame.querySelector('.thumb-label').textContent = '无预览'; return; }
        image.src = url;
        frame.dataset.state = 'ready';
      } catch {
        frame.dataset.state = 'error';
        frame.querySelector('.thumb-label').textContent = '预览失败';
        frame.append(el('button', { type: 'button', class: 'link', text: '重试', onclick: event => { event.stopPropagation(); frame.dataset.state = 'loading'; load(); } }));
      }
    };
    frame.load = load;
    if (observer) observer.observe(frame); else load();
    const open = el('button', { type: 'button', class: 'card-open', title: item.name + ' · ' + item.assetId, 'aria-label': `查看详情：${item.name}（${KIND[item.kind] ?? item.kind}，${RIGHTS[item.rights] ?? item.rights}）`, onclick: () => actions.openDetail(item.assetId) },
      frame, el('span', { class: 'card-name', text: item.name }), el('span', { class: 'badge', 'data-rights': item.rights, text: RIGHTS[item.rights] ?? item.rights }));
    const replacing = store.get().replacing;
    const add = isComponent ? el('button', { type: 'button', class: 'card-add', 'data-add': item.assetId, text: replacing ? '替换' : '添加', 'aria-label': (replacing ? '替换为 ' : '添加 ') + item.name, onclick: () => actions.addAsset({ assetId: item.assetId, name: item.name }, view.style) }) : null;
    return el('div', { class: 'card', dataset: { asset: item.assetId } }, open, add);
  }

  async function search(append = false) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    if (!append) {
      cursor = null;
      total = 0;
      $('library').replaceChildren();
      setState('loading', '加载中…');
      $('more').hidden = true;
      $('result-meta').textContent = '';
    }
    loading = true;
    $('library').setAttribute('aria-busy', 'true');
    const params = new URLSearchParams({ limit: String(PAGE) });
    for (const key of ['style', 'category', 'kind', 'rights']) if (view[key]) params.set(key, view[key]);
    if (view.q.trim()) params.set('q', view.q.trim());
    if (cursor) params.set('cursor', cursor);
    try {
      const result = await api.json('/assets/search?' + params, { signal });
      if (signal.aborted) return;
      cursor = result.nextCursor;
      total += result.items.length;
      $('library').append(...result.items.map(card));
      $('more').hidden = !cursor;
      $('result-meta').textContent = total ? `已显示 ${total} 个素材${cursor ? '，还有更多' : ''}` : '';
      if (!total) {
        const filtered = view.q.trim() || view.category || view.rights || view.kind !== 'component';
        setState('empty', filtered ? '没有符合条件的素材。试试清除搜索词或放宽筛选。' : '此风格下暂无素材。', filtered ? { label: '清除筛选', run: clearFilters } : null);
      } else setState(null);
    } catch (error) {
      if (error.kind === 'abort') return;
      if (append) { $('more').hidden = false; actions.notify(error.message); }
      else setState('error', error.message, { label: '重试', run: () => search() });
    } finally {
      if (!signal.aborted) { loading = false; $('library').setAttribute('aria-busy', 'false'); }
    }
  }

  // Category requests are cancelled and ignored when the style changes; stale chips are never shown or clickable.
  let categoryController = null;
  async function loadCategories() {
    categoryController?.abort();
    categoryController = new AbortController();
    const { signal } = categoryController;
    const style = view.style;
    const box = $('categories');
    box.setAttribute('aria-busy', 'true');
    box.replaceChildren(el('span', { class: 'hint', text: '分类加载中…' }));
    try {
      const result = await api.json('/categories' + (style ? '?style=' + encodeURIComponent(style) : ''), { signal });
      if (signal.aborted || style !== view.style) return;
      box.replaceChildren(...[{ id: '', label: '全部分类' }, ...result.items].map(item =>
        el('button', { type: 'button', class: 'chip', 'aria-pressed': String(item.id === view.category), dataset: { category: item.id }, text: item.label, onclick: () => { view.category = item.id; renderChips(); search(); } })));
    } catch (error) {
      if (error.kind !== 'abort' && !signal.aborted) box.replaceChildren(el('span', { class: 'hint', text: '分类加载失败 ' }), el('button', { type: 'button', class: 'link', text: '重试', onclick: loadCategories }));
    } finally { if (!signal.aborted) box.setAttribute('aria-busy', 'false'); }
  }
  const renderChips = () => $('categories').querySelectorAll('.chip').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.category === view.category)));

  function clearFilters() {
    Object.assign(view, { category: '', kind: 'component', rights: '', q: '' });
    $('kind').value = 'component';
    $('rights').value = '';
    $('q').value = '';
    renderChips();
    search();
  }

  function renderStyles() {
    const { styles } = store.get();
    $('style').replaceChildren(new Option('全部风格', ''), ...styles.map(item => new Option(item.label + (item.colors ? '' : '（仅浏览）'), item.id)));
    $('style').value = view.style;
  }

  async function setStyle(id, { fromRecipe = false } = {}) {
    view.style = id;
    view.category = '';
    $('style').value = id;
    if (!fromRecipe) actions.libraryStyleChanged(id);
    await Promise.all([loadCategories(), search()]);
  }

  function init() {
    renderStyles();
    $('style').onchange = () => setStyle($('style').value);
    $('kind').onchange = () => { view.kind = $('kind').value; search(); };
    $('rights').onchange = () => { view.rights = $('rights').value; search(); };
    $('q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { view.q = $('q').value; search(); }, 250); };
    $('q').onkeydown = event => { if (event.key === 'Enter') { clearTimeout(searchTimer); view.q = $('q').value; search(); } };
    $('more').onclick = () => { if (!loading) { $('more').hidden = true; search(true); } };
    store.subscribe((state, previous) => { if (state.replacing !== previous.replacing) refreshAddLabels(); });
  }
  function refreshAddLabels() {
    const replacing = store.get().replacing;
    for (const button of $('library').querySelectorAll('.card-add')) {
      button.textContent = replacing ? '替换' : '添加';
      button.setAttribute('aria-label', (replacing ? '替换为 ' : '添加 ') + button.closest('.card').querySelector('.card-name').textContent);
    }
  }

  return { init, renderStyles, setStyle, search, view: () => ({ ...view }) };
}
