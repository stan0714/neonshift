import { color, gradient, motion, radius, space, typography } from '@/theme';

// docs/style.md 4.1／4.2／5.2／6／15 的值即為驗收基準；改 token 必須同步改文件。
describe('design tokens 與 Style Guide 一致', () => {
  test('4.1 base palette', () => {
    expect(color).toMatchObject({
      canvas: '#050711',
      surface: '#0B1020',
      elevated: '#121A2E',
      mint: '#30EBC8',
      cyan: '#24C8FF',
      violet: '#9B6CFF',
      magenta: '#FF4FD8',
      warning: '#FFCB66',
      danger: '#FF6B7A',
    });
  });

  test('4.2 brand gradient 為 mint → cyan → violet', () => {
    expect(gradient.brand).toEqual(['#30EBC8', '#24C8FF', '#9B6CFF']);
  });

  test('5.2 body 不小於 14sp，交易文字 16sp', () => {
    expect(typography.bodySmall.fontSize).toBeGreaterThanOrEqual(14);
    expect(typography.body.fontSize).toBe(16);
    expect(typography.displayM).toMatchObject({ fontSize: 32, lineHeight: 36 });
  });

  test('6 spacing 為 4dp 基準、radius 8/12/20/28', () => {
    for (const v of Object.values(space)) expect(v % 4).toBe(0);
    expect(radius).toEqual({ s: 8, m: 12, l: 20, xl: 28 });
  });

  test('15 motion 120/220/320，頁面 transition 不超過 320ms', () => {
    expect([motion.fast, motion.normal, motion.slow]).toEqual([120, 220, 320]);
    expect(motion.slow).toBeLessThanOrEqual(320);
  });
});
