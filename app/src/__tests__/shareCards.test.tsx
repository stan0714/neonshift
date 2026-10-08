/**
 * PG-SHARE-06 卡型 C／D／E（docs/social-share §4.3）。
 * 每一張的界線都要測得出來：活動卡不寫名額也不含個人資料、跑鞋卡沒領取就不掛網路標示、
 * Guardian 卡不含個人數據也不宣稱捐款。
 */
import { render, screen } from '@testing-library/react-native';

import { ShareCard } from '@/components/ShareCard';
import { eventShareLayout, gearShareLayout, guardianShareLayout, sharePublishable } from '@/domain/shareImage';
import { t, useLocaleStore } from '@/i18n';

beforeEach(() => useLocaleStore.setState({ setting: 'en', locale: 'en' }));

const tr = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const labels = { tagline: 'Walk or run to grow your shoes.', site: 'neonshift.cc' };

/** react-native-svg 把文字收進 TSpan 的 content prop，RNTL 的 textContent 讀不到 */
const deepText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  const n = node as { props?: { content?: unknown; children?: unknown }; children?: unknown[] };
  const own = typeof n.props?.content === 'string' ? n.props.content : typeof n.props?.children === 'string' ? n.props.children : '';
  return own || (n.children ?? []).map(deepText).join('');
};
const cardText = (id = 'share-card') => deepText(screen.getByTestId(id));

describe('活動邀請卡（C）', () => {
  const mk = (o: Partial<Parameters<typeof eventShareLayout>[0]> = {}) =>
    eventShareLayout({ title: 'Wild Guardian Day', whenLabel: 'Sep 24, 09:00 (Asia/Taipei)', cityLabel: null, organizer: null, ...o }, { t: tr, labels, qr: 'https://neonshift.cc/e/wild-guardian-day-2026?source=invite' });

  test('只放公開資訊；名額回落地頁看，不寫死在圖裡', () => {
    const l = mk();
    expect(l.hero.value).toBe('Wild Guardian Day');
    expect(l.lines).toContain(t('share.card.spotsNote'));
    expect(l.lines.join('|')).not.toMatch(/\d+\s*(spots|left|名額剩)/i);
    expect(sharePublishable(l)).toBe(true);
  });

  test('沒有鏈上資產 → 不掛網路標示（不亂標 DEVNET）', () => {
    expect(mk().chainAsset).toBe(false);
    expect(mk().notice).toBeNull();
  });

  test('主辦方與地點有值才出現；沒有就不猜', () => {
    expect(mk().lines.join('|')).not.toMatch(/Organized by/);
    expect(mk({ organizer: 'Taipei Trail Club', cityLabel: 'Taipei' }).lines.join('|')).toMatch(/Organized by Taipei Trail Club/);
    expect(mk({ cityLabel: 'Taipei' }).lines).toContain('Taipei');
  });

  test('畫出來的圖上有活動名、時間與產品線索，沒有報到碼欄位', async () => {
    await render(<ShareCard layout={mk()} />);
    const text = cardText();
    expect(text).toMatch(/Wild Guardian/); // 標題長時會折行，圖上是兩行
    expect(text).toMatch(/Day/);
    expect(text).toMatch(/Sep 24/);
    expect(text).toMatch(/neonshift\.cc/);
    expect(text).not.toMatch(/claim_code|check-?in code/i);
  });
});

describe('跑鞋里程卡（D）', () => {
  const mk = (claimed: boolean, o: Partial<Parameters<typeof gearShareLayout>[0]> = {}) =>
    gearShareLayout({ levelName: 'Phase', level: 3, kmTotal: '42.5', nextLabel: null, claimedOnChain: claimed, ...o }, { t: tr, labels: { ...labels, notice: t('share.card.net.devnet') }, qr: 'https://neonshift.cc/s/gear?source=levelup' });

  test('主數字是里程，階名放次要行', () => {
    expect(mk(false).hero).toEqual({ value: '42.5', unit: 'km' });
    expect(mk(false).lines[0]).toBe(t('share.card.stage', { n: 3, name: 'Phase' }));
  });

  test('沒領取紀念 NFT → 不算鏈上資產、不掛網路標示，並說明里程在手機上', () => {
    const l = mk(false);
    expect([l.chainAsset, l.notice]).toEqual([false, null]);
    expect(l.lines).toContain(t('share.card.gear.unclaimed'));
    expect(sharePublishable(l)).toBe(true);
  });

  test('已領取 → 是鏈上資產，必須帶網路標示，缺了就不可發布', () => {
    const l = mk(true);
    expect(l.chainAsset).toBe(true);
    expect(l.notice).toMatch(/DEVNET/);
    expect(l.lines).toContain(t('share.card.gear.claimed'));
    expect(sharePublishable({ ...l, notice: null })).toBe(false);
  });

  test('徽章用鞋階短標，不需要遠端圖', async () => {
    await render(<ShareCard layout={mk(true)} />);
    expect(screen.getByTestId('share-card-emblem-shoe:3')).toBeTruthy();
    expect(cardText()).toMatch(/Lv\.3/);
  });
});

describe('Guardian 故事卡（E）', () => {
  const mk = (o: Partial<Parameters<typeof guardianShareLayout>[0]> = {}) =>
    guardianShareLayout({ speciesName: 'Amur Leopard', storyLine: 'Fewer than 130 remain in the wild', progressLabel: '131 counted', level: 5, ...o }, { t: tr, labels, qr: 'https://neonshift.cc/s/guardian?source=guardian' });

  test('只有物種、一句依據與共同進度；一定附上「這是學習里程碑」', () => {
    const l = mk();
    expect(l.hero.value).toBe('Amur Leopard');
    expect(l.lines).toContain('Fewer than 130 remain in the wild');
    expect(l.lines).toContain('131 counted');
    expect(l.lines).toContain(t('share.card.guardian.note'));
    // 除了那句免責說明本身，內容不得出現捐款／救援字樣
    expect(l.lines.slice(0, -1).join('|')).not.toMatch(/donat|rescued|捐款/i);
  });

  test('沒有共同進度時就不硬寫；不含鏈上資產標示', () => {
    expect(mk({ progressLabel: null }).lines).toHaveLength(2);
    expect(mk().chainAsset).toBe(false);
  });

  test('畫出來的圖不含任何個人數據欄位', async () => {
    await render(<ShareCard layout={mk()} />);
    const text = cardText();
    expect(text).toMatch(/Amur Leopard/);
    expect(text).not.toMatch(/km|pace|\/km/);
  });
});

describe('版面不壓線', () => {
  test('四行文字＋徽章時仍留得下分隔線與產品線索（縮徽章而不是疊字）', async () => {
    const crowded = eventShareLayout(
      { title: 'A Very Long Community Event Name', whenLabel: 'Sep 24, 09:00 (Asia/Taipei)', cityLabel: 'Taipei', organizer: 'Taipei Trail Club' },
      { t: tr, labels, qr: 'https://neonshift.cc/e/x?source=invite' },
    );
    expect(crowded.lines).toHaveLength(4);
    await render(<ShareCard layout={crowded} />);
    // 四行都畫得出來，最後一行不會被吃掉
    for (let i = 0; i < 4; i++) expect(screen.getByTestId(`share-card-line-${i}`)).toBeTruthy();
    expect(screen.getByTestId('share-card-tagline-0')).toBeTruthy();
    expect(screen.getByTestId('share-card-site')).toBeTruthy();
  });
});
