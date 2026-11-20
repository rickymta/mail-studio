import type { Account } from '@/lib/types';

/** Unread count as shown on a badge: nothing for zero, capped at "99+". */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}

/** One or two letters standing for a mailbox: from the display name, else from the address. */
export function accountInitials(a: Pick<Account, 'name' | 'email'>): string {
  const words = a.name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? [words[0]!, words[words.length - 1]!].map((w) => [...w][0]).join('')
      : [...(words[0] ?? a.email.split('@')[0] ?? '').replace(/[^\p{L}\p{N}]/gu, '')]
          .slice(0, 2)
          .join('');
  return (letters || '?').toLocaleUpperCase();
}
