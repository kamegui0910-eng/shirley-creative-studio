// Synthetic demo index for UI development and tests. Contains NO private Drive data.
// Usage: node tools/seed-demo.mjs [outDir=.local/demo]  → <outDir>/index.sqlite and <outDir>/cache/
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openIndex } from './import.mjs';

const T = 'studio', B = 'shirley';
const STYLES = {
  'pink-pixel-retro': { label: 'Pink Pixel Retro', colors: { pink: '#f6c3da', ink: '#62344f', cream: '#fff4f8', accent: '#ec9ec4' }, tokens: { '--px-ink': '#62344f', '--px-bg': '#fff4f8', '--px-radius': '2px', '--px-font': 'monospace' } },
  'pink-black-ins': { label: 'Pink Black Ins', colors: { pink: '#ff8fb8', black: '#1c1c1c', white: '#ffffff' }, tokens: { '--ins-ink': '#1c1c1c', '--ins-pop': '#ff8fb8', '--ins-radius': '12px' } }
};
const CATEGORIES = { icon: '图标', frame: '边框', sticker: '贴纸' };
const SHAPES = {
  icon: [['house', c => `<path d="M16 80 L64 30 L112 80 V112 H16Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="6"/>`], ['heart', c => `<path d="M64 108 C10 70 24 24 64 48 C104 24 118 70 64 108Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="6"/>`], ['star', c => `<path d="M64 12 L78 50 L118 52 L86 76 L98 114 L64 92 L30 114 L42 76 L10 52 L50 50Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="6"/>`], ['mail', c => `<rect x="12" y="28" width="104" height="72" fill="${c.pink}" stroke="${c.ink}" stroke-width="6"/><path d="M12 28 L64 70 L116 28" fill="none" stroke="${c.ink}" stroke-width="6"/>`], ['dot', c => `<circle cx="64" cy="64" r="44" fill="${c.pink}" stroke="${c.ink}" stroke-width="6"/>`]],
  frame: [['panel', c => `<rect x="10" y="10" width="108" height="108" rx="6" fill="none" stroke="${c.pink}" stroke-width="10"/><rect x="22" y="22" width="84" height="84" fill="none" stroke="${c.ink}" stroke-width="4"/>`], ['ticket', c => `<path d="M10 30 H118 V54 A10 10 0 0 0 118 74 V98 H10 V74 A10 10 0 0 0 10 54Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`], ['window', c => `<rect x="10" y="16" width="108" height="96" fill="#fff" stroke="${c.ink}" stroke-width="5"/><rect x="10" y="16" width="108" height="22" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`], ['bubble', c => `<path d="M14 20 H114 V90 H60 L36 112 V90 H14Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`], ['label', c => `<rect x="10" y="40" width="108" height="48" rx="24" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`]],
  sticker: [['flower', c => `<g fill="${c.pink}" stroke="${c.ink}" stroke-width="4"><circle cx="64" cy="30" r="22"/><circle cx="98" cy="64" r="22"/><circle cx="64" cy="98" r="22"/><circle cx="30" cy="64" r="22"/></g><circle cx="64" cy="64" r="16" fill="${c.ink}"/>`], ['sparkle', c => `<path d="M64 8 L74 54 L120 64 L74 74 L64 120 L54 74 L8 64 L54 54Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`], ['cloud', c => `<path d="M30 92 A24 24 0 0 1 36 46 A32 32 0 0 1 96 50 A22 22 0 0 1 98 92Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`], ['crown', c => `<path d="M14 98 L22 38 L48 66 L64 28 L80 66 L106 38 L114 98Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`], ['moon', c => `<path d="M84 14 A52 52 0 1 0 114 80 A42 42 0 0 1 84 14Z" fill="${c.pink}" stroke="${c.ink}" stroke-width="5"/>`]]
};

