import { create } from 'zustand';
import { useActivity } from './activity';

import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { notifyDesktop } from '@/lib/native';
import type { Account, Detail, Folder, ListQuery, MailEvent, Provider, Summary } from '@/lib/types';
import { toast, toastError, useUi } from './ui';

/** What the middle pane lists. `drafts` are the local drafts, everything else is mail. */
export type View =
  | { kind: 'folder'; folderId: number }
  | { kind: 'inbox' | 'unread' | 'flagged' | 'all' | 'drafts' };

export interface Filters {
  unread: boolean;
  flagged: boolean;
  attachments: boolean;
}

const PAGE = 100;
const VIEW_KEY = 'mailstudio.view';

function loadView(key = VIEW_KEY): View {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as View | null;
    if (v && typeof v.kind === 'string') return v;
  } catch {
    /* ignore */
  }
  return { kind: 'inbox' };
}

export const sameView = (a: View, b: View) =>
  a.kind === b.kind && (a.kind !== 'folder' || (b.kind === 'folder' && a.folderId === b.folderId));

/** The account a view belongs to: a folder's owner; `undefined` for the cross-account views. */
export const viewAccountId = (view: View, folders: Folder[]) =>
  view.kind === 'folder' ? folders.find((f) => f.id === view.folderId)?.accountId : undefined;

function queryFor(
  s: Pick<MailStore, 'view' | 'filters' | 'query' | 'scopeAccountId'>,
): ListQuery | null {
  const { view, filters, query } = s;
  if (view.kind === 'drafts') return null;
  const q = query.trim();
  const base =
    view.kind === 'folder'
      ? { scope: 'folder' as const, folderId: view.folderId }
      : { scope: view.kind };
  return { ...base, ...filters, query: q, accountId: s.scopeAccountId };
}

export interface MailStore {
  scopeAccountId?: number;
  dispose: () => void;
  ready: boolean;
  accounts: Account[];
  folders: Folder[];
  providers: Provider[];
  /** Accounts with a sync in progress. */
  syncing: number[];

  view: View;
  query: string;
  filters: Filters;
  items: Summary[];
  total: number;
  loading: boolean;
  /** Checked rows (bulk actions). */
  checked: number[];

  /** The message open in the reader. */
  activeId: number | null;
  detail: Detail | null;
  detailLoading: boolean;
  detailError: string | null;

