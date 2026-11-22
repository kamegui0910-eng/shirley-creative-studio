// Client↔server schema agreement: whatever the editor model can produce must be accepted by the Worker validator,
// and a server round trip must not change the editor's fingerprint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/ui/recipe.mjs';
import { parseRecipeV2, RECIPE_LIMITS } from '../src/worker.mjs';

const textMeasure = (font, line) => line.length * 10;
void textMeasure;
const build = () => {
  let r = R.emptyRecipe({ style: 'pixel', accent: '#aabbcc', title: ' 海报 ' });
  r = R.addComponent(r, { assetId: 'a1', name: 'house.svg' }, 'c1');
  r = R.addComponent(r, { assetId: 'a2', name: 'heart.svg' }, 'c2');
  r = R.addLayer(r, R.textLayer(r, { text: '春季\n上新' }, 't1'));
  return r;
};
const accepted = recipe => { const out = parseRecipeV2(R.toPayload(recipe)); assert.equal(out.error, undefined, 'server rejected: ' + out.error); return out.document; };
const roundTrip = (recipe, version = 1) => R.fromResult({ id: 'x', version, document: accepted(recipe) });

test('limits agree with the server', () => {
  assert.equal(R.MAX_COMPONENTS, RECIPE_LIMITS.components);
  assert.equal(R.MAX_TEXTS, RECIPE_LIMITS.texts);
  assert.equal(R.MAX_LAYERS, RECIPE_LIMITS.layers);
});

test('grid recipe, free recipe, every preset and extreme transforms are accepted by the server', () => {
  const grid = build();
  accepted(grid);
  const free = R.toFreeLayout(grid);
  accepted(free);
  for (const preset of R.CANVAS_PRESETS) accepted(R.setCanvas(free, preset));
  let r = free;
  r = R.updateLayer(r, 0, { scale: 99, rotation: 1234, x: 1e7, y: -1e7, opacity: 7 });
  const d = accepted(r);
  assert.deepEqual([d.layers[0].scale, d.layers[0].opacity, d.layers[0].x], [20, 1, 8192]);
  assert.ok(d.layers[0].rotation >= -180 && d.layers[0].rotation <= 180);
  r = R.updateLayer(r, 1, { colors: { pink: '#112233' }, visible: false, name: 'x' });
  accepted(r);
  accepted(R.setCanvas(r, { width: 64, height: 4096, background: '#ff00ff' }));
});

test('limits: 12 components, 12 texts, 40 layers all pass; one more is refused client-side', () => {
  let r = R.emptyRecipe({ style: 'pixel' });
  for (let i = 0; i < 12; i++) r = R.addComponent(r, { assetId: 'a1' }, 'c' + i);
  for (let i = 0; i < 12; i++) r = R.addLayer(r, R.textLayer(r, {}, 't' + i));
  accepted(r);
  assert.throws(() => R.addComponent(r, { assetId: 'a1' }), /12/);
  assert.throws(() => R.addLayer(r, R.textLayer(r, {})), R.RecipeError);
});

test('fingerprint survives a server round trip (no phantom "unsaved changes")', () => {
  for (const recipe of [build(), R.toFreeLayout(build()), R.updateLayer(R.toFreeLayout(build()), 2, { text: '改\n字', color: '#112233', align: 'left', weight: 'normal' })]) {
    const back = roundTrip(recipe);
    assert.equal(R.fingerprint(back), R.fingerprint(recipe));
    assert.equal(back.version, 1);
  }
});

test('v1 documents open as an equivalent grid recipe', () => {
  const back = R.fromResult({ id: 'old', version: 4, document: { title: 't', style: 'pixel', accent: '#aabbcc', components: [{ assetId: 'a1' }, { assetId: 'a2' }] } }, new Map([['a1', 'house.svg']]));
  assert.equal(back.layout, 'grid');
  assert.deepEqual(back.layers.map(l => [l.type, l.assetId, l.name]), [['component', 'a1', 'house.svg'], ['component', 'a2', undefined]]);
  assert.ok(back.layers.every(l => l.w > 0 && l.h > 0), 'grid geometry is filled in');
  accepted(back);
});

test('sanitizeRecipe survives hostile input and keeps valid layers', () => {
  assert.equal(R.sanitizeRecipe(null), null);
  assert.equal(R.sanitizeRecipe({ style: '../x' }), null);
  const messy = R.sanitizeRecipe({ style: 'pixel', accent: 'nope', canvas: { width: 1e9, height: -5 }, layout: 'weird',
    layers: [null, 5, { type: 'component', assetId: '../etc' }, { type: 'text', text: '' }, { id: 'ok', type: 'component', assetId: 'a1', x: 'NaN', scale: 1e9, colors: { pink: 'bad', ink: '#ABCDEF' } },
      { id: 'ok', type: 'text', text: 'dup id', fontSize: 1e6 }] });
  assert.equal(messy.accent, '#ffffff');
  assert.deepEqual(messy.canvas, { width: 4096, height: 64, background: null });
  assert.equal(messy.layout, 'grid');
  assert.equal(messy.layers.length, 2);
  assert.notEqual(messy.layers[0].id, messy.layers[1].id, 'duplicate layer ids are regenerated');
  assert.deepEqual([messy.layers[0].scale, messy.layers[0].colors], [20, { ink: '#abcdef' }]);
  assert.equal(messy.layers[1].fontSize, 400);
  const { error } = parseRecipeV2(R.toPayload(R.toFreeLayout(messy)));
  assert.equal(error, undefined);
});
