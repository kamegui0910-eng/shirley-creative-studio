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
      return { all: async () => ({ results: statement.all(...args) }), first: async () => statement.get(...args) ?? null };
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
  const db = openIndex('.local/index.sqlite');
  const assets = localCache('public');
  const types = { html: 'text/html', mjs: 'text/javascript', css: 'text/css' };
  const env = {
    DB: sqliteBinding(db), CACHE: localCache('.local/cache'),
    DESIGN_PRINCIPALS: JSON.stringify({ [await tokenDigest(token)]: { tenantId: 'studio', brandId: 'shirley', write: true } }),
    STATIC: { async fetch(request) {
      const name = new URL(request.url).pathname.slice(1) || 'index.html';
      const file = await assets.get(name);
      return file ? new Response(file.body, { headers: { 'Content-Type': types[name.split('.').at(-1)],
        'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } }) : new Response(null, { status: 404 });
    } }
  };
  createServer(async (req, res) => {
    try {
      const options = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD'].includes(req.method)) Object.assign(options, { body: Readable.toWeb(req), duplex: 'half' });
      const response = await worker.fetch(new Request(new URL(req.url, 'http://127.0.0.1:' + port), options), env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch {
      res.writeHead(400).end();
    }
  }).listen(port, '127.0.0.1', () => {
    console.log('Preview: http://127.0.0.1:' + port);
    if (!process.env.DESIGN_DEV_TOKEN) console.log('Local preview token: ' + token);
  });
}