const svgFor = (body, inkVar) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${body.replaceAll('#62344f', inkVar ?? '#62344f')}</svg>`;

export function seedDemo(out = '.local/demo') {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'cache'), { recursive: true });
  const db = openIndex(join(out, 'index.sqlite'));
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const scope = [T, B];
  run('INSERT INTO brands VALUES (?,?,?)', ...scope, JSON.stringify({ name: 'Shirley', usage: 'internal-preview', commercialEvidenceRequired: true }));
  for (const [category, label] of Object.entries(CATEGORIES)) run('INSERT INTO categories VALUES (?,?)', category, label);
  let n = 0;
  const added = [];
  for (const [styleId, style] of Object.entries(STYLES)) {
    run('INSERT INTO styles VALUES (?,?)', styleId, style.label);
    run('INSERT INTO palettes VALUES (?,?,?,?,?,?,?)', ...scope, styleId, JSON.stringify(style.colors), JSON.stringify(style.tokens), 'demo-kit-css',
      styleId === 'pink-pixel-retro' ? JSON.stringify({ original: 'tokens.css', status: 'unresolved', replacement: 'kit.css' }) : null);
    const dark = style.colors.ink ?? style.colors.black;
    for (const [category, shapes] of Object.entries(SHAPES)) {
      for (const [name, body] of shapes) {
        const id = 'a_demo_' + styleId.split('-').map(w => w[0]).join('') + '_' + category + '_' + name;
        const colors = { pink: style.colors.pink, ink: dark };
        // Half of the pixel kit uses the kit token so token switching is visible.
        const svg = svgFor(body(colors), styleId === 'pink-pixel-retro' && n % 2 === 0 ? 'var(--px-ink, #62344f)' : dark);
        const key = `${T}/${B}/${id}/demo`;
        mkdirSync(join(out, 'cache', T, B, id), { recursive: true });
        writeFileSync(join(out, 'cache', key + '.svg'), svg);
        const rights = n === 3 ? 'restricted' : n === 7 ? 'commercial_ready' : 'unverified';
        const review = rights === 'commercial_ready' ? 'approved' : 'indexed';
        run('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)', ...scope, id, 'drive_' + id, name + '.svg', 'component', '1', rights, review, rights === 'commercial_ready' ? 'Demo licence evidence #1' : null);
        run('INSERT INTO components VALUES (?,?,?,?,?,?)', ...scope, id, category + 's/' + name + '.svg', 'demo/' + name + '.svg', styleId);
        run('INSERT INTO asset_tags VALUES (?,?,?,?,?,?)', ...scope, id, styleId, null, 'style:' + styleId);
        run('INSERT INTO asset_tags VALUES (?,?,?,?,?,?)', ...scope, id, null, category, 'category:' + category);
        run('INSERT INTO asset_sources VALUES (?,?,?,?,?,?)', ...scope, id, 'catalog', styleId + '/' + name, JSON.stringify({ file: category + 's/' + name + '.svg', category, source: 'IMG_0001-0003', note: 'demo' }));
        run('INSERT INTO asset_variants VALUES (?,?,?,?,?,?,?,?)', ...scope, id, id + ':vector', 'vector', 'drive_vec_' + id, key + '.svg', 'image/svg+xml');
        // Previews: most are cached; one has no variant row, one points at a missing file (404 path).
        if (n === 5) { /* no preview variant */ }
        else if (n === 9) run('INSERT INTO asset_variants VALUES (?,?,?,?,?,?,?,?)', ...scope, id, id + ':preview', 'preview', null, key + '.missing.png', 'image/png');
        else { writeFileSync(join(out, 'cache', key + '.preview.svg'), svg); run('INSERT INTO asset_variants VALUES (?,?,?,?,?,?,?,?)', ...scope, id, id + ':preview', 'preview', null, key + '.preview.svg', 'image/svg+xml'); }
        added.push(id);
        n++;
      }
    }
  }
  // Reference assets: one under an unstyled-palette style (browse-only), thumbnail variants only on Drive.
  run('INSERT INTO styles VALUES (?,?)', 'cottagecore-ref', 'Cottagecore 参考');
  run('INSERT INTO categories VALUES (?,?)', 'tea', '茶饮');
  for (const [i, [name, rights, review]] of [['reference-tea-01.jpg', 'reference_only', 'indexed'], ['reference-tea-02.jpg', 'restricted', 'indexed'], ['IMG_4821.JPG', 'unverified', 'pending']].entries()) {
    const id = 'a_demo_ref_' + i;
    run('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)', ...scope, id, 'drive_' + id, name, 'reference', '2026-11-14', rights, review, null);
    run('INSERT INTO asset_tags VALUES (?,?,?,?,?,?)', ...scope, id, 'cottagecore-ref', null, 'style:cottagecore-ref');
    run('INSERT INTO asset_tags VALUES (?,?,?,?,?,?)', ...scope, id, null, 'tea', 'category:tea');
    run('INSERT INTO asset_variants VALUES (?,?,?,?,?,?,?,?)', ...scope, id, id + ':thumbnail', 'thumbnail', 'drive_thumb_' + id, null, 'image/jpeg');
    run('INSERT INTO asset_sources VALUES (?,?,?,?,?,?)', ...scope, id, 'studio', String(i), JSON.stringify({ name, tags: { style: 'Cottagecore 参考', cuisine: '茶饮' } }));
    if (i === 0) run('INSERT INTO asset_lineage VALUES (?,?,?,?,?)', ...scope, added[0], id, 'visual_reference');
  }
  // Same file name in two styles, as in the real library: the UI must disambiguate by style.
  db.close();
  return { components: n, out };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(seedDemo(process.argv[2]), null, 2));
}
