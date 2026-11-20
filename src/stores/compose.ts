import { create } from 'zustand';

import {
  displayName,
  escapeHtml,
  formatAddr,
  formatFullDate,
  prefixSubject,
  textToHtml,
} from '@/lib/format';
import { t, useLangStore } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Account, Addr, Detail, Draft } from '@/lib/types';
import { useMail } from './mail';
import { toast, toastError } from './ui';

const QUOTE_STYLE = 'margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex';

/** The signature block appended to a new message of this account. */
export function signatureHtml(account: Account | undefined): string {
  const sig = account?.signature.trim();
  return sig ? `<br><br><div data-signature="1">-- <br>${textToHtml(sig)}</div>` : '';
}

function blank(account: Account): Draft {
  return {
    id: 0,
    accountId: account.id,
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    html: signatureHtml(account),
    quote: '',
    attachments: [],
    inReplyTo: '',
    references: '',
    replyToMessage: null,
    updatedAt: 0,
  };
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function unique(list: Addr[]): Addr[] {
  const out: Addr[] = [];
  for (const a of list) if (!out.some((x) => sameEmail(x.email, a.email))) out.push(a);
  return out;
}

const bodyOf = (m: Detail) => m.html ?? textToHtml(m.text ?? '');

/** Recipients of a reply: the sender (or Reply-To); for "all", everyone else minus ourselves. */
export function replyRecipients(m: Detail, own: string, all: boolean): { to: Addr[]; cc: Addr[] } {
  const mine = (a: Addr) => sameEmail(a.email, own);
  // Answering our own sent message continues the conversation with its recipients.
  const fromMe = mine(m.from);
  const to = fromMe ? m.to : m.replyTo.length ? m.replyTo : [m.from];
  if (!all) return { to: unique(to), cc: [] };
  const others = fromMe ? [] : m.to;
  const toAll = unique([...to, ...others]).filter((a) => !mine(a) || fromMe);
  const cc = unique(m.cc).filter(
    (a) => !mine(a) && !toAll.some((x) => sameEmail(x.email, a.email)),
  );
  return { to: toAll.length ? toAll : unique(to), cc };
}

function replyQuote(m: Detail): string {
  const lang = useLangStore.getState().lang;
  const line = t('On {date}, {who} wrote:', {
    date: formatFullDate(m.date, lang),
    who: escapeHtml(formatAddr(m.from)),
  });
  return `<br><div class="ms-quote"><div>${line}</div><blockquote style="${QUOTE_STYLE}">${bodyOf(m)}</blockquote></div>`;
}

function forwardQuote(m: Detail): string {
  const lang = useLangStore.getState().lang;
  const row = (label: string, value: string) =>
    value ? `<div><b>${label}:</b> ${escapeHtml(value)}</div>` : '';
  return (
    `<br><div class="ms-quote"><div>---------- ${t('Forwarded message')} ----------</div>` +
    row(t('From'), formatAddr(m.from)) +
    row(t('Date'), formatFullDate(m.date, lang)) +
    row(t('Subject'), m.subject) +
    row(t('To'), m.to.map(formatAddr).join(', ')) +
    row(t('Cc'), m.cc.map(formatAddr).join(', ')) +
    `<br>${bodyOf(m)}</div>`
  );
}

/** Whether a draft holds anything worth keeping. */
export function isEmptyDraft(d: Draft, account: Account | undefined): boolean {
  const strip = (html: string) =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const untouched = strip(d.html) === strip(signatureHtml(account));
  return (
    untouched &&
    !d.subject.trim() &&
    !d.to.length &&
    !d.cc.length &&
    !d.bcc.length &&
    !d.attachments.length &&
    !d.quote
  );
}

interface ComposeStore {
  draft: Draft | null;
  /** Edits not yet written to the drafts table. */
  dirty: boolean;
  sending: boolean;
  /** Bumped when a draft is opened, so the editor re-reads `draft.html`. */
  session: number;
  newMessage: (to?: Addr[], accountId?: number) => void;
  reply: (m: Detail, all: boolean) => void;
  forward: (m: Detail) => void;
  edit: (d: Draft) => void;
  update: (patch: Partial<Draft>) => void;
  save: () => Promise<void>;
  /** Keep the draft (when it has content) and close the composer. */
  close: () => Promise<void>;
  discard: () => Promise<void>;
  send: () => Promise<boolean>;
}

function defaultAccount(preferId?: number): Account | undefined {
  const { accounts, view, folders } = useMail.getState();
  if (preferId) return accounts.find((a) => a.id === preferId) ?? accounts[0];
  if (view.kind === 'folder') {
    const f = folders.find((x) => x.id === view.folderId);
    const a = accounts.find((x) => x.id === f?.accountId);
    if (a) return a;
  }
  return accounts[0];
}

export const useCompose = create<ComposeStore>((set, get) => {
  const start = (draft: Draft) => set((s) => ({ draft, dirty: false, session: s.session + 1 }));
  const begin = (preferId: number | undefined, build: (a: Account) => Draft) => {
    const account = defaultAccount(preferId);
    if (!account) {
      toast('info', t('Add a mail account first'));
      return;
    }
    start(build(account));
  };
  return {
    draft: null,
    dirty: false,
    sending: false,
    session: 0,

    newMessage: (to = [], accountId) => begin(accountId, (a) => ({ ...blank(a), to })),

    reply: (m, all) =>
      begin(m.accountId, (a) => ({
        ...blank(a),
        ...replyRecipients(m, a.email, all),
        subject: prefixSubject(m.subject, 'reply'),
        quote: replyQuote(m),
        inReplyTo: m.messageId,
        references: `${m.references} ${m.messageId}`.trim(),
        replyToMessage: m.id,
      })),

    forward: (m) =>
      begin(m.accountId, (a) => ({
        ...blank(a),
        subject: prefixSubject(m.subject, 'forward'),
        quote: forwardQuote(m),
        attachments: m.attachments
          .filter((x) => !x.inline)
          .map((x) => ({
            kind: 'message' as const,
            messageId: m.id,
            index: x.index,
            name: x.name,
            size: x.size,
          })),
      })),

    edit: (d) => start(d),

    update: (patch) => {
      const d = get().draft;
      if (d) set({ draft: { ...d, ...patch }, dirty: true });
    },

    save: async () => {
      const d = get().draft;
      if (!d || !get().dirty) return;
      set({ dirty: false });
      try {
        const saved = await api.saveDraft(d);
        // Keep what was typed meanwhile; only adopt the id the backend assigned.
        const now = get().draft;
        if (now && now.id === d.id) set({ draft: { ...now, id: saved.id } });
      } catch (e) {
        set({ dirty: true });
        toastError(t('Could not save the draft'), e);
      }
    },

    close: async () => {
      const d = get().draft;
      if (!d) return;
      const account = useMail.getState().accounts.find((a) => a.id === d.accountId);
      if (isEmptyDraft(d, account)) {
        if (d.id) await api.deleteDraft(d.id).catch(() => {});
      } else {
        await get().save();
        if (get().dirty) return;
        toast('info', t('Draft saved'));
      }
      set({ draft: null, dirty: false });
    },

    discard: async () => {
      const d = get().draft;
      set({ draft: null, dirty: false });
      if (d?.id) await api.deleteDraft(d.id).catch(() => {});
    },

    send: async () => {
      const d = get().draft;
      if (!d || get().sending) return false;
      if (!d.to.length && !d.cc.length && !d.bcc.length) {
        toast('warning', t('Add at least one recipient'));
        return false;
      }
      set({ sending: true });
      try {
        const res = await api.send(d);
        set({ draft: null, dirty: false });
        toast('success', t('Message sent'), displayName(d.to[0] ?? d.cc[0] ?? d.bcc[0]));
        for (const w of res.warnings) toast('warning', t('Sent, with a problem'), w);
        return true;
      } catch (e) {
        toastError(t('The message was not sent'), e);
        return false;
      } finally {
        set({ sending: false });
      }
    },
  };
});
