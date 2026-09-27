/**
 * Dashboard 狀態（PG-A-12）：今日健康摘要、鏈上 profile／config／餘額、兩項任務狀態。
 * 權威狀態在鏈上與 Health Connect；這裡只是 UI 快取（含最後同步時間，離線時顯示快取值）。
 */
import { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';

import { decodeConfig, decodeIncidentFreeze, decodePlayerProfile, type ChainConfig, type IncidentFreeze, type PlayerProfile } from '@/chain/accounts';
import { claimPda, configPda, freezePda, playerPda } from '@/chain/program';
import { FEATURES } from '@/config/features';
import { APP_CONFIG } from '@/config/app';
import { progress, reduce, taskDateOf, TASK_CODE, WORKOUT_GOAL_MOVING_MS, type TaskStatus, type TaskType } from '@/domain/taskEngine';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { classifyRpcError, fetchAccountsInfo, rpcFailureRef, rpcRead, RpcReadError, type RpcFailureReason } from '@/services/chain/ChainClient';
import { healthConnect } from '@/services/health/HealthConnectService';
import { claimSubmitter } from '@/services/chain/ClaimSubmitter';
import { associatedTokenAddress } from '@/chain/txBuilder';

import type { SleepResult, StepsResult } from '../../modules/neonshift-health';

export type HealthSnapshot = { taskDate: number; steps: StepsResult | null; sleep: SleepResult | null; syncedAt: number; error: string | null; source: 'foreground' | 'background' | 'cache' };

type State = {
  taskDate: number;
  health: HealthSnapshot | null;
  healthSyncing: boolean;
  profile: PlayerProfile | null;
  config: ChainConfig | null;
  /** PG-V-05：全域 incident freeze（帳戶不存在 → null） */
  freeze: IncidentFreeze | null;
  /** tSKR 最小單位 */
  balance: bigint | null;
  chainSyncedAt: number | null;
  /**
   * 鏈上讀取失敗。**只留分類與短 Ref**——原始 RPC payload 不進使用者文案（Style 14）：
   * 2026-09-27 手機上就出現過一整串 `{"jsonrpc":"2.0","error":{"code":504,…}}` 貼在錯誤卡正文裡。
   */
  chainError: { reason: RpcFailureReason; ref: string } | null;
  tasks: Record<TaskType, TaskStatus>;
  /** 維持規則 v2：今日運動任務證據（本機已同步、審核通過、最長的一筆；沒有 → null） */
  workout: WorkoutEvidence | null;
  syncHealth: () => Promise<void>;
  /** 從本機紀錄重算今日運動任務（同步完成／刪除／換日時呼叫） */
  refreshWorkout: () => void;
  /** 啟動／離線時先顯示最近快取（前景或背景寫入），再前景同步 */
  loadCachedHealth: () => Promise<boolean>;
  syncChain: (wallet: PublicKey) => Promise<void>;
  dispatch: (type: TaskType, ev: Parameters<typeof reduce>[1]) => void;
  /** UTC 換日：重置任務狀態並重新同步 */
  rollDay: (nowUnix: number) => boolean;
};

/** 展示版（FEATURES.demoLevel）：把 profile 顯示成指定鞋階；沒有 profile 也造一個。純顯示，不能打卡 */
export function demoProfile(profile: PlayerProfile | null, wallet: PublicKey, config: ChainConfig | null): PlayerProfile | null {
  const lv = FEATURES.demoLevel;
  if (!lv) return profile;
  const xp = config?.shoeXpThresholds?.[lv - 1] ?? 0n;
  const today = Math.floor(Date.now() / 86_400_000);
  const base: PlayerProfile = profile ?? { wallet, coreLevel: 1, shoeLevel: 1, xp: 0n, lastTaskDate: 0, streakDays: 0, maxStreakDays: 0, claimedToday: 0n, todayDate: today, migrated: true, highestLevel: 1, epochAnchor: today, lastSettledEpoch: 0, epochPoints: 0, epochBitmap: 0, maintenanceRulesVersion: 2 };
  return { ...base, coreLevel: lv, shoeLevel: lv, highestLevel: Math.max(lv, base.highestLevel), xp: xp > base.xp ? xp : base.xp };
}

export const sleepMinutesOf = (sleep: SleepResult | null) => sleep?.sessions.reduce((n, s) => n + s.minutes, 0) ?? 0;

export type WorkoutEvidence = { serverId: string | null; localId: string; distanceM: number; movingMs: number; synced: boolean; underReview: boolean };
/**
 * 今日（UTC 任務日）運動任務證據：只看本機 App 內記錄的 session（GPS）、開始時間落在該 UTC 日、非刪除中。
 * 優先「已同步且 saved」且距離最長者；沒有 → 回最接近的一筆（未同步／待審）供 UI 提示；後端與鏈上才是權威。
 */
export function workoutEvidenceFor(sessions: { sessionId: string; startedAtUtc: number; status: string; syncedSessionId: string | null; deletedAt?: number | null; summary?: { distanceMm: number | null; movingMs?: number | null; elapsedMs?: number | null } | null }[], taskDate: number): WorkoutEvidence | null {
  const day = sessions.filter((m) => Math.floor(m.startedAtUtc / 86_400_000) === taskDate && !m.deletedAt && (m.status === 'saved' || m.status === 'needs_review') && m.summary);
  const ev = (m: (typeof day)[number]): WorkoutEvidence => ({ serverId: m.syncedSessionId, localId: m.sessionId, distanceM: Math.floor((m.summary?.distanceMm ?? 0) / 1000), movingMs: m.summary?.movingMs ?? m.summary?.elapsedMs ?? 0, synced: !!m.syncedSessionId, underReview: m.status === 'needs_review' });
  const ranked = day.map(ev).sort((a, b) => Number(b.synced && !b.underReview) - Number(a.synced && !a.underReview) || b.distanceM - a.distanceM);
  return ranked[0] ?? null;
}
const workoutValue = (w: WorkoutEvidence | null) => (w && w.synced && !w.underReview && w.movingMs >= WORKOUT_GOAL_MOVING_MS ? w.distanceM : 0);

export const useDashboardStore = create<State>((set, get) => ({
  taskDate: taskDateOf(Math.floor(Date.now() / 1000)),
  health: null,
  healthSyncing: false,
  profile: null,
  freeze: null,
  config: null,
  balance: null,
  chainSyncedAt: null,
  chainError: null,
  tasks: { steps: 'not_met', sleep: 'not_met', workout: 'not_met' },
  workout: null,

  refreshWorkout() {
    const w = workoutEvidenceFor(workoutRecorder.localStore().list(), get().taskDate);
    set({ workout: w });
    if (get().tasks.workout !== 'claimed') get().dispatch('workout', { kind: 'data', value: workoutValue(w) });
  },

  async loadCachedHealth() {
    const cached = await healthConnect.readCachedSummary();
    if (!cached || cached.taskDate !== get().taskDate) return false;
    // 只在沒有更新的前景資料時採用快取
    const cur = get().health;
    if (cur && cur.syncedAt >= cached.syncedAt) return false;
    set({ health: { taskDate: cached.taskDate, steps: cached.steps, sleep: FEATURES.sleep ? cached.sleep : null, syncedAt: cached.syncedAt, error: null, source: 'cache' } });
    get().dispatch('steps', { kind: 'data', value: cached.steps.total });
    if (FEATURES.sleep) get().dispatch('sleep', { kind: 'data', value: sleepMinutesOf(cached.sleep) });
    return true;
  },

  async syncHealth() {
    const { taskDate } = get();
    set({ healthSyncing: true });
    try {
      const [steps, sleep] = await Promise.all([healthConnect.readStepsForTaskDate(taskDate), FEATURES.sleep ? healthConnect.readSleepForTaskDate(taskDate) : Promise.resolve(null)]);
      const syncedAt = Date.now();
      set({ health: { taskDate, steps, sleep, syncedAt, error: null, source: 'foreground' } });
      get().dispatch('steps', { kind: 'data', value: steps.total });
      if (FEATURES.sleep) get().dispatch('sleep', { kind: 'data', value: sleepMinutesOf(sleep) });
      void healthConnect.cacheSummary({ taskDate, steps, sleep: sleep ?? { sessions: [] }, syncedAt, source: 'foreground' });
    } catch (e) {
      const prev = get().health;
      set({ health: { taskDate, steps: prev?.steps ?? null, sleep: FEATURES.sleep ? prev?.sleep ?? null : null, syncedAt: prev?.syncedAt ?? 0, error: e instanceof Error ? e.message : String(e), source: prev?.source ?? 'cache' } });
    } finally {
      set({ healthSyncing: false });
    }
  },

  /**
   * 讀鏈上狀態。**一次 getMultipleAccounts 讀完所有帳戶**（config／profile／freeze 與今日 receipt），
   * 不再一個帳戶打一次 getAccountInfo：首頁與 Gear 每次 focus 都會同步，原本 6～7 個請求打在
   * 限流的公用端點上，最容易換來 429／504。餘額必須等 config 才知道 mint，所以仍是第二個請求。
   */
  async syncChain(wallet) {
    if (!APP_CONFIG.chainConfigured) {
      set({ chainError: { reason: 'not_configured', ref: 'build' } });
      return;
    }
    const { taskDate } = get();
    try {
      const steps = claimPda(wallet, taskDate, TASK_CODE.steps);
      const workout = claimPda(wallet, taskDate, TASK_CODE.workout);
      const sleep = FEATURES.sleep ? claimPda(wallet, taskDate, TASK_CODE.sleep) : null;
      const addresses = [configPda(), playerPda(wallet), freezePda(), steps, workout, ...(sleep ? [sleep] : [])];
      const [configInfo, profileInfo, freezeInfo, stepsInfo, workoutInfo, sleepInfo] = await fetchAccountsInfo(addresses);

      const config = configInfo ? decodeConfig(new Uint8Array(configInfo.data), PublicKey) : null;
      const profile = profileInfo ? decodePlayerProfile(new Uint8Array(profileInfo.data), PublicKey) : null;
      // freeze 解不出來不該讓整次同步失敗（沿用原本的 catch 行為）
      let freeze: IncidentFreeze | null = null;
      try {
        freeze = freezeInfo ? decodeIncidentFreeze(new Uint8Array(freezeInfo.data)) : null;
      } catch {
        freeze = null;
      }

      let balance: bigint | null = null;
      if (config) {
        // ATA 不存在時 RPC 會回錯誤，那是預期內的「還沒有餘額」，不是連線問題（分類為 unknown → 不重試）
        const bal = await rpcRead('getTokenAccountBalance', (c) => c.getTokenAccountBalance(associatedTokenAddress(config.mint, wallet), 'confirmed')).catch(() => null);
        balance = bal ? BigInt(bal.value.amount) : 0n;
      }
      set({ config, profile: demoProfile(profile, wallet, config), freeze, balance, chainSyncedAt: Date.now(), chainError: null });
      if (stepsInfo) get().dispatch('steps', { kind: 'receipt_exists' });
      if (sleepInfo) get().dispatch('sleep', { kind: 'receipt_exists' });
      if (workoutInfo) get().dispatch('workout', { kind: 'receipt_exists' });
    } catch (e) {
      const failure = e instanceof RpcReadError ? e.failure : classifyRpcError('syncChain', e);
      set({ chainError: { reason: failure.reason, ref: rpcFailureRef(failure) } });
    }
  },

  dispatch(type, ev) {
    set((s) => ({ tasks: { ...s.tasks, [type]: reduce(s.tasks[type], ev, type) } }));
  },

  rollDay(nowUnix) {
    const d = taskDateOf(nowUnix);
    if (d === get().taskDate) return false;
    set({ taskDate: d, tasks: { steps: reduce('claimed', { kind: 'new_day' }, 'steps'), sleep: reduce('claimed', { kind: 'new_day' }, 'sleep'), workout: 'not_met' }, health: null, workout: null });
    get().refreshWorkout();
    return true;
  },
}));

export const stepsProgress = (h: HealthSnapshot | null) => progress('steps', h?.steps?.total ?? 0);
export const sleepProgress = (h: HealthSnapshot | null) => progress('sleep', sleepMinutesOf(h?.sleep ?? null));
export const workoutProgress = (w: WorkoutEvidence | null) => progress('workout', workoutValue(w));

/** 6 decimals → 顯示字串（7.5：`150 tSKR`） */
export const formatTskr = (units: bigint | null) => {
  if (units === null) return '—';
  const s = (Number(units) / 1_000_000).toFixed(6);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

/** 依 Config 與 profile 估算本次任務獎勵（顯示用；鏈上才是權威） */
export function estimateReward(cfg: ChainConfig | null, profile: PlayerProfile | null, type: TaskType): bigint | null {
  if (!cfg) return null;
  // v2：運動任務沿用 Config 的第二任務基礎（原睡眠欄位）
  const base = type === 'steps' ? cfg.baseStepsReward : cfg.baseSleepReward;
  const level = profile?.coreLevel ?? 1;
  const bps = BigInt(cfg.coreMultiplierBps[level - 1] ?? 10_000);
  return (base * bps) / 10_000n;
}
