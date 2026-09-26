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
import { achievementShareLayout, ACHIEVEMENT_SHARE_DEFAULT, SHARE_IMAGE, SHARE_RENDERER_VERSION, SHARE_STORY_SAFE_PX, workoutShareLayout, type ShareImageLayout, type ShareRenderSpec } from '@/domain/shareImage';
import { SHARE_CARD_DEFAULT } from '@/domain/review';
import { cleanupShareCache, copyCaption, SHARE_CACHE_MAX_FILES, SHARE_CACHE_TTL_MS, shareLayout } from '@/services/share/shareImage';
import { Directory, Paths } from 'expo-file-system';
import * as FS from 'expo-file-system';
import { t, useLocaleStore } from '@/i18n';

beforeEach(() => {
  jest.clearAllMocks();
  (FS as unknown as { __reset: () => void }).__reset(); // 每個測試自己一份記憶體檔案系統
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
  ACHIEVEMENT_SHARE_DEFAULT,
  { t: tr, labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc', notice: t('share.card.net.devnet') } },
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

  test('成就卡：徽章程序繪製（不抓遠端圖），且一定印出資產所屬網路', async () => {
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

describe('PG-SHARE-07 story 9:16', () => {
  test('畫布換成 1080×1920，內容置中且上下留白超過 250 px 安全區', async () => {
    await render(<ShareCard layout={mkWorkout()} format="story" testID="story-card" />);
    // react-native-svg 把 viewBox 拆成 vbWidth／vbHeight，不留原字串
    const svg = screen.getByTestId('story-card').props as { vbWidth: number; vbHeight: number };
    expect([svg.vbWidth, svg.vbHeight]).toEqual([SHARE_IMAGE.story.width, SHARE_IMAGE.story.height]);
    // 同一塊 1350 高的內容置中 → 上下各 285 px，比規格的 250 px 再寬一點
    const offset = (SHARE_IMAGE.story.height - SHARE_IMAGE.post.height) / 2;
    expect(offset).toBeGreaterThanOrEqual(SHARE_STORY_SAFE_PX);
    // G 的位移在 matrix 的第 6 位（translate y）
    expect((screen.getByTestId('share-card-block-story').props as { matrix: number[] }).matrix[5]).toBe(offset);
  });

  test('post 仍是 1080×1350，內容不位移（story 不影響既有版面）', async () => {
    await render(<ShareCard layout={mkWorkout()} testID="post-card" />);
    const svg = screen.getByTestId('post-card').props as { vbWidth: number; vbHeight: number };
    expect([svg.vbWidth, svg.vbHeight]).toEqual([SHARE_IMAGE.post.width, SHARE_IMAGE.post.height]);
    expect((screen.getByTestId('share-card-block-post').props as { matrix: number[] }).matrix[5]).toBe(0);
  });

  test('story 與 post 的內容完全相同（送出的是同一份已預覽內容）', async () => {
    await render(<ShareCard layout={mkWorkout()} testID="a" />);
    const post = deepText(screen.getByTestId('a'));
    await render(<ShareCard layout={mkWorkout()} format="story" testID="b" />);
    expect(deepText(screen.getByTestId('b'))).toBe(post);
  });
});

describe('出圖與分享', () => {
  const fakeSvg = (b64: string | null) => ({ toDataURL: (cb: (s: string) => void) => cb(b64 as string) }) as unknown as Svg;
  const spec: ShareRenderSpec = { kind: 'workout', source: { id: 's1', revision: 2 }, owner: 'wallet-a', rendererVersion: SHARE_RENDERER_VERSION, locale: 'en', format: 'post' };
  const cacheFiles = () => (new Directory(Paths.cache).list() as { name: string; uri: string }[]).filter((f) => f.name?.startsWith('neonshift-share-'));

  test('成功：寫進 cache、以 image/png 分享；分享返回後不立刻刪檔（接收 App 可能還在讀）', async () => {
    const r = await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), dialogTitle: 'Share card' });
    expect(r).toEqual({ ok: true, withImage: true });
    const uri = (Sharing.shareAsync as jest.Mock).mock.calls[0]![0] as string;
    expect(uri).toMatch(/neonshift-share-workout-\d+-[0-9a-f]+\.png$/);
    expect((Sharing.shareAsync as jest.Mock).mock.calls[0]![1]).toMatchObject({ mimeType: 'image/png' });
    expect(new File(uri).exists).toBe(true);
  });

  test('story：以 1080×1920 出圖，不寫死 post 尺寸（輸出錯尺寸等於裁掉內容）', async () => {
    const sizes: { width: number; height: number }[] = [];
    const svg = { toDataURL: (cb: (v: string) => void, o: { width: number; height: number }) => { sizes.push(o); cb('QUJD'); } } as unknown as Svg;
    await shareLayout({ svg, layout: mkWorkout(), dialogTitle: 'x', format: 'story' });
    await shareLayout({ svg, layout: mkWorkout(), dialogTitle: 'x' });
    expect(sizes).toEqual([{ width: 1080, height: 1920 }, { width: 1080, height: 1350 }]);
  });

  test('檔名不含使用者資料，只有 kind、到期時間與隨機值', async () => {
    await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), dialogTitle: 'x', spec });
    const uri = (Sharing.shareAsync as jest.Mock).mock.calls[0]![0] as string;
    expect(uri).not.toMatch(/s1|wallet-a/);
    const expiry = Number(/-(\d{10,})-/.exec(uri)![1]);
    expect(expiry).toBeGreaterThan(Date.now());
    expect(expiry).toBeLessThanOrEqual(Date.now() + SHARE_CACHE_TTL_MS);
  });

  test('清理：只刪已到期的；未到期與交付中的都留著', async () => {
    await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), dialogTitle: 'x' });
    const uri = (Sharing.shareAsync as jest.Mock).mock.calls[0]![0] as string;
    expect(cleanupShareCache()).toBe(0);
    expect(new File(uri).exists).toBe(true);
    // 到期後（現在 + TTL + 1 秒）才清
    expect(cleanupShareCache(Date.now() + SHARE_CACHE_TTL_MS + 1000)).toBe(1);
    expect(new File(uri).exists).toBe(false);
  });

  test('清理：超過數量上限時連未到期的最舊檔一起清', async () => {
    for (let i = 0; i < SHARE_CACHE_MAX_FILES + 3; i++) {
      await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), dialogTitle: 'x' });
    }
    cleanupShareCache();
    expect(cacheFiles().length).toBeLessThanOrEqual(SHARE_CACHE_MAX_FILES);
  });

  test('出圖失敗 → 回報原因，不自己彈第二個分享面板', async () => {
    const share = jest.spyOn(Share, 'share');
    expect(await shareLayout({ svg: fakeSvg(null), layout: mkWorkout(), dialogTitle: 'x' })).toEqual({ ok: false, reason: 'render_failed' });
    expect(share).not.toHaveBeenCalled();
    share.mockRestore();
  });

  test('沒有可接收的 App → no_target，也不自動改發文字', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    const share = jest.spyOn(Share, 'share');
    expect(await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), dialogTitle: 'x' })).toEqual({ ok: false, reason: 'no_target' });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    share.mockRestore();
  });

  test('預覽後帳號／來源變了 → stale，不匯出到別的帳號', async () => {
    const r = await shareLayout({ svg: fakeSvg('QUJD'), layout: mkWorkout(), dialogTitle: 'x', spec, stillValid: (sp) => sp.owner === 'wallet-b' });
    expect(r).toEqual({ ok: false, reason: 'stale' });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  test('成就卡缺網路標示 → 不出圖也不發文', async () => {
    const share = jest.spyOn(Share, 'share');
    const bad: ShareImageLayout = { ...mkAchievement(), notice: null };
    expect(await shareLayout({ svg: fakeSvg('QUJD'), layout: bad, dialogTitle: 'x' })).toEqual({ ok: false, reason: 'unpublishable' });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    share.mockRestore();
  });

  test('文案可複製（Android 上 IG 只取圖）', async () => {
    expect(await copyCaption('caption')).toBe(true);
  });
});
