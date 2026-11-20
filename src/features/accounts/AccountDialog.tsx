import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  Button,
  Field,
  Input,
  Modal,
  RadioGroup,
  Select,
  Spinner,
  Textarea,
  cn,
} from '@/components/ui';
import { t, useLang } from '@/lib/i18n';
import { api, type AccountInput } from '@/lib/ipc';
import { OAUTH } from '@/features/settings/oauthSetup';
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

/**
 * Fill in a provider's servers. The sign-in method the user already picked for this provider is
 * kept (re-detecting from the address must not undo it); on a provider change OAuth is chosen
 * when the provider requires it or its client is already set up, password sign-in otherwise.
 */
function applyProvider(form: AccountInput, p: Provider, oauthReady: boolean): AccountInput {
  const oauth =
    !!p.oauth && (p.oauthOnly || (form.provider === p.id ? form.auth === 'oauth' : oauthReady));
  return {
    ...form,
    provider: p.id,
    imapHost: p.imapHost,
    imapPort: p.imapPort,
    imapSecurity: p.imapSecurity,
    smtpHost: p.smtpHost,
    smtpPort: p.smtpPort,
    smtpSecurity: p.smtpSecurity,
    auth: oauth ? 'oauth' : 'password',
    oauthProvider: oauth ? p.oauth : '',
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
          onValueChange={(v) => onChange({ security: v as Security })}
          options={SECURITY.map((s) => ({ value: s.value, label: s.label() }))}
        />
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
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Once the user edits the servers by hand, typing in the address must not overwrite them.
  const manual = useRef(!!existing);
  const patch = (p: Partial<AccountInput>) => setForm((f) => ({ ...f, ...p }));
  const provider = providers.find((p) => p.id === form.provider);
  const busy = status.kind === 'busy';

  const secret = () => ({
    password: form.auth === 'password' ? password : undefined,
    oauthFlow: form.auth === 'oauth' ? oauthFlow : undefined,
  });

  // Browser sign-in needs a client registered with the provider (an ID, plus its secret where the
  // provider demands one); ask for it right here instead of sending the user off to Settings.
  // `null` = not known yet.
  const [clientIds, setClientIds] = useState<Record<string, boolean> | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  useEffect(() => {
    api.settings().then(
      (s) =>
        setClientIds(
          Object.fromEntries(
            OAUTH.map((o) => [
              o.id,
              // The app's own client (built in) needs no setup; else the user's ID (+ secret).
              !!s[`oauth.${o.id}.builtIn`] ||
                (!!String(s[`oauth.${o.id}.clientId`] ?? '') &&
                  (!o.needsSecret || !!s[`oauth.${o.id}.hasClientSecret`])),
            ]),
          ),
        ),
      () => setClientIds({}),
    );
  }, []);

  // Recognize the provider from the address while a new account is typed. Running again once the
  // OAuth settings arrive is harmless: the same provider keeps the sign-in method already chosen.
  useEffect(() => {
    if (existing || manual.current || !form.email.includes('@')) return;
    let live = true;
    const timer = setTimeout(() => {
      api.detectProvider(form.email).then(
        (p) => {
          if (!live || manual.current) return;
          setForm((f) => applyProvider(f, p, !!clientIds?.[p.oauth]));
        },
        () => {},
      );
    }, 600); // the lookup may go to the network, so wait for a pause in typing
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [form.email, existing, clientIds]);

  const setup =
    form.auth === 'oauth' && clientIds && !clientIds[provider?.oauth ?? '']
      ? OAUTH.find((o) => o.id === provider?.oauth)
      : undefined;
  const canSaveClient = !!clientId.trim() && (!setup?.needsSecret || !!clientSecret.trim());
  const saveClientId = async () => {
    if (!setup || !canSaveClient) return;
    try {
      await api.setSettings({
        [`oauth.${setup.id}.clientId`]: clientId.trim(),
        ...(setup.needsSecret ? { [`oauth.${setup.id}.clientSecret`]: clientSecret.trim() } : {}),
      });
      setClientIds({ ...clientIds, [setup.id]: true });
      setClientId('');
      setClientSecret('');
      setStatus({ kind: 'idle' });
    } catch (e) {
      toastError(t('Could not save the setting'), e);
    }
  };

  const signIn = async () => {
    if (!provider?.oauth) return;
    const name = provider.oauth === 'google' ? 'Google' : 'Microsoft';
    setStatus({ kind: 'busy', what: t('Waiting for the sign-in…') });
    // Closing the sign-in window by hand ends the wait here; the backend's own wait just times out.
    let cancel = () => {};
    const closed = new Promise<'closed'>((resolve) => (cancel = () => resolve('closed')));
    const unlisten = await api.onSignInClosed(() => cancel());
    try {
      const flow = await api.oauthStart(provider.oauth, form.email);
      await api.openSignIn(flow.url, {
        title: t('Sign in to {provider}', { provider: name }),
        openInBrowser: t('Open in browser'),
      });
      const outcome = await Promise.race([
        api.oauthWait(flow.flowId).then(() => 'done' as const),
        closed,
      ]);
      if (outcome === 'done') setOauthFlow(flow.flowId);
      setStatus({ kind: 'idle' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      unlisten();
      void api.closeSignIn();
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
            options={providers.map((p) => ({
              value: p.id,
              label: p.id === 'custom' ? t('Other (IMAP / SMTP)') : p.name,
            }))}
            onValueChange={(id) => {
              const p = providers.find((x) => x.id === id);
              if (!p) return;
              manual.current = true;
              setForm((f) =>
                p.id === 'custom'
                  ? { ...f, provider: 'custom', auth: 'password', oauthProvider: '' }
                  : applyProvider(f, p, !!clientIds?.[p.oauth]),
              );
            }}
          />
        </Field>

        {provider?.oauth && !provider.oauthOnly && (
          <RadioGroup
            className="text-sm"
            aria-label={t('Sign-in method')}
            value={form.auth}
            onValueChange={(v) =>
              patch(
                v === 'oauth'
                  ? { auth: 'oauth', oauthProvider: provider.oauth }
                  : { auth: 'password', oauthProvider: '' },
              )
            }
            options={[
              { value: 'password', label: t('App password') },
              {
                value: 'oauth',
                label: t('Sign in with {provider} (OAuth)', {
                  provider: provider.oauth === 'google' ? 'Google' : 'Microsoft',
                }),
              },
            ]}
          />
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
        ) : setup ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3">
            <div className="font-medium">
              {t('{provider} sign-in needs a one-time setup', { provider: setup.name })}
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              {t(
                '{provider} only lets registered apps read mail, and MailStudio does not ship with a registration. Register one yourself (free, a few minutes):',
                { provider: setup.name },
              )}{' '}
              {setup.steps()}
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1 self-start text-xs text-accent underline"
              onClick={() => void openUrl(setup.console)}
            >
              {t('Open the provider’s page')}
              <ExternalLink className="size-3" />
            </button>
            <div className="flex items-end gap-2">
              <Field label={t('Client ID')} className="flex-1">
                <Input
                  spellCheck={false}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </Field>
              {setup.needsSecret && (
                <Field label={t('Client secret')} className="flex-1">
                  <Input
                    type="password"
                    spellCheck={false}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                </Field>
              )}
              <Button disabled={!canSaveClient} onClick={() => void saveClientId()}>
                {t('Save')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted p-3">
            <Button disabled={busy || !form.email.includes('@')} onClick={() => void signIn()}>
              {oauthFlow ? t('Sign in again') : t('Open the sign-in window')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {oauthFlow
                ? t('Signed in. Save the account to finish.')
                : existing
                  ? t(
                      'Already signed in. Sign in again only if the sync reports a sign-in problem.',
                    )
                  : t(
                      'A sign-in window opens. If it will not sign you in, choose “Open in browser” in its menu.',
                    )}
            </span>
          </div>
        )}

        {/* Presets carry their servers; only a server MailStudio does not know needs them typed. */}
        {form.provider === 'custom' && (
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
              {canSubmit && (
                <button
                  type="button"
                  className="mt-1 text-xs underline"
                  onClick={() => void save(true)}
                >
                  {t('Save without testing')}
                </button>
              )}
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
