import type { AchievementView } from '@/services/api/ApiClient';

/**
 * 錢包確認後到伺服器記錄 minted 之間有空窗：後端的 minted 是 indexer 掃到鏈上事件才寫入的，
 * 而畫面在鑄造完成當下就重抓，拿到的仍是 approved → 卡片又畫成「可鑄造」，誘導重複鑄造。
 * 這裡記住本機已確認的鑄造（有交易簽章為憑），套回伺服器回應，直到 indexer 追上。
 * 只存在記憶體：重開 App 時 indexer 早已追上，不需要也不應該把它當成持久狀態。
 */
const minted = new Map<string, { asset: string; signature: string }>(); // signature 空字串＝已在鏈上但本次未取得簽章（alreadyMinted）

export function recordLocalMint(achievementId: string, tx: { asset: string; signature: string }) {
  minted.set(achievementId, tx);
}

/** 伺服器已標 minted 或已撤銷時以伺服器為準（撤銷是更新的事實，不能被本機樂觀狀態蓋掉） */
export function applyLocalMints(items: AchievementView[]): AchievementView[] {
  if (minted.size === 0) return items;
  return items.map((a) => {
    const tx = minted.get(a.achievement_id);
    if (!tx || a.minted || a.status === 'minted' || a.status === 'revoked' || a.status === 'revoke_pending') {
      if (tx && (a.minted || a.status === 'minted')) minted.delete(a.achievement_id); // indexer 追上了
      return a;
    }
    return { ...a, minted: true, status: 'minted', asset: tx.asset, minted_signature: tx.signature || a.minted_signature };
  });
}

/** 測試用：清掉跨測試殘留 */
export function resetLocalMints() {
  minted.clear();
}
