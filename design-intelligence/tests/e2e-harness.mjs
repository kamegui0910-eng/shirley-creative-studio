// Shared browser-test harness: synthetic demo index + the real Worker code via tools/dev.mjs + Chromium.
// "Real Worker, synthetic data" — NOT the deployed Cloudflare API (see tests/cloud.e2e.test.mjs for that).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDemo } from '../tools/seed-demo.mjs';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* callers skip */ }

export const TOKEN = 'e2e-owner-token-for-ui-tests-01';
export const READONLY = 'e2e-reader-token-for-ui-tests-1';
export const skip = chromium ? false : 'playwright is not installed';

export async function startHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'design-e2e-'));
  seedDemo(dir);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ['tools/dev.mjs'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PORT: String(port), DESIGN_DEV_TOKEN: TOKEN, DESIGN_DEV_READONLY_TOKEN: READONLY, DESIGN_REVISIONS: 'enabled',
      DESIGN_DEV_DB: join(dir, 'index.sqlite'), DESIGN_DEV_CACHE: join(dir, 'cache') } });
  const base = 'http://127.0.0.1:' + port;
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => { if (String(chunk).includes('Preview:')) resolve(); });
    server.on('exit', code => reject(Error('dev server exited ' + code)));
    setTimeout(() => reject(Error('dev server timeout')), 10000);
  });
  const browser = await chromium.launch();
  const api = async (path, { token = TOKEN, body } = {}) => {
    const response = await fetch(base + path, { method: body ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };

  async function context(options) {
    return browser.newContext(options ?? { viewport: { width: 1280, height: 900 } });
  }
  async function open(ctx, { token = TOKEN, login = true } = {}) {
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', error => page.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) page.errors.push(message.text()); });
    await page.goto(base);
    if (login) {
      await page.fill('#token', token);
      await page.click('#login-submit');
      await page.waitForSelector('#library .card');
    }
    return page;
  }
  async function withContext(fn, options) {
    const ctx = await context(options);
    try { await fn(ctx); } finally { await ctx.close(); }
  }
  async function close() {
    await browser.close();
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
  return { base, api, context, open, withContext, close };
}

/* ---------- page helpers ---------- */
export const slots = page => page.locator('#slots .slot');
export const addByName = (page, name) => page.locator('.card', { hasText: name }).first().locator('.card-add').click();
export const cardCount = (page, n) => page.waitForFunction(count => document.querySelectorAll('#library .card').length === count, n);
export const settle = page => page.waitForTimeout(350);
export const saved = (page, v) => page.waitForFunction(version => document.getElementById('dirty').textContent.includes('已保存 · v' + version), v);
export const slotNames = async page => (await slots(page).locator('.slot-main').allInnerTexts()).map(t => t.replace(/^\d+\.\s*/, ''));
export const canvasPng = page => page.evaluate(() => document.getElementById('canvas').toDataURL('image/png'));
export const pixel = (page, x, y) => page.evaluate(([px, py]) => Array.from(document.getElementById('canvas').getContext('2d').getImageData(px, py, 1, 1).data), [x, y]);
export const hex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

// Canvas-unit -> client coordinates for the current canvas.
export async function toClient(page, cx, cy, canvasW, canvasH) {
  const box = await page.locator('#canvas').boundingBox();
  return { x: box.x + cx / canvasW * box.width, y: box.y + cy / canvasH * box.height };
}
export const readField = (page, field) => page.locator(`#inspector [data-field="${field}"]`).first();

// Synthetic pointer drag (works for touch pointers too, which Playwright's mouse cannot emulate).
export async function pointerDrag(page, from, to, { pointerType = 'mouse', steps = 6 } = {}) {
  await page.evaluate(({ from, to, pointerType, steps }) => {
    const canvas = document.getElementById('canvas');
    const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
    fire('pointerdown', from);
    for (let i = 1; i <= steps; i++) fire('pointermove', { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps });
    fire('pointerup', to);
  }, { from, to, pointerType, steps });
}
