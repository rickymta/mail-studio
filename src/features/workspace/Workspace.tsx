import {
  Activity,
  PanelsTopLeft,
  CircleHelp,
  Settings,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Copy,
  Trash2,
  Keyboard,
  Minus,
  Plus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, cn } from '@/components/ui';
import { LayoutSettings } from './LayoutSettings';
import { About } from '@/features/settings/Settings';
import { ShortcutsWindow } from '@/features/shortcuts/ShortcutsWindow';
import { globalAction, isBrowserKey } from '@/features/shortcuts/shortcuts';
import { ZOOM_MAX, ZOOM_MIN, useZoom } from '@/stores/zoom';
import { t } from '@/lib/i18n';
import { copyText } from '@/lib/native';
import { useActivity } from '@/stores/activity';
import { useMail } from '@/stores/mail';
import { confirm, toast, toastError, useUi } from '@/stores/ui';

function activityLabel(label: string) {
  const labels: Record<string, string> = {
    'Test account': t('Test account'),
    'Save account': t('Save account'),
    'Remove account': t('Remove account'),
    'Start sign-in': t('Start sign-in'),
    'Complete sign-in': t('Complete sign-in'),
    'Create folder': t('Create folder'),
    'Rename folder': t('Rename folder'),
    'Delete folder': t('Delete folder'),
    'Update message flags': t('Update message flags'),
    'Move messages': t('Move messages'),
    'Archive messages': t('Archive messages'),
    'Update spam status': t('Update spam status'),
    'Delete messages': t('Delete messages'),
    'Load older messages': t('Load older messages'),
    'Save attachment': t('Save attachment'),
    'Save draft': t('Save draft'),
    'Delete draft': t('Delete draft'),
    'Send message': t('Send message'),
    'Request sync': t('Request sync'),
    'Update settings': t('Update settings'),
    'Sync completed': t('Sync completed'),
  };
  return labels[label] ?? label;
}
function ActivityLogs() {
  const items = useActivity((s) => s.items);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const shown = items
    .filter(
      (x) =>
        (filter === 'all' || x.status === filter) &&
        activityLabel(x.label).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .reverse();
  const status = (value: string) =>
    value === 'failed' ? t('Failed') : value === 'finished' ? t('Completed') : t('Info');
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-xs text-muted-foreground">
        {t(
          'The latest 500 operations are stored on this device. Mail content, addresses and passwords are not recorded.',
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={t('Search activity')}
          placeholder={t('Search activity')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-40 flex-1"
        />
        <Select
          aria-label={t('Status')}
          className="w-36"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t('All activity')}</option>
          <option value="finished">{t('Completed')}</option>
          <option value="failed">{t('Failed')}</option>
        </Select>
        <Button
          disabled={!shown.length}
          onClick={() =>
            void copyText(
              shown
                .map(
                  (x) =>
                    `${new Date(x.at).toISOString()} | ${activityLabel(x.label)} | ${status(x.status)}${x.ms !== undefined ? ` | ${x.ms}ms` : ''}`,
                )
                .join('\n'),
            ).then(
              () => toast('success', t('Copied')),
              (e) => toastError(t('Could not copy activity'), e),
            )
          }
        >
          <Copy className="size-4" />
          {t('Copy')}
        </Button>
        <Button
          disabled={!items.length}
          onClick={() =>
            void confirm(
              t('Clear activity'),
              t('Remove all activity history from this device?'),
              t('Clear'),
              true,
            ).then((ok) => {
              if (ok) useActivity.getState().clear();
            })
          }
        >
          <Trash2 className="size-4" />
          {t('Clear')}
        </Button>
      </div>
      <div className="h-80 overflow-y-auto rounded-lg border border-border">
        {!shown.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Activity className="size-8" />
            <span>{items.length ? t('No matching activity') : t('No activity yet')}</span>
          </div>
        ) : (
          shown.map((x) => (
            <div
              key={x.id}
              className="flex items-start gap-3 border-b border-border p-3 last:border-0"
            >
              {x.status === 'failed' ? (
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium">{activityLabel(x.label)}</div>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={new Date(x.at).toISOString()}
                >
                  {new Date(x.at).toLocaleString()}
                </time>
              </div>
              <span
                className={cn(
                  'text-xs',
                  x.status === 'failed' ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {status(x.status)}
                {x.ms !== undefined && (
                  <span className="mt-1 block text-right tabular-nums">{x.ms} ms</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {shown.length === 1 ? t('1 operation') : t('{n} operations', { n: shown.length })}
      </span>
    </div>
  );
}
function Help() {
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-muted-foreground">{t('Your guide to MailStudio')}</p>
      {[
        [
          t('Connect your mailbox'),
          t(
            'Add an account from the sidebar. Use OAuth for Gmail and Outlook, or an app password when your provider requires one.',
          ),
        ],
        [
          t('Organize your mail'),
          t(
            'Use All inboxes to read across accounts. Filter unread or starred mail, search messages, and select multiple messages for bulk actions.',
          ),
        ],
        [
          t('Troubleshoot sync'),
          t(
            'Check your connection and account settings, then sync again. Activity Logs show operation outcomes; account settings show the latest server error.',
          ),
        ],
        [
          t('Privacy'),
          t(
            'Remote images are blocked by default. You can load them for a message or change this in Settings.',
          ),
        ],
      ].map(([title, body]) => (
        <section key={title}>
          <h3 className="m-0 mb-1 text-sm font-semibold">{title}</h3>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">{body}</p>
        </section>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => useUi.getState().openDialog('shortcuts')}>
          <Keyboard className="size-4" />
          {t('Keyboard shortcuts')}
        </Button>
        <Button onClick={() => useUi.getState().openDialog('settings')}>{t('Settings')}</Button>
        <Button onClick={() => useUi.getState().openDialog('activity')}>
          {t('Activity Logs')}
        </Button>
      </div>
    </div>
  );
}
export function WorkspaceBar() {
  const accounts = useMail((s) => s.accounts);
  const syncing = useMail((s) => s.syncing.length > 0);
  const ready = useMail((s) => s.ready);
  const dialog = useUi((s) => s.dialog);
  const open = useUi((s) => s.openDialog);
  const errors = accounts.some((a) => a.lastError);
  const zoom = useZoom((s) => s.zoom);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const action = globalAction(e);
      // Also stops the webview's own handling: F5 / Ctrl+R reload, F3 find, F7, F12…
      if (action || isBrowserKey(e)) e.preventDefault();
      if (!action) return;
      if (action === 'zoomIn') return useZoom.getState().step(1);
      if (action === 'zoomOut') return useZoom.getState().step(-1);
      if (action === 'zoomReset') return useZoom.getState().set(1);
      if (e.repeat) return;
      // The same key closes its own window; any other dialog or menu keeps the focus.
      if (useUi.getState().dialog === action) return open(null);
      if (useUi.getState().prompt || document.querySelector('[role="dialog"], [role="menu"]'))
        return;
      open(action);
    };
    // Capture phase, so an input or the message frame cannot let a reload through.
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [open]);
  return (
    <>
      <footer className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 border-t border-border bg-surface px-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-2" role="status">
          {syncing ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : errors ? (
            <AlertCircle className="size-3.5 text-warning" />
          ) : (
            <span className="size-1.5 rounded-full bg-accent" />
          )}
          {!ready
            ? t('Loading…')
            : syncing
              ? t('Syncing…')
              : errors
                ? t('Account needs attention')
                : accounts.length
                  ? accounts.length === 1
                    ? t('1 account')
                    : t('{n} accounts', { n: accounts.length })
                  : t('No accounts yet.')}
        </span>
        <Button variant="ghost" size="sm" onClick={() => open('layout')}>
          <PanelsTopLeft className="size-3.5" />
          {t('Layout')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => open('activity')} title="Ctrl+Shift+L">
          <Activity className="size-3.5" />
          {t('Activity Logs')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open('shortcuts')}
          title="Ctrl+/"
          aria-label={t('Keyboard shortcuts')}
        >
          <Keyboard className="size-3.5" />
        </Button>
        <span className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={zoom <= ZOOM_MIN}
            onClick={() => useZoom.getState().step(-1)}
            title="Ctrl+-"
            aria-label={t('Zoom out')}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="tabular-nums"
            onClick={() => useZoom.getState().set(1)}
            title={`${t('Reset zoom')} (Ctrl+0)`}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => useZoom.getState().step(1)}
            title="Ctrl++"
            aria-label={t('Zoom in')}
          >
            <Plus className="size-3.5" />
          </Button>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open('about')}
          aria-label={t('Version {v}', { v: __APP_VERSION__ })}
        >
          v{__APP_VERSION__}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => open('help')} title="F1">
          <CircleHelp className="size-3.5" />
          {t('Help')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open('settings')}
          aria-label={t('Settings')}
        >
          <Settings className="size-3.5" />
        </Button>
      </footer>
      <Modal
        open={dialog === 'activity'}
        onClose={() => open(null)}
        title={t('Activity Logs')}
        width={760}
      >
        {dialog === 'activity' && <ActivityLogs />}
      </Modal>
      <Modal
        open={dialog === 'help'}
        onClose={() => open(null)}
        title={t('Help & Support')}
        width={640}
      >
        {dialog === 'help' && <Help />}
      </Modal>
      <Modal
        open={dialog === 'shortcuts'}
        onClose={() => open(null)}
        title={t('Keyboard shortcuts')}
        width={640}
      >
        {dialog === 'shortcuts' && <ShortcutsWindow />}
      </Modal>
      <Modal open={dialog === 'layout'} onClose={() => open(null)} title={t('Layout')} width={520}>
        {dialog === 'layout' && <LayoutSettings />}
      </Modal>
      <Modal open={dialog === 'about'} onClose={() => open(null)} title={t('About')} width={560}>
        {dialog === 'about' && <About />}
      </Modal>
    </>
  );
}
