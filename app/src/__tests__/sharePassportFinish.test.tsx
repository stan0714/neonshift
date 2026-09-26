/**
 * PG-SHARE-06 時機 S3（成就護照卡）與 S5（完賽卡），docs/social-share §3.2／§4.3／§4.5／§5.4。
 *
 * 這兩張卡各有一條會造成實質傷害的界線，所以各自要測得出來：
 *   S3：圖上的枚數不得多於護照畫面的有效枚數（待核准／已撤銷不算），且「有效」不等於「鏈上有」。
 *   S5：完賽時間與名次預設不出現——它們要本次社群分享的獨立同意，與公開成績榜的同意是兩件事。
 */
import { NavigationContainer } from '@react-navigation/native';
import { PublicKey } from '@solana/web3.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { ShareCard } from '@/components/ShareCard';
import { finishShareLayout, FINISH_SHARE_DEFAULT, passportShareLayout, PASSPORT_SHARE_EMBLEMS, sharePublishable, type FinishShareFields } from '@/domain/shareImage';
import { t, useLocaleStore } from '@/i18n';
import { PassportScreen } from '@/screens/PassportScreen';
import { Results } from '@/screens/events/Results';
import type { PassportEntry } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { passport: jest.fn(), eventResults: jest.fn(), myEventHistory: jest.fn(), updateEventPrivacy: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'passport' | 'eventResults' | 'myEventHistory' | 'updateEventPrivacy', jest.Mock>;

const Wrapper = ({ children }: PropsWithChildren) => (<ThemeProvider><NavigationContainer>{children}</NavigationContainer></ThemeProvider>);
const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const tr = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const labels = { tagline: 'Walk or run to grow your shoes.', site: 'neonshift.cc', notice: 'DEVNET test-network asset · no monetary value' };

/** react-native-svg 把文字收進 TSpan 的 content prop，RNTL 的 textContent 讀不到 */
const deepText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  const n = node as { props?: { content?: unknown; children?: unknown }; children?: unknown[] };
  const own = typeof n.props?.content === 'string' ? n.props.content : typeof n.props?.children === 'string' ? n.props.children : '';
  return own || (n.children ?? []).map(deepText).join('');
};

beforeEach(() => {
  jest.clearAllMocks();
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Seeker' }, error: null } as never);
});

describe('成就護照卡（S3，卡型 B 多格）', () => {
  const mk = (o: Partial<Parameters<typeof passportShareLayout>[0]> = {}) =>
    passportShareLayout({ validCount: 4, mintedCount: 2, emblems: ['first_5k', 'fastest_5k'], ...o }, { t: tr, labels, qr: 'https://neonshift.cc/s/passport?source=passport' });

  test('主數字是有效枚數；已鑄造枚數另外一行，不佔主數字', () => {
    const l = mk();
    expect(l.hero.value).toBe('4');
    expect(l.lines).toContain(t('share.card.passport.minted', { n: 2 }));
    // 計數規則寫在圖上，看圖的人才知道這個數字不含待核准與已撤銷
    expect(l.lines).toContain(t('share.card.passport.rule'));
    expect(sharePublishable(l)).toBe(true);
  });

  test('有效不等於鏈上：一枚都沒鑄造就不掛網路標示', () => {
    const none = mk({ mintedCount: 0 });
    expect(none.chainAsset).toBe(false);
    expect(none.notice).toBeNull();
    expect(none.lines).toContain(t('share.card.passport.noneMinted'));
    // 有鑄造時網路標示是必要的，缺了就不給出圖
    expect(mk().chainAsset).toBe(true);
    expect(sharePublishable({ ...mk(), notice: null })).toBe(false);
  });

  test('格子有上限；達成日期與 asset id 完全不進版面資料', () => {
    const many = mk({ emblems: ['first_5k', 'first_10k', 'first_half', 'first_marathon', 'fastest_1k', 'fastest_5k', 'fastest_10k', 'longest_run', 'event_finish', 'event_check_in'] });
    expect(many.grid).toHaveLength(PASSPORT_SHARE_EMBLEMS);
    // 只看這張卡自己產生的內容（notice 是呼叫端傳入的網路標示，本身就含 asset 一詞）
    const l = mk();
    const own = JSON.stringify({ hero: l.hero, lines: l.lines, chips: l.chips, grid: l.grid, qr: l.qr });
    expect(own).not.toMatch(/\d{4}-\d{2}/); // 連月份都沒有
    expect(own).not.toMatch(/asset/i);
  });

  test('畫出來的圖有格子、枚數與產品線索', async () => {
    await render(<ShareCard layout={mk()} />);
    expect(screen.getByTestId('share-card-grid-first_5k')).toBeTruthy();
    expect(screen.getByTestId('share-card-grid-fastest_5k')).toBeTruthy();
    // 多格卡不再畫單一大徽章
    expect(screen.queryByTestId('share-card-emblem-first_5k')).toBeNull();
    const text = deepText(screen.getByTestId('share-card'));
    expect(text).toMatch(/4/);
    expect(text).toMatch(/Walk or run/);
    expect(text).toMatch(/neonshift\.cc/);
  });

  test('護照畫面：圖上的枚數＝valid 計數；待核准與已撤銷不進格子', async () => {
    const entry = (o: Partial<PassportEntry>): PassportEntry => ({ id: 'pb:1', kind: 'pb', category: 'fastest_5k', title_key: 'pb.cat.fastest_5k', source_class: 'device', source: null, rules_version: 'pb/1', achieved_at: '2026-09-10T00:30:00Z', validity: 'valid', reason: null, public: false, nft: null, original_holder: 'you', ...o });
    api.passport.mockResolvedValue({
      entries: [
        entry({}),
        entry({ id: 'm:first_5k', kind: 'milestone', category: 'first_5k', title_key: 'ms.cat.first_5k', nft: { status: 'minted', asset: 'AsSeT111', achievement_id: 'a1' } }),
        entry({ id: 'm:first_10k', kind: 'milestone', category: 'first_10k', title_key: 'ms.cat.first_10k', validity: 'pending' }),
        entry({ id: 'q:e1', kind: 'quest', category: 'three_days', title_key: 'x', validity: 'revoked' }),
      ],
      counts: { valid: 2, pending: 1, revoked: 1, locked: 0 },
      trust_note: 'x',
    });
    await render(<PassportScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('passport-share-open')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('passport-share-open'));
    await waitFor(() => expect(screen.getByTestId('passport-share-preview')).toBeTruthy());
    expect(screen.getByTestId('share-card-grid-fastest_5k')).toBeTruthy();
    expect(screen.getByTestId('share-card-grid-first_5k')).toBeTruthy();
    expect(screen.queryByTestId('share-card-grid-first_10k')).toBeNull(); // 待核准
    expect(screen.queryByTestId('share-card-grid-three_days')).toBeNull(); // 已撤銷
    expect(deepText(screen.getByTestId('passport-share-preview'))).toMatch(new RegExp(`2\\s*${t('share.card.passport.unit')}`));
  });

  test('一枚有效成就都沒有時不提供分享入口', async () => {
    api.passport.mockResolvedValue({ entries: [], counts: { valid: 0, pending: 0, revoked: 0, locked: 0 }, trust_note: 'x' });
    await render(<PassportScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('passport-counts')).toBeTruthy());
    expect(screen.queryByTestId('passport-share-card')).toBeNull();
  });
});

