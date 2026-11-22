import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const dbId = process.env.DESIGN_SANDBOX_DB_ID;
const worker = 'shirley-design-intelligence-test';
if (!/^[0-9a-f]{32}$/.test(account) || !/^[0-9a-f-]{36}$/.test(dbId) || !token) throw Error('Missing sandbox deployment environment');
const root = '/accounts/' + account;
const scriptPath = root + '/workers/scripts/' + worker;
const databasePath = root + '/d1/database/' + dbId;
async function api(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error('Cloudflare ' + method + ' returned ' + response.status);
  const data = await response.json();
  if (!data.success) throw Error('Cloudflare rejected ' + method);
  return data.result;
}
const [settings, db] = await Promise.all([api(scriptPath + '/settings'), api(databasePath)]);
if (db.name !== worker || !settings.bindings.some(binding => binding.name === 'DB' && binding.id === dbId)) throw Error('Sandbox binding mismatch');
if (process.argv[2] === 'import') {
  const dir = process.argv[3] ?? '.local/incremental';
  const { batches } = JSON.parse(readFileSync(dir + '/counts.json'));
  let changes = 0;
  for (let i = 0; i < batches; i++) {
    const response = await api(databasePath + '/query', { method: 'POST', body: JSON.parse(readFileSync(dir + '/batch-' + i + '.json')) });
    if (!response.every(query => query.success)) throw Error('D1 batch failed at ' + i);
    changes += response.reduce((sum, query) => sum + Number(query.meta?.changes ?? 0), 0);
  }
  console.log(JSON.stringify({ batches, changes }));
} else if (process.argv[2] === 'deploy') {
  const bindings = [{ type: 'd1', name: 'DB', id: dbId }, { type: 'plain_text', name: 'DESIGN_D1_CACHE', text: 'enabled' }];
  for (const name of ['DESIGN_UPLOAD_FOLDER','DESIGN_UPLOAD_BRAND']) {
    const prior=settings.bindings.find(binding=>binding.name===name&&binding.type==='plain_text');
    const value=process.env[name]??prior?.text;
    if (value) {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw Error('Invalid upload binding');
      bindings.push({type:'plain_text',name,text:value});
    }
  }
  if (process.env.DESIGN_PRINCIPALS_FILE) {
    const data = JSON.parse(readFileSync(process.env.DESIGN_PRINCIPALS_FILE));
    if (!Array.isArray(data) || !data.length || data.some(row => !/^[\w.-]{24,512}$/.test(row.token ?? '') || !/^[\w-]{1,100}$/.test(row.brandId ?? '') || !/^[\w-]{1,100}$/.test(row.tenantId ?? '') || typeof row.write !== 'boolean')) throw Error('Invalid principal manifest');
    const principals = Object.fromEntries(data.map(({ token, tenantId, brandId, write }) =>
      [createHash('sha256').update(token).digest('hex'), { tenantId, brandId, write }]));
    bindings.push({ type: 'secret_text', name: 'DESIGN_PRINCIPALS', text: JSON.stringify(principals) });
  } else {
    if (!settings.bindings.some(binding => binding.name === 'DESIGN_PRINCIPALS' && binding.type === 'secret_text')) throw Error('Missing existing principal secret');
    bindings.push({ type: 'inherit', name: 'DESIGN_PRINCIPALS' });
  }
  const form = new FormData();
  const metadata = { main_module: 'design-worker.mjs', compatibility_date: '2026-11-22', bindings, observability: { enabled: true, traces: { enabled: true, head_sampling_rate: 0.1 } } };
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('design-worker.mjs', new Blob([readFileSync('.local/design-worker.mjs')], { type: 'application/javascript+module' }), 'design-worker.mjs');
  const result = await api(scriptPath, { method: 'PUT', body: form });
  console.log(JSON.stringify({ deployment: result.deployment_id, etag: result.etag }));
} else {
  throw Error('Expected import or deploy');
}
