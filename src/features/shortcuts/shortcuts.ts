import { t } from '@/lib/i18n';

export interface Shortcut {
  label: string;
  /** Alternatives, each a list of keys pressed together. */
  keys: string[][];
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** Every keyboard shortcut of the app, for the Keyboard Shortcuts window (display only). */
export function shortcutGroups(): ShortcutGroup[] {
  return [
    {
      title: t('Mail'),
      items: [
        { label: t('Compose'), keys: [['C']] },
        { label: t('Reply'), keys: [['R']] },
        { label: t('Reply all'), keys: [['A']] },
        { label: t('Forward'), keys: [['F']] },
        { label: t('Archive'), keys: [['E']] },
        { label: t('Delete'), keys: [['Delete'], ['#']] },
        { label: t('Toggle star'), keys: [['S']] },
        { label: t('Toggle read status'), keys: [['U']] },
        { label: t('Send'), keys: [['Ctrl', 'Enter']] },
      ],
    },
    {
      title: t('Navigation'),
      items: [
        { label: t('Search messages'), keys: [['/']] },
        { label: t('Next message'), keys: [['J'], ['↓']] },
        { label: t('Previous message'), keys: [['K'], ['↑']] },
        { label: t('Close the message or clear the selection'), keys: [['Esc']] },
      ],
    },
    {
      title: t('Application'),
      items: [
        { label: t('Help'), keys: [['F1']] },
        { label: t('Keyboard shortcuts'), keys: [['Ctrl', '/']] },
        { label: t('Activity Logs'), keys: [['Ctrl', 'Shift', 'L']] },
        { label: t('Zoom in'), keys: [['Ctrl', '+']] },
        { label: t('Zoom out'), keys: [['Ctrl', '-']] },
        { label: t('Reset zoom'), keys: [['Ctrl', '0']] },
      ],
    },
  ];
}

/** Groups narrowed to the shortcuts whose label or keys contain `query`. */
export function filterShortcuts(groups: ShortcutGroup[], query: string): ShortcutGroup[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (s) =>
          s.label.toLocaleLowerCase().includes(q) ||
          s.keys.some((combo) => combo.join('+').toLocaleLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

export type GlobalAction = 'help' | 'shortcuts' | 'activity' | 'zoomIn' | 'zoomOut' | 'zoomReset';

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The application-wide action a key press stands for, if any. */
export function globalAction(e: KeyLike): GlobalAction | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'F1' && !mod) return 'help';
  if (!mod) return null;
  if (e.key === '/') return 'shortcuts';
  if (e.shiftKey && e.key.toLowerCase() === 'l') return 'activity';
  if (e.key === '=' || e.key === '+') return 'zoomIn';
  if (e.key === '-' || e.key === '_') return 'zoomOut';
  if (e.key === '0') return 'zoomReset';
  return null;
}

/**
 * Keys the webview would otherwise act on by itself: F1–F12 (F5 reloads the app, F3 opens
 * find, F7 caret browsing, F12 the developer tools) and Ctrl+R / Ctrl+Shift+R (reload). A
 * reload throws away an unsent message, so the app swallows them all.
 */
export function isBrowserKey(e: KeyLike): boolean {
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return true;
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'r';
}
