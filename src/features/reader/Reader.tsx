import {
  Archive,
  Code2,
  Download,
  File,
  FolderInput,
  Forward,
  ImageOff,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Avatar, Button, IconButton, Menu, Modal, RightClick, Spinner } from '@/components/ui';
import { moveItems } from '@/features/list/MessageList';
import { displayName, formatFullDate, formatSize } from '@/lib/format';
import { t, useLang } from '@/lib/i18n';
import { api, isTauri } from '@/lib/ipc';
import { copyText, pickSavePath } from '@/lib/native';
import type { Addr, AttachmentInfo, Detail } from '@/lib/types';
import { useCompose } from '@/stores/compose';
import { useMail } from '@/stores/mail';
import { toast, toastError, useUi } from '@/stores/ui';
import { HtmlView } from './HtmlView';

function People({ label, list }: { label: string; list: Addr[] }) {
  if (!list.length) return null;
  return (
    <div className="flex gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{label}:</span>
      <span className="selectable min-w-0 break-words">
        {list.map((a, i) => (
          <span key={i} title={a.email}>
            {displayName(a)}
            {i < list.length - 1 ? ', ' : ''}
          </span>
        ))}
      </span>
    </div>
  );
}

async function saveAttachment(m: Detail, a: AttachmentInfo) {
  const path = await pickSavePath(t('Save attachment'), a.name);
  if (!path) return;
  try {
    await api.saveAttachment(m.id, a.index, path);
    toast('success', t('Attachment saved'), path);
  } catch (e) {
    toastError(t('Could not save the attachment'), e);
  }
}

async function openAttachment(m: Detail, a: AttachmentInfo) {
  if (!isTauri) return saveAttachment(m, a);
  try {
    await api.openAttachment(m.id, a.index);
  } catch (e) {
    toastError(t('Could not open the attachment'), e);
  }
}

function Attachments({ m }: { m: Detail }) {
  const files = m.attachments.filter((a) => !a.inline);
  if (!files.length) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Paperclip className="size-3.5" />
        {t('{n} attachments', { n: files.length })}
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((a) => (
          <RightClick
            key={a.index}
            items={() => [
              { label: t('Open'), onSelect: () => void openAttachment(m, a), disabled: !isTauri },
              { label: t('Save as…'), onSelect: () => void saveAttachment(m, a) },
            ]}
          >
            <div className="flex max-w-72 items-center gap-2 rounded-md border border-border bg-surface py-1.5 pr-1 pl-2.5">
              <File className="size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                title={t('Open {name}', { name: a.name })}
                onClick={() => void openAttachment(m, a)}
              >
                <span className="block truncate">{a.name}</span>
                <span className="block text-xs text-muted-foreground">{formatSize(a.size)}</span>
              </button>
              <IconButton label={t('Save as…')} onClick={() => void saveAttachment(m, a)}>
                <Download className="size-4" />
              </IconButton>
            </div>
          </RightClick>
        ))}
      </div>
    </div>
  );
}

function SourceDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    api.source(id).then(setSource, (e) => setSource(String(e instanceof Error ? e.message : e)));
  }, [id]);
  return (
    <Modal
      open
      onClose={onClose}
      title={t('Message source')}
      width={900}
      footer={
        <Button disabled={!source} onClick={() => source && void copyText(source)}>
          {t('Copy')}
        </Button>
      }
    >
      {source === null ? (
        <Spinner />
      ) : (
        <pre className="selectable m-0 font-mono text-xs break-all whitespace-pre-wrap">
          {source.length > 400_000 ? `${source.slice(0, 400_000)}\n…` : source}
        </pre>
      )}
    </Modal>
  );
}

