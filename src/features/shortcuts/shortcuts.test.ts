import { filterShortcuts, globalAction, isBrowserKey, shortcutGroups } from './shortcuts';

const key = (
  k: string,
  mods: Partial<Record<'ctrl' | 'meta' | 'shift' | 'alt', boolean>> = {},
) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('shortcuts', () => {
  it('filters by label and by key', () => {
    const groups = shortcutGroups();
    expect(filterShortcuts(groups, '')).toBe(groups);
    expect(filterShortcuts(groups, 'reply').flatMap((g) => g.items.map((s) => s.label))).toEqual([
      'Reply',
      'Reply all',
    ]);
    expect(filterShortcuts(groups, 'ctrl+shift').flatMap((g) => g.items)).toHaveLength(1);
    expect(filterShortcuts(groups, 'no such thing')).toEqual([]);
  });

  it('maps key presses to application actions', () => {
    expect(globalAction(key('F1'))).toBe('help');
    expect(globalAction(key('/', { ctrl: true }))).toBe('shortcuts');
    expect(globalAction(key('L', { ctrl: true, shift: true }))).toBe('activity');
    expect(globalAction(key('=', { meta: true }))).toBe('zoomIn');
    expect(globalAction(key('-', { ctrl: true }))).toBe('zoomOut');
    expect(globalAction(key('0', { ctrl: true }))).toBe('zoomReset');
    expect(globalAction(key('/'))).toBeNull();
    expect(globalAction(key('l', { ctrl: true }))).toBeNull();
    expect(globalAction(key('0', { ctrl: true, alt: true }))).toBeNull();
  });

  it('swallows the keys the webview handles itself', () => {
    for (let n = 1; n <= 12; n++) expect(isBrowserKey(key(`F${n}`))).toBe(true);
    expect(isBrowserKey(key('F13'))).toBe(false);
    expect(isBrowserKey(key('r', { ctrl: true }))).toBe(true);
    expect(isBrowserKey(key('R', { ctrl: true, shift: true }))).toBe(true);
    expect(isBrowserKey(key('r'))).toBe(false);
    expect(isBrowserKey(key('f'))).toBe(false);
  });
});
