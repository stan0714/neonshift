/**
 * SKR 外觀 SKU 目錄（docs/store/competition-development-plan.md §1 P1、skr-integration-assessment）。
 * - 成就不能買：SKU 只對「已由伺服器驗證並登錄（approved／minted）」的成就開放；SKR 不增加 XP、排名、成績或審核通過率。
 * - 首款：Genesis Mint 收藏卡邊框（first_5k）。價格由設定給定（最小單位），SKU 版本固定寫入訂單。
 */
import type { Achievement } from "../store/types.js";

export type SkuRequirement = { kind: "milestone"; category: string };
export type Sku = { sku: string; version: number; cosmeticId: string; requires: SkuRequirement };

export const SKUS: readonly Sku[] = [
  { sku: "genesis_mint_frame", version: 1, cosmeticId: "skr_genesis_mint_frame_v1", requires: { kind: "milestone", category: "first_5k" } },
];

export const findSku = (sku: string) => SKUS.find((s) => s.sku === sku) ?? null;

export type Eligibility = { status: "eligible"; achievementId: string } | { status: "not_achieved" | "pending_registry" | "revoked"; achievementId: string | null };

/** 資格只看伺服器端成就狀態；pending_registry 尚未登錄不算已驗證、revoke_* 一律不合格 */
export function eligibilityFor(sku: Sku, achievements: Achievement[]): Eligibility {
  const list = achievements.filter((a) => a.kind === sku.requires.kind && a.category === sku.requires.category);
  const ok = list.find((a) => a.status === "approved" || a.status === "minted");
  if (ok) return { status: "eligible", achievementId: ok.achievementId };
  const pending = list.find((a) => a.status === "pending_registry");
  if (pending) return { status: "pending_registry", achievementId: pending.achievementId };
  const revoked = list.find((a) => a.status === "revoked" || a.status === "revoke_pending");
  if (revoked) return { status: "revoked", achievementId: revoked.achievementId };
  return { status: "not_achieved", achievementId: null };
}

/** 顯示用：最小單位 → 十進位字串（不做浮點運算） */
export function formatBaseUnits(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
