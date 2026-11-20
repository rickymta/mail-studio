import { AccountWorkspace } from './AccountWorkspace';
import { useEffect, useRef, useState } from 'react';
import { ResizeHandle } from '@/components/ResizeHandle';
import { MessageList } from '@/features/list/MessageList';
import { Reader } from '@/features/reader/Reader';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { t } from '@/lib/i18n';
import { DEFAULT_LAYOUT, useLayout } from '@/stores/layout';

export function MailLayout({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const prefs = useLayout((s) => s.prefs);
  const update = useLayout((s) => s.update);
  const host = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(700);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [prefs.mode]);
  if (prefs.mode === 'accounts') return <AccountWorkspace />;
  const rows = prefs.mode === 'rows';
  return (
    <div
      className="mail-layout flex min-h-0 flex-1"
      style={{ minWidth: prefs.sidebar + (rows ? 440 : prefs.list + 380) + 12 }}
    >
      <div className="pane sidebar-pane" style={{ width: prefs.sidebar }}>
        <Sidebar />
      </div>
      <ResizeHandle
        label={t('Sidebar width')}
        value={prefs.sidebar}
        min={180}
        max={400}
        onChange={(sidebar) => update({ sidebar })}
        onReset={() => update({ sidebar: DEFAULT_LAYOUT.sidebar })}
      />
      <div ref={host} className={`flex min-h-0 min-w-0 flex-1 ${rows ? 'flex-col' : ''}`}>
        <div
          className="pane list-pane"
          style={rows ? { height: `${prefs.listHeight}%`, minHeight: 160 } : { width: prefs.list }}
        >
          <MessageList searchRef={searchRef} />
        </div>
        <ResizeHandle
          axis={rows ? 'y' : 'x'}
          label={rows ? t('Message list height') : t('Message list width')}
          value={rows ? prefs.listHeight : prefs.list}
          min={rows ? 25 : 280}
          max={rows ? 70 : 720}
          scale={rows ? 100 / Math.max(height, 1) : 1}
          onChange={(value) => update(rows ? { listHeight: value } : { list: value })}
          onReset={() =>
            update(rows ? { listHeight: DEFAULT_LAYOUT.listHeight } : { list: DEFAULT_LAYOUT.list })
          }
        />
        <Reader />
      </div>
    </div>
  );
}
