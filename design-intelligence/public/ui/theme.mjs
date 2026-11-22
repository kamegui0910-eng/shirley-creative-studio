// Pure theme/token logic: palette overrides + design-token overrides applied to SVG text.
// A theme is { colors: {paletteKey: '#rrggbb'}, tokens: {'--name': value} } and only stores overrides.

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return '#' + hex.toLowerCase();
}

export const emptyTheme = () => ({ colors: {}, tokens: {} });

export function paletteOf(style) {
  const colors = style?.colors;
  if (!colors || typeof colors !== 'object') return [];
  return Object.entries(colors).flatMap(([key, value]) => normalizeHex(value) ? [{ key, value: normalizeHex(value) }] : []);
}

// The recipe API persists a single `accent`; it maps to this palette entry.
export function primaryKey(style) {
  const palette = paletteOf(style);
  return (palette.find(item => item.key === 'pink') ?? palette[0])?.key ?? null;
}

export function tokensOf(style) {
  const tokens = style?.tokens;
  if (!tokens || typeof tokens !== 'object') return [];
  return Object.entries(tokens)
    .filter(([name, value]) => /^--[\w-]+$/.test(name) && typeof value === 'string')
    .map(([name, value]) => ({ name, value, isColor: normalizeHex(value) !== null }));
}

// Drop unknown keys and invalid values, e.g. stale data read from localStorage.
export function sanitizeTheme(theme, style) {
  const result = emptyTheme();
  const palette = new Map(paletteOf(style).map(item => [item.key, item.value]));
  for (const [key, value] of Object.entries(theme?.colors ?? {})) {
    const hex = normalizeHex(value);
    if (palette.has(key) && hex && hex !== palette.get(key)) result.colors[key] = hex;
  }
  const tokens = new Map(tokensOf(style).filter(item => item.isColor).map(item => [item.name, normalizeHex(item.value)]));
  for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
    const hex = normalizeHex(value);
    if (tokens.has(name) && hex && hex !== tokens.get(name)) result.tokens[name] = hex;
  }
  return result;
}

export function isThemeDefault(theme) {
  return !Object.keys(theme?.colors ?? {}).length && !Object.keys(theme?.tokens ?? {}).length;
}

export function effectiveColors(style, theme) {
  return Object.fromEntries(paletteOf(style).map(({ key, value }) => [key, normalizeHex(theme?.colors?.[key]) ?? value]));
}

export function themeKey(style, theme) {
  const clean = sanitizeTheme(theme, style);
  return JSON.stringify([style?.id ?? '', Object.entries(clean.colors).sort(), Object.entries(clean.tokens).sort()]);
}

// Never rewrite hex values that are references (url(#id), href="#id") rather than colors.
const HEX = /(?<!url\()(?<!href=["'])#([0-9a-f]{6})(?![0-9a-f\w])/gi;
const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*?))?\s*\)/g;

export function applyTheme(svg, style, theme) {
  const clean = sanitizeTheme(theme, style);
  const map = new Map();
  for (const { key, value } of paletteOf(style)) {
    const next = clean.colors[key];
    if (next && !map.has(value)) map.set(value, next);
  }
  const recolor = text => text.replace(HEX, match => map.get(match.toLowerCase()) ?? match);
  const defaults = new Map(tokensOf(style).map(item => [item.name, item.value]));
  // Palette changes follow token defaults that equal a palette color; explicit token overrides win.
  const resolve = (name, fallback) => {
    if (Object.hasOwn(clean.tokens, name)) return clean.tokens[name];
    if (defaults.has(name)) return recolor(defaults.get(name));
    return fallback;
  };
  const withTokens = svg.replace(VAR, (match, name, fallback) => resolve(name, fallback) ?? match);
  return recolor(withTokens);
}

export function toCss(style, theme) {
  const clean = sanitizeTheme(theme, style);
  const colors = effectiveColors(style, clean);
  const lines = Object.entries(colors).map(([key, value]) => `  --palette-${key}: ${value};`);
  for (const { name, value } of tokensOf(style)) {
    lines.push(`  ${name}: ${Object.hasOwn(clean.tokens, name) ? clean.tokens[name] : applyTheme(value, style, clean)};`);
  }
  return ':root {\n' + lines.join('\n') + '\n}\n';
}

// Light canvas tint derived from the primary color so assets stay legible on their own color.
export function tint(hex, amount = 0.82) {
  const value = normalizeHex(hex) ?? '#ffffff';
  const channels = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  return '#' + channels.map(c => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('');
}
