import { MailPlus, Inbox, Settings, ShieldCheck, Keyboard } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Prompt, Toasts } from '@/components/Overlays';
import { Button, Spinner } from '@/components/ui';
import { AccountDialog } from '@/features/accounts/AccountDialog';
import { Composer } from '@/features/compose/Composer';
import { SettingsDialog } from '@/features/settings/Settings';
import { WorkspaceBar } from '@/features/workspace/Workspace';
import { MailLayout } from '@/features/workspace/MailLayout';
import { t, useLang } from '@/lib/i18n';
import { useCompose } from '@/stores/compose';
import { useMail } from '@/stores/mail';
import { useUi } from '@/stores/ui';

/** Keys that act on the list/reader; ignored while typing or while a dialog is open. */
function useShortcuts(searchRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (useCompose.getState().draft || useUi.getState().dialog || useUi.getState().prompt) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const mail = useMail.getState();
      const compose = useCompose.getState();
      const ids = mail.targets();
      const detail = mail.detail;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      switch (e.key) {
        case 'c':
          return run(() => compose.newMessage([], mail.scopeAccountId));
        case '/':
          return run(() => searchRef.current?.focus());
        case 'j':
        case 'ArrowDown':
          return run(() => mail.step(1));
        case 'k':
        case 'ArrowUp':
          return run(() => mail.step(-1));
        case 'r':
          return detail && run(() => compose.reply(detail, false));
        case 'a':
          return detail && run(() => compose.reply(detail, true));
        case 'f':
          return detail && run(() => compose.forward(detail));
        case 'e':
          return ids.length && run(() => void mail.act('archive', ids));
        case 'Delete':
        case '#':
          return ids.length && run(() => void mail.act('delete', ids));
        case 's': {
          const m = mail.items.find((x) => x.id === ids[0]);
          return m && run(() => void mail.setFlags(ids, { flagged: !m.flagged }));
        }
        case 'u': {
          const m = mail.items.find((x) => x.id === ids[0]);
          return m && run(() => void mail.setFlags(ids, { seen: !m.seen }));
        }
        case 'Escape':
          if (mail.checked.length) return run(() => mail.setChecked([]));
          return mail.activeId !== null && run(() => void mail.open(null));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef]);
}

function Welcome() {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto bg-surface p-8 text-center">
      <img src="/icon.png" alt="" width={72} height={72} />
      <h1 className="m-0 text-2xl font-semibold">{t('Welcome to MailStudio')}</h1>
      <p className="m-0 max-w-md text-muted-foreground">
        {t(
          'Read and write mail from all your accounts in one place: Gmail, Outlook, Yahoo, iCloud, Zoho and any other IMAP/SMTP mailbox.',
        )}
      </p>
      {/* No account rail yet, so Settings (language, OAuth clients…) is reached from here. */}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => useUi.getState().openDialog('account', null)}>
          <MailPlus className="size-4" />
          {t('Add a mail account')}
        </Button>
        <Button onClick={() => useUi.getState().openDialog('settings')}>
          <Settings className="size-4" />
          {t('Settings')}
        </Button>
      </div>
      <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
        {(
          [
            [Inbox, t('All your mail, together'), t('One inbox for every account.')],
            [
              ShieldCheck,
              t('Safe to read'),
              t(
                'Messages are cleaned before they are shown; remote images can be turned off in Settings.',
              ),
            ],
            [
              Keyboard,
              t('Work at your pace'),
              t('Use keyboard shortcuts to move through your inbox.'),
            ],
          ] as const
        ).map(([FeatureIcon, title, body]) => {
          return (
            <div key={title} className="rounded-xl border border-border bg-background p-4">
              <FeatureIcon className="mb-3 size-5 text-accent" />
              <h2 className="m-0 mb-1 text-sm font-semibold">{title}</h2>
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function App() {
  const lang = useLang();
  const ready = useMail((s) => s.ready);
  const hasAccounts = useMail((s) => s.accounts.length > 0);
  const theme = useUi((s) => s.prefs.theme);
  const searchRef = useRef<HTMLInputElement>(null);
  useShortcuts(searchRef);

  useEffect(() => {
    void useMail.getState().init();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    // Keyed by language so every `t()` in the tree is evaluated again after a switch.
    <div key={lang} className="flex h-full flex-col">
      <div className="workspace flex min-h-0 flex-1 overflow-x-auto">
        {!ready ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6" />
          </div>
        ) : hasAccounts ? (
          <MailLayout searchRef={searchRef} />
        ) : (
          <Welcome />
        )}
      </div>
      <WorkspaceBar />
      <Composer />
      <AccountDialog />
      <SettingsDialog />
      <Prompt />
      <Toasts />
    </div>
  );
}
