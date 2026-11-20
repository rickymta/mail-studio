// Preparing a message's HTML for display. The backend already removed everything active
// (scripts, handlers, forms, frames); what is left to decide here is whether the message may
// load pictures from the internet, which tells the sender that — and where — it was opened.

const REMOTE_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;
const IMPORT = /@import\b[^;]*;?/gi;

/** Remove references to remote resources from a piece of CSS. */
export function scrubCss(css: string): string {
  return css.replace(IMPORT, '').replace(REMOTE_URL, 'none');
}

const isEmbedded = (src: string) => /^\s*(data:|cid:)/i.test(src);

export type FileKind =
  'image' | 'sheet' | 'doc' | 'slides' | 'pdf' | 'archive' | 'audio' | 'video' | 'text';

const KINDS: [FileKind, RegExp][] = [
  ['sheet', /\.(xlsx?|xlsm|csv|ods|numbers)\b/i],
  ['doc', /\.(docx?|odt|rtf|pages)\b/i],
  ['slides', /\.(pptx?|ppsx?|odp|key)\b/i],
  ['pdf', /\.pdf\b/i],
  ['archive', /\.(zip|rar|7z|tar|gz|tgz)\b/i],
  ['audio', /\.(mp3|wav|m4a|flac|ogg)\b/i],
  ['video', /\.(mp4|mov|avi|mkv|webm)\b/i],
  ['text', /\.(txt|md|log|json|xml)\b/i],
  ['image', /\.(png|jpe?g|gif|webp|bmp|svg|heic)\b/i],
];
const HOSTS: [FileKind, RegExp][] = [
  ['sheet', /docs\.google\.com\/spreadsheets/i],
  ['doc', /docs\.google\.com\/document/i],
  ['slides', /docs\.google\.com\/presentation/i],
];

/** The kind of file a piece of text (a file name, a link) points at, if it names one. */
export function fileKind(text: string): FileKind | null {
  return (
    KINDS.find(([, re]) => re.test(text))?.[0] ?? HOSTS.find(([, re]) => re.test(text))?.[0] ?? null
  );
}

/**
 * What a picture that was held back stands for. Mail apps put a small file-type icon in front
 * of a linked file; when that icon is blocked, the link beside it still says which file it is.
 */
function blockedKind(img: Element): FileKind {
  // The icon sits inside the link, or right before it.
  const next = img.nextElementSibling;
  const link = img.closest('a') ?? (next?.matches('a') ? next : next?.querySelector('a'));
  const hints = [img.getAttribute('alt'), link?.textContent, link?.getAttribute('href')];
  for (const h of hints) {
    const kind = h ? fileKind(h) : null;
    if (kind) return kind;
  }
  return 'image';
}

/**
 * The HTML to put on screen. With `allowRemote` false, remote images lose their source (and get
 * `data-blocked` so they can be styled as placeholders) and CSS loses its remote URLs.
 * Returns the markup and whether anything was blocked.
 */
export function prepareMailHtml(
  html: string,
  allowRemote: boolean,
): { html: string; blocked: boolean } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let blocked = false;
  if (!allowRemote) {
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (src && !isEmbedded(src)) {
        img.removeAttribute('src');
        img.setAttribute('data-blocked', blockedKind(img));
        blocked = true;
      }
      img.removeAttribute('srcset');
    });
    doc.querySelectorAll('[style]').forEach((el) => {
      const before = el.getAttribute('style') ?? '';
      const after = scrubCss(before);
      if (after !== before) {
        el.setAttribute('style', after);
        blocked = true;
      }
    });
    doc.querySelectorAll('style').forEach((st) => {
      const before = st.textContent ?? '';
      const after = scrubCss(before);
      if (after !== before) {
        st.textContent = after;
        blocked = true;
      }
    });
    doc.querySelectorAll('[background]').forEach((el) => el.removeAttribute('background'));
  }
  // The parser moves leading <style> blocks into <head>; keep them with the body.
  const styles = [...doc.head.querySelectorAll('style')].map((s) => s.outerHTML).join('');
  return { html: styles + doc.body.innerHTML, blocked };
}

/** Turn bare URLs of a plain-text message into links (the text is escaped first). */
export function linkify(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(
    /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]]/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
}
