import { create } from 'zustand';
import { clamp } from './layout';
type Panel = { width?: number; split?: number };
const KEY = 'mailstudio.account-layout';
function load(): Record<number, Panel> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([id]) => /^\d+$/.test(id))
        .map(([id, panel]) => [id, sanitize(panel)]),
    );
  } catch {
    return {};
  }
}
function sanitize(panel: Panel | null): Panel {
  return {
    width:
      typeof panel?.width === 'number' && Number.isFinite(panel.width)
        ? clamp(panel.width, 380, 1200)
        : undefined,
    split:
      typeof panel?.split === 'number' && Number.isFinite(panel.split)
        ? clamp(panel.split, 20, 60)
        : undefined,
  };
}
export const useAccountLayout = create<{
  panels: Record<number, Panel>;
  update: (id: number, panel: Panel) => void;
  reset: () => void;
}>((set) => ({
  panels: load(),
  update: (id, panel) =>
    set((s) => {
      const panels = { ...s.panels, [id]: sanitize({ ...s.panels[id], ...panel }) };
      try {
        localStorage.setItem(KEY, JSON.stringify(panels));
      } catch {
        /* Memory remains available. */
      }
      return { panels };
    }),
  reset: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* Memory remains available. */
    }
    set({ panels: {} });
  },
}));
