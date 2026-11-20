import { normalizeZoom, useZoom } from './zoom';

describe('zoom', () => {
  it('snaps to 10% steps inside the range', () => {
    expect(normalizeZoom(1.04)).toBe(1);
    expect(normalizeZoom('1.26')).toBe(1.3);
    expect(normalizeZoom(0.1)).toBe(0.6);
    expect(normalizeZoom(9)).toBe(2);
    expect(normalizeZoom('nonsense')).toBe(1);
    expect(normalizeZoom(null)).toBe(1);
  });

  it('steps without drifting', () => {
    useZoom.getState().set(1);
    for (let i = 0; i < 3; i++) useZoom.getState().step(1);
    expect(useZoom.getState().zoom).toBe(1.3);
    for (let i = 0; i < 20; i++) useZoom.getState().step(-1);
    expect(useZoom.getState().zoom).toBe(0.6);
    useZoom.getState().set(1);
  });
});
