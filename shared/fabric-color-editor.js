import { readFabricColors } from './fabric-color-config.js';

// Keep an individual row's working copy separate until its save is confirmed.
export function createFabricColorEditor(save) {
  let colors = [], editing = null, saving = false;
  const copy = value => ({ ...value });
  return {
    get colors() { return colors.map(copy); },
    get editing() { return editing ? { index: editing.index, value: copy(editing.value), isNew: editing.index === colors.length } : null; },
    get dirty() { return !!editing && JSON.stringify(editing.value) !== JSON.stringify(colors[editing.index]); },
    reset(value) { if (saving) return; colors = readFabricColors(value); editing = null; },
    begin(index) {
      if (saving || editing) return false;
      if (!Number.isInteger(index) || index < 0 || index >= colors.length) throw new Error('色号不存在，请重新加载');
      editing = { index, value: copy(colors[index]) }; return true;
    },
    add() {
      if (saving || editing) return false;
      if (colors.length >= 500) throw new Error('最多可配置 500 个色号球');
      editing = { index: colors.length, value: { code: '', base: '#f6f6f6', line: '#080808' } }; return true;
    },
    update(key, value) {
      if (!saving && editing && ['code', 'base', 'line'].includes(key)) editing.value[key] = value;
    },
    cancel() { if (!saving) editing = null; },
    async commit() {
      if (saving || !editing) throw new Error('请先选择要编辑的色号');
      const next = colors.map(copy); next[editing.index] = copy(editing.value);
      const checked = readFabricColors(next);
      saving = true;
      try {
        colors = readFabricColors(await save(checked));
        editing = null;
        return colors.map(copy);
      } finally { saving = false; }
    },
  };
}
