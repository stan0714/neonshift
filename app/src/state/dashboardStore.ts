/**
 * Dashboard 狀態（PG-A-12）：今日健康摘要、鏈上 profile／config／餘額、兩項任務狀態。
 * 權威狀態在鏈上與 Health Connect；這裡只是 UI 快取（含最後同步時間，離線時顯示快取值）。
 */
import { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';

import { decodeConfig, decodeIncidentFreeze, decodePlayerProfile, fetchAccount, type ChainConfig, type IncidentFreeze, type PlayerProfile } from '@/chain/accounts';
import { claimPda, configPda, freezePda, playerPda } from '@/chain/program';
import { APP_CONFIG } from '@/config/app';
import { progress, reduce, taskDateOf, type TaskStatus, type TaskType } from '@/domain/taskEngine';
import { getConnection } from '@/services/chain/ChainClient';
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
  chainError: string | null;
  tasks: Record<TaskType, TaskStatus>;
  syncHealth: () => Promise<void>;
  /** 啟動／離線時先顯示最近快取（前景或背景寫入），再前景同步 */
  loadCachedHealth: () => Promise<boolean>;
  syncChain: (wallet: PublicKey) => Promise<void>;
  dispatch: (type: TaskType, ev: Parameters<typeof reduce>[1]) => void;
  /** UTC 換日：重置任務狀態並重新同步 */
  rollDay: (nowUnix: number) => boolean;
};

export const sleepMinutesOf = (sleep: SleepResult | null) => sleep?.sessions.reduce((n, s) => n + s.minutes, 0) ?? 0;

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
  tasks: { steps: 'not_met', sleep: 'not_met' },

  async loadCachedHealth() {
    const cached = await healthConnect.readCachedSummary();
    if (!cached || cached.taskDate !== get().taskDate) return false;
    // 只在沒有更新的前景資料時採用快取
    const cur = get().health;
    if (cur && cur.syncedAt >= cached.syncedAt) return false;
    set({ health: { taskDate: cached.taskDate, steps: cached.steps, sleep: cached.sleep, syncedAt: cached.syncedAt, error: null, source: 'cache' } });
    get().dispatch('steps', { kind: 'data', value: cached.steps.total });
    get().dispatch('sleep', { kind: 'data', value: sleepMinutesOf(cached.sleep) });
    return true;
  },

  async syncHealth() {
    const { taskDate } = get();
    set({ healthSyncing: true });
    try {
      const [steps, sleep] = await Promise.all([healthConnect.readStepsForTaskDate(taskDate), healthConnect.readSleepForTaskDate(taskDate)]);
      const syncedAt = Date.now();
      set({ health: { taskDate, steps, sleep, syncedAt, error: null, source: 'foreground' } });
      get().dispatch('steps', { kind: 'data', value: steps.total });
      get().dispatch('sleep', { kind: 'data', value: sleepMinutesOf(sleep) });
      void healthConnect.cacheSummary({ taskDate, steps, sleep, syncedAt, source: 'foreground' });
    } catch (e) {
      const prev = get().health;
      set({ health: { taskDate, steps: prev?.steps ?? null, sleep: prev?.sleep ?? null, syncedAt: prev?.syncedAt ?? 0, error: e instanceof Error ? e.message : String(e), source: prev?.source ?? 'cache' } });
    } finally {
      set({ healthSyncing: false });
    }
  },

  async syncChain(wallet) {
    if (!APP_CONFIG.chainConfigured) {
      set({ chainError: 'Onchain program not configured in this build' });
      return;
    }
    const conn = getConnection();
    const { taskDate } = get();
    try {
      const [config, profile, freeze] = await Promise.all([
        fetchAccount(conn, configPda(), (d) => decodeConfig(d, PublicKey)),
        fetchAccount(conn, playerPda(wallet), (d) => decodePlayerProfile(d, PublicKey)),
        fetchAccount(conn, freezePda(), decodeIncidentFreeze).catch(() => null),
      ]);
      let balance: bigint | null = null;
      if (config) {
        const bal = await conn.getTokenAccountBalance(associatedTokenAddress(config.mint, wallet), 'confirmed').catch(() => null);
        balance = bal ? BigInt(bal.value.amount) : 0n;
      }
      const [stepsReceipt, sleepReceipt] = await Promise.all([claimSubmitter.receiptExists(claimPda(wallet, taskDate, 1)), claimSubmitter.receiptExists(claimPda(wallet, taskDate, 2))]);
      set({ config, profile, freeze, balance, chainSyncedAt: Date.now(), chainError: null });
      if (stepsReceipt) get().dispatch('steps', { kind: 'receipt_exists' });
      if (sleepReceipt) get().dispatch('sleep', { kind: 'receipt_exists' });
    } catch (e) {
      set({ chainError: e instanceof Error ? e.message : String(e) });
    }
  },

  dispatch(type, ev) {
    set((s) => ({ tasks: { ...s.tasks, [type]: reduce(s.tasks[type], ev, type) } }));
  },

  rollDay(nowUnix) {
    const d = taskDateOf(nowUnix);
    if (d === get().taskDate) return false;
    set({ taskDate: d, tasks: { steps: reduce('claimed', { kind: 'new_day' }, 'steps'), sleep: reduce('claimed', { kind: 'new_day' }, 'sleep') }, health: null });
    return true;
  },
}));

export const stepsProgress = (h: HealthSnapshot | null) => progress('steps', h?.steps?.total ?? 0);
export const sleepProgress = (h: HealthSnapshot | null) => progress('sleep', sleepMinutesOf(h?.sleep ?? null));

/** 6 decimals → 顯示字串（7.5：`150 tSKR`） */
export const formatTskr = (units: bigint | null) => {
  if (units === null) return '—';
  const s = (Number(units) / 1_000_000).toFixed(6);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

/** 依 Config 與 profile 估算本次任務獎勵（顯示用；鏈上才是權威） */
export function estimateReward(cfg: ChainConfig | null, profile: PlayerProfile | null, type: TaskType): bigint | null {
  if (!cfg) return null;
  const base = type === 'steps' ? cfg.baseStepsReward : cfg.baseSleepReward;
  const level = profile?.coreLevel ?? 1;
  const bps = BigInt(cfg.coreMultiplierBps[level - 1] ?? 10_000);
  return (base * bps) / 10_000n;
}