function Toolbar({ m }: { m: Detail }) {
  const s = useMail.getState();
  const compose = useCompose.getState();
  const [source, setSource] = useState(false);
  const inJunk = m.folderRole === 'junk';
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-border px-2">
      <Button variant="ghost" onClick={() => compose.reply(m, false)}>
        <Reply className="size-4" />
        {t('Reply')}
      </Button>
      <Button variant="ghost" onClick={() => compose.reply(m, true)}>
        <ReplyAll className="size-4" />
        {t('Reply all')}
      </Button>
      <Button variant="ghost" onClick={() => compose.forward(m)}>
        <Forward className="size-4" />
        {t('Forward')}
      </Button>
      <span className="mx-1.5 h-5 w-px bg-border" />
      <IconButton label={t('Archive')} onClick={() => void s.act('archive', [m.id])}>
        <Archive className="size-4" />
      </IconButton>
      <IconButton label={t('Delete')} onClick={() => void s.act('delete', [m.id])}>
        <Trash2 className="size-4" />
      </IconButton>
      <Menu
        items={moveItems(m.accountId, [m.id])}
        trigger={
          <IconButton label={t('Move to')}>
            <FolderInput className="size-4" />
          </IconButton>
        }
      />
      <span className="flex-1" />
      <IconButton
        label={m.seen ? t('Mark as unread') : t('Mark as read')}
        onClick={() => void s.setFlags([m.id], { seen: !m.seen })}
      >
        {m.seen ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
      </IconButton>
      <IconButton
        label={m.flagged ? t('Remove star') : t('Add star')}
        active={m.flagged}
        onClick={() => void s.setFlags([m.id], { flagged: !m.flagged })}
      >
        <Star
          className={m.flagged ? 'size-4 text-warning' : 'size-4'}
          fill={m.flagged ? 'currentColor' : 'none'}
        />
      </IconButton>
      <Menu
        align="end"
        items={[
          {
            label: inJunk ? t('Not spam') : t('Mark as spam'),
            icon: <ShieldAlert className="size-3.5" />,
            onSelect: () => void s.act(inJunk ? 'notSpam' : 'spam', [m.id]),
          },
          {
            label: t('View source'),
            icon: <Code2 className="size-3.5" />,
            onSelect: () => setSource(true),
          },
        ]}
        trigger={
          <IconButton label={t('More actions')}>
            <MoreHorizontal className="size-4" />
          </IconButton>
        }
      />
      {source && <SourceDialog id={m.id} onClose={() => setSource(false)} />}
    </div>
  );
}

function Message({ m }: { m: Detail }) {
  const lang = useLang();
  const alwaysImages = useUi((s) => s.prefs.remoteImages);
  const [allow, setAllow] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const account = useMail((s) => s.accounts.find((a) => a.id === m.accountId));
  return (
    <>
      <Toolbar m={m} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[920px] p-5">
          <h2 className="selectable m-0 text-xl leading-snug font-semibold break-words">
            {m.subject || t('(no subject)')}
          </h2>
          <div className="mt-4 flex items-start gap-3">
            <Avatar name={displayName(m.from)} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="selectable min-w-0 flex-1 truncate">
                  <span className="font-semibold">{displayName(m.from)}</span>
                  {m.from.name && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      &lt;{m.from.email}&gt;
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatFullDate(m.date, lang)}
                </span>
              </div>
              <People label={t('To')} list={m.to} />
              <People label={t('Cc')} list={m.cc} />
              <People label={t('Bcc')} list={m.bcc} />
              {m.replyTo.length > 0 && m.replyTo[0]?.email !== m.from.email && (
                <People label={t('Reply to')} list={m.replyTo} />
              )}
              {account && useMail.getState().accounts.length > 1 && (
                <div className="text-xs text-muted-foreground">
                  {t('Account')}: {account.email}
                </div>
              )}
            </div>
          </div>
          {blocked && !allow && !alwaysImages && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
              <ImageOff className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">
                {t('Remote images are hidden so the sender cannot tell that you opened this.')}
              </span>
              <Button size="sm" onClick={() => setAllow(true)}>
                {t('Show images')}
              </Button>
            </div>
          )}
          <div className="mt-4 overflow-hidden rounded-md border border-border">
            <HtmlView
              html={m.html}
              text={m.text}
              allowRemote={allow || alwaysImages}
              onBlocked={setBlocked}
            />
          </div>
          <Attachments m={m} />
        </div>
      </div>
    </>
  );
}

export function Reader() {
  useLang();
  const detail = useMail((s) => s.detail);
  const loading = useMail((s) => s.detailLoading);
  const error = useMail((s) => s.detailError);
  const activeId = useMail((s) => s.activeId);
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      {detail ? (
        // Keyed so per-message state (the "show images" choice) starts fresh.
        <Message key={detail.id} m={detail} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
          {loading ? (
            <Spinner className="size-5" />
          ) : error ? (
            <>
              <span className="selectable max-w-md text-danger">{error}</span>
              {activeId !== null && (
                <Button onClick={() => void useMail.getState().open(activeId)}>
                  {t('Try again')}
                </Button>
              )}
            </>
          ) : (
            <>
              <Mail className="size-10 opacity-40" />
              <span>{t('Select a message to read it')}</span>
            </>
          )}
        </div>
      )}
    </main>
  );
}
