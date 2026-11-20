import { create } from 'zustand';

import { t } from '@/lib/i18n';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  /** Auto-hide delay in ms. */
  duration: number;
}

export type FieldType = 'text' | 'textarea' | 'password';

export interface Field {
  name: string;
  label: string;
  type?: FieldType;
  placeholder?: string;
  initial?: string;
  required?: boolean;
}

export interface PromptSpec {
  title: string;
  description?: string;
  fields?: Field[];
  confirmLabel?: string;
  danger?: boolean;
}

export type PromptValues = Record<string, string>;

interface PromptState extends PromptSpec {
  resolve: (v: PromptValues | null) => void;
}

/** The app has a dark and a light mode, chosen in Settings; it does not follow the OS. */
export type Theme = 'light' | 'dark';

/** Preferences that only concern this window (kept in localStorage). */
export interface Prefs {
  theme: Theme;
  /** Desktop notification when new mail arrives. */
  notifications: boolean;
  /** Load images from the internet without asking. On by default; off keeps senders from seeing
   *  when you read their message (a "Show images" bar then loads them per message). */
  remoteImages: boolean;
  /** Opening a message marks it read. */
  markReadOnOpen: boolean;
  /** With the dark theme, show HTML messages on a dark background too. */
  darkMessages: boolean;
}

const PREFS_KEY = 'mailstudio.prefs';
/**
 * Bumped when a default changes for existing installs too. 2: remote images shown by default.
 * 3 (briefly): messages kept light in the dark theme; 4: back to dark, so a `false` stored by 3
 * is not a choice either.
 */
const PREFS_VERSION = 4;
const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  notifications: true,
  remoteImages: true,
  markReadOnOpen: true,
  darkMessages: true,
};

/** Stored preferences over the defaults; exported for tests. */
export function mergePrefs(stored: Partial<Prefs> & { version?: number }): Prefs {
  const prefs: Partial<Prefs> & { version?: number } = { ...stored };
  // Every save writes all fields, so a field stored before the version that changed its default
  // holds only the old default, not a choice: let the new default apply.
  const version = prefs.version ?? 1;
  if (version < 2) delete prefs.remoteImages;
  if (version === 3) delete prefs.darkMessages;
  delete prefs.version;
  // The old "same as the system" theme becomes whichever mode the OS is in now, so nothing
  // changes on screen; from then on it stays put.
  if (prefs.theme !== 'light' && prefs.theme !== 'dark') {
    if (prefs.theme === undefined) delete prefs.theme;
    else prefs.theme = osTheme();
  }
  return { ...DEFAULT_PREFS, ...prefs };
}

function osTheme(): Theme {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'light'
    : 'dark';
}

function loadPrefs(): Prefs {
  try {
    return mergePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
  } catch {
    return DEFAULT_PREFS;
  }
}

export type DialogName =
  'settings' | 'account' | 'activity' | 'help' | 'shortcuts' | 'about' | 'layout' | null;

interface UiStore {
  toasts: Toast[];
  prompt: PromptState | null;
  prefs: Prefs;
  /** Which big dialog is open; `accountId` is the account being edited (null = adding). */
  dialog: DialogName;
  accountId: number | null;
  toast: (kind: ToastKind, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
  ask: (spec: PromptSpec) => Promise<PromptValues | null>;
  closePrompt: (v: PromptValues | null) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  openDialog: (d: DialogName, accountId?: number | null) => void;
}

let nextId = 1;

export const useUi = create<UiStore>((set, get) => ({
  toasts: [],
  prompt: null,
  prefs: loadPrefs(),
  dialog: null,
  accountId: null,
  toast: (kind, title, detail) => {
    const id = nextId++;
    const base = kind === 'error' || kind === 'warning' ? 9000 : 4500;
    const duration = base + Math.min(6000, (detail?.length ?? 0) * 30);
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, title, detail, duration }] }));
    setTimeout(() => get().dismiss(id), duration);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  ask: (spec) =>
    new Promise((resolve) => {
      get().prompt?.resolve(null);
      set({ prompt: { ...spec, resolve } });
    }),
  closePrompt: (v) => {
    const p = get().prompt;
    set({ prompt: null });
    p?.resolve(v);
  },
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, version: PREFS_VERSION }));
    } catch {
      /* ignore */
    }
    set({ prefs });
  },
  openDialog: (dialog, accountId = null) => set({ dialog, accountId }),
}));

export const toast = (kind: ToastKind, title: string, detail?: string) =>
  useUi.getState().toast(kind, title, detail);

/** Show a failure the user caused or needs to know about. */
export const toastError = (title: string, e: unknown) =>
  toast('error', title, e instanceof Error ? e.message : String(e));

export const ask = (spec: PromptSpec) => useUi.getState().ask(spec);

export async function confirm(
  title: string,
  description: string,
  confirmLabel = t('OK'),
  danger = false,
) {
  return (await ask({ title, description, confirmLabel, danger })) !== null;
}
