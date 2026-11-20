import { useMailboxStore } from '@/stores/mailboxContext';
import { useLayout } from '@/stores/layout';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Archive,
  CornerUpLeft,
  File,
  FolderInput,
  Mail,
  MailOpen,
  Paperclip,
  Search,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  Avatar,
  Button,
  IconButton,
  Menu,
  RightClick,
  Spinner,
  cn,
  type MenuItem,
} from '@/components/ui';
import { DRAG_TYPE, folderLabel } from '@/features/sidebar/Sidebar';
import { displayName, formatListDate } from '@/lib/format';
import { t, useLang } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Draft, Summary } from '@/lib/types';
import { useCompose } from '@/stores/compose';
import { accountColor, sortedFolders, useMail, type MailStore, type Filters } from '@/stores/mail';

function viewTitle(state: MailStore): string {
  const { view, folders, accounts } = state;
  switch (view.kind) {
    case 'inbox':
      return state.scopeAccountId === undefined ? t('All inboxes') : t('Inbox');
    case 'unread':
      return t('Unread');
    case 'flagged':
      return t('Starred');
    case 'all':
      return t('All mail');
    case 'drafts':
      return t('Local drafts');
    case 'folder': {
      const f = folders.find((x) => x.id === view.folderId);
      if (!f) return '';
      const a = accounts.find((x) => x.id === f.accountId);
      return accounts.length > 1 && a ? `${folderLabel(f)} — ${a.email}` : folderLabel(f);
    }
  }
}

/** "Move to" submenu for messages of one account. */
export function moveItems(
  accountId: number,
  ids: number[],
  state: MailStore = useMail.getState(),
): MenuItem[] {
  const { folders, moveTo } = state;
  return sortedFolders(folders, accountId)
    .filter((f) => f.selectable)
    .map((f) => ({ label: folderLabel(f), onSelect: () => void moveTo(ids, f.id) }));
}

function rowMenu(m: Summary, s: MailStore): MenuItem[] {
  const ids = s.checked.includes(m.id) ? s.checked : [m.id];
  const inJunk = m.folderRole === 'junk';
  return [
    {
      label: m.seen ? t('Mark as unread') : t('Mark as read'),
      icon: m.seen ? <Mail className="size-3.5" /> : <MailOpen className="size-3.5" />,
      onSelect: () => void s.setFlags(ids, { seen: !m.seen }),
    },
    {
      label: m.flagged ? t('Remove star') : t('Add star'),
      icon: <Star className="size-3.5" />,
      onSelect: () => void s.setFlags(ids, { flagged: !m.flagged }),
    },
    'sep',
    {
      label: t('Archive'),
      icon: <Archive className="size-3.5" />,
      onSelect: () => void s.act('archive', ids),
    },
    {
      label: t('Move to'),
      icon: <FolderInput className="size-3.5" />,
      items: moveItems(m.accountId, ids, s),
    },
    {
      label: inJunk ? t('Not spam') : t('Mark as spam'),
      icon: <ShieldAlert className="size-3.5" />,
      onSelect: () => void s.act(inJunk ? 'notSpam' : 'spam', ids),
    },
    'sep',
    {
      label: t('Delete'),
      icon: <Trash2 className="size-3.5" />,
      danger: true,
      onSelect: () => void s.act('delete', ids),
    },
  ];
}

