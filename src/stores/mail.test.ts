import { vi } from 'vitest';
import { api } from '@/lib/ipc';
import type { Page, Detail } from '@/lib/types';
import { createMailbox } from './mail';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('independent account panes', () => {
  it('scopes concurrent requests and does not discard another account response', async () => {
    const pending = new Map<number, (page: Page) => void>();
    vi.spyOn(api, 'messages').mockImplementation(
      (query) =>
        new Promise((resolve) => {
          pending.set(query.accountId!, resolve);
        }),
    );
    const first = createMailbox(1),
      second = createMailbox(2);
    const a = first.getState().reload(),
      b = second.getState().reload();
    pending.get(2)!({ items: [], total: 22 });
    await b;
    pending.get(1)!({ items: [], total: 11 });
    await a;
    expect(first.getState().total).toBe(11);
    expect(second.getState().total).toBe(22);
    first.getState().setChecked([101]);
    expect(second.getState().checked).toEqual([]);
  });
  it('debounces each account search independently', async () => {
    vi.useFakeTimers();
    const messages = vi.spyOn(api, 'messages').mockResolvedValue({ items: [], total: 0 });
    const first = createMailbox(1),
      second = createMailbox(2);
    first.getState().setQuery('invoices');
    second.getState().setQuery('travel');
    await vi.advanceTimersByTimeAsync(260);
    expect(messages).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 1, query: 'invoices' }),
    );
    expect(messages).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 2, query: 'travel' }),
    );
    first.getState().dispose();
    second.getState().dispose();
  });
  it('keeps two messages open at the same time', async () => {
    vi.spyOn(api, 'message').mockImplementation(async (id) => ({ id, seen: true }) as Detail);
    const first = createMailbox(1),
      second = createMailbox(2);
    await Promise.all([first.getState().open(101), second.getState().open(202)]);
    expect(first.getState().detail?.id).toBe(101);
    expect(second.getState().detail?.id).toBe(202);
    await first.getState().open(null);
    expect(second.getState().detail?.id).toBe(202);
  });
});
