import { darkBackground, lightForeground, luminance, parseColor } from './darkMail';

const c = (s: string) => parseColor(s)!;

describe('dark rendering of messages', () => {
  it('parses computed colours', () => {
    expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('rgb(11 26 92 / 50%)')).toEqual({ r: 11, g: 26, b: 92, a: 0.5 });
    expect(parseColor('transparent')).toBeNull();
  });

  it('darkens light backgrounds and leaves dark or transparent ones alone', () => {
    expect(darkBackground(c('rgb(255, 255, 255)'))).toBe('hsl(220 14% 12%)');
    expect(darkBackground(c('rgb(11, 26, 92)'))).toBeNull();
    expect(darkBackground(c('rgba(0, 0, 0, 0)'))).toBeNull();
    // A pale yellow highlight stays yellowish, but dark.
    const yellow = parseColor(
      darkBackground(c('rgb(255, 245, 200)'))!.replace(/hsl\((\d+) .*/, 'rgb($1, 0, 0)'),
    );
    expect(yellow!.r).toBeGreaterThan(40);
    expect(yellow!.r).toBeLessThan(60);
  });

  it('lightens dark text and keeps readable text', () => {
    expect(lightForeground(c('rgb(0, 0, 0)'))).toBe('hsl(220 14% 90%)');
    expect(lightForeground(c('rgb(31, 35, 40)'))).toMatch(/^hsl\(/);
    expect(lightForeground(c('rgb(255, 255, 255)'))).toBeNull();
    expect(lightForeground(c('rgb(138, 180, 248)'))).toBeNull();
    // A dark blue link turns into a light blue one.
    expect(lightForeground(c('rgb(11, 87, 208)'))).toMatch(/^hsl\(21\d 80% 7\d%\)$/);
  });

  it('measures lightness', () => {
    expect(luminance(c('rgb(0, 0, 0)'))).toBe(0);
    expect(luminance(c('rgb(255, 255, 255)'))).toBeCloseTo(1);
  });
});
