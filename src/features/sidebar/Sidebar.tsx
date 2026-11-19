import {
  AlertCircle,
  Archive,
  File,
  Folder as FolderIcon,
  FolderPlus,
  Inbox,
  Mail,
  MoreHorizontal,
  PenSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type DragEvent, type ReactNode } from 'react';

import { IconButton, Menu, RightClick, Spinner, cn, type MenuItem } from '@/components/ui';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Account, Folder, Role } from '@/lib/types';
import { useCompose } from '@/stores/compose';
import { accountColor, sameView, sortedFolders, useMail, type View } from '@/stores/mail';
import { ask, confirm, toastError, useUi } from '@/stores/ui';

export const DRAG_TYPE = 'application/x-mailstudio-ids';

const ROLE_ICON: Partial<Record<Role, typeof Inbox>> = {
  inbox: Inbox,
  sent: Send,
  drafts: File,
  trash: Trash2,
  junk: ShieldAlert,
  archive: Archive,
};

/** Label of a folder: system folders by their role, others by the last part of their name. */
export function folderLabel(f: Folder): string {
  switch (f.role) {
    case 'inbox':
      return t('Inbox');
    case 'sent':
      return t('Sent');
    case 'drafts':
      return t('Drafts');
    case 'trash':
      return t('Trash');
    case 'junk':
      return t('Spam');
    case 'archive':
      return t('Archive');
    default:
      return f.name.split(f.delimiter).pop() || f.name;
  }
}

/** How deep a user folder sits under other visible user folders. */
function depthOf(f: Folder, all: Folder[]): number {
  if (f.role) return 0;
  const parts = f.name.split(f.delimiter);
  let depth = 0;
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join(f.delimiter);
    if (all.some((x) => x.name === parent && x.selectable && !x.role)) depth++;
  }
  return depth;
}

function Row({
  icon,
  label,
  count,
  active,
  indent = 0,
  onClick,
  onDropIds,
  title,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  indent?: number;
  onClick: () => void;
  onDropIds?: (ids: number[]) => void;
  title?: string;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => !!onDropIds && e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <button
      type="button"
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        try {
          onDropIds?.(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as number[]);
        } catch {
          /* not our payload */
        }
      }}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left',
        active ? 'bg-selection font-medium' : 'hover:bg-surface-hover',
        over && 'ring-2 ring-accent',
      )}
      style={{ paddingLeft: 8 + indent * 14 }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!count && (
        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
          {count > 9999 ? '9999+' : count}
        </span>
      )}
    </button>
  );
}

