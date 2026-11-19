import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useState } from 'react';

import { t } from '@/lib/i18n';
import { useUi, type PromptValues } from '@/stores/ui';
import { Button, Field, Input, Modal, Textarea } from './ui';

const TOAST_STYLE = {
  error: { color: 'var(--danger)', Icon: XCircle },
  success: { color: 'var(--success)', Icon: CheckCircle2 },
  warning: { color: 'var(--warning)', Icon: AlertTriangle },
  info: { color: 'var(--accent)', Icon: Info },
} as const;

/** Bottom-left notifications, newest at the bottom. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[400px] max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const { color, Icon } = TOAST_STYLE[toast.kind];
        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className="toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 shadow-xl"
            style={{ borderLeft: `3px solid ${color}` }}
          >
            <Icon className="mt-0.5 size-4 shrink-0" style={{ color }} />
            <div className="selectable min-w-0 flex-1">
              <div className="font-medium">{toast.title}</div>
              {toast.detail && (
                <div className="mt-0.5 text-xs break-words text-muted-foreground">
                  {toast.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label={t('Dismiss')}
              className="rounded p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              onClick={() => dismiss(toast.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The dialog behind `ask()` / `confirm()`. */
export function Prompt() {
  const prompt = useUi((s) => s.prompt);
  if (!prompt) return null;
  return <PromptBody key={prompt.title} />;
}

function PromptBody() {
  const prompt = useUi((s) => s.prompt)!;
  const close = useUi((s) => s.closePrompt);
  const [values, setValues] = useState<PromptValues>(() =>
    Object.fromEntries((prompt.fields ?? []).map((f) => [f.name, f.initial ?? ''])),
  );
  const missing = (prompt.fields ?? []).some((f) => f.required && !values[f.name]?.trim());
  const submit = () => !missing && close(values);
  return (
    <Modal
      open
      onClose={() => close(null)}
      title={prompt.title}
      width={440}
      footer={
        <>
          <Button onClick={() => close(null)}>{t('Cancel')}</Button>
          <Button
            variant={prompt.danger ? 'danger' : 'primary'}
            disabled={missing}
            onClick={submit}
          >
            {prompt.confirmLabel ?? t('OK')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {prompt.description && (
          <p className="selectable m-0 whitespace-pre-wrap text-muted-foreground">
            {prompt.description}
          </p>
        )}
        {(prompt.fields ?? []).map((f, i) => (
          <Field key={f.name} label={f.label}>
            {f.type === 'textarea' ? (
              <Textarea
                rows={4}
                autoFocus={i === 0}
                placeholder={f.placeholder}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            ) : (
              <Input
                type={f.type === 'password' ? 'password' : 'text'}
                autoFocus={i === 0}
                placeholder={f.placeholder}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </form>
    </Modal>
  );
}
