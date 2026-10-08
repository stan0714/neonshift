/** XD-02：錢包互動時間線——guardWalletOp 自動記錄 App／錢包／回來後等待與結果；記錄中旗標；無回覆；Profile 卡片摘要；清除。 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { WalletTimelineCard } from '@/components/WalletTimelineCard';
import { _resetStaleForTests, guardWalletOp } from '@/services/wallet/mwaGuard';
import { walletTimeline } from '@/services/wallet/walletTimeline';
import { ThemeProvider } from '@/theme';

type Listener = (s: 'active' | 'background' | 'inactive') => void;
const fakeAppState = () => {
  const listeners = new Set<Listener>();
  return { currentState: 'active' as const, addEventListener: (_: 'change', l: Listener) => { listeners.add(l); return { remove: () => listeners.delete(l) }; }, emit: (s: 'active' | 'background' | 'inactive') => listeners.forEach((l) => l(s)) };
};

beforeEach(() => { jest.useFakeTimers(); _resetStaleForTests(); walletTimeline._resetForTests(); });
afterEach(() => { jest.useRealTimers(); });

test('成功：App 等待 1.2 s → 錢包 6 s → 回來 0.4 s；op 名稱與 duringRecording 來自 probe', async () => {
  let now = 1_000_000;
  const app = fakeAppState();
  walletTimeline.setRecordingProbe(() => true);
  let resolveOp!: (v: string) => void;
  const p = guardWalletOp(() => new Promise<string>((r) => { resolveOp = r; }), { appState: app, now: () => now, op: 'signMessage' });
  now += 1_200; app.emit('background');
  now += 6_000; app.emit('active');
  now += 400; resolveOp('sig');
  await expect(p).resolves.toBe('sig');
  const [e] = walletTimeline.list();
  expect(e).toMatchObject({ op: 'signMessage', appWaitMs: 1_200, walletWaitMs: 6_000, returnWaitMs: 400, result: 'ok', duringRecording: true, initiatedBy: 'user' });
  expect(walletTimeline.summary()).toEqual({ total: 1, duringRecording: 1, noReply: 0, medianWalletWaitMs: 6_000 });
});

test('無回覆：回前景寬限到期 → result=no_reply、code=foreground_grace；錯誤 → error 帶 WalletError code；未切去錢包也有 appWait', async () => {
  let now = 5_000;
  const app = fakeAppState();
  const p = guardWalletOp(() => new Promise<string>(() => {}), { appState: app, now: () => now, foregroundGraceMs: 8_000, op: 'connect' });
  now += 500; app.emit('background');
  now += 3_000; app.emit('active');
  now += 8_000; jest.advanceTimersByTime(8_000);
  await expect(p).rejects.toMatchObject({ code: 'WALLET_NO_REPLY' });
  const { WalletError } = jest.requireActual('@/services/wallet/WalletService') as { WalletError: new (code: string, m: string) => Error };
  const p2 = guardWalletOp(() => Promise.reject(new WalletError('REJECTED', 'user declined')), { appState: fakeAppState(), now: () => now, op: 'signAndSend' });
  await expect(p2).rejects.toMatchObject({ code: 'REJECTED' });
  const [a, b] = walletTimeline.list();
  expect(a).toMatchObject({ op: 'connect', result: 'no_reply', code: 'foreground_grace', appWaitMs: 500, walletWaitMs: 3_000, duringRecording: false });
  expect(b).toMatchObject({ op: 'signAndSend', result: 'error', code: 'REJECTED', appWaitMs: 0, walletWaitMs: null });
  expect(walletTimeline.summary().noReply).toBe(1);
});

test('Profile 卡片：摘要、列出最近項目（運動中標記）、清除', async () => {
  jest.useRealTimers();
  walletTimeline.setRecordingProbe(() => true);
  const id = walletTimeline.begin('signMessage', 1_000);
  walletTimeline.leftApp(id, 1_500); walletTimeline.returned(id, 4_500); walletTimeline.end(id, 'ok', undefined, 4_800);
  walletTimeline.setRecordingProbe(() => false);
  const id2 = walletTimeline.begin('connect', 10_000);
  walletTimeline.end(id2, 'no_reply', 'hard_timeout', 130_000);
  render(<ThemeProvider><WalletTimelineCard /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('wallet-timeline-summary')).toBeTruthy());
  expect(screen.getByText('2 requests · 1 during a workout · 1 no reply · median wallet time 3.0s')).toBeTruthy();
  expect(screen.getByText('Sign-in message · during workout')).toBeTruthy();
  expect(screen.getByText('No reply')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('wallet-timeline-clear'));
  await waitFor(() => expect(screen.getByText('No wallet requests yet.')).toBeTruthy());
});
