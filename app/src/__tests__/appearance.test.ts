/** PG-LINK-01：外觀與有效等級分開——擁有清單、外觀等級回退、場景、鞋款快照；偏好依錢包分區、新鞋提示只在有明確選擇時出現。 */
import { PublicKey } from '@solana/web3.js';

import type { PlayerProfile } from '@/chain/accounts';
import { appearanceLevel, highestOwnedLevel, ownedShoes, sceneOf, shoeSnapshotOf } from '@/domain/appearance';
import { useAppearanceStore } from '@/state/appearanceStore';

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const profile = (p: Partial<PlayerProfile>): PlayerProfile => ({ wallet, coreLevel: 2, shoeLevel: 2, xp: BigInt(600), lastTaskDate: 0, streakDays: 1, maxStreakDays: 1, claimedToday: BigInt(0), todayDate: 0, migrated: true, highestLevel: 2, epochAnchor: 0, lastSettledEpoch: 0, epochPoints: 0, epochBitmap: 0, maintenanceRulesVersion: 1, ...p });
const owner = wallet.toBase58();

beforeEach(() => {
  useAppearanceStore.setState({ owner: null, loaded: false, selectedShoeId: null, shoeBackgroundEnabled: true, acquiredAt: {}, offer: null });
});

test('取得＝曾達到的最高階（highest／shoeLevel 取大者），XP 達門檻不算；Lv.1 人人擁有', () => {
  expect(ownedShoes(owner, null).map((s) => s.level)).toEqual([1]);
  expect(ownedShoes(owner, profile({ xp: BigInt(99_999), coreLevel: 1, shoeLevel: 1, highestLevel: 1 })).map((s) => s.level)).toEqual([1]);
  const list = ownedShoes(owner, profile({ coreLevel: 2, shoeLevel: 2, highestLevel: 4 }));
  expect(list.map((s) => s.level)).toEqual([1, 2, 3, 4]);
  expect(list[0]).toMatchObject({ id: 'wild-guardians-v1:1', variant: null, entitlementSource: 'starter' });
  expect(list[3]).toMatchObject({ id: 'wild-guardians-v1:4', entitlementSource: 'chain_level' });
  expect(list[3]!.variant).toBeTruthy();
  expect(highestOwnedLevel(profile({ shoeLevel: 3, highestLevel: 2 }))).toBe(3);
});

test('外觀等級：明確選擇且仍擁有 → 該鞋（降級後沿用）；未選擇或選了未取得 → 跟隨有效等級', () => {
  const p = profile({ coreLevel: 2, shoeLevel: 2, highestLevel: 4 });
  expect(appearanceLevel(p, null)).toBe(2);
  expect(appearanceLevel(p, 'wild-guardians-v1:4')).toBe(4);
  expect(appearanceLevel(p, 'wild-guardians-v1:5')).toBe(2); // 未取得
  expect(appearanceLevel(null, 'wild-guardians-v1:3')).toBe(1);
  expect(sceneOf(1)).toBeNull();
  expect([2, 3, 4, 5].map((l) => sceneOf(l as 2 | 3 | 4 | 5))).toEqual(['forest', 'ocean', 'jungle', 'snow']);
});

test('鞋款快照：未綁定玩家 → null（未指定，不推算）；有玩家 → 目前外觀', () => {
  expect(shoeSnapshotOf(null, profile({}), null)).toBeNull();
  expect(shoeSnapshotOf(owner, null, null)).toBeNull();
  expect(shoeSnapshotOf(owner, profile({ highestLevel: 3 }), 'wild-guardians-v1:3')).toMatchObject({ shoeId: 'wild-guardians-v1:3', level: 3 });
});

test('偏好依錢包分區；訪客預設且不保存；新鞋只在有明確選擇時提示「立即使用／稍後」，不覆蓋原選擇', async () => {
  const store = useAppearanceStore.getState();
  await store.load(owner);
  expect(useAppearanceStore.getState()).toMatchObject({ owner, loaded: true, selectedShoeId: null, shoeBackgroundEnabled: true });
  // 跟隨有效等級時取得新鞋：不提示（外觀自然跟著有效等級）
  await useAppearanceStore.getState().observeOwned(2);
  expect(useAppearanceStore.getState().offer).toBeNull();
  expect(useAppearanceStore.getState().acquiredAt[2]).toBeTruthy();
  // 明確選擇 Lv.2 後取得 Lv.3 → 提示；稍後 → 選擇不變
  await useAppearanceStore.getState().selectShoe(2);
  await useAppearanceStore.getState().observeOwned(3);
  expect(useAppearanceStore.getState().offer).toBe(3);
  useAppearanceStore.getState().dismissOffer();
  expect(useAppearanceStore.getState().selectedShoeId).toBe('wild-guardians-v1:2');
  await useAppearanceStore.getState().setBackground(false);
  // 訪客：回預設、不保存
  await useAppearanceStore.getState().load(null);
  expect(useAppearanceStore.getState()).toMatchObject({ owner: null, selectedShoeId: null, shoeBackgroundEnabled: true });
  await useAppearanceStore.getState().setBackground(false);
  // 回到同一錢包：讀回之前保存的選擇與關閉的背景
  useAppearanceStore.setState({ loaded: false });
  await useAppearanceStore.getState().load(owner);
  expect(useAppearanceStore.getState()).toMatchObject({ owner, selectedShoeId: 'wild-guardians-v1:2', shoeBackgroundEnabled: false });
  // 另一錢包：不沿用
  useAppearanceStore.setState({ loaded: false });
  await useAppearanceStore.getState().load('11111111111111111111111111111112');
  expect(useAppearanceStore.getState()).toMatchObject({ selectedShoeId: null, shoeBackgroundEnabled: true });
});
