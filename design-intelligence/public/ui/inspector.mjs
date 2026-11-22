// Layer inspector (transform, opacity, per-instance colors, text properties) and canvas settings.
import { $, el } from './core.mjs';
import { paletteOf, normalizeHex, tint } from './theme.mjs';
import { CANVAS_PRESETS } from './recipe.mjs';

export function createInspector({ store, ops }) {
  let builtKey = '';
  let sync = [];

  const present = () => store.get().history.present;
  const row = (label, ...controls) => el('label', { class: 'field' }, el('span', { text: label }), ...controls);
  const number = (attrs = {}) => el('input', { type: 'number', inputmode: 'decimal', ...attrs });

  function build(layer, index) {
    sync = [];
    const style = ops.styleOf(present().style);
    const box = $('inspector');
    const on = (input, event, apply, key) => input.addEventListener(event, () => { const patch = apply(input); if (patch) ops.update(patch, key ? `${layer.id}:${key}` : null); });
    const bind = (name, input, read, write, key = name) => {
      on(input, 'input', i => { const v = write(i); return v === undefined ? null : v; }, key);
      sync.push(() => {
        const current = present().layers[index];
        if (!current) return;
        const value = read(current);
        if (input.type === 'checkbox') input.checked = value;
        else if (document.activeElement !== input && String(input.value) !== String(value)) input.value = value;
        input.disabled = current.locked && ['x', 'y', 'scale', 'rotation', 'text', 'fontSize', 'weight', 'align'].some(f => f === name || name.startsWith(f));
      });
      return input;
    };
    const numeric = (name, label, attrs, read, write) => {
      const field = number({ ...attrs, 'data-field': name });
      bind(name, field, read, input => input.value === '' || !Number.isFinite(Number(input.value)) ? undefined : write(Number(input.value)), name);
      return row(label, field);
    };
    const slider = (name, label, attrs, read, write) => {
      const range = el('input', { type: 'range', ...attrs, 'data-field': name + '-range', 'aria-label': label });
      const field = number({ ...attrs, 'data-field': name, 'aria-label': label + '（数值）' });
      for (const input of [range, field]) bind(name + input.type, input, read, i => i.value === '' || !Number.isFinite(Number(i.value)) ? undefined : write(Number(i.value)), name);
      return row(label, range, field);
    };
    const name = bind('name', el('input', { type: 'text', maxlength: 120, 'data-field': 'name' }), l => l.name ?? '', i => ({ name: i.value }), 'name');
    const visible = el('input', { type: 'checkbox', 'data-field': 'visible' });
    visible.addEventListener('change', () => ops.update({ visible: visible.checked }, null));
    sync.push(() => { const l = present().layers[index]; if (l) visible.checked = l.visible; });
    const locked = el('input', { type: 'checkbox', 'data-field': 'locked' });
    locked.addEventListener('change', () => ops.update({ locked: locked.checked }, null));
    sync.push(() => { const l = present().layers[index]; if (l) locked.checked = l.locked; });
    const geom = key => () => Math.round(ops.center(index)[key]);
    const parts = [
      el('h3', { text: layer.type === 'text' ? '文字属性' : '组件属性' }),
      row('名称', name),
      el('div', { class: 'row' }, el('label', { class: 'check' }, visible, ' 显示'), el('label', { class: 'check' }, locked, ' 锁定')),
      el('div', { class: 'row' },
        numeric('x', 'X', { step: 1 }, () => geom('cx')(), v => ({ x: v, _freeze: true })),
        numeric('y', 'Y', { step: 1 }, () => geom('cy')(), v => ({ y: v, _freeze: true }))),
      slider('scale', '缩放 %', { min: 5, max: 400, step: 1 }, l => Math.round(l.scale * 100), v => ({ scale: v / 100 })),
      slider('rotation', '旋转 °', { min: -180, max: 180, step: 1 }, l => Math.round(l.rotation), v => ({ rotation: v })),
      slider('opacity', '不透明度 %', { min: 0, max: 100, step: 1 }, l => Math.round(l.opacity * 100), v => ({ opacity: v / 100 }))
    ];
    if (layer.type === 'component') {
      const swatches = paletteOf(style).map(({ key, value }) => {
        const input = el('input', { type: 'color', 'data-layer-color': key, 'aria-label': `此图层 ${key} 颜色` });
        const reset = el('button', { type: 'button', class: 'small', text: '还原', 'aria-label': `还原此图层 ${key}` });
        input.addEventListener('input', () => ops.update({ colors: { ...present().layers[index].colors, [key]: input.value } }, `${layer.id}:color:${key}`));
        reset.addEventListener('click', () => { const { [key]: _drop, ...rest } = present().layers[index].colors; ops.update({ colors: rest }, null); });
        sync.push(() => {
          const l = present().layers[index];
          if (!l) return;
          const own = l.colors?.[key];
          const effective = own ?? ops.effectiveColor(key) ?? value;
          if (input.value !== effective) input.value = effective;
          reset.disabled = !own;
        });
        return el('div', { class: 'swatch' }, el('span', { text: key }), input, reset);
      });
      if (swatches.length) parts.push(el('h3', { text: '此图层颜色' }), el('div', { class: 'swatches' }, swatches));
    } else {
      const text = el('textarea', { rows: 3, maxlength: 500, 'data-field': 'text', 'aria-label': '文字内容' });
      bind('text', text, l => l.text, i => i.value.length ? { text: i.value } : undefined, 'text');
      const size = numeric('fontSize', '字号', { min: 8, max: 400, step: 1 }, l => l.fontSize, v => ({ fontSize: v }));
      const color = el('input', { type: 'color', 'data-field': 'color', 'aria-label': '文字颜色' });
      bind('color', color, l => l.color, i => ({ color: i.value }), 'color');
      const weight = el('select', { 'data-field': 'weight', 'aria-label': '字重' }, new Option('粗体', 'bold'), new Option('常规', 'normal'));
      bind('weight', weight, l => l.weight, i => ({ weight: i.value }));
      const align = el('select', { 'data-field': 'align', 'aria-label': '对齐' }, new Option('居中', 'center'), new Option('左对齐', 'left'), new Option('右对齐', 'right'));
      bind('align', align, l => l.align, i => ({ align: i.value }));
      parts.push(row('内容', text), el('div', { class: 'row' }, size, row('颜色', color), row('字重', weight), row('对齐', align)));
    }
    box.replaceChildren(...parts);
  }

  function refresh() {
    const { selected } = store.get();
    const recipe = present();
    const layer = recipe.layers[selected];
    const box = $('inspector');
    box.hidden = !layer;
    if (!layer) { builtKey = ''; return; }
    const key = `${layer.id}|${layer.type}|${recipe.style}|${selected}`;
    if (key !== builtKey) { builtKey = key; build(layer, selected); }
    for (const fn of sync) fn();
  }

  function refreshCanvas() {
    const { canvas, layout, accent } = present();
    const preset = CANVAS_PRESETS.find(p => p.width === canvas.width && p.height === canvas.height);
    const select = $('canvas-preset');
    if (select.options.length !== CANVAS_PRESETS.length + 1) select.replaceChildren(...CANVAS_PRESETS.map(p => new Option(p.label, p.id)), new Option('自定义', 'custom'));
    select.value = preset?.id ?? 'custom';
    for (const [id, value] of [['canvas-w', canvas.width], ['canvas-h', canvas.height]]) if (document.activeElement !== $(id)) $(id).value = value;
    $('canvas-bg').value = normalizeHex(canvas.background) ?? tint(accent);
    $('canvas-bg-auto').disabled = canvas.background === null;
    $('layout-label').textContent = layout === 'grid' ? '布局：自动排列（拖动图层后转为自由布局）' : '布局：自由';
    $('auto-arrange').hidden = layout === 'grid';
  }

  function init() {
    $('canvas-preset').onchange = () => { const p = CANVAS_PRESETS.find(x => x.id === $('canvas-preset').value); if (p) ops.setCanvas({ width: p.width, height: p.height }); };
    for (const id of ['canvas-w', 'canvas-h']) $(id).onchange = () => { const w = Number($('canvas-w').value), h = Number($('canvas-h').value); if (Number.isFinite(w) && Number.isFinite(h)) ops.setCanvas({ width: w, height: h }); else refreshCanvas(); };
    $('canvas-bg').oninput = () => ops.setCanvas({ background: $('canvas-bg').value }, 'canvas-bg');
    $('canvas-bg-auto').onclick = () => ops.setCanvas({ background: null });
    store.subscribe(() => { refresh(); refreshCanvas(); });
    refresh();
    refreshCanvas();
  }
  return { init };
}
