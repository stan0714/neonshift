import { reviewReasonsText } from '@/domain/workouts';
import { t, useLocaleStore } from '@/i18n';

/** 伺服器回的是代碼；明細頁原本直接 join 印出「gps_gap, gap_teleport」給使用者看 */
beforeEach(() => useLocaleStore.setState({ setting: 'en', locale: 'en' }));

test('審查原因翻成人看得懂的字', () => {
  expect(reviewReasonsText(t, ['gps_gap', 'gap_teleport'])).toBe('GPS gaps、Position jumped during a GPS gap');
});

test('未知代碼保留原字串，不吞掉資訊也不顯示 i18n key', () => {
  expect(reviewReasonsText(t, ['something_new'])).toBe('something_new');
});

test('中文字典同樣有對應', () => {
  useLocaleStore.setState({ setting: 'zh-TW', locale: 'zh-TW' });
  const s = reviewReasonsText(t, ['gps_gap']);
  expect(s).not.toContain('wo.reason');
  expect(s.length).toBeGreaterThan(0);
});
