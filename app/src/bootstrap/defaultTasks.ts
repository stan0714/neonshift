import { healthConnect } from '@/services/health/HealthConnectService';
import { walletService } from '@/services/wallet/WalletService';
import { isOnboardingComplete, useOnboardingStore } from '@/state/onboardingStore';
import { useWalletStore } from '@/state/walletStore';

import type { BootstrapTask } from './types';
import { LOADING_COPY } from './types';

/**
 * 預設 bootstrap 步驟（Style 8.2 載入順序）。
 * - profile：本機 onboarding 旗標（PG-A-11）
 * - health：Health Connect availability 與既有權限，不彈 dialog（PG-A-04）
 * - wallet：只讀本機保存的 MWA session，不開啟錢包；reauthorize 延後到首次簽章（PG-A-06）
 * - network：Config 版本檢查與 dashboard 快取，待 PG-A-07／A-12 接入
 */
export const defaultBootstrapTasks: readonly BootstrapTask[] = [
  {
    id: 'profile',
    label: LOADING_COPY.profile,
    run: async (ctx) => {
      const flags = await useOnboardingStore.getState().load();
      ctx.onboardingComplete = isOnboardingComplete(flags);
      return { status: 'done' };
    },
  },
  {
    id: 'health',
    label: LOADING_COPY.health,
    run: async () => {
      try {
        const status = await healthConnect.getStatus();
        if (status.availability !== 'available') return { status: 'failed', detail: `Health Connect ${status.availability}` };
        const perms = await healthConnect.getPermissions();
        return { status: 'done', detail: `permissions ${perms.state}` };
      } catch (e) {
        return { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    id: 'wallet',
    label: LOADING_COPY.wallet,
    run: async (ctx) => {
      if (!(await walletService.hasStoredSession())) {
        ctx.walletConnected = false;
        return { status: 'skipped', detail: 'No saved wallet session' };
      }
      const session = await useWalletStore.getState().restore();
      ctx.walletConnected = session !== null;
      return session ? { status: 'done', detail: session.address } : { status: 'failed', detail: 'Wallet session could not be read' };
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
