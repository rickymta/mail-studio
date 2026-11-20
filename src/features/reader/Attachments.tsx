import {
  Download,
  ExternalLink,
  Eye,
  File,
  FileImage,
  FileText,
  Film,
  Music,
  Paperclip,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, IconButton, Modal, Spinner, cn } from '@/components/ui';
import { ResizeHandle } from '@/components/ResizeHandle';
import { formatSize } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api, isTauri } from '@/lib/ipc';
import { pickSavePath } from '@/lib/native';
import {
  decodeAttachment,
  decodeText,
  PREVIEW_LIMIT,
  previewType,
  type PreviewKind,
} from '@/lib/preview';
import type { AttachmentInfo, Detail } from '@/lib/types';
import { DEFAULT_LAYOUT, useLayout } from '@/stores/layout';
import { toast, toastError } from '@/stores/ui';

const PdfPreview = lazy(() => import('./PdfPreview'));

async function saveAttachment(id: number, a: AttachmentInfo) {
  try {
    const path = await pickSavePath(t('Save attachment'), a.name);
    if (!path) return;
    await api.saveAttachment(id, a.index, path);
    toast('success', t('Attachment saved'), path);
  } catch (e) {
    toastError(t('Could not save the attachment'), e);
  }
}
async function openAttachment(id: number, a: AttachmentInfo) {
  try {
    await api.openAttachment(id, a.index);
  } catch (e) {
    toastError(t('Could not open the attachment'), e);
  }
}
const icons = { image: FileImage, pdf: FileText, text: FileText, audio: Music, video: Film };
const colors = {
  image: 'bg-accent-soft text-accent',
  pdf: 'bg-danger-soft text-danger',
  text: 'bg-success-soft text-success',
  audio: 'bg-warning-soft text-warning',
  video: 'bg-accent-soft text-accent',
};
type Loaded = {
  data: Uint8Array<ArrayBuffer>;
  kind: PreviewKind;
  url: string;
  text?: string;
  truncated?: boolean;
};
function Preview({ id, file, onClose }: { id: number; file: AttachmentInfo; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const type = previewType(file.name, file.mime);
  const supported = type !== null && file.size <= PREVIEW_LIMIT;
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    let url: string | null = null;
    void api
      .previewAttachment(id, file.index)
      .then((payload) => {
        if (!alive) return;
        if (payload.size > PREVIEW_LIMIT)
          throw new Error(t('Preview is limited to 20 MB. Save the file to open it.'));
        const actual = previewType(payload.name, payload.mime);
        if (!actual) throw new Error(t('This file type cannot be previewed here.'));
        const bytes = decodeAttachment(payload.base64);
        if (bytes.length > PREVIEW_LIMIT)
          throw new Error(t('Preview is limited to 20 MB. Save the file to open it.'));
        url = URL.createObjectURL(new Blob([bytes], { type: actual.mime }));
        const text = actual.kind === 'text' ? decodeText(bytes) : undefined;
        setLoaded({
          data: bytes,
          kind: actual.kind,
          url,
          text: text?.slice(0, 250_000),
          truncated: (text?.length ?? 0) > 250_000,
        });
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, file.index, supported, attempt]);
  const failed = () =>
    setError(
      t('Your browser could not display this file. Save it or open it in another application.'),
    );
  return (
    <Modal
      open
      title={t('Preview: {name}', { name: file.name })}
      onClose={onClose}
      width={1040}
      footer={
        <>
          <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
            {formatSize(file.size)} · {file.mime}
          </span>
          {isTauri && (
            <Button onClick={() => void openAttachment(id, file)}>
              <ExternalLink className="size-4" />
              {t('Open externally')}
            </Button>
          )}
          <Button variant="primary" onClick={() => void saveAttachment(id, file)}>
            <Download className="size-4" />
            {t('Save as…')}
          </Button>
        </>
      }
    >
      <div className="flex h-[62vh] min-h-40 flex-col overflow-hidden rounded-lg border border-border bg-background">
        {!supported || error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <File className="size-10 text-muted-foreground" />
            <p className="m-0 max-w-lg break-words text-sm">
              {error ??
                (file.size > PREVIEW_LIMIT
                  ? t('Preview is limited to 20 MB. Save the file to open it.')
                  : t('This file type cannot be previewed here.'))}
            </p>
            {supported && (
              <Button
                onClick={() => {
                  setLoaded(null);
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                {t('Try again')}
              </Button>
            )}
          </div>
        ) : !loaded ? (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-muted-foreground"
          >
            <Spinner />
            {t('Loading preview…')}
          </div>
        ) : loaded.kind === 'image' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
            <img
              src={loaded.url}
              alt={file.name}
              className="max-h-full max-w-full object-contain"
              onError={failed}
            />
          </div>
        ) : loaded.kind === 'text' ? (
          <>
            <pre className="selectable m-0 min-h-0 flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap break-words">
              {loaded.text}
            </pre>
            {loaded.truncated && (
              <p className="m-0 border-t border-border p-2 text-xs text-muted-foreground">
                {t('Preview shortened. Save the file to read all content.')}
              </p>
            )}
          </>
        ) : loaded.kind === 'pdf' ? (
          <Suspense fallback={<Spinner />}>
            <PdfPreview data={loaded.data} />
          </Suspense>
        ) : loaded.kind === 'audio' ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
            <Music className="size-16 text-accent" />
            <audio
              src={loaded.url}
              controls
              preload="metadata"
              className="w-full max-w-xl"
              onError={failed}
            />
          </div>
        ) : (
          <video
            src={loaded.url}
            controls
            preload="metadata"
            className="h-full w-full bg-black object-contain"
            onError={failed}
          />
        )}
      </div>
    </Modal>
  );
}
export function Attachments({ m }: { m: Detail }) {
  const files = m.attachments.filter((a) => !a.inline);
  const height = useLayout((s) => s.prefs.attachments);
  const update = useLayout((s) => s.update);
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<AttachmentInfo | null>(null);
  if (!files.length) return null;
  return (
    <>
      {!collapsed && (
        <ResizeHandle
          axis="y"
          reverse
          label={t('Attachment panel height')}
          value={height}
          min={100}
          max={400}
          onChange={(attachments) => update({ attachments })}
          onReset={() => update({ attachments: DEFAULT_LAYOUT.attachments })}
        />
      )}
      <section
        aria-label={t('Attachments')}
        className="flex shrink-0 flex-col border-t border-border bg-surface"
        style={{ height: collapsed ? 44 : height, maxHeight: collapsed ? undefined : '45%' }}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 px-4">
          <Paperclip className="size-4 text-accent" />
          <h3 className="m-0 text-sm font-semibold">{t('{n} attachments', { n: files.length })}</h3>
          <span className="text-xs text-muted-foreground">
            {formatSize(files.reduce((sum, a) => sum + a.size, 0))}
          </span>
          <span className="flex-1" />
          <IconButton
            label={collapsed ? t('Expand attachments') : t('Collapse attachments')}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </IconButton>
        </header>
        {!collapsed && (
          <div className="attachment-grid min-h-0 overflow-y-auto px-4 pb-3">
            {files.map((a) => {
              const type = previewType(a.name, a.mime);
              const Icon = type ? icons[type.kind] : File;
              const previewable = type !== null && a.size <= PREVIEW_LIMIT;
              return (
                <article
                  key={a.index}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-accent/50"
                >
                  <div
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-lg',
                      type ? colors[type.kind] : 'bg-surface-muted text-muted-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setSelected(a)}
                      title={a.name}
                      className="block w-full text-left text-sm font-medium break-all hover:text-accent"
                    >
                      {a.name}
                    </button>
                    <p className="m-0 mt-1 truncate text-xs text-muted-foreground" title={a.mime}>
                      {a.name.split('.').pop()?.toUpperCase()} · {formatSize(a.size)}
                    </p>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      onClick={() => setSelected(a)}
                    >
                      <Eye className="size-3" />
                      {previewable ? t('Preview') : t('File details')}
                    </button>
                  </div>
                  <IconButton
                    label={t('Save {name}', { name: a.name })}
                    onClick={() => void saveAttachment(m.id, a)}
                  >
                    <Download className="size-4" />
                  </IconButton>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {selected && (
        <Preview
          key={`${m.id}-${selected.index}`}
          id={m.id}
          file={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
