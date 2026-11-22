import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openIndex } from './import.mjs';
import worker, { tokenDigest } from '../src/worker.mjs';

export function sqliteBinding(db) {
  return { prepare(sql) {
    return { bind(...args) {
      const statement = db.prepare(sql);
      return { all: async () => ({ results: statement.all(...args) }), first: async () => statement.get(...args) ?? null, run: async () => ({ meta: statement.run(...args) }) };
    } };
  } };
}

export function localCache(directory) {
  const base = resolve(directory);
  return { async get(key) {
    const path = resolve(base, key);
    if (!path.startsWith(base + '/')) return null;
    try {
      if ((await stat(path)).isFile()) return { body: Readable.toWeb(createReadStream(path)) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return null;
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT ?? 8787);
  const token = process.env.DESIGN_DEV_TOKEN ?? randomBytes(32).toString('hex');
  // `--demo` serves a synthetic index (no private Drive data) so the UI can be tried without the importer.
  const demo = process.argv.includes('--demo');
  if (demo) (await import('./seed-demo.mjs')).seedDemo('.local/demo');
  // DESIGN_UPSTREAM=<https origin> serves this UI locally and forwards API calls to a deployed Design API.
  // The bearer token comes from DESIGN_API_TOKEN and is added here, so it never reaches the browser.
  const upstream = process.env.DESIGN_UPSTREAM ? new URL(process.env.DESIGN_UPSTREAM) : null;
  if (upstream && !process.env.DESIGN_API_TOKEN) { console.error('DESIGN_API_TOKEN is required with DESIGN_UPSTREAM'); process.exit(1); }
  const db = upstream ? null : openIndex(process.env.DESIGN_DEV_DB ?? (demo ? '.local/demo/index.sqlite' : '.local/index.sqlite'));
  const assets = localCache('public');
  const types = { html: 'text/html', mjs: 'text/javascript', css: 'text/css' };
  const env = {
    DB: db && sqliteBinding(db), CACHE: localCache(process.env.DESIGN_DEV_CACHE ?? (demo ? '.local/demo/cache' : '.local/cache')),
    // Revisions are on in demo mode; DESIGN_DEV_READONLY_TOKEN adds a write:false principal (used by tests).
    DESIGN_REVISIONS: process.env.DESIGN_REVISIONS ?? (demo ? 'enabled' : undefined),
    DESIGN_PRINCIPALS: JSON.stringify({
      [await tokenDigest(token)]: { tenantId: 'studio', brandId: 'shirley', write: true },
      ...(process.env.DESIGN_DEV_READONLY_TOKEN ? { [await tokenDigest(process.env.DESIGN_DEV_READONLY_TOKEN)]: { tenantId: 'studio', brandId: 'shirley', write: false } } : {})
    }),
    STATIC: { async fetch(request) {
      const name = new URL(request.url).pathname.slice(1) || 'index.html';
      const file = await assets.get(name);
      return file ? new Response(file.body, { headers: { 'Content-Type': types[name.split('.').at(-1)],
        'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } }) : new Response(null, { status: 404 });
    } }
  };
  const isStatic = pathname => ['/', '/index.html', '/app.mjs', '/canvas.mjs', '/style.css'].includes(pathname) || /^\/ui\/[\w-]+\.mjs$/.test(pathname);
  async function forward(req, res) {
    const target = new URL(req.url, upstream);
    if (!req.url.startsWith('/') || req.url.startsWith('//') || target.origin !== upstream.origin) { res.writeHead(400).end(); return; }
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(await Array.fromAsync(req));
    const response = await fetch(target, { method: req.method, body, redirect: 'manual',
      headers: { Authorization: 'Bearer ' + process.env.DESIGN_API_TOKEN, ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}) } });
    const headers = Object.fromEntries([...response.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)));
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  }
  createServer(async (req, res) => {
    try {
      if (upstream && !isStatic(new URL(req.url, 'http://x').pathname)) return await forward(req, res);
      const options = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD'].includes(req.method)) Object.assign(options, { body: Readable.toWeb(req), duplex: 'half' });
      const response = await worker.fetch(new Request(new URL(req.url, 'http://127.0.0.1:' + port), options), env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(upstream ? 502 : 400).end();
    }
  }).listen(port, '127.0.0.1', () => {
    console.log('Preview: http://127.0.0.1:' + port + (upstream ? '  (API → ' + upstream.origin + ')' : ''));
    if (!process.env.DESIGN_DEV_TOKEN) console.log('Local preview token: ' + token);
  });
}
