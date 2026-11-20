import { Fragment, useEffect, useRef, useState } from 'react';
import { MailPlus, PenSquare, RefreshCw, Columns2 } from 'lucide-react';
import { Button, IconButton, Select } from '@/components/ui';
import { ResizeHandle } from '@/components/ResizeHandle';
import { MessageList } from '@/features/list/MessageList';
import { Reader } from '@/features/reader/Reader';
import { folderLabel } from '@/features/sidebar/Sidebar';
import { t } from '@/lib/i18n';
import type { Account, MailEvent } from '@/lib/types';
import { accountColor, createMailbox, sortedFolders, useMail } from '@/stores/mail';
import { MailboxContext, focusMailbox, releaseMailbox } from '@/stores/mailboxContext';
import { useCompose } from '@/stores/compose';
import { useUi } from '@/stores/ui';
import { useLayout } from '@/stores/layout';
import { useAccountLayout } from '@/stores/accountLayout';

function AccountPane({ account, height }: { account: Account; height: number }) {
  const [store] = useState(() => createMailbox(account.id));
  const search = useRef<HTMLInputElement>(null);
  const folders = useMail((s) => s.folders);
  const syncing = useMail((s) => s.syncing.includes(account.id));
  const view = store((s) => s.view);
  const split = useAccountLayout((s) => s.panels[account.id]?.split ?? 44);
  const update = useAccountLayout((s) => s.update);
  useEffect(() => {
    store.setState({
      accounts: [account],
      folders: folders.filter((f) => f.accountId === account.id),
      ready: true,
    });
    const v = store.getState().view;
    if (
      v.kind === 'folder' &&
      !folders.some((f) => f.id === v.folderId && f.accountId === account.id)
    )
      store.getState().setView({ kind: 'inbox' });
  }, [account, folders, store]);
  useEffect(() => {
    void store.getState().reload();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (event: Event) => {
      const e = (event as CustomEvent<MailEvent>).detail;
      if (e.data.accountId !== undefined && e.data.accountId !== account.id) return;
      if (!['messages', 'folders', 'accounts', 'sync'].includes(e.kind)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void store.getState().reload({ quiet: true }), 400);
    };
    window.addEventListener('mailstudio:event', changed);
    return () => {
      if (timer) clearTimeout(timer);
      store.getState().dispose();
      releaseMailbox(store);
      window.removeEventListener('mailstudio:event', changed);
    };
  }, [account.id, store]);
  return (
    <MailboxContext.Provider value={store}>
      <section
        aria-label={account.email}
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-lg border border-border bg-surface shadow-sm"
        onPointerDownCapture={() => focusMailbox(store, search)}
        onFocusCapture={() => focusMailbox(store, search)}
      >
        <header
          className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface-muted p-3"
          style={{ borderTop: `3px solid ${accountColor(account)}` }}
        >
          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: accountColor(account) }}
            />
            <div className="min-w-0 flex-1">
              <h2 className="m-0 truncate text-sm font-semibold" title={account.email}>
                {account.email}
              </h2>
              {account.name && (
                <span className="block truncate text-xs text-muted-foreground">{account.name}</span>
              )}
            </div>
            <IconButton
              label={t('Compose')}
              onClick={() => useCompose.getState().newMessage([], account.id)}
            >
              <PenSquare className="size-4" />
            </IconButton>
            <IconButton
              label={t('Sync')}
              disabled={syncing}
              onClick={() => void useMail.getState().sync(account.id)}
            >
              <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
            </IconButton>
          </div>
          <Select
            aria-label={t('Mailbox for {account}', { account: account.email })}
            value={view.kind === 'folder' ? `folder:${view.folderId}` : view.kind}
            onChange={(e) => {
              const value = e.target.value;
              store
                .getState()
                .setView(
                  value.startsWith('folder:')
                    ? { kind: 'folder', folderId: Number(value.slice(7)) }
                    : { kind: value as 'inbox' | 'unread' | 'flagged' | 'all' | 'drafts' },
                );
            }}
          >
            <option value="inbox">{t('Inbox')}</option>
            <option value="unread">{t('Unread')}</option>
            <option value="flagged">{t('Starred')}</option>
            <option value="all">{t('All mail')}</option>
            <option value="drafts">{t('Local drafts')}</option>
            {sortedFolders(folders, account.id)
              .filter((f) => f.selectable)
              .map((f) => (
                <option key={f.id} value={`folder:${f.id}`}>
                  {folderLabel(f)}
                </option>
              ))}
          </Select>
          {account.lastError && (
            <button
              type="button"
              onClick={() => useUi.getState().openDialog('account', account.id)}
              className="truncate text-left text-xs text-danger"
              title={account.lastError}
            >
              {t('Account needs attention')}
            </button>
          )}
        </header>
        <div className="min-h-0 shrink-0" style={{ height: `${split}%` }}>
          <MessageList searchRef={search} />
        </div>
        <ResizeHandle
          axis="y"
          label={t('Message list height')}
          value={split}
          min={20}
          max={60}
          scale={100 / Math.max(height, 1)}
          onChange={(split) => update(account.id, { split })}
          onReset={() => update(account.id, { split: 44 })}
        />
        <Reader />
      </section>
    </MailboxContext.Provider>
  );
}
export function AccountWorkspace() {
  const accounts = useMail((s) => s.accounts);
  const panels = useAccountLayout((s) => s.panels);
  const update = useAccountLayout((s) => s.update);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 700 });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const defaultWidth = Math.max(
    420,
    Math.floor((size.width - accounts.length * 6 - 16) / Math.max(accounts.length, 1)),
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1">
        <Columns2 className="size-4 text-accent" />
        <span className="font-semibold">{t('Accounts side by side')}</span>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          {t('Each account keeps its own search and open message.')}
        </span>
        <Button
          size="sm"
          onClick={() => {
            useMail.getState().setView({ kind: 'inbox' });
            useLayout.getState().update({ mode: 'columns' });
          }}
        >
          {t('All inboxes')}
        </Button>
        <Button size="sm" onClick={() => useUi.getState().openDialog('account', null)}>
          <MailPlus className="size-3.5" />
          {t('Add account')}
        </Button>
      </header>
      <div ref={host} className="flex min-h-0 flex-1 overflow-x-auto p-2">
        {accounts.map((account) => {
          const width = panels[account.id]?.width ?? defaultWidth;
          return (
            <Fragment key={account.id}>
              <div className="min-h-0 shrink-0" style={{ width }}>
                <AccountPane account={account} height={size.height - 16} />
              </div>
              {
                <ResizeHandle
                  label={t('Width of {account}', { account: account.email })}
                  value={width}
                  min={380}
                  max={1200}
                  onChange={(width) => update(account.id, { width })}
                  onReset={() => update(account.id, { width: defaultWidth })}
                />
              }
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