function AccountSection({ account }: { account: Account }) {
  const folders = useMail((s) => s.folders);
  const view = useMail((s) => s.view);
  const setView = useMail((s) => s.setView);
  const moveTo = useMail((s) => s.moveTo);
  const syncing = useMail((s) => s.syncing.includes(account.id));
  const openDialog = useUi((s) => s.openDialog);
  const mine = sortedFolders(folders, account.id).filter((f) => f.selectable);

  const newFolder = async (parent?: Folder) => {
    const v = await ask({
      title: parent ? t('New folder in {name}', { name: folderLabel(parent) }) : t('New folder'),
      fields: [{ name: 'name', label: t('Folder name'), required: true }],
      confirmLabel: t('Create'),
    });
    if (!v) return;
    try {
      await api.createFolder(account.id, v.name ?? '', parent?.id);
    } catch (e) {
      toastError(t('Could not create the folder'), e);
    }
  };

  const folderMenu = (f: Folder): MenuItem[] => [
    {
      label: t('New subfolder…'),
      icon: <FolderPlus className="size-3.5" />,
      onSelect: () => void newFolder(f),
    },
    {
      label: t('Rename…'),
      icon: <Pencil className="size-3.5" />,
      disabled: !!f.role,
      onSelect: async () => {
        const v = await ask({
          title: t('Rename folder'),
          fields: [
            { name: 'name', label: t('Folder name'), initial: folderLabel(f), required: true },
          ],
          confirmLabel: t('Rename'),
        });
        if (!v) return;
        try {
          await api.renameFolder(f.id, v.name ?? '');
        } catch (e) {
          toastError(t('Could not rename the folder'), e);
        }
      },
    },
    'sep',
    {
      label: t('Delete folder…'),
      icon: <Trash2 className="size-3.5" />,
      danger: true,
      disabled: !!f.role,
      onSelect: async () => {
        const ok = await confirm(
          t('Delete “{name}”?', { name: folderLabel(f) }),
          t('The folder and every message in it are deleted on the server. This cannot be undone.'),
          t('Delete'),
          true,
        );
        if (!ok) return;
        try {
          await api.deleteFolder(f.id);
          if (view.kind === 'folder' && view.folderId === f.id) setView({ kind: 'inbox' });
        } catch (e) {
          toastError(t('Could not delete the folder'), e);
        }
      },
    },
  ];

  const accountMenu: MenuItem[] = [
    {
      label: t('Sync now'),
      icon: <RefreshCw className="size-3.5" />,
      onSelect: () => void useMail.getState().sync(account.id),
    },
    {
      label: t('New folder…'),
      icon: <FolderPlus className="size-3.5" />,
      onSelect: () => void newFolder(),
    },
    'sep',
    {
      label: t('Account settings…'),
      icon: <Settings className="size-3.5" />,
      onSelect: () => openDialog('account', account.id),
    },
  ];

  return (
    <section className="mt-3">
      <div className="group flex h-7 items-center gap-2 pr-1 pl-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: accountColor(account) }}
        />
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground"
          title={account.email}
        >
          {account.email}
        </span>
        {syncing ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : (
          account.lastError && (
            <button
              type="button"
              title={account.lastError}
              aria-label={t('Sync problem: {error}', { error: account.lastError })}
              className="text-danger"
              onClick={() => openDialog('account', account.id)}
            >
              <AlertCircle className="size-3.5" />
            </button>
          )
        )}
        <Menu
          align="end"
          items={accountMenu}
          trigger={
            <IconButton label={t('Account menu')} className="size-6">
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
        />
      </div>
      {mine.length === 0 && (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {syncing ? t('Loading folders…') : t('No folders yet')}
        </div>
      )}
      {mine.map((f) => {
        const Icon = ROLE_ICON[f.role] ?? FolderIcon;
        const target: View = { kind: 'folder', folderId: f.id };
        return (
          <RightClick key={f.id} items={() => folderMenu(f)}>
            <div>
              <Row
                icon={<Icon className="size-4" />}
                label={folderLabel(f)}
                title={f.name}
                count={f.role === 'drafts' ? f.total : f.unread}
                indent={depthOf(f, mine)}
                active={sameView(view, target)}
                onClick={() => setView(target)}
                onDropIds={(ids) => void moveTo(ids, f.id)}
              />
            </div>
          </RightClick>
        );
      })}
    </section>
  );
}

export function Sidebar() {
  const accounts = useMail((s) => s.accounts);
  const folders = useMail((s) => s.folders);
  const view = useMail((s) => s.view);
  const setView = useMail((s) => s.setView);
  const anySync = useMail((s) => s.syncing.length > 0);
  const openDialog = useUi((s) => s.openDialog);
  const [draftCount, setDraftCount] = useState(0);

  useEffect(() => {
    const load = () =>
      void api.drafts().then(
        (d) => setDraftCount(d.length),
        () => {},
      );
    load();
    window.addEventListener('mailstudio:drafts', load);
    return () => window.removeEventListener('mailstudio:drafts', load);
  }, []);

  const inboxUnread = folders.filter((f) => f.role === 'inbox').reduce((n, f) => n + f.unread, 0);
  const smart: { view: View; label: string; icon: ReactNode; count?: number }[] = [
    {
      view: { kind: 'inbox' },
      label: t('All inboxes'),
      icon: <Inbox className="size-4" />,
      count: inboxUnread,
    },
    { view: { kind: 'unread' }, label: t('Unread'), icon: <Mail className="size-4" /> },
    { view: { kind: 'flagged' }, label: t('Starred'), icon: <Star className="size-4" /> },
    {
      view: { kind: 'drafts' },
      label: t('Local drafts'),
      icon: <File className="size-4" />,
      count: draftCount,
    },
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-accent font-medium text-accent-foreground hover:brightness-110"
          onClick={() => useCompose.getState().newMessage()}
        >
          <PenSquare className="size-4" />
          {t('Compose')}
        </button>
        <IconButton
          label={t('Sync all accounts')}
          className="size-9 border border-border"
          disabled={!accounts.length}
          onClick={() => void useMail.getState().sync()}
        >
          <RefreshCw className={cn('size-4', anySync && 'animate-spin')} />
        </IconButton>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label={t('Mailboxes')}>
        {smart.map((s) => (
          <Row
            key={s.view.kind}
            icon={s.icon}
            label={s.label}
            count={s.count}
            active={sameView(view, s.view)}
            onClick={() => setView(s.view)}
          />
        ))}
        {accounts.map((a) => (
          <AccountSection key={a.id} account={a} />
        ))}
      </nav>
      <div className="flex items-center gap-1 border-t border-border p-2">
        <button
          type="button"
          className="flex h-8 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover"
          onClick={() => openDialog('account', null)}
        >
          <Plus className="size-4 text-muted-foreground" />
          {t('Add account')}
        </button>
        <IconButton label={t('Settings')} onClick={() => openDialog('settings')}>
          <Settings className="size-4" />
        </IconButton>
      </div>
    </aside>
  );
}
