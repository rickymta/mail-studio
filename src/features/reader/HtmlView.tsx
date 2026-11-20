import { useEffect, useRef } from 'react';

import { parseAddrList } from '@/lib/format';
import { applyDarkMail } from '@/lib/darkMail';
import { linkify, prepareMailHtml, type FileKind } from '@/lib/html';
import { openUrl } from '@/lib/native';
import { useCompose } from '@/stores/compose';
import { useUi } from '@/stores/ui';

// Mail is written for a white page, whatever the app theme, and laid out the way webmail (Gmail)
// shows it. `all: initial` cuts the app's inherited styles off; the transform keeps
// `position: fixed` content inside the message. Too wide a message scrolls sideways rather than
// being squeezed: `overflow-wrap: break-word` (not `anywhere`, which lets table columns shrink to
// one letter) and no percentage limits inside tables (they collapse auto-sized cells, and the
// icons in them, to nothing).
const BASE_CSS = `
:host { all: initial; display: block; }
.mail {
  background: #fff; color: #1f2328; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  padding: 16px 20px; overflow-x: auto; overflow-wrap: break-word; user-select: text;
  transform: translateZ(0); border-radius: 6px; min-height: 40px;
}
.mail.plain { background: var(--surface, #fff); color: var(--foreground, #1f2328); white-space: pre-wrap; font-size: 13.5px; }
img { max-width: 100%; height: auto; }
table img { max-width: none; }
img[data-blocked] {
  display: inline-block; min-width: 20px; min-height: 20px; vertical-align: middle;
  background: #eef0f3 center / 16px 16px no-repeat; border-radius: 3px;
  outline: 1px dashed #c3c8cf; outline-offset: -1px;
}
/* The dark theme: a dark page; applyDarkMail then recolours what the message itself set. */
:host([data-dark]) .mail:not(.plain) { background: #1b1e26; color: #e3e6eb; }
:host([data-dark]) .mail:not(.plain) a { color: #8ab4f8; }
:host([data-dark]) img[data-blocked] { background-color: #2a2f3a; outline-color: #4a5160; }
a { color: #0b57d0; }
pre { white-space: pre-wrap; }
blockquote { margin: 0 0 0 .8ex; border-left: 2px solid #ccc; padding-left: 1ex; color: #555; }
`;

/** A 16px file glyph in the colour of its kind, with a letter, as a CSS data URI. */
function fileIcon(color: string, letter: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>` +
    `<path fill='${color}' d='M3.5 1h6L13 4.5V14a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z'/>` +
    `<path fill='#fff' fill-opacity='.45' d='M9.5 1 13 4.5H9.5z'/>` +
    `<text x='7.75' y='12.4' text-anchor='middle' font-family='Arial,sans-serif' font-size='6.5' font-weight='700' fill='#fff'>${letter}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const KIND_ICON: Record<FileKind, [color: string, letter: string]> = {
  sheet: ['#1d8f4e', 'X'],
  doc: ['#2b6fd6', 'W'],
  slides: ['#d9622b', 'P'],
  pdf: ['#d93a3a', 'PDF'],
  archive: ['#8a6d3b', 'ZIP'],
  audio: ['#8e4ec6', '♪'],
  video: ['#c2410c', '▶'],
  text: ['#5f6b7a', 'T'],
  image: ['#2f9e9e', '▲'],
};

const ICON_CSS = (Object.entries(KIND_ICON) as [FileKind, [string, string]][])
  .map(
    ([kind, [color, letter]]) =>
      `img[data-blocked="${kind}"] { background-image: ${fileIcon(color, letter)}; }`,
  )
  .join('\n');

const STYLE = `<style>${BASE_CSS}${ICON_CSS}</style>`;

/** Whether HTML messages are to be shown dark: the dark mode, unless the user opted out. */
function useDarkMessages(): boolean {
  const theme = useUi((s) => s.prefs.theme);
  const wanted = useUi((s) => s.prefs.darkMessages);
  return wanted && theme === 'dark';
}

/**
 * A message body in a shadow root: its styles cannot touch the app, and the app's cannot touch
 * it. Links open in the browser (or the composer for `mailto:`), never inside the app window.
 */
export function HtmlView({
  html,
  text,
  allowRemote,
  onBlocked,
  accountId,
}: {
  accountId?: number;
  html: string | null;
  text?: string | null;
  allowRemote: boolean;
  /** Told whether remote content was held back, after each render. */
  onBlocked?: (blocked: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const dark = useDarkMessages();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    if (html !== null) {
      const prepared = prepareMailHtml(html, allowRemote);
      root.innerHTML = `${STYLE}<div class="mail">${prepared.html}</div>`;
      if (dark) applyDarkMail(root.querySelector('.mail')!);
      onBlocked?.(prepared.blocked);
    } else {
      root.innerHTML = `${STYLE}<div class="mail plain">${linkify(text ?? '')}</div>`;
      onBlocked?.(false);
    }
    const onClick = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') ?? '';
      if (/^mailto:/i.test(href)) {
        const to = decodeURIComponent(href.slice(7).split('?')[0] ?? '');
        useCompose.getState().newMessage(parseAddrList(to), accountId);
      } else {
        void openUrl(href);
      }
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
    // `onBlocked` is a state setter in every caller; leaving it out avoids re-rendering the body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, text, allowRemote, accountId, dark]);

  return <div ref={host} data-dark={dark ? '' : undefined} />;
}
