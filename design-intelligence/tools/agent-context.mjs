import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function recipeIdFrom(input) {
  const reference = typeof input === 'string' ? input : input?.payloadRef;
  const match = typeof reference === 'string' && reference.match(/^design-recipe:([a-zA-Z0-9_-]{1,100})$/);
  if (!match) throw Error('Expected an approved design-recipe:<id> reference');
  return match[1];
}

export async function designContext(base, token, input, { fetcher = fetch } = {}) {
  const origin = new URL(base);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw Error('DESIGN_API_BASE must be an HTTPS origin');
  }
  if (typeof token !== 'string' || !/^[\w.-]{16,512}$/.test(token)) throw Error('Missing or malformed Design API read token');
  const id = recipeIdFrom(input);
  const get = async path => {
    const response = await fetcher(new URL(path, origin), { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('Design API request failed with ' + response.status);
    return response.json();
  };
  const scope = await get('/session');
  if (scope.write !== false || typeof scope.brandId !== 'string' || !/^[\w-]{1,100}$/.test(scope.brandId)) {
    throw Error('Use a brand-scoped read-only credential');
  }
  const [brand, recipe, publication] = await Promise.all([
    get('/brands/' + scope.brandId + '/design-rules'),
    get('/design-recipes/' + id),
    get('/design-recipes/' + id + '/publication-check')
  ]);
  return {
    design: { recipeId: id, brandId: scope.brandId, version: recipe.version, style: recipe.document.style,
      accent: recipe.document.accent, componentIds: recipe.document.components.map(item => item.assetId),
      publicationAllowed: publication.allowed === true },
    brandRules: brand.rules
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const argument = process.argv[2];
    const input = argument === '-' ? JSON.parse(readFileSync(0, 'utf8')) : argument;
    const result = await designContext(process.env.DESIGN_API_BASE, process.env.DESIGN_API_TOKEN, input);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