function MessageRow({ m, showAccount }: { m: Summary; showAccount: boolean }) {
  const useMail = useMailboxStore();
  const lang = useLang();
  const active = useMail((s) => s.activeId === m.id);
  const checked = useMail((s) => s.checked.includes(m.id));
  const anyChecked = useMail((s) => s.checked.length > 0);
  const account = useMail((s) => s.accounts.find((a) => a.id === m.accountId));
  const outgoing = m.folderRole === 'sent' || m.folderRole === 'drafts';
  const who = outgoing
    ? `${t('To')}: ${m.to.map(displayName).join(', ') || t('(no recipient)')}`
    : displayName(m.from);
  const avatarName = outgoing ? displayName(m.to[0]) : displayName(m.from);

  return (
    <RightClick items={() => rowMenu(m, useMail.getState())}>
      <div
        role="option"
        aria-selected={active}
        tabIndex={-1}
        draggable
        onDragStart={(e) => {
          const s = useMail.getState();
          const ids = s.checked.includes(m.id) ? s.checked : [m.id];
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={(e) => {
          const s = useMail.getState();
          if (e.ctrlKey || e.metaKey) s.toggleChecked(m.id);
          else if (e.shiftKey) s.toggleChecked(m.id, true);
          else void s.open(m.id);
        }}
        className={cn(
          'group relative flex h-full cursor-default items-center gap-3 border-b border-border pr-3 pl-3',
          active ? 'bg-selection' : checked ? 'bg-accent-soft' : 'hover:bg-surface-hover',
        )}
      >
        {showAccount && (
          <span
            className="absolute top-0 bottom-0 left-0 w-[3px]"
            style={{ background: accountColor(account) }}
            title={account?.email}
          />
        )}
        <div className="relative size-8 shrink-0">
          <span className={cn(anyChecked || checked ? 'hidden' : 'group-hover:hidden')}>
            <Avatar name={avatarName} />
          </span>
          <input
            type="checkbox"
            aria-label={t('Select message')}
            checked={checked}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              useMail
                .getState()
                .toggleChecked(m.id, (e.nativeEvent as MouseEvent).shiftKey === true)
            }
            className={cn(
              'absolute inset-0 m-auto size-4 accent-[var(--accent)]',
              anyChecked || checked ? 'block' : 'hidden group-hover:block',
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {!m.seen && <span className="size-2 shrink-0 rounded-full bg-accent" />}
            <span className={cn('min-w-0 flex-1 truncate', !m.seen && 'font-semibold')}>{who}</span>
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                m.seen ? 'text-muted-foreground' : 'font-semibold',
              )}
            >
              {formatListDate(m.date, lang)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {m.answered && (
              <CornerUpLeft
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t('Answered')}
              />
            )}
            <span className={cn('min-w-0 flex-1 truncate', !m.seen && 'font-medium')}>
              {m.subject || t('(no subject)')}
            </span>
            {m.hasAttachments && (
              <Paperclip
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t('Has attachments')}
              />
            )}
            <button
              type="button"
              aria-label={m.flagged ? t('Remove star') : t('Add star')}
              aria-pressed={m.flagged}
              className={cn(
                'shrink-0 rounded p-0.5',
                m.flagged
                  ? 'text-warning'
                  : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
              onClick={(e) => {
                e.stopPropagation();
                void useMail.getState().setFlags([m.id], { flagged: !m.flagged });
              }}
            >
              <Star className="size-3.5" fill={m.flagged ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="truncate text-xs text-muted-foreground">{m.snippet || ' '}</div>
          {showAccount && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] leading-3 text-muted-foreground">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: accountColor(account) }}
              />
              <span className="truncate" title={account?.email}>
                {account?.email}
              </span>
            </div>
          )}
        </div>
      </div>
    </RightClick>
  );
}

function BulkBar() {
  const useMail = useMailboxStore();
  const checked = useMail((s) => s.checked);
  const items = useMail((s) => s.items);
  const s = useMail.getState();
  const picked = items.filter((m) => checked.includes(m.id));
  const anyUnread = picked.some((m) => !m.seen);
  const oneAccount = new Set(picked.map((m) => m.accountId)).size === 1;
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-accent-soft px-2">
      <IconButton label={t('Clear selection')} onClick={() => s.setChecked([])}>
        <X className="size-4" />
      </IconButton>
      <span className="flex-1 truncate text-xs font-medium">
        {t('{n} selected', { n: checked.length })}
      </span>
      <IconButton
        label={anyUnread ? t('Mark as read') : t('Mark as unread')}
        onClick={() => void s.setFlags(checked, { seen: anyUnread })}
      >
        {anyUnread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
      </IconButton>
      <IconButton label={t('Archive')} onClick={() => void s.act('archive', checked)}>
        <Archive className="size-4" />
      </IconButton>
      {oneAccount && picked[0] && (
        <Menu
          align="end"
          items={moveItems(picked[0].accountId, checked, s)}
          trigger={
            <IconButton label={t('Move to')}>
              <FolderInput className="size-4" />
            </IconButton>
          }
        />
      )}
      <IconButton label={t('Delete')} onClick={() => void s.act('delete', checked)}>
        <Trash2 className="size-4" />
      </IconButton>
    </div>
  );
}

const FILTERS: { key: keyof Filters; label: () => string }[] = [
  { key: 'unread', label: () => t('Unread') },
  { key: 'flagged', label: () => t('Starred') },
  { key: 'attachments', label: () => t('Attachments') },
];

function DraftList() {
  const useMail = useMailboxStore();
  const scopeAccountId = useMail((s) => s.scopeAccountId);
  const lang = useLang();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  useEffect(() => {
    const load = () =>
      void api.drafts().then(
        (drafts) =>
          setDrafts(
            drafts.filter((d) => scopeAccountId === undefined || d.accountId === scopeAccountId),
          ),
        () => setDrafts([]),
      );
    load();
    window.addEventListener('mailstudio:drafts', load);
    return () => window.removeEventListener('mailstudio:drafts', load);
  }, [scopeAccountId]);
  if (!drafts) return <Empty>{<Spinner />}</Empty>;
  if (!drafts.length)
    return <Empty>{t('No drafts. Messages you start writing are kept here.')}</Empty>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {drafts.map((d) => (
        <button
          key={d.id}
          type="button"
          className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left hover:bg-surface-hover"
          onClick={() => useCompose.getState().edit(d)}
        >
          <File className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">
                {d.to.map(displayName).join(', ') || t('(no recipient)')}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatListDate(d.updatedAt, lang)}
              </span>
            </span>
            <span className="block truncate text-muted-foreground">
              {d.subject || t('(no subject)')}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-muted-foreground">
      {children}
    </div>
  );
}

export function MessageList({
  searchRef,
}: {
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const useMail = useMailboxStore();
  useLang();
  const items = useMail((s) => s.items);
  const total = useMail((s) => s.total);
  const loading = useMail((s) => s.loading);
  const view = useMail((s) => s.view);
  const query = useMail((s) => s.query);
  const filters = useMail((s) => s.filters);
  const anyChecked = useMail((s) => s.checked.length > 0);
  const accountCount = useMail((s) => s.accounts.length);
  const activeId = useMail((s) => s.activeId);
  const rowHeight = useLayout((s) => s.prefs.rowHeight);
  const scroller = useRef<HTMLDivElement>(null);
  const hasFooter = view.kind !== 'drafts' && (items.length < total || view.kind === 'folder');
  const count = items.length + (hasFooter ? 1 : 0);

  // The virtualizer hands out functions that change every render; this component reads them
  // during render on purpose (it is the list itself).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  useEffect(() => {
    virtual.measure();
  }, [rowHeight, virtual]);

  // Keep the open message in sight when moving with the keyboard.
  useEffect(() => {
    const i = items.findIndex((m) => m.id === activeId);
    if (i >= 0) virtual.scrollToIndex(i, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const showAccount = view.kind !== 'folder' && accountCount > 1;
  const filtered = !!query.trim() || filters.unread || filters.flagged || filters.attachments;

  return (
    <section className="message-list flex h-full min-h-0 w-full flex-col bg-surface">
      <header className="shrink-0 border-b border-border p-3 pb-2">
        <div className="flex items-baseline gap-2">
          <h1 className="m-0 min-w-0 flex-1 truncate text-base font-semibold">
            {viewTitle(useMail.getState())}
          </h1>
          {view.kind !== 'drafts' && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t('{n} messages', { n: total })}
            </span>
          )}
        </div>
        {view.kind !== 'drafts' && (
          <>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={t('Search sender, subject, text…')}
                aria-label={t('Search messages')}
                onChange={(e) => useMail.getState().setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    useMail.getState().setQuery('');
                    e.currentTarget.blur();
                  }
                }}
                className="h-8 w-full rounded-md border border-border bg-surface pr-2.5 pl-8 outline-none placeholder:text-muted-foreground focus:border-accent"
              />
            </div>
            <div className="mt-2 flex gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filters[f.key]}
                  onClick={() => useMail.getState().toggleFilter(f.key)}
                  className={cn(
                    'h-6 rounded-full border px-2.5 text-xs',
                    filters[f.key]
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border text-muted-foreground hover:bg-surface-hover',
                  )}
                >
                  {f.label()}
                </button>
              ))}
            </div>
          </>
        )}
      </header>
      {anyChecked && <BulkBar />}
      {view.kind === 'drafts' ? (
        <DraftList />
      ) : items.length === 0 ? (
        <Empty>
          {loading ? (
            <Spinner />
          ) : accountCount === 0 ? (
            t('Add a mail account to get started.')
          ) : filtered ? (
            t('No messages match.')
          ) : (
            <div className="flex flex-col items-center gap-3">
              <span>{t('Nothing here.')}</span>
              {view.kind === 'folder' && (
                <Button size="sm" onClick={() => void useMail.getState().loadOlder()}>
                  {t('Check the server')}
                </Button>
              )}
            </div>
          )}
        </Empty>
      ) : (
        <div
          ref={scroller}
          role="listbox"
          aria-label={t('Messages')}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((v) => {
              const m = items[v.index];
              return (
                <div
                  key={m ? m.id : 'footer'}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: rowHeight,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {m ? (
                    <MessageRow m={m} showAccount={showAccount} />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      {loading ? (
                        <Spinner />
                      ) : items.length < total ? (
                        <Button size="sm" onClick={() => void useMail.getState().loadMore()}>
                          {t('Show more')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void useMail.getState().loadOlder()}
                        >
                          {t('Load older messages from the server')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
