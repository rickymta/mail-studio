import { AlertCircle, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Field, Input, Modal, Select, Toggle, cn } from '@/components/ui';
import { LANGUAGES, t, useLang, useLangStore, type Lang } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { accountColor, useMail } from '@/stores/mail';
import { toast, toastError, useUi, type Theme } from '@/stores/ui';

import { OAUTH } from './oauthSetup';

type Tab = 'general' | 'accounts' | 'oauth' | 'about';

const INTERVALS = [1, 5, 15, 30, 60];

function General({
  settings,
  reload,
}: {
  settings: Record<string, string | boolean>;
  reload: () => void;
}) {
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);
  const lang = useLang();
  const interval = String(settings['setting.syncInterval'] ?? '5');
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Language')}>
          <Select
            value={lang}
            onChange={(e) => useLangStore.getState().setLang(e.target.value as Lang)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.native}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Theme')}>
          <Select
            value={prefs.theme}
            onChange={(e) => setPrefs({ theme: e.target.value as Theme })}
          >
            <option value="system">{t('Same as the system')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </Select>
        </Field>
      </div>
      <Field label={t('Check for new mail')}>
        <Select
          value={interval}
          onChange={(e) => {
            api
              .setSettings({ 'setting.syncInterval': e.target.value })
              .then(reload, (err) => toastError(t('Could not save the setting'), err));
          }}
        >
          {INTERVALS.map((m) => (
            <option key={m} value={m}>
              {m === 1 ? t('Every minute') : t('Every {n} minutes', { n: m })}
            </option>
          ))}
          <option value="0">{t('Only when I press Sync')}</option>
        </Select>
      </Field>
      <div>
        <Toggle
          checked={prefs.notifications}
          onChange={(v) => setPrefs({ notifications: v })}
          label={t('Notify me about new mail')}
          hint={t('A desktop notification with the sender and subject')}
        />
        <Toggle
          checked={prefs.markReadOnOpen}
          onChange={(v) => setPrefs({ markReadOnOpen: v })}
          label={t('Mark messages as read when I open them')}
        />
        <Toggle
          checked={prefs.remoteImages}
          onChange={(v) => setPrefs({ remoteImages: v })}
          label={t('Always show remote images')}
          hint={t('Senders can then see when and where you opened their message')}
        />
      </div>
    </div>
  );
}

