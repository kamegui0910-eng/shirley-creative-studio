// Brand palette + design-token switching with local presets and CSS export.
import { $, el } from './core.mjs';
import { paletteOf, tokensOf, normalizeHex, effectiveColors, isThemeDefault, toCss, sanitizeTheme } from './theme.mjs';

export function createThemePanel({ store, storage, feedback, editor }) {
  let builtFor = null;
  const inputs = new Map(); // 'c:key' | 't:--name' -> {input, reset}

  const styleOf = () => store.get().styles.find(s => s.id === store.get().history.present.style) ?? null;

  function build(style) {
    builtFor = style?.id ?? null;
    inputs.clear();
    const palette = style ? paletteOf(style) : [];
    $('palette').replaceChildren(...palette.map(({ key, value }) => {
      const input = el('input', { type: 'color', id: 'color-' + key, value, 'data-color': key });
      const reset = el('button', { type: 'button', class: 'small', text: '还原', 'aria-label': `还原 ${key} 默认色 ${value}` });
      input.oninput = () => editor.setTheme({ ...current(), colors: { ...current().colors, [key]: input.value } }, 'color:' + key);
      reset.onclick = () => { const { [key]: _drop, ...rest } = current().colors; editor.setTheme({ ...current(), colors: rest }, null); };
      inputs.set('c:' + key, { input, reset, base: value });
      return el('div', { class: 'swatch' }, el('label', { for: 'color-' + key, text: key }), input, el('code', { text: value }), reset);
    }));
    const tokens = style ? tokensOf(style) : [];
    $('tokens').replaceChildren(...tokens.map(({ name, value, isColor }) => {
      if (!isColor) return el('tr', {}, el('th', { scope: 'row', text: name }), el('td', {}, el('code', { text: value })), el('td'));
      const input = el('input', { type: 'color', value: normalizeHex(value), 'aria-label': name, 'data-token': name });
      const reset = el('button', { type: 'button', class: 'small', text: '还原', 'aria-label': `还原 ${name}` });
      input.oninput = () => editor.setTheme({ ...current(), tokens: { ...current().tokens, [name]: input.value } }, 'token:' + name);
      reset.onclick = () => { const { [name]: _drop, ...rest } = current().tokens; editor.setTheme({ ...current(), tokens: rest }, null); };
      inputs.set('t:' + name, { input, reset, base: normalizeHex(value) });
      return el('tr', {}, el('th', { scope: 'row', text: name }), el('td', {}, input, ' ', el('code', { text: value })), el('td', {}, reset));
    }));
    $('tokens-count').textContent = tokens.length ? `（${tokens.length}）` : '';
    $('tokens-box').hidden = !tokens.length;
    const compat = style?.tokenCompatibility;
    $('theme-note').textContent = !style ? '请先在素材库选择带配色的风格。'
      : !palette.length ? '此风格没有配色数据，仅可浏览。'
        : compat?.status === 'unresolved' ? '此风格的 Catalog Token 来源尚未解析，当前使用 kit.css 中的 Token（Token 兼容性：待确认）。'
          : '调整颜色会实时作用于画布与矢量详情；列表缩略图保持原始 PNG。';
    refreshPresets(style);
  }

  const current = () => store.get().history.present.theme;

  function sync() {
    const style = styleOf();
    if ((style?.id ?? null) !== builtFor) build(style);
    if (!style) return;
    const theme = current();
    const colors = effectiveColors(style, theme);
    for (const [key, { input, reset, base }] of inputs) {
      const isColor = key.startsWith('c:');
      const name = key.slice(2);
      const value = isColor ? colors[name] : theme.tokens[name] ?? base;
      if (input.value !== value) input.value = value;
      reset.disabled = value === base;
    }
    $('theme-reset').disabled = isThemeDefault(theme);
  }

  function refreshPresets(style) {
    const list = style ? storage.loadPresets(style.id) : [];
    $('presets').replaceChildren(...(list.length ? list.map(p => new Option(p.name, p.name)) : [new Option('暂无预设', '')]));
    $('preset-apply').disabled = $('preset-delete').disabled = !list.length;
  }

  function init() {
    $('theme-reset').onclick = () => editor.setTheme({ colors: {}, tokens: {} }, null);
    $('preset-save').onclick = () => {
      const style = styleOf();
      const name = $('preset-name').value.trim();
      if (!style) return feedback.toast('请先选择风格');
      if (!name) return feedback.toast('请填写预设名称');
      if (!storage.savePreset(style.id, { name, theme: sanitizeTheme(current(), style) })) return feedback.toast('无法写入浏览器本地存储');
      $('preset-name').value = '';
      refreshPresets(style);
      $('presets').value = name;
      feedback.toast('已保存预设 ' + name);
    };
    $('preset-apply').onclick = () => {
      const style = styleOf();
      const preset = storage.loadPresets(style?.id).find(p => p.name === $('presets').value);
      if (preset) editor.setTheme(preset.theme, null);
    };
    $('preset-delete').onclick = () => {
      const style = styleOf();
      if (style && $('presets').value) { storage.deletePreset(style.id, $('presets').value); refreshPresets(style); }
    };
    $('theme-copy').onclick = async () => {
      const style = styleOf();
      if (!style) return;
      const css = toCss(style, current());
      try { await navigator.clipboard.writeText(css); feedback.toast('已复制 CSS 变量'); }
      catch {
        let box = $('css-out');
        if (!box) { box = el('textarea', { id: 'css-out', readonly: true, rows: 8, 'aria-label': 'CSS 变量' }); $('theme-copy').closest('.row').after(box); }
        box.value = css;
        box.select();
        feedback.toast('无法写入剪贴板，请手动复制下方文本');
      }
    };
    store.subscribe(sync);
    sync();
  }
  return { init, sync };
}
