import { getPreviewShoeProgress } from '@/config/shoeProgression';

describe('shoe progression preview', () => {
  test.each([[0, 1], [449, 1], [450, 2], [1499, 2], [1500, 3], [3599, 3], [3600, 4], [7499, 4], [7500, 5], [9000, 5]])('%i XP gives level %i', (xp, level) => {
    expect(getPreviewShoeProgress(xp).stage.level).toBe(level);
  });
  test('progress resets at a threshold; max level has no next target', () => {
    expect(getPreviewShoeProgress(450)).toMatchObject({ progress: 0, remainingXp: 1050 });
    expect(getPreviewShoeProgress(7500)).toMatchObject({ progress: 1, remainingXp: 0, next: undefined });
  });
  test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid XP %s', (xp) => {
    expect(() => getPreviewShoeProgress(xp)).toThrow(RangeError);
  });
});
