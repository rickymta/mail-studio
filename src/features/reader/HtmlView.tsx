import { useEffect, useRef } from 'react';

import { parseAddrList } from '@/lib/format';
import { linkify, prepareMailHtml } from '@/lib/html';
import { openUrl } from '@/lib/native';
import { useCompose } from '@/stores/compose';

// Mail is written for a white page, whatever the app theme. `all: initial` cuts the app's
// inherited styles off; the transform keeps `position: fixed` content inside the message.
const BASE_CSS = `
:host { all: initial; display: block; }
.mail {
  background: #fff; color: #1f2328; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  padding: 16px 20px; overflow-x: auto; overflow-wrap: anywhere; user-select: text;
  transform: translateZ(0); border-radius: 6px; min-height: 40px;
}
.mail.plain { background: var(--surface, #fff); color: var(--foreground, #1f2328); white-space: pre-wrap; font-size: 13.5px; }
img { max-width: 100%; height: auto; }
img[data-blocked] {
  display: inline-block; min-width: 20px; min-height: 20px; background: #eef0f3;
  outline: 1px dashed #c3c8cf; outline-offset: -1px;
}
table { max-width: 100%; }
a { color: #0b57d0; }
pre { white-space: pre-wrap; }
blockquote { margin: 0 0 0 .8ex; border-left: 2px solid #ccc; padding-left: 1ex; color: #555; }
`;

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

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    if (html !== null) {
      const prepared = prepareMailHtml(html, allowRemote);
      root.innerHTML = `<style>${BASE_CSS}</style><div class="mail">${prepared.html}</div>`;
      onBlocked?.(prepared.blocked);
    } else {
      root.innerHTML = `<style>${BASE_CSS}</style><div class="mail plain">${linkify(text ?? '')}</div>`;
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
  }, [html, text, allowRemote, accountId]);

  return <div ref={host} />;
}
