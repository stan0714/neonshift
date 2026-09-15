/**
 * 跑鞋維持挑戰（PG-V-04；shoe-gameplay 3、4、6）。參數與 programs/neonshift-core/src/maintenance.rs、tools/maintenance-sim/rules.mjs 同版（v1）；
 * 只作 UI 預覽與提示，production 以鏈上狀態為準。
 */
import { EPOCH_DAYS, epochIndexOf, type PlayerProfile } from '@/chain/accounts';

export const MAINTENANCE_RULES_VERSION = 1;
export const MAINTENANCE_POINTS = [0, 200, 450, 700, 900] as const;
export const MAINTENANCE_ACTIVE_DAYS = [0, 2, 3, 5, 6] as const;
export const POINTS_STEPS = 100;
export const POINTS_SLEEP = 50;

export type MaintenanceView = {
  state: 'no_profile' | 'migration_required' | 'settlement_pending' | 'active';
  activeLevel: number;
  highestLevel: number;
  epochIndex: number;
  /** 本期結束（UTC 期末 00:00）毫秒時間 */
  epochEndsAtMs: number;
  daysLeft: number;
  points: number;
  activeDays: number;
  /** 維持目前階級所需（Lv1 為 0） */
  keep: { points: number; activeDays: number; met: boolean };
  /** 下一階（若 XP 上限與規則允許）所需；已 Lv5 → null */
  next: { level: number; points: number; activeDays: number; met: boolean; xpAllowed: boolean } | null;
  /** 歷史最高高於現役 → 回歸目標 */
  restore: { level: number; points: number; activeDays: number } | null;
  pendingEpochs: number;
};

const need = (level: number) => ({ points: MAINTENANCE_POINTS[Math.min(5, Math.max(1, level)) - 1]!, activeDays: MAINTENANCE_ACTIVE_DAYS[Math.min(5, Math.max(1, level)) - 1]! });
const bits = (b: number) => { let n = 0; for (let i = 0; i < 7; i++) if (b & (1 << i)) n++; return n; };
export const xpCapLevel = (xp: bigint, thresholds: bigint[]) => thresholds.filter((t) => xp >= t).length || 1;

export function maintenanceView(profile: PlayerProfile | null, thresholds: bigint[], nowMs: number): MaintenanceView | null {
  if (!profile) return null;
  const today = Math.floor(nowMs / 86_400_000);
  const active = profile.coreLevel || 1;
  const highest = Math.max(profile.highestLevel || 1, active);
  const base = { activeLevel: active, highestLevel: highest };
  if (!profile.migrated) return { ...base, state: 'migration_required', epochIndex: 0, epochEndsAtMs: 0, daysLeft: 0, points: 0, activeDays: 0, keep: { ...need(active), met: true }, next: null, restore: null, pendingEpochs: 0 };
  const epochIndex = epochIndexOf(profile.epochAnchor, today);
  const pendingEpochs = Math.max(0, epochIndex - profile.lastSettledEpoch);
  const epochEndsAtMs = (profile.epochAnchor + (epochIndex + 1) * EPOCH_DAYS) * 86_400_000;
  const daysLeft = Math.max(0, Math.ceil((epochEndsAtMs - nowMs) / 86_400_000));
  const points = pendingEpochs ? 0 : profile.epochPoints;
  const activeDays = pendingEpochs ? 0 : bits(profile.epochBitmap);
  const keep = { ...need(active), met: points >= need(active).points && activeDays >= need(active).activeDays };
  const cap = xpCapLevel(profile.xp, thresholds);
  const nextLevel = active < 5 ? active + 1 : null;
  const next = nextLevel ? { level: nextLevel, ...need(nextLevel), met: points >= need(nextLevel).points && activeDays >= need(nextLevel).activeDays, xpAllowed: cap >= nextLevel } : null;
  const restore = highest > active ? { level: highest, ...need(highest) } : null;
  return { ...base, state: pendingEpochs ? 'settlement_pending' : 'active', epochIndex, epochEndsAtMs, daysLeft, points, activeDays, keep, next, restore, pendingEpochs };
}

/** 下一步提示：還差幾點／幾個活躍日（以「雙任務日」換算） */
export function nextSteps(target: { points: number; activeDays: number }, points: number, activeDays: number) {
  const morePoints = Math.max(0, target.points - points);
  const moreDays = Math.max(0, target.activeDays - activeDays);
  const doubleDays = Math.ceil(morePoints / (POINTS_STEPS + POINTS_SLEEP));
  return { morePoints, moreDays, doubleDays: Math.max(doubleDays, moreDays) };
}
