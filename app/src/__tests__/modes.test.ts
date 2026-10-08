/** 三模式樣態（domain/modes）：主指標／預設／區間判定／配速比較。 */
import { MODE_PROFILES, paceVsAvg, profileOf, snapPreset, speedZone } from '@/domain/modes';

test('三模式主指標與預設不同：走路＝時間、健走＝時速＋區間＋1 km 自動圈、跑步＝配速＋10 km', () => {
  expect(profileOf('walk')).toMatchObject({ primary: 'time', autoLapDefault: 'off', speedZoneKmh: null });
  expect(profileOf('brisk')).toMatchObject({ primary: 'speed', autoLapDefault: '1000', speedZoneKmh: [5.5, 7.5] });
  expect(profileOf('run')).toMatchObject({ primary: 'pace', autoLapDefault: 'off' });
  expect(profileOf('run').distPresets).toContain(10);
  expect(new Set(Object.values(MODE_PROFILES).map((p) => p.accent)).size).toBe(3);
});

test('換模式時目標預設對齊最接近選項', () => {
  expect(snapPreset(10, profileOf('walk').timePresets)).toBe(15);
  expect(snapPreset(45, profileOf('run').timePresets)).toBe(30);
  expect(snapPreset(3, profileOf('brisk').distPresets)).toBe(3);
  expect(snapPreset(1, profileOf('brisk').distPresets)).toBe(2);
});

test('健走區間：低／內／高；走路與跑步不判定；速度未知 → null', () => {
  const b = profileOf('brisk');
  expect(speedZone(b, 4)).toBe('below');
  expect(speedZone(b, 6)).toBe('in');
  expect(speedZone(b, 9)).toBe('above');
  expect(speedZone(b, null)).toBeNull();
  expect(speedZone(profileOf('walk'), 6)).toBeNull();
  expect(speedZone(profileOf('run'), 6)).toBeNull();
});

test('跑步 vs 平均：負＝較快；資料不足 → null', () => {
  expect(paceVsAvg(300, 330)).toBe(-9);
  expect(paceVsAvg(360, 330)).toBe(9);
  expect(paceVsAvg(null, 330)).toBeNull();
  expect(paceVsAvg(300, 0)).toBeNull();
});
