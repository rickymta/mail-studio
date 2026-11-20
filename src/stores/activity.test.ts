import { vi } from 'vitest';
import { call } from '@/lib/ipc';
import { useActivity } from './activity';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
  useActivity.getState().clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('activity recording', () => {
  it('keeps a bounded history and clears persisted entries', () => {
    for (let i = 0; i < 505; i++)
      useActivity.getState().log({ label: String(i), status: 'finished' });
    expect(useActivity.getState().items).toHaveLength(500);
    expect(useActivity.getState().items[0]!.label).toBe('5');
    useActivity.getState().clear();
    expect(localStorage.setItem).toHaveBeenLastCalledWith('mailstudio.activity', '[]');
    expect(useActivity.getState().items).toEqual([]);
  });
  it('records success without persisting command arguments or results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ password: 'secret-result' }) })),
    );
    await call('account.save', { password: 'private-password', email: 'private@example.com' });
    const entry = useActivity.getState().items[0]!;
    expect(entry).toMatchObject({ label: 'Save account', status: 'finished' });
    expect(entry.ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(useActivity.getState().items)).not.toMatch(/private|secret/);
  });
  it('records failure without storing raw server errors and preserves the error for callers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ kind: 'auth', message: 'private server detail' }),
      })),
    );
    await expect(call('compose.send')).rejects.toThrow('private server detail');
    expect(useActivity.getState().items[0]).toMatchObject({
      label: 'Send message',
      status: 'failed',
    });
    expect(JSON.stringify(useActivity.getState().items)).not.toContain('private');
  });
  it('does not flood history with polling or reading messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => null })),
    );
    await call('events.poll');
    await call('msg.get');
    expect(useActivity.getState().items).toEqual([]);
  });
  it('keeps operations working when persistence is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => 'ok' })),
    );
    await expect(call('sync.run')).resolves.toBe('ok');
    expect(useActivity.getState().items).toHaveLength(1);
  });
});