function Accounts() {
  const accounts = useMail((s) => s.accounts);
  const openDialog = useUi((s) => s.openDialog);
  return (
    <div className="flex flex-col gap-2">
      {accounts.length === 0 && (
        <p className="m-0 text-muted-foreground">{t('No accounts yet.')}</p>
      )}
      {accounts.map((a) => (
        <div key={a.id} className="flex items-center gap-3 rounded-md border border-border p-3">
          <span className="size-3 shrink-0 rounded-full" style={{ background: accountColor(a) }} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{a.email}</div>
            <div className="truncate text-xs text-muted-foreground">
              {a.imapHost} · {a.auth === 'oauth' ? 'OAuth' : t('Password')}
            </div>
            {a.lastError && (
              <div className="mt-1 flex items-start gap-1 text-xs text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span className="selectable break-words">{a.lastError}</span>
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => openDialog('account', a.id)}>
            {t('Edit')}
          </Button>
        </div>
      ))}
      <Button className="self-start" onClick={() => openDialog('account', null)}>
        <Plus className="size-4" />
        {t('Add account')}
      </Button>
    </div>
  );
}

function OAuth({
  settings,
  reload,
}: {
  settings: Record<string, string | boolean>;
  reload: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const value = (key: string) => values[key] ?? String(settings[key] ?? '');
  const save = async () => {
    try {
      // An untouched secret field stays as stored; only what was typed is sent.
      await api.setSettings(values);
      setValues({});
      reload();
      toast('success', t('Sign-in settings saved'));
    } catch (e) {
      toastError(t('Could not save the setting'), e);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-muted-foreground">
        {t(
          'Gmail and Outlook can sign in through the browser instead of an app password. Each provider only allows that for an app registered with it, so you need your own client ID. Without one, use an app password.',
        )}
      </p>
      {OAUTH.map((p) => (
        <fieldset
          key={p.id}
          className="m-0 flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <legend className="px-1 font-medium">{p.name}</legend>
          <p className="m-0 text-xs text-muted-foreground">{p.steps()}</p>
          <Field label={t('Client ID')}>
            <Input
              spellCheck={false}
              value={value(`oauth.${p.id}.clientId`)}
              onChange={(e) => setValues({ ...values, [`oauth.${p.id}.clientId`]: e.target.value })}
            />
          </Field>
          <Field
            label={t('Client secret')}
            hint={
              settings[`oauth.${p.id}.hasClientSecret`]
                ? t('A secret is stored in the system keychain.')
                : undefined
            }
          >
            <Input
              type="password"
              placeholder={settings[`oauth.${p.id}.hasClientSecret`] ? '••••••••' : ''}
              value={values[`oauth.${p.id}.clientSecret`] ?? ''}
              onChange={(e) =>
                setValues({ ...values, [`oauth.${p.id}.clientSecret`]: e.target.value })
              }
            />
          </Field>
        </fieldset>
      ))}
      <Button
        variant="primary"
        className="self-start"
        disabled={!Object.keys(values).length}
        onClick={() => void save()}
      >
        {t('Save')}
      </Button>
    </div>
  );
}

function About() {
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  useEffect(() => {
    api.info().then(setInfo, () => {});
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-lg font-semibold">MailStudio</div>
      <div className="text-muted-foreground">
        {t('Version {v}', { v: info?.version ?? __APP_VERSION__ })}
      </div>
      <p className="m-0">
        {t(
          'One mail client for all your accounts: Gmail, Outlook, Yahoo, iCloud, Zoho and any IMAP/SMTP server.',
        )}
      </p>
      <p className="m-0 text-xs text-muted-foreground">
        {t('Mail is cached on this computer in:')}{' '}
        <span className="selectable break-all">{info?.dataDir}</span>
      </p>
      <p className="m-0 text-xs text-muted-foreground">
        {t('Passwords are kept in the system keychain, never in that folder.')}
      </p>
      <div className="mt-2 text-xs text-muted-foreground">
        <b>{t('Keyboard shortcuts')}</b>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          {(
            [
              ['C', t('Compose')],
              ['R / A / F', `${t('Reply')} / ${t('Reply all')} / ${t('Forward')}`],
              ['J / K', t('Next / previous message')],
              ['E', t('Archive')],
              ['Delete', t('Delete')],
              ['S', t('Add star')],
              ['U', t('Mark as unread')],
              ['/', t('Search messages')],
              ['Ctrl+Enter', t('Send')],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="contents">
              <kbd className="font-mono">{k}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  useLang();
  const open = useUi((s) => s.dialog === 'settings');
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const reload = () => void api.settings().then(setSettings, () => {});
  useEffect(() => {
    if (open) reload();
  }, [open]);
  if (!open) return null;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: t('General') },
    { id: 'accounts', label: t('Accounts') },
    { id: 'oauth', label: t('Sign-in (OAuth)') },
    { id: 'about', label: t('About') },
  ];
  return (
    <Modal
      open
      bare
      width={760}
      title={t('Settings')}
      onClose={() => useUi.getState().openDialog(null)}
    >
      <div className="flex h-[520px] max-h-[calc(90vh-60px)]">
        <div
          className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2"
          role="tablist"
        >
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={cn(
                'h-8 rounded-md px-2.5 text-left',
                tab === x.id ? 'bg-selection font-medium' : 'hover:bg-surface-hover',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-4" role="tabpanel">
          {tab === 'general' && <General settings={settings} reload={reload} />}
          {tab === 'accounts' && <Accounts />}
          {tab === 'oauth' && <OAuth settings={settings} reload={reload} />}
          {tab === 'about' && <About />}
        </div>
      </div>
    </Modal>
  );
}
