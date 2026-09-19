import { useEffect } from 'react';

import { activeLevel, appearanceLevel, highestOwnedLevel, ownedShoes, sceneOf } from '@/domain/appearance';
import { useAppearanceStore } from '@/state/appearanceStore';
import { useDashboardStore } from '@/state/dashboardStore';
import { useWalletStore } from '@/state/walletStore';

/**
 * 外觀狀態（PG-LINK-01）：載入目前玩家的偏好、補記取得日期，回傳顯示用等級／有效等級／場景／擁有清單。
 * 訪客（未連錢包）一律基本背景。
 */
export function useAppearance() {
  const owner = useWalletStore((s) => s.session?.address ?? null);
  const profile = useDashboardStore((s) => s.profile);
  const selectedShoeId = useAppearanceStore((s) => s.selectedShoeId);
  const backgroundEnabled = useAppearanceStore((s) => s.shoeBackgroundEnabled);
  const loadedOwner = useAppearanceStore((s) => (s.loaded ? s.owner : undefined));
  const offer = useAppearanceStore((s) => s.offer);
  const acquiredAt = useAppearanceStore((s) => s.acquiredAt);

  useEffect(() => {
    if (loadedOwner !== owner) void useAppearanceStore.getState().load(owner);
  }, [owner, loadedOwner]);
  const highest = highestOwnedLevel(profile);
  useEffect(() => {
    if (profile && loadedOwner === owner && owner) void useAppearanceStore.getState().observeOwned(highest);
  }, [profile, highest, owner, loadedOwner]);

  const level = appearanceLevel(profile, selectedShoeId);
  const active = activeLevel(profile);
  return {
    owner,
    level,
    active,
    /** 外觀與有效等級不同（降級後沿用外觀／主動選了較低階） */
    differs: level !== active,
    selectedShoeId,
    backgroundEnabled,
    scene: owner && backgroundEnabled ? sceneOf(level) : null,
    owned: ownedShoes(owner, profile),
    acquiredAt,
    offer,
  };
}
