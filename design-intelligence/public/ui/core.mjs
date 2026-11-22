// Small UI infrastructure: DOM helper, store, asset loader (preview blobs + vector text), banner/toast/confirm.
export const $ = id => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

export function createStore(initial) {
  let state = initial;
  const subscribers = new Set();
  return {
    get: () => state,
    set(patch) {
      const previous = state;
      state = { ...state, ...patch };
      for (const fn of [...subscribers]) fn(state, previous);
    },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
  };
}

// Preview PNG/SVG blobs are fetched with the bearer header, so they are held as object URLs.
export function createAssetLoader(api, { concurrency = 6, maxPreviews = 400 } = {}) {
  const previews = new Map();
  const vectors = new Map();
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      job.run().then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  };
  const schedule = run => new Promise((resolve, reject) => { queue.push({ run, resolve, reject }); pump(); });
  const evict = () => {
    while (previews.size > maxPreviews) {
      const [key, promise] = previews.entries().next().value;
      previews.delete(key);
      promise.then(url => url && URL.revokeObjectURL(url), () => {});
    }
  };
  return {
    // Resolves to an object URL, or null when the asset has no cached preview (404). Other errors reject and are not cached.
    preview(id) {
      if (!previews.has(id)) {
        const promise = schedule(async () => {
          try { return URL.createObjectURL(await api.blob('/assets/' + encodeURIComponent(id) + '/preview')); }
          catch (error) { if (error.kind === 'notfound') return null; throw error; }
        });
        previews.set(id, promise);
        promise.catch(() => previews.delete(id));
        evict();
      }
      return previews.get(id);
    },
    vector(id) {
      if (!vectors.has(id)) {
        const promise = schedule(() => api.text('/assets/' + encodeURIComponent(id) + '/vector'));
        vectors.set(id, promise);
        promise.catch(() => vectors.delete(id));
      }
      return vectors.get(id);
    },
    clear() {
      for (const promise of previews.values()) promise.then(url => url && URL.revokeObjectURL(url), () => {});
      previews.clear();
      vectors.clear();
    }
  };
}

export function createFeedback() {
  let toastTimer = 0;
  const banner = (message, actions = []) => {
    $('banner-text').textContent = message;
    $('banner-actions').replaceChildren(...actions.map(({ label, run }) => el('button', { type: 'button', text: label, onclick: () => { hideBanner(); run(); } })));
    $('banner').hidden = false;
  };
  const hideBanner = () => { $('banner').hidden = true; };
  const toast = message => {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
  };
  const confirm = (message, ok = '继续', cancel = '取消') => new Promise(resolve => {
    const dialog = $('confirm');
    $('confirm-text').textContent = message;
    $('confirm-ok').textContent = ok;
    $('confirm-cancel').textContent = cancel;
    const done = value => { dialog.close(); resolve(value); };
    $('confirm-ok').onclick = () => done(true);
    $('confirm-cancel').onclick = () => done(false);
    dialog.oncancel = event => { event.preventDefault(); done(false); };
    dialog.showModal();
  });
  $('banner-close').onclick = hideBanner;
  return { banner, hideBanner, toast, confirm };
}

export const RIGHTS = { reference_only: '仅参考', unverified: '未验证', restricted: '受限', commercial_ready: '可商用' };
export const REVIEW = { pending: '待分类', indexed: '已索引', approved: '已审核' };
export const KIND = { component: '组件', reference: '参考图' };
