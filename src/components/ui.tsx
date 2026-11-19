import { ContextMenu, Dialog, DropdownMenu } from 'radix-ui';
import { ChevronRight, Loader2, X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { hue, initials } from '@/lib/format';
import { t } from '@/lib/i18n';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'default' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3',
        variant === 'primary' && 'bg-accent text-accent-foreground hover:brightness-110',
        variant === 'default' && 'border border-border bg-surface-muted hover:bg-surface-hover',
        variant === 'ghost' && 'hover:bg-surface-hover',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  active,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...rest}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        active ? 'bg-accent-soft text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn('size-4 animate-spin', className)} />
);

export function Avatar({
  name,
  size = 32,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: color ?? `oklch(0.58 0.12 ${hue(name)})`,
      }}
    >
      {initials(name)}
    </span>
  );
}

const fieldCls =
  'w-full rounded-md border border-border bg-background px-2.5 outline-none placeholder:text-muted-foreground focus:border-accent disabled:opacity-60';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldCls, 'h-8', props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldCls, 'resize-none py-2', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldCls, 'h-8', props.className)} />;
}

/** A labelled form row; `hint` explains the field in a sentence. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col">
        <span>{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

// ---- menus --------------------------------------------------------------------------------------

export type MenuItem =
  | 'sep'
  | {
      label: string;
      icon?: ReactNode;
      onSelect?: () => void;
      danger?: boolean;
      disabled?: boolean;
      items?: MenuItem[];
    };

const itemCls =
  'flex h-7 cursor-default items-center gap-2 rounded px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';
const contentCls =
  'z-50 max-h-[70vh] min-w-48 overflow-y-auto rounded-md border border-border bg-surface p-1 text-[13px] shadow-xl';

function renderItems(items: MenuItem[], C: typeof DropdownMenu | typeof ContextMenu): ReactNode[] {
  return items.map((it, i) => {
    if (it === 'sep') return <C.Separator key={i} className="my-1 h-px bg-border" />;
    if (it.items) {
      return (
        <C.Sub key={i}>
          <C.SubTrigger className={itemCls} disabled={it.disabled}>
            {it.icon}
            <span className="flex-1 truncate">{it.label}</span>
            <ChevronRight className="size-3.5" />
          </C.SubTrigger>
          <C.Portal>
            <C.SubContent className={contentCls}>{renderItems(it.items, C)}</C.SubContent>
          </C.Portal>
        </C.Sub>
      );
    }
    return (
      <C.Item
        key={i}
        className={cn(itemCls, it.danger && 'text-danger')}
        disabled={it.disabled}
        onSelect={it.onSelect}
      >
        {it.icon}
        <span className="flex-1 truncate">{it.label}</span>
      </C.Item>
    );
  });
}

/** A dropdown opened by `trigger` (which must be a single element that takes a ref). */
export function Menu({
  trigger,
  items,
  align = 'start',
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={contentCls} align={align} sideOffset={4}>
          {renderItems(items, DropdownMenu)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Right-click menu around `children`; `items` is built when the menu opens. */
export function RightClick({ children, items }: { children: ReactNode; items: () => MenuItem[] }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={contentCls}>
          <LazyItems items={items} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// Rendered only while the menu is open, so `items()` runs with the state of that moment.
function LazyItems({ items }: { items: () => MenuItem[] }) {
  return <>{renderItems(items(), ContextMenu)}</>;
}

// ---- dialog -------------------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  bare = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** No padding around the content (the content lays itself out). */
  bare?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-40 flex max-h-[90vh] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-2xl outline-none"
          style={{ width }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
            <Dialog.Title className="flex-1 truncate text-sm font-semibold">{title}</Dialog.Title>
            <IconButton label={t('Close')} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto', !bare && 'p-4')}>{children}</div>
          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
