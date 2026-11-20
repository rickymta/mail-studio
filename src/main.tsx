import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './app/App';
import { t } from './lib/i18n';
import { toast, useUi } from './stores/ui';
import { applyZoom, useZoom } from './stores/zoom';

// Before the first paint, so a dark-theme user never sees a white flash.
document.documentElement.classList.toggle('dark', useUi.getState().prefs.theme === 'dark');
applyZoom(useZoom.getState().zoom);

// Click handlers are often `async` with no catch; surface their failures instead of letting the
// button look dead.
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string } | undefined;
  toast('error', t('Something went wrong'), r?.message ?? String(e.reason));
});

// The webview's own right-click menu (Back, Reload, Print, Inspect…) does not belong in the app.
// Our menus (Radix ContextMenu) handle their own areas; text fields and selected text keep the
// native one so cut / copy / paste still work.
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null;
  const editable = !!el?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
  const selected = !!window.getSelection()?.toString().trim();
  if (!editable && !selected) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
