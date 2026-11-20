import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, Field, Input, Modal, Select, Spinner, Textarea, cn } from '@/components/ui';
import { t, useLang } from '@/lib/i18n';
import { api, type AccountInput } from '@/lib/ipc';
import { openUrl } from '@/lib/native';
import type { Account, Provider, Security } from '@/lib/types';
import { useMail } from '@/stores/mail';
import { confirm, toast, toastError, useUi } from '@/stores/ui';

const COLORS = [
  '',
  'oklch(0.62 0.16 250)',
  'oklch(0.62 0.15 195)',
  'oklch(0.62 0.16 150)',
  'oklch(0.7 0.15 85)',
  'oklch(0.64 0.18 45)',
  'oklch(0.6 0.2 25)',
  'oklch(0.6 0.19 330)',
  'oklch(0.58 0.18 295)',
];

const SECURITY: { value: Security; label: () => string }[] = [
  { value: 'tls', label: () => 'SSL/TLS' },
  { value: 'starttls', label: () => 'STARTTLS' },
  { value: 'none', label: () => t('None (not encrypted)') },
];

function emptyForm(): AccountInput {
  return {
    id: 0,
    email: '',
    name: '',
    provider: 'custom',
    color: '',
    signature: '',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: '',
    smtpPort: 465,
    smtpSecurity: 'tls',
    username: '',
    auth: 'password',
    oauthProvider: '',
  };
}

function fromAccount(a: Account): AccountInput {
  const form: AccountInput & Partial<Account> = { ...a };
  delete form.position;
  delete form.lastSync;
  delete form.lastError;
  return form;
}