describe('完賽卡（S5）', () => {
  const input = { eventTitle: 'River 5K', whenLabel: 'Sep 24, 09:00 (Asia/Taipei)', disciplineLabel: 'run · M30 · 5.0 km', finishTime: '25:00', rank: 3, official: true, corrected: false };
  const mk = (o: Partial<typeof input> = {}, fields: FinishShareFields = FINISH_SHARE_DEFAULT) =>
    finishShareLayout({ ...input, ...o }, fields, { t: tr, labels: { tagline: labels.tagline, site: labels.site }, qr: 'https://neonshift.cc/e/river-5k?source=finish' });

  test('預設不含完賽時間與名次（本次分享的獨立同意）', () => {
    const l = mk();
    expect(l.lines.join('|')).not.toMatch(/25:00/);
    expect(l.lines.join('|')).not.toMatch(/#3/);
    expect(l.lines[0]).toBe(t('share.card.finish.official'));
    expect(sharePublishable(l)).toBe(true);
  });

  test('勾選後才出現；名次還要求主辦方已公布', () => {
    expect(mk({}, { time: true, rank: false }).lines).toContain(t('share.card.finish.time', { t: '25:00' }));
    expect(mk({}, { time: false, rank: true }).lines).toContain(t('share.card.finish.rank', { n: 3 }));
    // 主辦方還沒公布 → 沒有可引用的名次來源，勾了也不進圖
    expect(mk({ official: false }, { time: false, rank: true }).lines.join('|')).not.toMatch(/#3/);
    expect(mk({ official: false }).lines[0]).toBe(t('share.card.finish.unofficial'));
  });

  test('更正過的成績要寫在圖上；這張卡不宣稱任何鏈上資產', () => {
    expect(mk({ corrected: true }).lines).toContain(t('share.card.finish.corrected'));
    expect(mk().chainAsset).toBe(false);
    expect(mk().notice).toBeNull();
  });

  test('成績頁：完賽才有這張卡，DNF 沒有；開啟預覽後切換時間才會出現在圖上', async () => {
    const result = { revision_id: 'r1', import_id: 'i1', discipline: 'run', division: 'M30', finish_status: 'finished' as const, distance_m: 5000, elapsed_ms: 1_500_000, rank: 3, previous_revision_id: null, reason: null, published_at: '2026-09-24T12:00:00Z' };
    const reg = { status: 'checked_in' as const, accepted_rule_revision: 'REV2', display_name: null, public_consent: false, registered_at: '', cancelled_at: null };
    const history = (r: typeof result) => ({ items: [{ event: { event_id: 'E1', slug: 'river-5k', title: 'River 5K', state: 'published', starts_at: null, ends_at: null }, registration: reg, check_ins: [], redemptions: [], results: [r] }] });
    api.eventResults.mockResolvedValue({ event_id: 'E1', slug: 'river-5k', total_finished: 0, results: [], non_finishers: [], source: 'organizer' });

    api.myEventHistory.mockResolvedValue(history({ ...result, finish_status: 'dnf' as never, elapsed_ms: 0 }));
    await render(<Results eventId="E1" slug="river-5k" registration={reg} event={{ title: 'River 5K', whenLabel: 'Sep 24, 09:00 (Asia/Taipei)' }} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('results-mine')).toBeTruthy());
    expect(screen.queryByTestId('results-finish-share')).toBeNull();

    api.myEventHistory.mockResolvedValue(history(result));
    await render(<Results eventId="E1" slug="river-5k" registration={reg} event={{ title: 'River 5K', whenLabel: 'Sep 24, 09:00 (Asia/Taipei)' }} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('results-finish-open')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('results-finish-open'));
    await waitFor(() => expect(screen.getByTestId('results-finish-preview')).toBeTruthy());
    expect(deepText(screen.getByTestId('results-finish-preview'))).not.toMatch(/Finish time/);
    await fireEvent(screen.getByTestId('results-finish-time'), 'valueChange', true);
    await waitFor(() => expect(deepText(screen.getByTestId('results-finish-preview'))).toMatch(/Finish time 25:00/));
  });
});
