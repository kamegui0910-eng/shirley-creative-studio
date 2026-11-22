import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/ui/recipe.mjs';
import { gridLayout, resolveGeometry, hitLayers, layerBox, toLocal, fromLocal, handlePoints, hitHandle, scaleFromDrag, rotationFromDrag, textSize } from '../public/canvas.mjs';

const measure = (font, line) => line.length * 10;
const seed = () => {
  let r = R.emptyRecipe({ style: 'pixel', accent: '#aabbcc' });
  for (const id of ['a', 'b', 'c']) r = R.addComponent(r, { assetId: id, name: id + '.svg' }, 'L' + id);
  return r;
};
const ids = r => r.layers.map(l => l.id);

test('layers: add/replace/remove/duplicate/move keep identity, order and limits', () => {
  let r = seed();
  r = R.replaceComponent(r, 1, { assetId: 'x', name: 'x.svg' });
  assert.deepEqual(r.layers.map(l => l.assetId), ['a', 'x', 'c']);
  assert.equal(r.layers[1].id, 'Lb', 'replace keeps the instance (id)');
  r = R.updateLayer(r, 1, { scale: 2, rotation: 30, colors: { pink: '#112233' } });
  r = R.replaceComponent(r, 1, { assetId: 'y', name: 'y.svg' });
  assert.deepEqual([r.layers[1].scale, r.layers[1].rotation, r.layers[1].colors], [2, 30, { pink: '#112233' }], 'replace keeps transform and colors');
  r = R.duplicateLayer(r, 0, 'copy');
  assert.deepEqual(ids(r), ['La', 'copy', 'Lb', 'Lc']);
  const moved = R.moveLayer(r, 3, -1);
  assert.deepEqual(ids(moved.recipe), ['La', 'copy', 'Lc', 'Lb']);
  assert.equal(moved.index, 2);
  assert.equal(R.moveLayer(r, 0, -1).index, 0, 'moving past the edge is a no-op');
  assert.deepEqual(ids(R.removeLayer(r, 0)), ['copy', 'Lb', 'Lc']);
  assert.throws(() => R.removeLayer(r, 9), R.RecipeError);
  assert.throws(() => R.replaceComponent(R.addLayer(r, R.textLayer(r, {}, 't')), 4, { assetId: 'z' }), /只能替换组件/);
});

test('layers: type limits are enforced separately for components, texts and total', () => {
  let r = R.emptyRecipe({ style: 'pixel' });
  for (let i = 0; i < R.MAX_COMPONENTS; i++) r = R.addComponent(r, { assetId: 'a' }, 'c' + i);
  assert.throws(() => R.addComponent(r, { assetId: 'a' }), /12/);
  assert.throws(() => R.duplicateLayer(r, 0), R.RecipeError);
  for (let i = 0; i < R.MAX_TEXTS; i++) r = R.addLayer(r, R.textLayer(r, {}, 't' + i));
  assert.throws(() => R.addLayer(r, R.textLayer(r, {})), /文字图层/);
  assert.equal(r.layers.length, 24);
});

test('transform edits clamp to the schema range; locked layers refuse edits but can be unlocked', () => {
  let r = seed();
  r = R.updateLayer(r, 0, { scale: 1000, rotation: 540, opacity: -3, x: 1e9 });
  assert.deepEqual([r.layers[0].scale, r.layers[0].rotation, r.layers[0].opacity, r.layers[0].x], [20, -180, 0, 8192]);
  r = R.updateLayer(r, 0, { locked: true });
  assert.throws(() => R.updateLayer(r, 0, { x: 5 }), /已锁定/);
  assert.throws(() => R.replaceComponent(r, 0, { assetId: 'q' }), /已锁定/);
  assert.equal(R.updateLayer(r, 0, { opacity: 0.5 }).layers[0].opacity, 0.5, 'non-geometric edits stay allowed');
  assert.equal(R.updateLayer(r, 0, { locked: false }).layers[0].locked, false);
  const t = R.addLayer(r, R.textLayer(r, { text: '标题文字' }, 't'));
  assert.throws(() => R.updateLayer(t, 3, { text: '' }), /1–500/);
  assert.throws(() => R.updateLayer(t, 3, { color: 'red' }), /颜色/);
  assert.equal(R.updateLayer(t, 3, { text: '新标题很长很长很长很长' }).layers[3].name, '新标题很长很长很长很长'.slice(0, 12), 'auto name follows text');
});

