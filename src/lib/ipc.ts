import { invoke } from '@tauri-apps/api/core';

import type * as T from './types';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const BRIDGE = 'http://127.0.0.1:1431/call';

export class IpcError extends Error {
  kind: string;
  constructor(e: T.AppError) {
    super(e.message);
    this.kind = e.kind;
  }
}

export function toError(e: unknown): IpcError {
  if (e instanceof IpcError) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const o = e as { kind?: string; message: string };
    return new IpcError({ kind: o.kind ?? 'unknown', message: o.message });
  }
  return new IpcError({ kind: 'unknown', message: String(e) });
}

/** Call one backend command (Tauri in the app, the dev HTTP bridge in a plain browser). */
export async function call<R>(cmd: string, args: Record<string, unknown> = {}): Promise<R> {
  try {
    if (inTauri) {
      return await invoke<R>('call', { cmd, args });
    }
    const res = await fetch(BRIDGE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd, args }),
    });
    const body = await res.json();
    if (!res.ok) throw body;
    return body as R;
  } catch (e) {
    throw toError(e);
  }
}

export const isTauri = inTauri;

type AccountInput = Omit<T.Account, 'position' | 'lastSync' | 'lastError'>;
export type { AccountInput };

interface Secret {
  password?: string;
  oauthFlow?: string;
}

/** Typed wrappers around the backend commands. */
export const api = {
  info: () => call<{ version: string; dataDir: string }>('app.info'),
  settings: () => call<Record<string, string | boolean>>('settings.get'),
  setSettings: (changes: Record<string, string | null>) => call<null>('settings.set', { changes }),

  providers: () => call<T.Provider[]>('providers.list'),
  detectProvider: (email: string) => call<T.Provider>('providers.detect', { email }),

  accounts: () => call<T.Account[]>('account.list'),
  testAccount: (account: AccountInput, secret: Secret) =>
    call<{ ok: boolean }>('account.test', { account, ...secret }),
  saveAccount: (account: AccountInput, secret: Secret) =>
    call<T.Account>('account.save', { account, ...secret }),
  removeAccount: (id: number) => call<null>('account.remove', { id }),
  oauthStart: (provider: string, email: string) =>
    call<{ flowId: string; url: string }>('oauth.start', { provider, email }),
  oauthWait: (flowId: string) => call<null>('oauth.wait', { flowId }),

  folders: () => call<T.Folder[]>('folder.list'),
  createFolder: (accountId: number, name: string, parentId?: number) =>
    call<null>('folder.create', { accountId, name, parentId }),
  renameFolder: (id: number, name: string) => call<null>('folder.rename', { id, name }),
  deleteFolder: (id: number) => call<null>('folder.delete', { id }),

  messages: (q: T.ListQuery) => call<T.Page>('msg.list', { ...q }),
  message: (id: number) => call<T.Detail>('msg.get', { id }),
  source: (id: number) => call<string>('msg.source', { id }),
  setFlags: (ids: number[], flags: { seen?: boolean; flagged?: boolean }) =>
    call<null>('msg.setFlags', { ids, ...flags }),
  move: (ids: number[], folderId: number) => call<null>('msg.move', { ids, folderId }),
  archive: (ids: number[]) => call<null>('msg.archive', { ids }),
  spam: (ids: number[], spam: boolean) => call<null>('msg.spam', { ids, spam }),
  remove: (ids: number[]) => call<null>('msg.delete', { ids }),
  loadOlder: (folderId: number) => call<number>('msg.loadOlder', { folderId }),

  saveAttachment: (id: number, index: number, path: string) =>
    call<null>('attachment.save', { id, index, path }),
  /** Open with the default application (desktop app only). */
  openAttachment: (id: number, index: number) =>
    inTauri
      ? invoke<null>('open_attachment', { id, index }).catch((e) => Promise.reject(toError(e)))
      : Promise.reject(
          toError({ kind: 'invalid', message: 'Opening attachments needs the desktop app' }),
        ),
  describeFile: (path: string) => call<T.DraftAttachment>('attachment.describe', { path }),

  drafts: () => call<T.Draft[]>('draft.list'),
  saveDraft: (draft: T.Draft) => call<T.Draft>('draft.save', { draft }),
  deleteDraft: (id: number) => call<null>('draft.delete', { id }),
  send: (draft: T.Draft) => call<{ warnings: string[] }>('compose.send', { draft }),

  contacts: (query: string) => call<T.Addr[]>('contacts.search', { query }),

  sync: (accountId?: number) => call<null>('sync.run', { accountId }),
  syncStatus: () => call<{ syncing: number[] }>('sync.status'),
  poll: (after: number | null) =>
    call<{ seq: number; events: T.MailEvent[] }>('events.poll', { after }),
};
