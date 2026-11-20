import { MailPlus } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Prompt, Toasts } from '@/components/Overlays';
import { Button, Spinner } from '@/components/ui';
import { AccountDialog } from '@/features/accounts/AccountDialog';
import { Composer } from '@/features/compose/Composer';
import { MessageList } from '@/features/list/MessageList';
import { Reader } from '@/features/reader/Reader';
import { SettingsDialog } from '@/features/settings/Settings';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { t, useLang } from '@/lib/i18n';
import { useCompose } from '@/stores/compose';
import { useMail } from '@/stores/mail';
import { resolveTheme, useUi } from '@/stores/ui';

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
          return run(() => compose.newMessage());
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
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <img src="/icon.png" alt="" width={72} height={72} />
      <h1 className="m-0 text-2xl font-semibold">{t('Welcome to MailStudio')}</h1>
      <p className="m-0 max-w-md text-muted-foreground">
        {t(
          'Read and write mail from all your accounts in one place: Gmail, Outlook, Yahoo, iCloud, Zoho and any other IMAP/SMTP mailbox.',
        )}
      </p>
      <Button variant="primary" onClick={() => useUi.getState().openDialog('account', null)}>
        <MailPlus className="size-4" />
        {t('Add a mail account')}
      </Button>
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
    const apply = () =>
      document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    // Keyed by language so every `t()` in the tree is evaluated again after a switch.
    <div key={lang} className="flex h-full">
      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : hasAccounts ? (
        <>
          <Sidebar />
          <MessageList searchRef={searchRef} />
          <Reader />
        </>
      ) : (
        <Welcome />
      )}
      <Composer />
      <AccountDialog />
      <SettingsDialog />
      <Prompt />
      <Toasts />
    </div>
  );
}
