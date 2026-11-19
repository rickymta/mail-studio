import { t } from './i18n';
import type { Addr } from './types';

/** Stable hue (0–359) for a name, for avatar and account colours. */
export function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function initials(name: string): string {
  const words = name
    .replace(/[<>"'()]/g, ' ')
    .split(/[\s@._-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export const displayName = (a: Addr | undefined | null): string =>
  a ? a.name || a.email || t('(unknown sender)') : t('(unknown sender)');

export const formatAddr = (a: Addr): string => (a.name ? `${a.name} <${a.email}>` : a.email);

/** `Name <a@b.c>`, `a@b.c` → an address; null when there is no usable e-mail in it. */
export function parseAddr(text: string): Addr | null {
  const s = text
    .trim()
    .replace(/[,;]+$/, '')
    .trim();
  if (!s) return null;
  const m = /^(.*)<([^<>]+)>$/.exec(s);
  const email = (m ? m[2] : s)?.trim() ?? '';
  const name = m ? (m[1] ?? '').trim().replace(/^"(.*)"$/, '$1') : '';
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? { name, email } : null;
}

/** Split pasted text like `a@b.c, Name <c@d.e>; f@g.h` into addresses (invalid parts dropped). */
export function parseAddrList(text: string): Addr[] {
  return text
    .split(/[,;\n]+/)
    .map(parseAddr)
    .filter((a): a is Addr => a !== null);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Short date for list rows: time today, weekday this week, else day and month (and year). */
export function formatListDate(ts: number, lang: string, now = new Date()): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days > 0 && days < 6) return d.toLocaleDateString(lang, { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'numeric', year: 'numeric' });
}

export function formatFullDate(ts: number, lang: string): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const textToHtml = (text: string): string => escapeHtml(text).replace(/\r?\n/g, '<br>');

/** `Re: ` / `Fwd: ` prefix, added once however many times the thread went back and forth. */
export function prefixSubject(subject: string, kind: 'reply' | 'forward'): string {
  const base = subject.replace(/^\s*((re|fwd?|tr|aw)\s*:\s*)+/i, '').trim();
  return `${kind === 'reply' ? 'Re' : 'Fwd'}: ${base}`;
}
