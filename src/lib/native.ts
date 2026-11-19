import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { openUrl as openExternal } from '@tauri-apps/plugin-opener';

import { isTauri } from './ipc';

/** File picker for attachments. In a plain browser (dev bridge) falls back to a text prompt. */
export async function pickFiles(title: string): Promise<string[]> {
  if (isTauri) {
    const r = await openDialog({ directory: false, multiple: true, title });
    return Array.isArray(r) ? r : typeof r === 'string' ? [r] : [];
  }
  const p = window.prompt(`${title} (absolute path)`, '');
  return p ? [p] : [];
}

/** "Save as" dialog; null when cancelled. */
export async function pickSavePath(title: string, defaultName: string): Promise<string | null> {
  if (isTauri) return await saveDialog({ title, defaultPath: defaultName });
  return window.prompt(`${title} (absolute path)`, defaultName);
}

/** Open a web or mailto link outside the app. Anything else is ignored. */
export async function openUrl(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isTauri) {
    await openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Desktop notification; asks for permission the first time. Never throws. */
export async function notifyDesktop(title: string, body: string): Promise<void> {
  try {
    if (isTauri) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === 'granted';
      if (ok) sendNotification({ title, body });
      return;
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body });
  } catch {
    /* notifications are best-effort */
  }
}
