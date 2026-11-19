// Tiny i18n: English source strings are the keys, so untranslated text still reads fine.
//
//   t('Mark as read')
//   t('{n} selected', { n: 3 })

import { create } from 'zustand';

import { vi } from '@/locales/vi';

export type Lang = 'en' | 'vi';

export const LANGUAGES: { id: Lang; native: string }[] = [
  { id: 'en', native: 'English' },
  { id: 'vi', native: 'Tiếng Việt' },
];

const KEY = 'mailstudio.lang';

function saved(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' || v === 'vi' ? v : null;
  } catch {
    return null;
  }
}

function systemLang(): Lang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi')
    ? 'vi'
    : 'en';
}

interface LangStore {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLangStore = create<LangStore>((set) => ({
  lang: saved() ?? systemLang(),
  setLang: (l) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
    set({ lang: l });
  },
}));

/** Subscribe a component to language changes. */
export const useLang = () => useLangStore((s) => s.lang);

const DICTS: Record<Lang, Record<string, string> | null> = { en: null, vi };

/** Translate `text` (an English source string) into the current language. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[useLangStore.getState().lang];
  let out = dict?.[text] ?? text;
  if (import.meta.env?.DEV && dict && !(text in dict)) missing.add(text);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

// Dev aid: `window.__missingTranslations()` lists strings seen without a Vietnamese entry.
const missing = new Set<string>();
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __missingTranslations: () => string[] }).__missingTranslations = () => [
    ...missing,
  ];
}