function applyProvider(form: AccountInput, p: Provider): AccountInput {
  return {
    ...form,
    provider: p.id,
    imapHost: p.imapHost,
    imapPort: p.imapPort,
    imapSecurity: p.imapSecurity,
    smtpHost: p.smtpHost,
    smtpPort: p.smtpPort,
    smtpSecurity: p.smtpSecurity,
    // Password sign-in stays the default: OAuth needs a client ID the user must set up first.
    auth: 'password',
    oauthProvider: '',
  };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

function Server({
  title,
  host,
  port,
  security,
  onChange,
}: {
  title: string;
  host: string;
  port: number;
  security: Security;
  onChange: (p: { host?: string; port?: number; security?: Security }) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_88px_150px] gap-2">
      <Field label={title}>
        <Input
          value={host}
          spellCheck={false}
          onChange={(e) => onChange({ host: e.target.value })}
        />
      </Field>
      <Field label={t('Port')}>
        <Input
          type="number"
          min={1}
          max={65535}
          value={port || ''}
          onChange={(e) => onChange({ port: Number(e.target.value) })}
        />
      </Field>
      <Field label={t('Security')}>
        <Select
          value={security}
          onChange={(e) => onChange({ security: e.target.value as Security })}
        >
          {SECURITY.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label()}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function Form({ existing }: { existing: Account | null }) {
  const providers = useMail((s) => s.providers);
  const close = () => useUi.getState().openDialog(null);
  const [form, setForm] = useState<AccountInput>(() =>
    existing ? fromAccount(existing) : emptyForm(),
  );
  const [password, setPassword] = useState('');
  const [oauthFlow, setOauthFlow] = useState('');
  const [advanced, setAdvanced] = useState(!!existing);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Once the user edits the servers by hand, typing in the address must not overwrite them.
  const manual = useRef(!!existing);
  const patch = (p: Partial<AccountInput>) => setForm((f) => ({ ...f, ...p }));
  const provider = providers.find((p) => p.id === form.provider);
  const busy = status.kind === 'busy';

  // Recognize the provider from the address while a new account is typed.
  useEffect(() => {
    if (existing || manual.current || !form.email.includes('@')) return;
    let live = true;
    const timer = setTimeout(() => {
      api.detectProvider(form.email).then(
        (p) => {
          if (!live || manual.current) return;
          setForm((f) => applyProvider(f, p));
          if (p.id === 'custom') setAdvanced(true);
        },
        () => {},
      );
    }, 600); // the lookup may go to the network, so wait for a pause in typing
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [form.email, existing]);

  const secret = () => ({
    password: form.auth === 'password' ? password : undefined,
    oauthFlow: form.auth === 'oauth' ? oauthFlow : undefined,
  });

  const signIn = async () => {
    if (!provider?.oauth) return;
    setStatus({ kind: 'busy', what: t('Waiting for the sign-in in your browser…') });
    try {
      const flow = await api.oauthStart(provider.oauth, form.email);
      await openUrl(flow.url);
      await api.oauthWait(flow.flowId);
      setOauthFlow(flow.flowId);
      setStatus({ kind: 'idle' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const test = async (): Promise<boolean> => {
    setStatus({ kind: 'busy', what: t('Testing the connection…') });
    try {
      await api.testAccount(form, secret());
      setStatus({ kind: 'ok' });
      return true;
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const save = async (skipTest: boolean) => {
    if (!skipTest && !(await test())) return;
    setStatus({ kind: 'busy', what: t('Saving…') });
    try {
      const saved = await api.saveAccount(form, secret());
      await useMail.getState().refreshAccounts();
      toast('success', existing ? t('Account updated') : t('Account added'), saved.email);
      close();
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm(
      t('Remove {email}?', { email: existing.email }),
      t(
        'The account and its downloaded mail are removed from this computer. Nothing is deleted on the server.',
      ),
      t('Remove'),
      true,
    );
    if (!ok) return;
    try {
      await api.removeAccount(existing.id);
      const s = useMail.getState();
      await Promise.all([s.refreshAccounts(), s.refreshFolders()]);
      s.setView({ kind: 'inbox' });
      close();
    } catch (e) {
      toastError(t('Could not remove the account'), e);
    }
  };

  const canSubmit =
    form.email.includes('@') &&
    !!form.imapHost.trim() &&
    !!form.smtpHost.trim() &&
    (form.auth === 'oauth'
      ? !!oauthFlow || !!existing
      : !!password || !!existing || form.imapSecurity === 'none');

  return (
    <Modal
      open
      onClose={close}
      width={600}
      title={existing ? t('Account settings') : t('Add a mail account')}
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t('Remove account')}
            </Button>
          )}
          <Button disabled={busy || !canSubmit} onClick={() => void test()}>
            {t('Test connection')}
          </Button>
          <Button variant="primary" disabled={busy || !canSubmit} onClick={() => void save(false)}>
            {existing ? t('Save') : t('Add account')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && canSubmit) void save(false);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('E-mail address')}>
            <Input
              type="email"
              autoFocus={!existing}
              spellCheck={false}
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </Field>
          <Field label={t('Your name')} hint={t('Shown to the people you write to')}>
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
        </div>

        <Field label={t('Provider')}>
          <Select
            value={form.provider}
            onChange={(e) => {
              const p = providers.find((x) => x.id === e.target.value);
              if (!p) return;
              manual.current = true;
              setForm((f) =>
                p.id === 'custom'
                  ? { ...f, provider: 'custom', auth: 'password', oauthProvider: '' }
                  : applyProvider(f, p),
              );
              if (p.id === 'custom') setAdvanced(true);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'custom' ? t('Other (IMAP / SMTP)') : p.name}
              </option>
            ))}
          </Select>
        </Field>

        {provider?.oauth && (
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label={t('Sign-in method')}>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                className="accent-[var(--accent)]"
                checked={form.auth === 'password'}
                onChange={() => patch({ auth: 'password', oauthProvider: '' })}
              />
              {t('App password')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                className="accent-[var(--accent)]"
                checked={form.auth === 'oauth'}
                onChange={() => patch({ auth: 'oauth', oauthProvider: provider.oauth })}
              />
              {t('Sign in with {provider} (OAuth)', {
                provider: provider.oauth === 'google' ? 'Google' : 'Microsoft',
              })}
            </label>
          </div>
        )}

        {form.auth === 'password' ? (
          <Field
            label={provider?.passwordIsAppPassword ? t('App password') : t('Password')}
            hint={
              <>
                {existing && `${t('Leave empty to keep the stored password.')} `}
                {provider?.passwordIsAppPassword &&
                  t(
                    '{provider} does not accept your normal password here: create an app password in your account’s security settings.',
                    { provider: provider.name },
                  )}
                {provider?.id === 'outlook' &&
                  ` ${t('Microsoft has turned off password sign-in for most Outlook.com accounts; use OAuth if this fails.')}`}
                {provider?.helpUrl && (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center gap-1 text-accent underline"
                    onClick={() => void openUrl(provider.helpUrl)}
                  >
                    {t('Open the provider’s page')}
                    <ExternalLink className="size-3" />
                  </button>
                )}
              </>
            }
          >
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted p-3">
            <Button disabled={busy || !form.email.includes('@')} onClick={() => void signIn()}>
              {oauthFlow ? t('Sign in again') : t('Sign in in the browser')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {oauthFlow
                ? t('Signed in. Save the account to finish.')
                : existing
                  ? t(
                      'Already signed in. Sign in again only if the sync reports a sign-in problem.',
                    )
                  : t('Needs an OAuth client ID, set in Settings → Sign-in (OAuth).')}
            </span>
          </div>
        )}

        <button
          type="button"
          aria-expanded={advanced}
          className="self-start text-xs text-accent underline"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? t('Hide server settings') : t('Show server settings')}
        </button>
        {advanced && (
          <div
            className="flex flex-col gap-3 rounded-md border border-border p-3"
            onChange={() => (manual.current = true)}
          >
            <Server
              title={t('Incoming mail server (IMAP)')}
              host={form.imapHost}
              port={form.imapPort}
              security={form.imapSecurity}
              onChange={(p) =>
                patch({
                  ...(p.host !== undefined && { imapHost: p.host }),
                  ...(p.port !== undefined && { imapPort: p.port }),
                  ...(p.security !== undefined && { imapSecurity: p.security }),
                })
              }
            />
            <Server
              title={t('Outgoing mail server (SMTP)')}
              host={form.smtpHost}
              port={form.smtpPort}
              security={form.smtpSecurity}
              onChange={(p) =>
                patch({
                  ...(p.host !== undefined && { smtpHost: p.host }),
                  ...(p.port !== undefined && { smtpPort: p.port }),
                  ...(p.security !== undefined && { smtpSecurity: p.security }),
                })
              }
            />
            <Field
              label={t('User name')}
              hint={t('Usually the full e-mail address. Empty = the address above.')}
            >
              <Input
                spellCheck={false}
                value={form.username}
                placeholder={form.email}
                onChange={(e) => patch({ username: e.target.value })}
              />
            </Field>
          </div>
        )}

        <Field label={t('Colour')}>
          <div className="flex gap-2" role="radiogroup" aria-label={t('Colour')}>
            {COLORS.map((c) => (
              <button
                key={c || 'auto'}
                type="button"
                role="radio"
                aria-checked={form.color === c}
                aria-label={c ? c : t('Automatic')}
                title={c ? undefined : t('Automatic')}
                onClick={() => patch({ color: c })}
                className={cn(
                  'size-6 rounded-full border border-border',
                  form.color === c &&
                    'ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]',
                )}
                style={{
                  background: c || 'conic-gradient(#e66, #ec5, #5c8, #59e, #b6e, #e66)',
                }}
              />
            ))}
          </div>
        </Field>

        <Field
          label={t('Signature')}
          hint={t('Added to the end of new messages from this account')}
        >
          <Textarea
            rows={3}
            value={form.signature}
            onChange={(e) => patch({ signature: e.target.value })}
          />
        </Field>

        {status.kind === 'busy' && (
          <div className="flex items-center gap-2 text-muted-foreground" role="status">
            <Spinner />
            {status.what}
          </div>
        )}
        {status.kind === 'ok' && (
          <div className="flex items-center gap-2 text-success" role="status">
            <CheckCircle2 className="size-4" />
            {t('Both servers accepted the sign-in.')}
          </div>
        )}
        {status.kind === 'error' && (
          <div
            className="flex items-start gap-2 rounded-md border border-danger bg-danger-soft p-3"
            role="alert"
          >
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <div className="selectable break-words">{status.message}</div>
              <button
                type="button"
                className="mt-1 text-xs underline"
                onClick={() => void save(true)}
              >
                {t('Save without testing')}
              </button>
            </div>
          </div>
        )}
        {existing?.lastError && status.kind === 'idle' && (
          <div
            className="rounded-md border border-border bg-warning-soft p-3 text-xs"
            role="status"
          >
            <b>{t('Last sync problem')}:</b>{' '}
            <span className="selectable">{existing.lastError}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

export function AccountDialog() {
  useLang();
  const open = useUi((s) => s.dialog === 'account');
  const id = useUi((s) => s.accountId);
  const existing = useMail((s) => s.accounts.find((a) => a.id === id) ?? null);
  if (!open) return null;
  return <Form key={id ?? 'new'} existing={existing} />;
}
