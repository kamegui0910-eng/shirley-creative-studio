// Verifies the tools/dev.mjs upstream mode that the cloud E2E relies on, using a LOCAL worker as the upstream.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startHarness, skip, TOKEN } from './e2e-harness.mjs';

let h, proxy, base;
const cwd = new URL('..', import.meta.url).pathname;
before(async () => {
  if (skip) return;
  h = await startHarness();
  const port = 40000 + Math.floor(Math.random() * 10000);
  proxy = spawn(process.execPath, ['tools/dev.mjs'], { cwd, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PORT: String(port), DESIGN_UPSTREAM: h.base, DESIGN_API_TOKEN: TOKEN } });
  base = 'http://127.0.0.1:' + port;
  await new Promise((resolve, reject) => { proxy.stdout.on('data', c => String(c).includes('Preview:') && resolve()); proxy.on('exit', code => reject(Error('proxy exited ' + code))); setTimeout(() => reject(Error('timeout')), 10000); });
});
after(async () => { proxy?.kill(); await h?.close(); });

test('upstream mode: UI is served locally, API calls are forwarded with the server-side token', { skip }, async () => {
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Design Intelligence/);
  assert.equal((await fetch(base + '/ui/theme.mjs')).status, 200);
  // The browser-side token is ignored: even a bogus bearer gets the upstream's real answer.
  const styles = await fetch(base + '/styles', { headers: { Authorization: 'Bearer browser-token-is-ignored-0000' } });
  assert.equal(styles.status, 200);
  assert.ok((await styles.json()).items.length > 0);
  assert.equal((await fetch(base + '/assets/search?limit=1&kind=component')).status, 200);
  assert.equal((await fetch(base + '/session')).status, 200);
});

test('upstream mode: writes, errors and binary bodies pass through unchanged; the target is pinned', async () => {
  const body = { version: 0, title: 'via proxy', style: 'pink-pixel-retro', accent: '#f6c3da', components: [{ assetId: 'a_demo_ppr_icon_house' }] };
  const put = await fetch(base + '/design-recipes/proxy-check', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(put.status, 201);
  assert.equal((await h.api('/design-recipes/proxy-check')).json.document.title, 'via proxy', 'the write really reached the upstream');
  assert.equal((await fetch(base + '/design-recipes/missing-one')).status, 404, 'upstream 404 is preserved');
  const preview = await fetch(base + '/assets/a_demo_ppr_icon_house/preview');
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /svg/);
  assert.equal((await fetch(base + '/assets/a_demo_ppr_icon_house/vector')).status, 200);
  // protocol-relative paths must not redirect the proxy to another host
  const net = await new Promise(resolve => {
    import('node:net').then(({ connect }) => {
      const socket = connect(Number(new URL(base).port), '127.0.0.1', () => socket.write('GET //evil.example/x HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let data = '';
      socket.on('data', chunk => { data += chunk; });
      socket.on('close', () => resolve(data.split('\r\n')[0]));
    });
  });
  assert.match(net, /400/);
});
