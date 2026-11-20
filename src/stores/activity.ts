import { create } from 'zustand';

export type ActivityStatus = 'finished' | 'failed' | 'info';
export interface Activity {
  id: string;
  at: number;
  label: string;
  status: ActivityStatus;
  ms?: number;
}
const KEY = 'mailstudio.activity';
const LIMIT = 500;
function load(): Activity[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (x): x is Activity =>
          x &&
          typeof x.id === 'string' &&
          typeof x.at === 'number' &&
          typeof x.label === 'string' &&
          ['finished', 'failed', 'info'].includes(x.status) &&
          (x.ms === undefined || typeof x.ms === 'number'),
      )
      .slice(-LIMIT);
  } catch {
    return [];
  }
}
function save(items: Activity[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* Memory remains available. */
  }
}
export const useActivity = create<{
  items: Activity[];
  log: (item: Omit<Activity, 'id' | 'at'>) => void;
  clear: () => void;
}>((set) => ({
  items: load(),
  log: (item) =>
    set((s) => {
      const items = [...s.items, { ...item, id: crypto.randomUUID(), at: Date.now() }].slice(
        -LIMIT,
      );
      save(items);
      return { items };
    }),
  clear: () => {
    save([]);
    set({ items: [] });
  },
}));

// Only operation names, outcomes and timings are stored; never mail content or credentials.
export const operationLabels: Record<string, string> = {
  'account.test': 'Test account',
  'account.save': 'Save account',
  'account.remove': 'Remove account',
  'oauth.start': 'Start sign-in',
  'oauth.wait': 'Complete sign-in',
  'folder.create': 'Create folder',
  'folder.rename': 'Rename folder',
  'folder.delete': 'Delete folder',
  'msg.setFlags': 'Update message flags',
  'msg.move': 'Move messages',
  'msg.archive': 'Archive messages',
  'msg.spam': 'Update spam status',
  'msg.delete': 'Delete messages',
  'msg.loadOlder': 'Load older messages',
  'attachment.save': 'Save attachment',
  'draft.save': 'Save draft',
  'draft.delete': 'Delete draft',
  'compose.send': 'Send message',
  'sync.run': 'Request sync',
  'settings.set': 'Update settings',
};
