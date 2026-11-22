import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The REST upload connector can deploy JavaScript modules without Wrangler auth.
// Only these public UI files are embedded. Scoped media is served by the Worker.
const output = process.argv[2] ?? '.local/design-worker.mjs';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const files = {
  '/index.html': ['text/html; charset=utf-8', read('public/index.html')],
  '/app.mjs': ['text/javascript; charset=utf-8', read('public/app.mjs')],
  '/canvas.mjs': ['text/javascript; charset=utf-8', read('public/canvas.mjs')],
  '/style.css': ['text/css; charset=utf-8', read('public/style.css')]
};
for (const file of readdirSync(new URL('../public/ui', import.meta.url))) {
  if (/^[\w-]+\.mjs$/.test(file)) files['/ui/' + file] = ['text/javascript; charset=utf-8', read('public/ui/' + file)];
}
const headers = Object.fromEntries(read('public/_headers').split('\n').filter(line => line.startsWith('  ')).map(line => {
  const separator = line.indexOf(':');
  return [line.slice(2, separator), line.slice(separator + 1).trim()];
}));
const recipe = read('src/recipe.mjs').replaceAll(/^export /gm, '');
const model = read('public/ui/visual-features.mjs').match(/^export const MODEL = .*;$/m)[0].replace('export ', '');
const extension = read('src/intelligence.mjs').replace(/^import .*\n/m, '').replaceAll(/^export /gm, '');
const source = read('src/worker.mjs').replace("import { recipeDocument, validId } from './recipe.mjs';", recipe)
  .replace("import { intelligence } from './intelligence.mjs';", model + '\n' + extension);
const moduleText = source.replace('export default {', 'const application = {') + `
const shellFiles = ${JSON.stringify(files)};
const shellHeaders = ${JSON.stringify(headers)};
const staticFiles = { fetch(request) {
  const path = new URL(request.url).pathname;
  const file = shellFiles[path === '/' ? '/index.html' : path];
  if (!file) return new Response(null, { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  return new Response(request.method === 'HEAD' ? null : file[1], {
    headers: { ...shellHeaders, 'Content-Type': file[0], 'Cache-Control': 'no-cache' }
  });
} };
export default { fetch(request, env) {
  return application.fetch(request, { ...env, STATIC: staticFiles });
} };
`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, moduleText);
