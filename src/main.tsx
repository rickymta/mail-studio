import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './app/App';
import { t } from './lib/i18n';
import { resolveTheme, toast, useUi } from './stores/ui';
import { applyZoom, useZoom } from './stores/zoom';

// Before the first paint, so a dark-theme user never sees a white flash.
document.documentElement.classList.toggle(
  'dark',
  resolveTheme(useUi.getState().prefs.theme) === 'dark',
);
applyZoom(useZoom.getState().zoom);

// Click handlers are often `async` with no catch; surface their failures instead of letting the
// button look dead.
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string } | undefined;
  toast('error', t('Something went wrong'), r?.message ?? String(e.reason));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
