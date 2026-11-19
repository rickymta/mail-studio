import type { Detail } from '@/lib/types';
import { isEmptyDraft, replyRecipients, signatureHtml } from './compose';

const base: Detail = {
  id: 1,
  accountId: 1,
  folderId: 1,
  folderRole: 'inbox',
  uid: 1,
  subject: 'Hi',
  from: { name: 'Ann', email: 'ann@example.org' },
  to: [
    { name: 'Me', email: 'ME@example.com' },
    { name: 'Bob', email: 'bob@example.org' },
  ],
  cc: [
    { name: 'Cy', email: 'cy@example.org' },
    { name: 'Bob', email: 'bob@example.org' },
  ],
  bcc: [],
  replyTo: [],
  date: 0,
  size: 0,
  seen: true,
  flagged: false,
  answered: false,
  hasAttachments: false,
  snippet: '',
  messageId: 'm1@x',
  references: '',
  html: null,
  text: 'hello',
  attachments: [],
  hasRemoteImages: false,
};

const emails = (l: { email: string }[]) => l.map((a) => a.email);

describe('reply recipients', () => {
  it('answers the sender only', () => {
    const r = replyRecipients(base, 'me@example.com', false);
    expect(emails(r.to)).toEqual(['ann@example.org']);
    expect(r.cc).toEqual([]);
  });

  it('prefers Reply-To', () => {
    const m = { ...base, replyTo: [{ name: '', email: 'list@example.org' }] };
    expect(emails(replyRecipients(m, 'me@example.com', false).to)).toEqual(['list@example.org']);
  });

  it('reply all keeps everyone but ourselves, once', () => {
    const r = replyRecipients(base, 'me@example.com', true);
    expect(emails(r.to)).toEqual(['ann@example.org', 'bob@example.org']);
    expect(emails(r.cc)).toEqual(['cy@example.org']);
  });

  it('answering our own sent message goes to its recipients', () => {
    const m = { ...base, from: { name: 'Me', email: 'me@example.com' }, to: [base.to[1]!] };
    expect(emails(replyRecipients(m, 'me@example.com', false).to)).toEqual(['bob@example.org']);
    const all = replyRecipients(m, 'me@example.com', true);
    expect(emails(all.to)).toEqual(['bob@example.org']);
    expect(emails(all.cc)).toEqual(['cy@example.org']);
  });
});

describe('empty drafts', () => {
  const account = { signature: 'Best,\nMe' } as Parameters<typeof signatureHtml>[0];
  const draft = {
    id: 0,
    accountId: 1,
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    html: signatureHtml(account),
    quote: '',
    attachments: [],
    inReplyTo: '',
    references: '',
    replyToMessage: null,
    updatedAt: 0,
  };

  it('a draft holding only the signature is empty', () => {
    expect(signatureHtml(account)).toContain('Best,<br>Me');
    expect(isEmptyDraft(draft, account)).toBe(true);
    expect(isEmptyDraft({ ...draft, html: `<div><br></div>${draft.html}` }, account)).toBe(true);
  });

  it('anything written makes it worth keeping', () => {
    expect(isEmptyDraft({ ...draft, html: `Hello${draft.html}` }, account)).toBe(false);
    expect(isEmptyDraft({ ...draft, subject: 'x' }, account)).toBe(false);
    expect(isEmptyDraft({ ...draft, to: [{ name: '', email: 'a@b.co' }] }, account)).toBe(false);
  });
});