test('layout: grid auto-places components; first manual move freezes it; auto-arrange restores', () => {
  let r = seed();
  const rects = gridLayout(3, 640, 480);
  const geoms = resolveGeometry(r, measure);
  assert.deepEqual(geoms.map(g => [g.cx, g.cy]), rects.map(c => [c.x + c.w / 2, c.y + c.h / 2]));
  const frozen = R.toFreeLayout(r);
  assert.equal(frozen.layout, 'free');
  assert.deepEqual(resolveGeometry(frozen, measure).map(g => [g.cx, g.cy, g.w, g.h]), geoms.map(g => [g.cx, g.cy, g.w, g.h]).map(row => row.map(v => Math.round(v * 100) / 100)), 'freezing does not move anything');
  const dragged = R.updateLayer(frozen, 0, { x: 50, y: 60 });
  assert.deepEqual([resolveGeometry(dragged, measure)[0].cx, resolveGeometry(dragged, measure)[1].cx], [50, geoms[1].cx]);
  assert.equal(R.toGridLayout(dragged).layout, 'grid');
  assert.equal(R.toFreeLayout(frozen), frozen, 'idempotent');
});

test('layout: texts stay absolute in grid mode; new free components are placed near the center', () => {
  let r = R.addLayer(seed(), R.textLayer(seed(), { text: 'hi' }, 't'));
  const g = resolveGeometry(r, measure);
  assert.deepEqual([g[3].cx, g[3].cy], [r.layers[3].x, r.layers[3].y]);
  let free = R.toFreeLayout(R.emptyRecipe({ style: 'pixel' }));
  free = R.addComponent(free, { assetId: 'a' }, 'n');
  assert.deepEqual([free.layers[0].x, free.layers[0].y], [320, 240]);
  assert.ok(free.layers[0].w > 0);
});

test('canvas resize keeps the composition proportional', () => {
  let r = R.toFreeLayout(seed());
  r = R.updateLayer(r, 0, { x: 160, y: 120 });
  const big = R.setCanvas(r, { width: 1280, height: 960 });
  assert.deepEqual([big.layers[0].x, big.layers[0].y], [320, 240]);
  assert.ok(Math.abs(big.layers[0].w / r.layers[0].w - 2) < 0.02);
  const tall = R.setCanvas(r, { width: 1080, height: 1920, background: '#ff00ff' });
  assert.equal(tall.canvas.background, '#ff00ff');
  assert.equal(R.setCanvas(tall, { background: 'nope' }).canvas.background, '#ff00ff', 'invalid background is ignored');
  assert.equal(R.setCanvas(r, { width: 5, height: 99999 }).canvas.width, 64, 'clamped to schema range');
});

test('geometry: rotation-aware hit testing, handles, and drag math', () => {
  let r = R.toFreeLayout(seed());
  r = R.updateLayer(r, 0, { x: 200, y: 200, w: 100, h: 40, rotation: 90, scale: 1 });
  const geoms = resolveGeometry(r, measure);
  assert.equal(hitLayers(r.layers, geoms, 200, 200 + 45), 0, 'a 100×40 box rotated 90° is tall');
  assert.equal(hitLayers(r.layers, geoms, 200 + 45, 200), -1);
  const hidden = { ...r, layers: r.layers.map((l, i) => i === 0 ? { ...l, visible: false } : l) };
  assert.equal(hitLayers(hidden.layers, geoms, 200, 245), -1, 'hidden layers are not hit');
  const box = layerBox(r.layers[0], geoms[0]);
  const back = fromLocal(box, ...Object.values(toLocal(box, 233, 187)));
  assert.ok(Math.hypot(back.x - 233, back.y - 187) < 1e-9);
  const points = handlePoints({ cx: 100, cy: 100, w: 40, h: 20, rotation: 0 }, 1);
  assert.deepEqual([points.scale.x, points.scale.y], [120, 110]);
  assert.equal(hitHandle({ cx: 100, cy: 100, w: 40, h: 20, rotation: 0 }, 121, 111), 'scale');
  assert.equal(hitHandle({ cx: 100, cy: 100, w: 40, h: 20, rotation: 0 }, 100, 100 - 10 - 26), 'rotate');
  assert.equal(hitHandle({ cx: 100, cy: 100, w: 40, h: 20, rotation: 0 }, 100, 100), null);
  const b = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
  assert.equal(scaleFromDrag(b, { x: 10, y: 0 }, { x: 20, y: 0 }, 1.5), 3);
  assert.equal(Math.round(rotationFromDrag(b, { x: 0, y: -50 })), 0, 'dragging straight up is 0°');
  assert.equal(Math.round(rotationFromDrag(b, { x: 50, y: 0 })), 90);
});

