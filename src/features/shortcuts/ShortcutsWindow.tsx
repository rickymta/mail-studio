import { Fragment, useState } from 'react';

import { Input } from '@/components/ui';
import { t } from '@/lib/i18n';

import { filterShortcuts, shortcutGroups } from './shortcuts';

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </kbd>
  );
}

/** Body of the Keyboard Shortcuts dialog: every shortcut, grouped, with a filter. */
export function ShortcutsWindow() {
  const [query, setQuery] = useState('');
  const groups = filterShortcuts(shortcutGroups(), query);
  return (
    <div className="flex flex-col gap-4">
      <Input
        data-autofocus
        aria-label={t('Filter shortcuts')}
        placeholder={t('Filter shortcuts')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="h-96 overflow-y-auto pr-1">
        {!groups.length && (
          <p className="m-0 py-8 text-center text-muted-foreground">{t('No matching shortcuts')}</p>
        )}
        {groups.map((g) => (
          <section key={g.title} className="mb-5 last:mb-0">
            <h3 className="m-0 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {g.title}
            </h3>
            <div className="rounded-lg border border-border">
              {g.items.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between gap-4 border-b border-border px-3 py-2 text-sm last:border-0"
                >
                  <span>{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((combo, i) => (
                      <Fragment key={combo.join('+')}>
                        {i > 0 && (
                          <span className="px-1 text-xs text-muted-foreground">{t('or')}</span>
                        )}
                        {combo.map((k) => (
                          <Key key={k}>{k}</Key>
                        ))}
                      </Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
