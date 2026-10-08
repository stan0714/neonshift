import { applyLocalMints, recordLocalMint, resetLocalMints } from '@/services/chain/localMints';
import type { AchievementView } from '@/services/api/ApiClient';

/**
 * 後端的 minted 由 indexer 掃鏈上事件寫入，錢包確認後會有一段空窗仍回 approved。
 * 畫面若照單全收就會在鑄造完成後又顯示「可鑄造」，誘導重複鑄造。
 */
const view = (over: Partial<AchievementView> = {}): AchievementView => ({
  achievement_id: 'a1', minted: false, kind: 'milestone', pb_id: null, milestone_key: 'first_5k|outdoor|device', source: null,
  category: 'first_5k', verification_class: 'device', source_revision: 1, rules_major: 1, public_consent: true,
  status: 'approved', metadata_hash: '', metadata_uri: '', asset: null, minted_signature: null, minted_at: null,
  registry_updated_at: null, updated_at: '', ...over,
} as AchievementView);

beforeEach(() => resetLocalMints());

test('鑄造確認後：伺服器還停在 approved 也顯示為已鑄造，帶 asset 與簽章', () => {
  expect(applyLocalMints([view()])[0]!.status).toBe('approved'); // 沒有本機紀錄時原樣回傳
  recordLocalMint('a1', { asset: 'DL3g', signature: 'sig1' });
  const [a] = applyLocalMints([view()]);
  expect([a!.status, a!.minted, a!.asset, a!.minted_signature]).toEqual(['minted', true, 'DL3g', 'sig1']);
});

test('撤銷以伺服器為準：本機樂觀狀態不得蓋掉更新的事實', () => {
  recordLocalMint('a1', { asset: 'DL3g', signature: 'sig1' });
  for (const status of ['revoked', 'revoke_pending'] as const) {
    expect(applyLocalMints([view({ status })])[0]!.status).toBe(status);
  }
});

test('indexer 追上後丟掉本機紀錄，之後完全以伺服器為準', () => {
  recordLocalMint('a1', { asset: 'DL3g', signature: 'sig1' });
  expect(applyLocalMints([view({ status: 'minted', minted: true, asset: 'DL3g', minted_signature: 'sig1' })])[0]!.status).toBe('minted');
  // 已清除：同一筆若之後被撤銷，不會再被本機狀態覆蓋
  expect(applyLocalMints([view({ status: 'revoke_pending' })])[0]!.status).toBe('revoke_pending');
});

test('其他成就不受影響', () => {
  recordLocalMint('a1', { asset: 'DL3g', signature: 'sig1' });
  const [other] = applyLocalMints([view({ achievement_id: 'a2' })]);
  expect([other!.status, other!.minted]).toEqual(['approved', false]);
});
