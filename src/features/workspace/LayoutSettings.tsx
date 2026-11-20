import { Columns2, Rows2, RotateCcw } from 'lucide-react';
import { Button, cn } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useLayout } from '@/stores/layout';

export function LayoutSettings() {
  const prefs = useLayout((s) => s.prefs);
  const update = useLayout((s) => s.update);
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-sm text-muted-foreground">
        {t(
          'Drag the dividers between panes to resize them. Double-click a divider to restore its default size. Your layout is saved automatically.',
        )}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { mode: 'columns', Icon: Columns2, label: t('Side by side') },
            { mode: 'rows', Icon: Rows2, label: t('Reading pane below') },
          ] as const
        ).map(({ mode, Icon, label }) => (
          <button
            type="button"
            key={mode}
            aria-pressed={prefs.mode === mode}
            onClick={() => update({ mode })}
            className={cn(
              'flex flex-col items-center gap-3 rounded-lg border p-4',
              prefs.mode === mode
                ? 'border-accent bg-accent-soft text-foreground'
                : 'border-border hover:bg-surface-hover',
            )}
          >
            <Icon className="size-8 text-accent" />
            {label}
          </button>
        ))}
      </div>
      {(
        [
          ['sidebar', t('Sidebar width'), 180, 400, 'px'],
          [
            prefs.mode === 'columns' ? 'list' : 'listHeight',
            prefs.mode === 'columns' ? t('Message list width') : t('Message list height'),
            prefs.mode === 'columns' ? 280 : 25,
            prefs.mode === 'columns' ? 720 : 70,
            prefs.mode === 'columns' ? 'px' : '%',
          ],
          ['rowHeight', t('Message row height'), 80, 128, 'px'],
        ] as const
      ).map(([key, label, min, max, unit]) => (
        <label key={key} className="flex flex-col gap-2">
          <span className="flex justify-between gap-2 text-sm">
            <span>{label}</span>
            <span className="text-muted-foreground tabular-nums">
              {prefs[key]} {unit}
            </span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            value={prefs[key]}
            onChange={(e) => update({ [key]: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        </label>
      ))}
      <Button className="self-start" onClick={() => useLayout.getState().reset()}>
        <RotateCcw className="size-4" />
        {t('Reset layout')}
      </Button>
    </div>
  );
}
