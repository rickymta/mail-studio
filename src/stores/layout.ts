import { create } from 'zustand';

export interface LayoutPrefs {
  sidebar: number;
  list: number;
  listHeight: number;
  rowHeight: number;
  mode: 'columns' | 'rows';
}
export const DEFAULT_LAYOUT: LayoutPrefs = {
  sidebar: 232,
  list: 360,
  listHeight: 42,
  rowHeight: 88,
  mode: 'columns',
};
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function normalizeLayout(value: Partial<LayoutPrefs>): LayoutPrefs {
  const number = (key: keyof LayoutPrefs, min: number, max: number) =>
    typeof value[key] === 'number' && Number.isFinite(value[key])
      ? clamp(value[key] as number, min, max)
      : (DEFAULT_LAYOUT[key] as number);
  return {
    sidebar: number('sidebar', 180, 400),
    list: number('list', 280, 720),
    listHeight: number('listHeight', 25, 70),
    rowHeight: number('rowHeight', 80, 128),
    mode: value.mode === 'rows' ? 'rows' : 'columns',
  };
}
const KEY = 'mailstudio.layout';
function load(): LayoutPrefs {
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {});
  } catch {
    return DEFAULT_LAYOUT;
  }
}
export const useLayout = create<{
  prefs: LayoutPrefs;
  update: (value: Partial<LayoutPrefs>) => void;
  reset: () => void;
}>((set) => {
  const save = (prefs: LayoutPrefs) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* Keep in memory. */
    }
    set({ prefs });
  };
  return {
    prefs: load(),
    update: (value) =>
      set((s) => {
        const prefs = normalizeLayout({ ...s.prefs, ...value });
        try {
          localStorage.setItem(KEY, JSON.stringify(prefs));
        } catch {
          /* Keep in memory. */
        }
        return { prefs };
      }),
    reset: () => save({ ...DEFAULT_LAYOUT }),
  };
});
