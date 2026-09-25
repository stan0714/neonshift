/** 分享連結落地（PG-SHARE-04）：連結只決定去哪一頁，不夾帶身分也不猜測未知值。 */
import { shareLandingSource, shareLandingTarget } from '@/navigation/shareLanding';

test('每種 kind 有明確去向', () => {
  expect(shareLandingTarget('workout')).toEqual({ screen: 'Workouts' });
  expect(shareLandingTarget('achievement')).toEqual({ screen: 'Gallery' });
  expect(shareLandingTarget('passport')).toEqual({ screen: 'Passport' });
  expect(shareLandingTarget('gear')).toEqual({ screen: 'Main', tab: 'Gear' });
  expect(shareLandingTarget('guardian')).toEqual({ screen: 'Main', tab: 'Gear' });
});

test('未知、空白或被改過的 kind → 回首頁，不猜測意圖', () => {
  expect(shareLandingTarget(undefined)).toEqual({ screen: 'Main' });
  expect(shareLandingTarget('')).toEqual({ screen: 'Main' });
  expect(shareLandingTarget('workout/../admin')).toEqual({ screen: 'Main' });
  expect(shareLandingTarget('WORKOUT')).toEqual({ screen: 'Main' });
});

test('source 只收允許清單內的值，其餘丟掉不往下傳', () => {
  expect(shareLandingSource('summary')).toBe('summary');
  expect(shareLandingSource('invite')).toBe('invite');
  expect(shareLandingSource('ig_story')).toBeNull();
  expect(shareLandingSource('<script>')).toBeNull();
  expect(shareLandingSource(undefined)).toBeNull();
});
