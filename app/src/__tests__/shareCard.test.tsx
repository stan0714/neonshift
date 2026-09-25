/**
 * 圖卡渲染與出圖（docs/social-share §9.1）。
 * 圖是一張 SVG：測試看的是「該出現的元素在、不該出現的不在」，以及出圖失敗時不會把使用者卡住。
 */
import { render, screen } from '@testing-library/react-native';
import type Svg from 'react-native-svg';
import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';

import { ShareCard, wrapText } from '@/components/ShareCard';
import { achievementShareLayout, workoutShareLayout, type ShareImageLayout } from '@/domain/shareImage';
import { SHARE_CARD_DEFAULT } from '@/domain/review';
import { copyCaption, shareLayout } from '@/services/share/shareImage';
import { t, useLocaleStore } from '@/i18n';

beforeEach(() => {
  jest.clearAllMocks();
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
});

/**
 * react-native-svg 把文字收進 RNSVGTSpan 的 `content` prop，不放在 children 陣列，
 * 所以 RNTL 的 toHaveTextContent 讀不到——自己遞迴取字。
 */
const deepText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  const n = node as { props?: { content?: unknown; children?: unknown }; children?: unknown[] };
  const own = typeof n.props?.content === 'string' ? n.props.content : typeof n.props?.children === 'string' ? n.props.children : '';
  return own || (n.children ?? []).map(deepText).join('');
};
const textOf = (id: string) => deepText(screen.getByTestId(id));

const tr = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const mkWorkout = () => workoutShareLayout(
  {
    sport: 'run', intent: 'run', startedAt: new Date('2026-09-24T22:10:00Z'), elapsedMs: 2_292_000, movingMs: 2_280_000, distanceMm: 5_500_000,
    avgPaceSPerKm: 417, avgSpeedKmh: 8.6, maxSpeed5sKmh: 11.2,
    splits: [{ index: 1, paceSPerKm: 408, isPartial: false }, { index: 2, paceSPerKm: 415, isPartial: false }],
    lapCount: 0, goal: null, goalMet: false, qualityAccepted: 1204, qualityRejected: 37, autoPausedMs: 0,
  },
  SHARE_CARD_DEFAULT,
  { t: tr, labels: { mode: 'Run', tagline: t('share.card.tagline'), site: 'neonshift.cc' }, qr: 'https://neonshift.cc/s/workout?source=summary' },
);
const mkAchievement = () => achievementShareLayout(
  { category: 'first_5k', title: 'First 5K', series: t('share.card.series'), detail: null, achievedAt: new Date('2026-09-24T00:00:00Z'), verification: 'device', edition: 'No. 12' },
  { t: tr, labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc', notice: t('share.card.devnet') } },
);

describe('圖卡渲染', () => {
  test('運動卡：主數字、模式、站名、產品線索與 QR 都在；沒有路線區塊', async () => {
    await render(<ShareCard layout={mkWorkout()} />);
    expect(textOf('share-card-hero')).toContain('5.50');
    expect(textOf('share-card-label')).toBe('Run');
    expect(textOf('share-card-site')).toBe('neonshift.cc');
    expect(textOf('share-card-tagline-0').length).toBeGreaterThan(0);
    expect(screen.getByTestId('share-card-qr')).toBeTruthy();
    expect(screen.queryByTestId('share-card-route')).toBeNull();
  });

  test('路線只在版面資料帶形狀時出現', async () => {
    await render(<ShareCard layout={{ ...mkWorkout(), route: { segments: [[{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }]] } }} />);
    expect(screen.getByTestId('share-card-route')).toBeTruthy();
  });

  test('成就卡：徽章程序繪製（不抓遠端圖），且一定印出 DEVNET 與測試代幣', async () => {
    await render(<ShareCard layout={mkAchievement()} />);
    expect(screen.getByTestId('share-card-emblem-first_5k')).toBeTruthy();
    expect(textOf('share-card-notice')).toMatch(/DEVNET/);
    expect(textOf('share-card-notice')).toMatch(/No monetary value/);
  });

  test('折行：有空白依詞切、無空白依字數切、超出行數收尾加省略', () => {
    expect(wrapText('walk or run to grow your shoes', 16)).toEqual(['walk or run to', 'grow your shoes']);
    expect(wrapText('walk or run to grow your shoes', 14)).toEqual(['walk or run to', 'grow your…']); // 第三行放不下就收尾
    expect(wrapText('走路和跑步就能養跑鞋收集鏈上成就', 8)).toEqual(['走路和跑步就能養', '跑鞋收集鏈上成就']);
    expect(wrapText('a b c d e f g h i j k l', 4, 2)).toEqual(['a b', 'c d…']);
  });
});

describe('出圖與分享', () => {
  const fakeSvg = (b64: string | null) => ({ toDataURL: (cb: (s: string) => void) => cb(b64 as string) }) as unknown as Svg;

  test('成功：寫進 cache、以 image/png 分享，結束後刪檔（不留殘檔、不寫相簿）', async () => {
    const r = await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), message: 'caption', dialogTitle: 'Share card' });
    expect(r).toEqual({ ok: true, withImage: true });
    const uri = (Sharing.shareAsync as jest.Mock).mock.calls[0]![0] as string;
    expect(uri).toMatch(/neonshift-workout-\d+\.png$/);
    expect((Sharing.shareAsync as jest.Mock).mock.calls[0]![1]).toMatchObject({ mimeType: 'image/png' });
    expect(new File(uri).exists).toBe(false);
  });

  test('出圖失敗 → 退回純文字分享，不丟例外', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await shareLayout({ svg: fakeSvg(null), layout: mkWorkout(), message: 'caption', dialogTitle: 'x' });
    expect(r).toEqual({ ok: true, withImage: false });
    expect(share).toHaveBeenCalledWith({ message: 'caption' });
    share.mockRestore();
  });

  test('分享面板不可用 → 同樣退回純文字', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    expect(await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), message: 'caption', dialogTitle: 'x' })).toEqual({ ok: true, withImage: false });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    share.mockRestore();
  });

  test('成就卡缺環境標示 → 不出圖也不發文', async () => {
    const share = jest.spyOn(Share, 'share');
    const bad: ShareImageLayout = { ...mkAchievement(), notice: null };
    expect(await shareLayout({ svg: fakeSvg('QUJD'), layout: bad, message: 'caption', dialogTitle: 'x' })).toEqual({ ok: false, reason: 'unpublishable' });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    share.mockRestore();
  });

  test('文案可複製（Android 上 IG 只取圖）', async () => {
    expect(await copyCaption('caption')).toBe(true);
  });
});