  init: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshFolders: () => Promise<void>;
  setView: (v: View) => void;
  setQuery: (q: string) => void;
  toggleFilter: (f: keyof Filters) => void;
  reload: (opts?: { quiet?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  loadOlder: () => Promise<void>;
  open: (id: number | null) => Promise<void>;
  step: (delta: 1 | -1) => void;
  toggleChecked: (id: number, range?: boolean) => void;
  setChecked: (ids: number[]) => void;
  /** The checked messages, or the open one when nothing is checked. */
  targets: () => number[];
  setFlags: (ids: number[], flags: { seen?: boolean; flagged?: boolean }) => Promise<void>;
  act: (action: 'archive' | 'delete' | 'spam' | 'notSpam', ids: number[]) => Promise<void>;
  moveTo: (ids: number[], folderId: number) => Promise<void>;
  sync: (accountId?: number) => Promise<void>;
}

export function createMailbox(scopeAccountId?: number) {
  let loadToken = 0;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  const viewKey = scopeAccountId === undefined ? VIEW_KEY : `${VIEW_KEY}.${scopeAccountId}`;
  return create<MailStore>((set, get) => ({
    scopeAccountId,
    dispose: () => {
      loadToken++;
      if (reloadTimer) clearTimeout(reloadTimer);
    },
    ready: false,
    accounts: [],
    folders: [],
    providers: [],
    syncing: [],
    view: loadView(viewKey),
    query: '',
    filters: { unread: false, flagged: false, attachments: false },
    items: [],
    total: 0,
    loading: false,
    checked: [],
    activeId: null,
    detail: null,
    detailLoading: false,
    detailError: null,

    init: async () => {
      try {
        const [accounts, folders, providers, status] = await Promise.all([
          api.accounts(),
          api.folders(),
          api.providers(),
          api.syncStatus(),
        ]);
        set({ accounts, folders, providers, syncing: status.syncing, ready: true });
        // A remembered folder may be gone (account removed since).
        const v = get().view;
        if (v.kind === 'folder' && !folders.some((f) => f.id === v.folderId))
          set({ view: { kind: 'inbox' } });
        await get().reload();
      } catch (e) {
        set({ ready: true });
        toastError(t('Could not reach the mail backend'), e);
      }
      if (scopeAccountId === undefined) void listen();
    },

    refreshAccounts: async () => set({ accounts: await api.accounts() }),
    refreshFolders: async () => set({ folders: await api.folders() }),

    setView: (view) => {
      try {
        localStorage.setItem(viewKey, JSON.stringify(view));
      } catch {
        /* ignore */
      }
      set({
        view,
        checked: [],
        items: [],
        total: 0,
        activeId: null,
        detail: null,
        detailError: null,
      });
      void get().reload();
    },

    setQuery: (query) => {
      set({ query });
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void get().reload(), 250);
    },

    toggleFilter: (f) => {
      set((s) => ({ filters: { ...s.filters, [f]: !s.filters[f] } }));
      void get().reload();
    },

    reload: async ({ quiet = false } = {}) => {
      const q = queryFor(get());
      if (!q) {
        set({ items: [], total: 0, loading: false });
        return;
      }
      const token = ++loadToken;
      if (!quiet) set({ loading: true });
      try {
        // A quiet refresh keeps as many rows as were loaded, so the list does not jump.
        const limit = quiet ? Math.max(PAGE, get().items.length) : PAGE;
        const page = await api.messages({ ...q, limit, offset: 0 });
        if (token !== loadToken) return;
        const ids = new Set(page.items.map((m) => m.id));
        set((s) => ({
          items: page.items,
          total: page.total,
          loading: false,
          checked: s.checked.filter((id) => ids.has(id)),
        }));
      } catch (e) {
        if (token !== loadToken) return;
        set({ loading: false });
        if (!quiet) toastError(t('Could not load messages'), e);
      }
    },

    loadMore: async () => {
      const s = get();
      const q = queryFor(s);
      if (!q || s.loading || s.items.length >= s.total) return;
      const token = ++loadToken;
      set({ loading: true });
      try {
        const page = await api.messages({ ...q, limit: PAGE, offset: s.items.length });
        if (token !== loadToken) return;
        const known = new Set(get().items.map((m) => m.id));
        set((st) => ({
          items: [...st.items, ...page.items.filter((m) => !known.has(m.id))],
          total: page.total,
          loading: false,
        }));
      } catch (e) {
        if (token === loadToken) set({ loading: false });
        toastError(t('Could not load messages'), e);
      }
    },

    loadOlder: async () => {
      const v = get().view;
      if (v.kind !== 'folder') return;
      set({ loading: true });
      try {
        const added = await api.loadOlder(v.folderId);
        if (added === 0) toast('info', t('There are no older messages on the server'));
        await get().reload({ quiet: true });
        await get().loadMore();
      } catch (e) {
        toastError(t('Could not load older messages'), e);
      } finally {
        set({ loading: false });
      }
    },

    open: async (id) => {
      if (id === null) {
        set({ activeId: null, detail: null, detailError: null, detailLoading: false });
        return;
      }
      set({ activeId: id, detail: null, detailError: null, detailLoading: true });
      try {
        const detail = await api.message(id);
        if (get().activeId !== id) return;
        set({ detail, detailLoading: false });
        if (!detail.seen && useUi.getState().prefs.markReadOnOpen)
          void get().setFlags([id], { seen: true });
      } catch (e) {
        if (get().activeId !== id) return;
        set({ detailLoading: false, detailError: e instanceof Error ? e.message : String(e) });
      }
    },

    step: (delta) => {
      const { items, activeId } = get();
      if (!items.length) return;
      const i = items.findIndex((m) => m.id === activeId);
      const next = items[i < 0 ? 0 : Math.min(items.length - 1, Math.max(0, i + delta))];
      if (next && next.id !== activeId) void get().open(next.id);
    },

    toggleChecked: (id, range = false) => {
      const { checked, items } = get();
      if (range && checked.length) {
        const last = checked[checked.length - 1];
        const a = items.findIndex((m) => m.id === last);
        const b = items.findIndex((m) => m.id === id);
        if (a >= 0 && b >= 0) {
          const span = items.slice(Math.min(a, b), Math.max(a, b) + 1).map((m) => m.id);
          set({ checked: [...new Set([...checked, ...span])] });
          return;
        }
      }
      set({ checked: checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id] });
    },

    setChecked: (checked) => set({ checked }),

    targets: () => {
      const { checked, activeId } = get();
      return checked.length ? checked : activeId !== null ? [activeId] : [];
    },

    setFlags: async (ids, flags) => {
      if (!ids.length) return;
      const patch = (m: Summary) => (ids.includes(m.id) ? { ...m, ...flags } : m);
      set((s) => ({
        items: s.items.map(patch),
        detail: s.detail && ids.includes(s.detail.id) ? { ...s.detail, ...flags } : s.detail,
      }));
      try {
        await api.setFlags(ids, flags);
      } catch (e) {
        toastError(t('Could not update the messages on the server'), e);
        void get().reload({ quiet: true });
      }
    },

    act: async (action, ids) => {
      if (!ids.length) return;
      // Move the reader to the neighbour of the message that is about to disappear.
      const { items, activeId } = get();
      let nextActive = activeId;
      if (activeId !== null && ids.includes(activeId)) {
        const i = items.findIndex((m) => m.id === activeId);
        const rest = items.filter((m) => !ids.includes(m.id));
        nextActive = (rest[Math.min(i, rest.length - 1)] ?? null)?.id ?? null;
      }
      set((s) => ({
        items: s.items.filter((m) => !ids.includes(m.id)),
        total: Math.max(0, s.total - ids.length),
        checked: s.checked.filter((id) => !ids.includes(id)),
      }));
      if (nextActive !== activeId) void get().open(nextActive);
      try {
        if (action === 'archive') await api.archive(ids);
        else if (action === 'delete') await api.remove(ids);
        else await api.spam(ids, action === 'spam');
      } catch (e) {
        toastError(t('The server refused the change'), e);
        void get().reload({ quiet: true });
      }
    },

    moveTo: async (ids, folderId) => {
      if (!ids.length) return;
      const v = get().view;
      if (v.kind === 'folder' && v.folderId === folderId) return;
      set((s) => ({
        items: v.kind === 'folder' ? s.items.filter((m) => !ids.includes(m.id)) : s.items,
        checked: [],
      }));
      if (v.kind === 'folder' && get().activeId !== null && ids.includes(get().activeId!))
        void get().open(null);
      try {
        await api.move(ids, folderId);
      } catch (e) {
        toastError(t('Could not move the messages'), e);
      }
      void get().reload({ quiet: true });
    },

    sync: async (accountId) => {
      try {
        await api.sync(accountId);
      } catch (e) {
        toastError(t('Could not start the sync'), e);
      }
    },
  }));
}

