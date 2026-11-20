import { mergePrefs } from './ui';

describe('preferences', () => {
  it('shows remote images and dark messages by default', () => {
    expect(mergePrefs({})).toMatchObject({ remoteImages: true, darkMessages: true });
  });

  it('drops the old remote-images default stored before version 2', () => {
    expect(mergePrefs({ remoteImages: false, darkMessages: false, theme: 'dark' })).toMatchObject({
      remoteImages: true,
      darkMessages: false,
      theme: 'dark',
    });
  });

  it('drops the light-messages default stored by version 3', () => {
    expect(mergePrefs({ darkMessages: false, remoteImages: false, version: 3 })).toMatchObject({
      darkMessages: true,
      remoteImages: false,
    });
  });

  it('has only a dark and a light mode, dark by default', () => {
    expect(mergePrefs({}).theme).toBe('dark');
    expect(mergePrefs({ theme: 'light' }).theme).toBe('light');
    // The old "same as the system" turns into the OS mode of the moment (dark without one).
    expect(mergePrefs({ theme: 'system' as never }).theme).toMatch(/^(dark|light)$/);
  });

  it('keeps choices saved from version 4 on', () => {
    const prefs = mergePrefs({ remoteImages: false, darkMessages: false, version: 4 });
    expect(prefs).toMatchObject({ remoteImages: false, darkMessages: false });
    expect(prefs).not.toHaveProperty('version');
  });
});
