import { create } from 'zustand';

const KEY = 'mailstudio.zoom';
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;
const STEP = 0.1;

/** A zoom factor snapped to 10% steps inside the allowed range (1 for anything unusable). */
export function normalizeZoom(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 10) / 10;
}

function load(): number {
  try {
    return normalizeZoom(localStorage.getItem(KEY) ?? 1);
  } catch {
    return 1;
  }
}

export function applyZoom(zoom: number) {
  if (typeof document !== 'undefined') document.documentElement.style.zoom = String(zoom);
}

/** Size of the whole interface (kept in localStorage). */
export const useZoom = create<{
  zoom: number;
  set: (zoom: number) => void;
  step: (direction: 1 | -1) => void;
}>((set, get) => ({
  zoom: load(),
  set: (value) => {
    const zoom = normalizeZoom(value);
    try {
      localStorage.setItem(KEY, String(zoom));
    } catch {
      /* Memory remains available. */
    }
    applyZoom(zoom);
    set({ zoom });
  },
  step: (direction) => get().set(get().zoom + direction * STEP),
}));
