import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { vi } from './vi';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Every literal passed to `t('…')` in the app. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of sources('src')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g))
      keys.add(m[1]!.replace(/\\'/g, "'"));
  }
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('Vietnamese translations', () => {
  const used = usedKeys();

  it('cover every string the app shows', () => {
    expect([...used].filter((k) => !(k in vi))).toEqual([]);
  });

  it('have no entries the app no longer uses', () => {
    expect(Object.keys(vi).filter((k) => !used.has(k))).toEqual([]);
  });

  it('keep the placeholders of the source string', () => {
    for (const [en, translated] of Object.entries(vi))
      expect(placeholders(translated), en).toEqual(placeholders(en));
  });
});
