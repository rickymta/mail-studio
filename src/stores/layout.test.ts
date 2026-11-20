import { DEFAULT_LAYOUT, normalizeLayout } from './layout';
describe('layout preferences', () => {
  it('rejects non-finite sizes and clamps saved values to usable ranges', () => {
    expect(
      normalizeLayout({ sidebar: -1, list: 9999, rowHeight: NaN, listHeight: Infinity }),
    ).toMatchObject({
      sidebar: 180,
      list: 720,
      rowHeight: DEFAULT_LAYOUT.rowHeight,
      listHeight: DEFAULT_LAYOUT.listHeight,
    });
  });
  it('restores defaults for missing settings', () => {
    expect(normalizeLayout({})).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout({ mode: 'rows' }).mode).toBe('rows');
    expect(normalizeLayout({ mode: 'accounts' as never }).mode).toBe('columns');
  });
});
