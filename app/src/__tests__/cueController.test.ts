/** 2026-09-19 review 7／8：提示以 session 驅動、不依賴記錄頁；返回畫面不重設基準；自動暫停／繼續有確認。 */
import type { RawPoint } from '@/domain/gps/engine';
import { installWorkoutCues } from '@/services/workouts/cueController';
import { LocalWorkoutStore } from '@/services/workouts/LocalWorkoutStore';
import { WorkoutCues } from '@/services/workouts/WorkoutCues';
import { WorkoutRecorder } from '@/services/workouts/WorkoutRecorder';

jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }; });
const fsMock = jest.requireMock('expo-file-system') as { __reset: () => void };

const M_PER_DEG_LAT = 111_195;
const pts = (n: number, startMs: number, seqStart = 0, speed = 3): RawPoint[] => Array.from({ length: n }, (_, i) => ({ seq: seqStart + i, monotonicMs: startMs + i * 1000, utcMs: startMs + i * 1000, lat: 25 + (speed * (seqStart + i)) / M_PER_DEG_LAT, lon: 121.5, accuracyM: 5 }));

beforeEach(() => { fsMock.__reset(); jest.clearAllMocks(); });

const setup = () => {
  let t = 1_000_000;
  const rec = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => t, sync: jest.fn(async () => ({ sessionId: null })), monotonic: null, motionProbe: null });
  const speak = jest.fn();
  const haptic = jest.fn(async () => {});
  const cues = new WorkoutCues({ speak, haptic, canPlay: () => true });
  const prefs = { voice: true, haptic: true, cueEvery: '1000' as const };
  const uninstall = installWorkoutCues({ recorder: rec, cues, prefsOf: () => prefs, localeOf: () => 'en' });
  return { rec, speak, haptic, cues, prefs, uninstall, advance: (ms: number) => { t += ms; }, now: () => t };
};

test('review 7：沒有任何畫面訂閱，跨 1 km 仍會播；session 結束後不再播；新 session 從 0 重算', async () => {
  const { rec, speak, uninstall, advance } = setup();
  await rec.start({ sport: 'run', environment: 'outdoor' });
  rec.ingest(pts(340, 1_000_000)); // ≈ 1.02 km
  advance(340_000);
  expect(speak).toHaveBeenCalledTimes(1);
  expect(speak.mock.calls[0]![0]).toMatch(/^1 kilometer/);
  await rec.finish();
  // 新 session：從 0 開始，500 m 不會播（1 km 間隔）
  await rec.start({ sport: 'run', environment: 'outdoor' });
  rec.ingest(pts(170, 2_000_000));
  advance(170_000);
  expect(speak).toHaveBeenCalledTimes(1);
  rec.ingest(pts(170, 2_170_000, 170));
  advance(170_000);
  expect(speak).toHaveBeenCalledTimes(2);
  await rec.finish();
  uninstall();
});

test('review 8：重新 reset（模擬返回畫面）不改變下一條界線的配速——基準取上一個完整分段的結束時間', async () => {
  const { rec, cues, speak, prefs, advance } = setup();
  await rec.start({ sport: 'run', environment: 'outdoor' });
  // 第 1 km：3 m/s（≈ 5:33/km）；第 2 km 前半：先跑到 1.8 km。時鐘與點同步（先推進再餵，模擬即時到達）
  advance(340_000); rec.ingest(pts(340, 1_000_000));
  advance(260_000); rec.ingest(pts(260, 1_340_000, 340)); // 1.8 km，運動時間 600 s
  expect(speak).toHaveBeenCalledTimes(1);
  // 之前的 bug：這裡 reset 會把時間基準設成「目前運動時間」(600 s)，下一條界線用 (667−600)=67 s ÷ 1 km 播出 1:07/km
  cues.reset(rec.snapshot(), { voice: true, haptic: true, locale: 'en', cueEvery: prefs.cueEvery });
  advance(80_000); rec.ingest(pts(80, 1_600_000, 600)); // 跨 2 km，運動時間 680 s
  expect(speak).toHaveBeenCalledTimes(2);
  const text = speak.mock.calls[1]![0] as string;
  expect(text).toMatch(/^2 kilometers, pace 5 minutes \d+ seconds/); // 5:3x，不是 1:07
  await rec.finish();
});

test('review 4：自動暫停／自動繼續 → 震動一次；語音開啟時播「Auto-paused」「Resumed」', async () => {
  const { rec, speak, haptic, advance, now, uninstall } = setup();
  const still = (seq: number, lat: number): RawPoint[] => [{ seq, monotonicMs: now(), utcMs: now(), lat, lon: 121.5, accuracyM: 5 }];
  await rec.start({ sport: 'run', environment: 'outdoor', autoPause: true });
  rec.ingest(pts(20, 1_000_000)); advance(20_000);
  const lat = 25 + (3 * 19) / M_PER_DEG_LAT;
  for (let i = 0; i < 14; i++) { advance(1000); rec.ingest(still(100 + i, lat)); }
  await new Promise((r) => setTimeout(r, 0));
  expect(rec.snapshot().state).toBe('paused');
  expect(speak).toHaveBeenCalledWith('Auto-paused', { language: 'en-US' });
  expect(haptic).toHaveBeenCalledTimes(1);
  advance(1000); rec.ingest(still(200, lat + 20 / M_PER_DEG_LAT));
  advance(1000); rec.ingest(still(201, lat + 24 / M_PER_DEG_LAT));
  await new Promise((r) => setTimeout(r, 0));
  expect(rec.snapshot().state).toBe('recording');
  expect(speak).toHaveBeenCalledWith('Resumed', { language: 'en-US' });
  expect(haptic).toHaveBeenCalledTimes(2);
  await rec.finish();
  uninstall();
});

test('偏好即時生效：關閉語音與震動後不再播；解除安裝後完全不再收事件', async () => {
  const { rec, speak, haptic, prefs, uninstall, advance } = setup();
  await rec.start({ sport: 'run', environment: 'outdoor' });
  prefs.voice = false; prefs.haptic = false;
  rec.ingest(pts(340, 1_000_000)); advance(340_000);
  expect(speak).not.toHaveBeenCalled();
  expect(haptic).not.toHaveBeenCalled();
  prefs.voice = true;
  uninstall();
  rec.ingest(pts(340, 1_340_000, 340)); advance(340_000);
  expect(speak).not.toHaveBeenCalled();
  await rec.finish();
});
