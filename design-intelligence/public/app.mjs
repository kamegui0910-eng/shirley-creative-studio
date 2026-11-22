// Shirley Design Intelligence preview & recipe editor: session, wiring, responsive tabs.
import { $, createStore, createAssetLoader, createFeedback } from './ui/core.mjs';
import { createApi } from './ui/api.mjs';
import { createStorage } from './ui/storage.mjs';
import { createLibrary } from './ui/library.mjs';
import { createDetail } from './ui/detail.mjs';
import { createEditor } from './ui/editor.mjs';
import { createThemePanel } from './ui/themepanel.mjs';
import { wireIntelligence } from './ui/intake-panel.mjs';
import { emptyRecipe, createHistory, fingerprint } from './ui/recipe.mjs';

const TOKEN_KEY = 'shirley-di:session-token';
let token = '';
let started = false;
let intake;

const feedback = createFeedback();
const storage = createStorage();
const store = createStore({ styles: [], history: createHistory(emptyRecipe()), savedFp: fingerprint(emptyRecipe()), selected: -1, replacing: false, saving: false });
const actions = {};
const api = createApi({ getToken: () => token, onAuthFailure: () => logout('访问令牌无效或已过期，请重新登录。', { force: true }) });
const assets = createAssetLoader(api);
const library = createLibrary({ api, assets, store, actions });
const detail = createDetail({ api, assets, store, actions });
const editor = createEditor({ api, assets, store, storage, feedback, actions });
const themePanel = createThemePanel({ store, storage, feedback, editor });

Object.assign(actions, {
  openDetail: detail.open,
  addAsset: editor.addAsset,
  notify: feedback.toast,
  browsedStyle: () => library.view().style,
  syncLibraryStyle: id => library.setStyle(id, { fromRecipe: true }),
  libraryStyleChanged(id) {
    const recipe = store.get().history.present;
    const style = store.get().styles.find(s => s.id === id);
    if (style?.colors && !recipe.components.length && recipe.style !== id) editor.reset(editor.freshRecipe(id, recipe.title));
  }
});

function showTab(name) {
  $('app').dataset.tab = name;
  document.querySelectorAll('#tabs [data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === name)));
  window.scrollTo({ top: 0 });
}

function showLogin(message = '') {
  $('login').hidden = false;
  $('app').hidden = true;
  $('tabs').hidden = true;
  $('logout').hidden = true;
  $('login-error').textContent = message;
  $('login-submit').disabled = false;
  $('token').focus();
}

async function logout(message = '', { force = false } = {}) {
  if (!force && editor.hasWork() && !await feedback.confirm('当前配方有未保存更改（已保留本地草稿）。仍要退出？', '退出', '返回')) return;
  token = '';
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  assets.clear();
  intake?.clear();
  store.set({ styles: [] });
  showLogin(message);
}

async function start() {
  const styles = (await api.json('/styles')).items;
  store.set({ styles });
  const first = styles.find(s => s.colors) ?? styles[0];
  library.renderStyles();
  if (!started) {
    started = true;
    library.init();
    editor.init();
    themePanel.init();
    intake=wireIntelligence({api,actions});
    $('logout').onclick = () => logout();
    document.querySelectorAll('#tabs [data-tab]').forEach(button => { button.onclick = () => showTab(button.dataset.tab); });
    addEventListener('offline', () => { $('conn').textContent = '离线'; $('conn').hidden = false; });
    addEventListener('online', () => { $('conn').hidden = true; feedback.toast('网络已恢复'); });
  }
  $('login').hidden = true;
  $('app').hidden = false;
  $('tabs').hidden = false;
  $('logout').hidden = false;
  showTab('library');
  if (!styles.length) { await library.search(); return; }
  const recipe = editor.freshRecipe(first.colors ? first.id : '', '新设计');
  editor.reset(recipe);
  await library.setStyle(first.id, { fromRecipe: true });
  await editor.offerDraft();
}

async function login(value, remember) {
  token = value;
  $('login-submit').disabled = true;
  $('login-error').textContent = '';
  try {
    await start();
    if (remember) { try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ } }
    $('token').value = '';
  } catch (error) {
    token = '';
    showLogin(error.kind === 'auth' ? '令牌无效，请检查后重试。' : error.message);
  }
}

$('login').onsubmit = event => {
  event.preventDefault();
  login($('token').value.trim(), $('remember').checked);
};

let saved = '';
try { saved = sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { /* storage unavailable */ }
if (saved) login(saved, true); else $('token').focus();
