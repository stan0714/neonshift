/** PG-R-11 熱量估算：MET 分級、分段優先、暫停不計、體重範圍、無體重回 null；BodyWeightCard 存／清除（只存手機）；bodyStore 持久化。 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { BodyWeightCard } from '@/components/BodyWeightCard';
import { ENERGY_MODEL_VERSION, estimateEnergy, metFor } from '@/domain/energy';
import { useBody } from '@/state/bodyStore';
import { ThemeProvider } from '@/theme';

beforeEach(() => { useBody.setState({ loaded: false, weightKg: null, updatedAt: null }); });

test('MET 依速度分級（2024 Compendium）：跑步 10 km/h → 9.3（12050）；走路 5 km/h → 3.8（17190）；超出最高級用最高級', () => {
  expect(metFor('run', 10)).toMatchObject({ met: 9.3, code: expect.stringContaining('12050') });
  expect(metFor('run', 6.5)).toMatchObject({ met: 6.5, code: expect.stringContaining('12028') });
  expect(metFor('run', 5)).toMatchObject({ met: 3.3, code: expect.stringContaining('12026') });
  expect(metFor('run', 12)).toMatchObject({ met: 11.8, code: expect.stringContaining('12080') });
  expect(metFor('run', 30).met).toBe(23.0);
  expect(metFor('walk', 5)).toMatchObject({ met: 3.8, code: expect.stringContaining('17190') });
  expect(metFor('walk', 6)).toMatchObject({ met: 4.8, code: expect.stringContaining('17200') });
  expect(metFor('walk', 6.5).met).toBe(5.5);
  expect(metFor('walk', 9).met).toBe(8.5);
});

test('整段估算：65 kg 跑 5 km／30 分（10 km/h，MET 9.3）→ 總 ≈ 317、活動 ≈ 283；模型版本標示', () => {
  const e = estimateEnergy({ sport: 'run', weightKg: 65, movingMs: 30 * 60_000, distanceMm: 5_000_000 });
  // 9.3 × 3.5 × 65 / 200 = 10.58 kcal/min × 30 = 317；(9.3−1) × 3.5 × 65 / 200 × 30 = 283
  expect(e).toMatchObject({ totalKcal: 317, activeKcal: 283, avgMet: 9.3, minutes: 30, model: ENERGY_MODEL_VERSION });
});

test('分段優先：快慢兩段各套各的 MET，不硬套平均速度；暫停時間不在分段內就不計', () => {
  const segs = [{ distanceMm: 1_000_000, durationMs: 4 * 60_000 }, { distanceMm: 1_000_000, durationMs: 8 * 60_000 }]; // 15 km/h（14.8）與 7.5 km/h（7.8）
  const e = estimateEnergy({ sport: 'run', weightKg: 60, movingMs: 99 * 60_000, distanceMm: 2_000_000, segments: segs })!;
  const expectTotal = (14.8 * 3.5 * 60 / 200) * 4 + (7.8 * 3.5 * 60 / 200) * 8;
  expect(e.totalKcal).toBe(Math.round(expectTotal));
  expect(e.minutes).toBe(12);
});

test('無體重／體重超範圍／沒有時間 → null', () => {
  expect(estimateEnergy({ sport: 'run', weightKg: null, movingMs: 60_000, distanceMm: 100_000 })).toBeNull();
  expect(estimateEnergy({ sport: 'run', weightKg: 10, movingMs: 60_000, distanceMm: 100_000 })).toBeNull();
  expect(estimateEnergy({ sport: 'run', weightKg: 70, movingMs: 0, distanceMm: 100_000 })).toBeNull();
});

test('BodyWeightCard：儲存 → 顯示已儲存並寫入 SecureStore（只存手機）；無效值提示；清除 → 刪除', async () => {
  await render(<ThemeProvider><BodyWeightCard /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('body-weight-status')).toBeTruthy());
  expect(screen.getByText('No weight saved — calories show as “—”.')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('body-weight-input'), '5');
  await fireEvent.press(screen.getByTestId('body-weight-save'));
  expect(screen.getByTestId('body-weight-invalid')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('body-weight-input'), '65.5');
  await fireEvent.press(screen.getByTestId('body-weight-save'));
  await waitFor(() => expect(useBody.getState().weightKg).toBe(65.5));
  await waitFor(() => expect(screen.getByText(/Saved 65.5 kg/)).toBeTruthy());
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('neonshift.body.v1', expect.stringContaining('"weightKg":65.5'));
  expect(useBody.getState().weightKg).toBe(65.5);
  await fireEvent.press(screen.getByTestId('body-weight-clear'));
  await waitFor(() => expect(useBody.getState().weightKg).toBeNull());
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('neonshift.body.v1');
});
