// localStorage wrapper that never throws (private mode, quota, blocked storage). Tokens are never stored here.
const PREFIX = 'shirley-di:';

export function createStorage(area = globalThis.localStorage) {
  const read = key => { try { return JSON.parse(area.getItem(PREFIX + key)); } catch { return null; } };
  const write = (key, value) => { try { area.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; } };
  const remove = key => { try { area.removeItem(PREFIX + key); } catch { /* storage unavailable */ } };
  return {
    loadDraft: () => read('draft:v1'),
    saveDraft: draft => write('draft:v1', draft),
    clearDraft: () => remove('draft:v1'),
    // Undo/redo history per saved recipe, so it survives a refresh. Only the 6 most recently written recipes are kept.
    loadHistory(id) { const all = read('history:v1'); return all?.[id] ?? null; },
    saveHistory(id, entry) {
      const all = read('history:v1') ?? {};
      delete all[id];
      all[id] = entry;
      for (const key of Object.keys(all).slice(0, -6)) delete all[key];
      return write('history:v1', all);
    },
    clearHistory(id) { const all = read('history:v1') ?? {}; delete all[id]; return write('history:v1', all); },
    loadLast: () => read('last:v1'),
    saveLast: entry => write('last:v1', entry),
    // Theme presets are local to this browser, keyed by style id.
    loadPresets: styleId => { const all = read('presets:v1'); return Array.isArray(all?.[styleId]) ? all[styleId] : []; },
    savePreset(styleId, preset) {
      const all = read('presets:v1') ?? {};
      const list = (Array.isArray(all[styleId]) ? all[styleId] : []).filter(item => item.name !== preset.name);
      all[styleId] = [...list, preset].slice(-20);
      return write('presets:v1', all);
    },
    deletePreset(styleId, name) {
      const all = read('presets:v1') ?? {};
      all[styleId] = (Array.isArray(all[styleId]) ? all[styleId] : []).filter(item => item.name !== name);
      return write('presets:v1', all);
    }
  };
}