export const useMail = createMailbox();

// ---- backend events -----------------------------------------------------------------------------

let quietTimer: ReturnType<typeof setTimeout> | null = null;
function quietReload() {
  if (quietTimer) return;
  quietTimer = setTimeout(() => {
    quietTimer = null;
    void useMail.getState().reload({ quiet: true });
  }, 400);
}

let folderTimer: ReturnType<typeof setTimeout> | null = null;
function refreshFoldersSoon() {
  if (folderTimer) return;
  folderTimer = setTimeout(() => {
    folderTimer = null;
    void useMail
      .getState()
      .refreshFolders()
      .catch(() => {});
  }, 300);
}

function handle(e: MailEvent) {
  const s = useMail.getState();
  const accountId = e.data.accountId as number | undefined;
  switch (e.kind) {
    case 'sync': {
      const state = e.data.state as string;
      const on = state === 'start';
      if (!on)
        useActivity
          .getState()
          .log({ label: 'Sync completed', status: state === 'error' ? 'failed' : 'finished' });
      useMail.setState({
        syncing: on
          ? [...new Set([...s.syncing, accountId!])]
          : s.syncing.filter((id) => id !== accountId),
      });
      if (!on) void s.refreshAccounts().catch(() => {});
      break;
    }
    case 'folders':
      refreshFoldersSoon();
      break;
    case 'accounts':
      void s.refreshAccounts().catch(() => {});
      refreshFoldersSoon();
      quietReload();
      break;
    case 'messages': {
      const v = s.view;
      if (v.kind === 'drafts') break;
      if (v.kind !== 'folder' || v.folderId === e.data.folderId) quietReload();
      break;
    }
    case 'newMail': {
      if (!useUi.getState().prefs.notifications) break;
      const count = e.data.count as number;
      const title =
        count > 1
          ? t('{n} new messages — {account}', { n: count, account: String(e.data.email) })
          : String(e.data.from ?? e.data.email);
      void notifyDesktop(title, String(e.data.subject || t('(no subject)')));
      break;
    }
    case 'drafts':
      window.dispatchEvent(new Event('mailstudio:drafts'));
      break;
  }
}

let listening = false;

/** Long-poll the backend for events, forever. */
async function listen() {
  if (listening) return;
  listening = true;
  let after: number | null = null;
  for (;;) {
    try {
      const res = await api.poll(after);
      // A lower sequence means the backend restarted: start over from its position.
      after = res.seq;
      for (const e of res.events) {
        handle(e);
        window.dispatchEvent(new CustomEvent('mailstudio:event', { detail: e }));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ---- selectors ----------------------------------------------------------------------------------

export const accountById = (accounts: Account[], id: number) => accounts.find((a) => a.id === id);

/** Colour of an account: the one the user picked, else derived from the address. */
export function accountColor(a: Account | undefined): string {
  if (!a) return 'var(--muted-foreground)';
  if (a.color) return a.color;
  let h = 0;
  for (let i = 0; i < a.email.length; i++) h = (h * 31 + a.email.charCodeAt(i)) % 360;
  return `oklch(0.62 0.14 ${h})`;
}

const ROLE_ORDER = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash'];

/** Folders of one account in display order: system folders first, then the rest by name. */
export function sortedFolders(folders: Folder[], accountId: number): Folder[] {
  const rank = (f: Folder) => {
    const i = ROLE_ORDER.indexOf(f.role);
    return i < 0 ? ROLE_ORDER.length : i;
  };
  return folders
    .filter((f) => f.accountId === accountId && !['all', 'flagged', 'important'].includes(f.role))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
