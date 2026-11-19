import {
  formatListDate,
  formatSize,
  initials,
  parseAddr,
  parseAddrList,
  prefixSubject,
  textToHtml,
} from './format';
import { linkify, scrubCss } from './html';

describe('addresses', () => {
  it('parses bare and named addresses', () => {
    expect(parseAddr('a@b.co')).toEqual({ name: '', email: 'a@b.co' });
    expect(parseAddr('  "Nguyễn An" <an@example.com>, ')).toEqual({
      name: 'Nguyễn An',
      email: 'an@example.com',
    });
    expect(parseAddr('An <an@example.com>')).toEqual({ name: 'An', email: 'an@example.com' });
  });

  it('rejects what is not an address', () => {
    for (const bad of ['', 'hello', 'a@b', 'a b@c.d', '<>', 'x@y.z <oops>']) {
      expect(parseAddr(bad), bad).toBeNull();
    }
  });

  it('splits pasted lists and drops the invalid parts', () => {
    expect(parseAddrList('a@b.co; B <b@c.de>\nnope, c@d.ef')).toEqual([
      { name: '', email: 'a@b.co' },
      { name: 'B', email: 'b@c.de' },
      { name: '', email: 'c@d.ef' },
    ]);
  });
});

describe('formatting', () => {
  it('prefixes a subject once', () => {
    expect(prefixSubject('Hello', 'reply')).toBe('Re: Hello');
    expect(prefixSubject('RE: re: Fwd: Hello', 'reply')).toBe('Re: Hello');
    expect(prefixSubject('Re: Hello', 'forward')).toBe('Fwd: Hello');
    expect(prefixSubject('Reminder', 'reply')).toBe('Re: Reminder');
  });

  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(200 * 1024)).toBe('200 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('builds initials', () => {
    expect(initials('Nguyễn Văn An')).toBe('NA');
    expect(initials('support@example.com')).toBe('SC');
    expect(initials('')).toBe('?');
  });

  it('shows the time for today and the date otherwise', () => {
    const now = new Date(2026, 10, 20, 15, 0, 0);
    const at = (d: Date) => Math.floor(d.getTime() / 1000);
    expect(formatListDate(at(new Date(2026, 10, 20, 9, 5)), 'en-GB', now)).toBe('09:05');
    expect(formatListDate(at(new Date(2026, 10, 18, 9, 5)), 'en-GB', now)).toBe('Wed');
    expect(formatListDate(at(new Date(2026, 2, 3, 9, 5)), 'en-GB', now)).toBe('3 Mar');
    expect(formatListDate(at(new Date(2024, 2, 3, 9, 5)), 'en-GB', now)).toBe('03/03/2024');
    expect(formatListDate(0, 'en-GB', now)).toBe('');
  });

  it('escapes text turned into HTML', () => {
    expect(textToHtml('a <b> & "c"\nd')).toBe('a &lt;b&gt; &amp; &quot;c&quot;<br>d');
  });
});

describe('mail HTML helpers', () => {
  it('removes remote references from CSS and keeps embedded ones', () => {
    expect(scrubCss('background: url(https://t.example/p.gif) no-repeat; color: red')).toBe(
      'background: none no-repeat; color: red',
    );
    expect(scrubCss("background:url( '//t.example/p.gif' )")).toBe('background:none');
    expect(scrubCss('@import url("https://x/y.css"); p { color: red }')).toBe(' p { color: red }');
    const embedded = 'background: url(data:image/png;base64,AAAA)';
    expect(scrubCss(embedded)).toBe(embedded);
  });

  it('links URLs in plain text without letting markup through', () => {
    expect(linkify('see https://example.com/a?b=1&c=2. <script>')).toBe(
      'see <a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>. &lt;script&gt;',
    );
  });
});
