import { Inbox, Plus, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { Folder } from '@/lib/types';
import { accountColor, useMail, viewAccountId } from '@/stores/mail';
import { useUi } from '@/stores/ui';

import { accountInitials, badgeText } from './rail';

const inboxOf = (folders: Folder[], accountId: number) =>
  folders.find((f) => f.accountId === accountId && f.role === 'inbox');

function Tile({
  label,
  active,
  count,
  onClick,
  style,
  className,
  children,
}: {
  label: string;
  active?: boolean;
  count?: number;
  onClick: () => void;
  style?: React.CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  const badge = badgeText(count ?? 0);
  return (
    <button
      type="button"
      title={label}
      aria-label={badge ? `${label} (${t('{n} unread', { n: badge })})` : label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold outline-offset-2 transition-transform hover:scale-105',
        active && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-muted',
        className,
      )}
      style={style}
    >
      {children}
      {badge && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-none font-bold text-white tabular-nums ring-2 ring-surface-muted">
          {badge}
        </span>
      )}
    </button>
  );
}

/** Narrow column on the far left: one square avatar per account with its unread inbox count. */
export function AccountRail() {
  const accounts = useMail((s) => s.accounts);
  const folders = useMail((s) => s.folders);
  const view = useMail((s) => s.view);
  const setView = useMail((s) => s.setView);
  const activeAccount = viewAccountId(view, folders);
  const allUnread = folders.filter((f) => f.role === 'inbox').reduce((n, f) => n + f.unread, 0);
  return (
    <nav
      aria-label={t('Accounts')}
      className="flex h-full w-14 shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-border bg-surface-muted py-3"
    >
      <Tile
        label={t('All inboxes')}
        active={view.kind !== 'folder'}
        count={allUnread}
        onClick={() => setView({ kind: 'inbox' })}
        className="border border-border bg-surface text-muted-foreground"
      >
        <Inbox className="size-5" />
      </Tile>
      <span className="h-px w-6 shrink-0 bg-border" />
      {accounts.map((a) => {
        const inbox = inboxOf(folders, a.id);
        return (
          <Tile
            key={a.id}
            label={a.name ? `${a.name} — ${a.email}` : a.email}
            active={activeAccount === a.id}
            count={inbox?.unread}
            onClick={() => inbox && setView({ kind: 'folder', folderId: inbox.id })}
            className="text-white"
            style={{ background: accountColor(a) }}
          >
            {accountInitials(a)}
          </Tile>
        );
      })}
      <Tile
        label={t('Add account')}
        onClick={() => useUi.getState().openDialog('account', null)}
        className="border border-dashed border-border text-muted-foreground hover:bg-surface-hover"
      >
        <Plus className="size-4" />
      </Tile>
      {/* Pinned to the bottom of the rail, the same size as the account tiles. */}
      <Tile
        label={t('Settings')}
        onClick={() => useUi.getState().openDialog('settings')}
        className="mt-auto border border-border bg-surface text-muted-foreground hover:bg-surface-hover"
      >
        <Settings className="size-5" />
      </Tile>
    </nav>
  );
}
