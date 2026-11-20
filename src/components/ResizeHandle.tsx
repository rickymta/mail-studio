import { useEffect, useRef, useState } from 'react';
import { cn } from './ui';
import { t } from '@/lib/i18n';
import { clamp } from '@/stores/layout';

/** Pointer capture keeps dragging stable outside the narrow divider; arrows provide keyboard access. */
export function ResizeHandle({
  axis = 'x',
  label,
  value,
  min,
  max,
  onChange,
  onReset,
  scale = 1,
  reverse = false,
}: {
  axis?: 'x' | 'y';
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  scale?: number;
  reverse?: boolean;
}) {
  const drag = useRef<{ point: number; value: number } | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!active) return;
    document.body.dataset.resizing = axis;
    return () => {
      delete document.body.dataset.resizing;
    };
  }, [active, axis]);
  const update = (next: number) => onChange(Math.round(clamp(next, min, max)));
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      title={t('Drag to resize. Double-click to reset.')}
      className={cn(
        'resize-handle',
        axis === 'x' ? 'resize-x' : 'resize-y',
        active && 'is-resizing',
      )}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { point: axis === 'x' ? e.clientX : e.clientY, value };
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const point = axis === 'x' ? e.clientX : e.clientY;
        update(drag.current.value + (point - drag.current.point) * scale * (reverse ? -1 : 1));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        setActive(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onKeyDown={(e) => {
        const negative = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const positive = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (![negative, positive, 'Home', 'End', 'Enter'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Enter') return onReset();
        update(
          e.key === 'Home'
            ? min
            : e.key === 'End'
              ? max
              : value +
                (e.key === negative ? -1 : 1) * (reverse ? -1 : 1) * (e.shiftKey ? 32 : 8) * scale,
        );
      }}
    >
      <span />
    </div>
  );
}