test('text size follows lines and font size', () => {
  const layer = R.textLayer(R.emptyRecipe({ style: 'p' }), { text: 'ab\nabcd' }, 't');
  const size = textSize({ ...layer, fontSize: 20 }, measure);
  assert.deepEqual([size.w, size.h], [40, 50]);
});

test('history: undo/redo, coalescing, redo cleared by new edits, and packing for storage', () => {
  let h = R.createHistory(R.emptyRecipe({ title: 'a' }));
  h = R.commit(h, { ...h.present, title: 'ab' }, 'title');
  h = R.commit(h, { ...h.present, title: 'abc' }, 'title');
  assert.equal(h.past.length, 1, 'typing coalesces into one step');
  h = R.undo(h);
  assert.equal(h.present.title, 'a');
  h = R.redo(h);
  assert.equal(h.present.title, 'abc');
  h = R.undo(h);
  h = R.commit(h, { ...h.present, title: 'z' });
  assert.equal(h.future.length, 0);
  assert.equal(R.undo(R.createHistory(R.emptyRecipe())).past.length, 0);
  // a long history is capped when stored, and restored through the sanitizer
  let long = R.createHistory(R.emptyRecipe({ style: 'pixel' }));
  for (let i = 0; i < 80; i++) long = R.commit(long, R.addComponent({ ...long.present, layers: [] }, { assetId: 'a' }, 'k' + i));
  const packed = R.packHistory(long);
  assert.equal(packed.past.length, R.HISTORY_STORE_LIMIT);
  const back = R.unpackHistory(JSON.parse(JSON.stringify(packed)));
  assert.equal(back.past.length, R.HISTORY_STORE_LIMIT);
  assert.equal(R.fingerprint(back.present), R.fingerprint(long.present));
  assert.equal(R.unpackHistory({ present: { style: '../x' } }), null);
  assert.equal(R.unpackHistory(null), null);
});

test('history: undo/redo never roll back recipe identity (id/version)', () => {
  let h = R.createHistory(R.emptyRecipe({ style: 'pixel' }));
  h = R.commit(h, R.addComponent(h.present, { assetId: 'a' }, 'l1'));
  h = { ...h, present: { ...h.present, id: 'saved-id', version: 3 } }; // what a successful save does
  h = R.commit(h, R.addComponent(h.present, { assetId: 'b' }, 'l2'));
  h = R.undo(R.undo(h));
  assert.equal(h.present.layers.length, 0);
  assert.deepEqual([h.present.id, h.present.version], ['saved-id', 3], 'undo past the first save keeps the id');
  h = R.redo(R.redo(h));
  assert.deepEqual([h.present.id, h.present.version, h.present.layers.length], ['saved-id', 3, 2]);
});

test('fingerprint ignores ids/version bookkeeping but sees every persisted edit', () => {
  const r = R.toFreeLayout(seed());
  const same = { ...r, id: 'other', version: 9 };
  assert.equal(R.fingerprint(same), R.fingerprint(r));
  for (const changed of [R.updateLayer(r, 0, { x: r.layers[0].x + 1 }), R.updateLayer(r, 0, { colors: { pink: '#010203' } }), R.setCanvas(r, { width: 700 }),
    { ...r, title: 'x' }, R.toGridLayout(r), R.withTheme(r, { colors: { pink: '#010203' }, tokens: {} }), R.updateLayer(r, 1, { visible: false })]) {
    assert.notEqual(R.fingerprint(changed), R.fingerprint(r));
  }
});

test('validation reports what blocks saving', () => {
  assert.deepEqual(R.validate(R.emptyRecipe()), ['请先选择风格', '画布为空，请至少添加一个图层']);
  assert.deepEqual(R.validate({ ...seed(), title: '  ' }), ['请填写配方名称']);
});
