// Showing a message written for a white page on a dark one. Instead of inverting everything
// (which turns a dark banner light and washes out pictures), each element is looked at: light
// backgrounds become dark, dark text and borders become light, and whatever is already dark —
// or is a picture — stays as the sender made it.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse the `rgb(…)` / `rgba(…)` strings `getComputedStyle` returns. */
export function parseColor(value: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: alpha };
}

/** Perceived lightness, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function toHsl({ r, g, b }: Rgba): [h: number, s: number, l: number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const hsl = (h: number, s: number, l: number, a: number) =>
  `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${a < 1 ? ` / ${a}` : ''})`;

/** Hue and saturation used for what was neutral (white, grey): the app's own blue-grey. */
const NEUTRAL = { h: 220, s: 0.14 };

/** The dark replacement of a light background, or null when it is dark enough already. */
export function darkBackground(c: Rgba): string | null {
  if (c.a < 0.05 || luminance(c) < 0.4) return null;
  const [h, s, l] = toHsl(c);
  const dark = Math.min(0.28, Math.max(0.12, (1 - l) * 0.9 + 0.12));
  return s < 0.12 ? hsl(NEUTRAL.h, NEUTRAL.s, dark, c.a) : hsl(h, s * 0.55, dark, c.a);
}

/** The light replacement of a dark text or border colour, or null when it is readable already. */
export function lightForeground(c: Rgba): string | null {
  if (c.a < 0.05 || luminance(c) > 0.3) return null;
  const [h, s, l] = toHsl(c);
  const light = Math.min(0.9, Math.max(0.72, 1 - l));
  return s < 0.12 ? hsl(NEUTRAL.h, NEUTRAL.s, light, c.a) : hsl(h, Math.min(s, 0.8), light, c.a);
}

const SKIP = new Set(['IMG', 'VIDEO', 'PICTURE', 'SVG', 'CANVAS', 'STYLE']);

/** Recolour a rendered message for a dark page. Call once after its markup is in place. */
export function applyDarkMail(root: Element) {
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (SKIP.has(el.tagName.toUpperCase()) || el.closest('svg')) continue;
    const cs = view.getComputedStyle(el);
    const set = (prop: string, color: string | null) => {
      if (color) el.style.setProperty(prop, color, 'important');
    };
    const bg = parseColor(cs.backgroundColor);
    if (bg) set('background-color', darkBackground(bg));
    const fg = parseColor(cs.color);
    if (fg) set('color', lightForeground(fg));
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (cs.getPropertyValue(`border-${side}-style`) === 'none') continue;
      const border = parseColor(cs.getPropertyValue(`border-${side}-color`));
      if (border) set(`border-${side}-color`, lightForeground(border) && 'hsl(220 10% 45%)');
    }
  }
}
