import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/components/ui';
import { displayName, parseAddr, parseAddrList } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import type { Addr } from '@/lib/types';

/** Recipients as chips, with suggestions from the people the user has written to or heard from. */
export function AddressInput({
  label,
  value,
  onChange,
  autoFocus,
  trailing,
}: {
  label: string;
  value: Addr[];
  onChange: (v: Addr[]) => void;
  autoFocus?: boolean;
  trailing?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [found, setSuggestions] = useState<Addr[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Stale results of an earlier query are not shown for an empty field.
  const suggestions = text.trim() ? found : [];

  useEffect(() => {
    const q = text.trim();
    if (!q) return;
    let live = true;
    const timer = setTimeout(() => {
      api.contacts(q).then(
        (list) => {
          if (!live) return;
          setSuggestions(
            list.filter((c) => !value.some((v) => v.email.toLowerCase() === c.email.toLowerCase())),
          );
          setHighlight(0);
        },
        () => {},
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, value]);

  const add = (list: Addr[]) => {
    const fresh = list.filter(
      (a) => !value.some((v) => v.email.toLowerCase() === a.email.toLowerCase()),
    );
    if (fresh.length) onChange([...value, ...fresh]);
    setText('');
    setSuggestions([]);
    setInvalid(false);
  };

  /** Turn what is typed into a chip; false when it is not an address. */
  const commit = (): boolean => {
    if (!text.trim()) return true;
    const a = parseAddr(text);
    if (!a) {
      setInvalid(true);
      return false;
    }
    add([a]);
    return true;
  };

  return (
    <div
      className={cn(
        'relative flex min-h-9 items-start gap-2 border-b border-border px-3 py-1',
        invalid && 'border-danger',
      )}
      onClick={() => input.current?.focus()}
    >
      <span className="w-12 shrink-0 pt-1.5 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((a, i) => (
          <span
            key={a.email + i}
            title={a.email}
            className="flex h-6 max-w-full items-center gap-1 rounded-full bg-surface-muted pr-1 pl-2.5 text-xs"
          >
            <span className="truncate">{displayName(a)}</span>
            <button
              type="button"
              aria-label={t('Remove {name}', { name: displayName(a) })}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((_, j) => j !== i));
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          aria-label={label}
          aria-invalid={invalid}
          className="h-7 min-w-40 flex-1 bg-transparent outline-none"
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            const list = parseAddrList(pasted);
            if (list.length > 1 || (list.length === 1 && /[,;\n]/.test(pasted))) {
              e.preventDefault();
              add(list);
            }
          }}
          onBlur={() => {
            // Leave time for a click on a suggestion to land first.
            setTimeout(() => {
              setSuggestions([]);
              if (document.activeElement !== input.current) commit();
            }, 150);
          }}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setHighlight((h) => (h + d + suggestions.length) % suggestions.length);
            } else if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') {
              const pick = suggestions[highlight];
              if (pick && e.key !== ',' && e.key !== ';') {
                e.preventDefault();
                add([pick]);
              } else if (text.trim()) {
                // Tab moves on only when the text became a chip.
                if (!commit() || e.key !== 'Tab') e.preventDefault();
              } else if (e.key !== 'Tab') {
                e.preventDefault();
              }
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === 'Escape' && suggestions.length) {
              e.stopPropagation();
              setSuggestions([]);
            }
          }}
        />
      </div>
      {trailing}
      {invalid && (
        <span role="alert" className="absolute top-full right-3 z-10 text-xs text-danger">
          {t('Not a valid e-mail address')}
        </span>
      )}
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-16 z-20 m-0 w-96 max-w-[calc(100%-80px)] list-none rounded-md border border-border bg-surface p-1 shadow-xl"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.email}
              role="option"
              aria-selected={i === highlight}
              className={cn(
                'flex cursor-default flex-col rounded px-2 py-1',
                i === highlight && 'bg-accent text-accent-foreground',
              )}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                add([s]);
              }}
            >
              <span className="truncate">{s.name || s.email}</span>
              {s.name && <span className="truncate text-xs opacity-75">{s.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
