import type { BootstrapTask } from './types';
import { LOADING_COPY } from './types';

/**
 * 預設 bootstrap 步驟。目前各步驟只完成「可離開 loading」的最小行為；
 * 真實資料來源由後續 PG 項目接入：
 * - profile：本機 session／onboarding 旗標（PG-A-07、PG-A-21）
 * - health：Health Connect availability 與既有權限（PG-A-04）
 * - wallet：MWA token reauthorize（PG-A-06）
 * - network：Config 版本檢查與 dashboard 快取（PG-A-07、PG-A-12）
 */
export const defaultBootstrapTasks: readonly BootstrapTask[] = [
  {
    id: 'profile',
    label: LOADING_COPY.profile,
    run: async (ctx) => {
      ctx.onboardingComplete = false;
      return { status: 'done' };
    },
  },
  {
    id: 'health',
    label: LOADING_COPY.health,
    run: async () => ({ status: 'skipped', detail: 'Health Connect module not wired yet' }),
  },
  {
    id: 'wallet',
    label: LOADING_COPY.wallet,
    run: async (ctx) => {
      ctx.walletConnected = false;
      return { status: 'skipped', detail: 'No saved wallet session' };
    },
  },
  {
    id: 'network',
    label: LOADING_COPY.network,
    run: async (ctx) => {
      ctx.hasCache = false;
      return { status: 'skipped', detail: 'Backend not configured' };
    },
  },
];
