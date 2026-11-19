import {
  Bold,
  ChevronDown,
  ChevronRight,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Paperclip,
  RemoveFormatting,
  Send,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, IconButton, Modal, Select, Spinner } from '@/components/ui';
import { HtmlView } from '@/features/reader/HtmlView';
import { formatSize } from '@/lib/format';
import { t, useLang } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { pickFiles } from '@/lib/native';
import type { Draft } from '@/lib/types';
import { signatureHtml, useCompose } from '@/stores/compose';
import { useMail } from '@/stores/mail';
import { ask, toastError } from '@/stores/ui';
import { AddressInput } from './AddressInput';

/** `document.execCommand` is deprecated but remains the one rich-text API every webview has. */
const exec = (command: string, value?: string) => document.execCommand(command, false, value);

function Editor({
  session,
  initial,
  onChange,
}: {
  session: number;
  initial: string;
  onChange: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // The DOM owns the text while typing; React only seeds it when a draft is opened.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const tool = (label: string, icon: React.ReactNode, run: () => void) => (
    <IconButton
      label={label}
      className="size-7"
      // Keep the selection in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        run();
        if (ref.current) onChange(ref.current.innerHTML);
      }}
    >
      {icon}
    </IconButton>
  );

  const addLink = async () => {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const v = await ask({
      title: t('Insert link'),
      fields: [{ name: 'url', label: t('Web address'), placeholder: 'https://', required: true }],
      confirmLabel: t('Insert'),
    });
    const url = v?.url?.trim();
    if (!url || !/^(https?:|mailto:)/i.test(url)) return;
    ref.current?.focus();
    if (range) {
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    if (range && !range.collapsed) exec('createLink', url);
    else
      exec(
        'insertHTML',
        `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`,
      );
    if (ref.current) onChange(ref.current.innerHTML);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1">
        {tool(t('Bold'), <Bold className="size-4" />, () => exec('bold'))}
        {tool(t('Italic'), <Italic className="size-4" />, () => exec('italic'))}
        {tool(t('Underline'), <Underline className="size-4" />, () => exec('underline'))}
        <span className="mx-1 h-4 w-px bg-border" />
        {tool(t('Bulleted list'), <List className="size-4" />, () => exec('insertUnorderedList'))}
        {tool(t('Numbered list'), <ListOrdered className="size-4" />, () =>
          exec('insertOrderedList'),
        )}
        <IconButton
          label={t('Insert link')}
          className="size-7"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void addLink()}
        >
          <LinkIcon className="size-4" />
        </IconButton>
        {tool(t('Clear formatting'), <RemoveFormatting className="size-4" />, () =>
          exec('removeFormat'),
        )}
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline
        aria-label={t('Message')}
        contentEditable
        suppressContentEditableWarning
        className="compose-editor selectable min-h-40 flex-1 overflow-y-auto px-4 py-3 outline-none"
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onPaste={(e) => {
          // Plain text only: pasted markup could carry remote images and foreign styles.
          e.preventDefault();
          exec('insertText', e.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}

function Quote({ draft }: { draft: Draft }) {
  const [open, setOpen] = useState(false);
  if (!draft.quote) return null;
  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          aria-expanded={open}
          className="flex flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-surface-hover"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {t('The original message is included below your text')}
        </button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => useCompose.getState().update({ quote: '' })}
        >
          {t('Remove')}
        </Button>
      </div>
      {open && (
        <div className="max-h-56 overflow-y-auto border-t border-border">
          <HtmlView html={draft.quote} allowRemote={false} />
        </div>
      )}
    </div>
  );
}

export function Composer() {
  const session = useCompose((s) => s.session);
  const open = useCompose((s) => s.draft !== null);
  // Keyed by session: opening another draft starts with fresh field state.
  return open ? <ComposerBody key={session} session={session} /> : null;
}

function ComposerBody({ session }: { session: number }) {
  useLang();
  const draft = useCompose((s) => s.draft);
  const sending = useCompose((s) => s.sending);
  const dirty = useCompose((s) => s.dirty);
  const accounts = useMail((s) => s.accounts);
  const [showCc, setShowCc] = useState(() => !!useCompose.getState().draft?.cc.length);
  const [showBcc, setShowBcc] = useState(() => !!useCompose.getState().draft?.bcc.length);

  // Autosave a little after the last change.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void useCompose.getState().save(), 2500);
    return () => clearTimeout(timer);
  }, [dirty, draft]);

  if (!draft) return null;
  const { update, send, close, discard } = useCompose.getState();
  const total = draft.attachments.reduce((n, a) => n + a.size, 0);

  const attach = async () => {
    try {
      const paths = await pickFiles(t('Attach files'));
      if (!paths.length) return;
      const added = await Promise.all(paths.map((p) => api.describeFile(p)));
      const now = useCompose.getState().draft;
      if (now) update({ attachments: [...now.attachments, ...added] });
    } catch (e) {
      toastError(t('Could not attach the file'), e);
    }
  };

  const changeAccount = (id: number) => {
    const from = accounts.find((a) => a.id === draft.accountId);
    const to = accounts.find((a) => a.id === id);
    // Swap the signature when the body is still nothing but the old one.
    const untouched = draft.html === signatureHtml(from);
    update({ accountId: id, ...(untouched ? { html: signatureHtml(to) } : {}) });
    if (untouched) useCompose.setState((s) => ({ session: s.session + 1 }));
  };

  return (
    <Modal
      open
      bare
      width={860}
      onClose={() => void close()}
      title={draft.subject.trim() || t('New message')}
      footer={
        <>
          <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <IconButton
              label={t('Discard draft')}
              disabled={sending}
              onClick={() => void discard()}
            >
              <Trash2 className="size-4" />
            </IconButton>
            {dirty ? t('Not saved yet') : draft.id ? t('Draft saved') : ''}
          </span>
          <Button onClick={() => void attach()} disabled={sending}>
            <Paperclip className="size-4" />
            {t('Attach')}
          </Button>
          <Button
            variant="primary"
            disabled={sending}
            onClick={() => void send()}
            title="Ctrl+Enter"
          >
            {sending ? <Spinner /> : <Send className="size-4" />}
            {sending ? t('Sending…') : t('Send')}
          </Button>
        </>
      }
    >
      <div
        className="flex h-[min(640px,calc(90vh-110px))] flex-col"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void send();
          }
        }}
      >
        {accounts.length > 1 && (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{t('From')}</span>
            <Select
              aria-label={t('From')}
              className="h-7 border-0 bg-transparent px-0"
              value={draft.accountId}
              onChange={(e) => changeAccount(Number(e.target.value))}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ? `${a.name} <${a.email}>` : a.email}
                </option>
              ))}
            </Select>
          </div>
        )}
        <AddressInput
          key={`to-${session}`}
          label={t('To')}
          value={draft.to}
          autoFocus={!draft.to.length}
          onChange={(to) => update({ to })}
          trailing={
            <span className="flex shrink-0 gap-1 pt-1">
              {!showCc && (
                <Button size="sm" variant="ghost" onClick={() => setShowCc(true)}>
                  {t('Cc')}
                </Button>
              )}
              {!showBcc && (
                <Button size="sm" variant="ghost" onClick={() => setShowBcc(true)}>
                  {t('Bcc')}
                </Button>
              )}
            </span>
          }
        />
        {showCc && (
          <AddressInput
            key={`cc-${session}`}
            label={t('Cc')}
            value={draft.cc}
            onChange={(cc) => update({ cc })}
          />
        )}
        {showBcc && (
          <AddressInput
            key={`bcc-${session}`}
            label={t('Bcc')}
            value={draft.bcc}
            onChange={(bcc) => update({ bcc })}
          />
        )}
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="w-12 shrink-0 text-xs text-muted-foreground">{t('Subject')}</span>
          <input
            aria-label={t('Subject')}
            value={draft.subject}
            onChange={(e) => update({ subject: e.target.value })}
            className="h-7 min-w-0 flex-1 bg-transparent font-medium outline-none"
          />
        </div>
        <Editor session={session} initial={draft.html} onChange={(html) => update({ html })} />
        {draft.attachments.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
            {draft.attachments.map((a, i) => (
              <span
                key={i}
                className="flex h-7 max-w-64 items-center gap-1.5 rounded-md border border-border bg-surface-muted pr-1 pl-2 text-xs"
              >
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatSize(a.size)}</span>
                <button
                  type="button"
                  aria-label={t('Remove {name}', { name: a.name })}
                  className="rounded p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  onClick={() =>
                    update({ attachments: draft.attachments.filter((_, j) => j !== i) })
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <span className="text-xs text-muted-foreground">{formatSize(total)}</span>
          </div>
        )}
        <Quote draft={draft} />
      </div>
    </Modal>
  );
}
