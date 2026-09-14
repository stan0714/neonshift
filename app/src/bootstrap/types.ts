/**
 * App Bootstrap（Style 8.2）。載入順序：
 * 1. 本機設定與 cached profile  2. 版本相容  3. Health Connect availability／既有權限（不彈 dialog）
 * 4. 以保存的 MWA token reauthorize（失效標記 disconnected，不卡住）  5. dashboard 資料（失敗用快取）
 */
export type StepId = 'profile' | 'health' | 'wallet' | 'network';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type StepState = { id: StepId; label: string; status: StepStatus; detail?: string };

/** 單一步驟的執行結果；`blocking` 表示必須離開 loading 進入特殊狀態 */
export type StepOutcome =
  | { status: 'done' | 'skipped' | 'failed'; detail?: string }
  | { status: 'blocked'; reason: 'forceUpdate' | 'maintenance'; detail?: string; retryAfter?: string };

export type BootstrapTask = {
  id: StepId;
  /** 8.2 Loading copy，例如 `Checking health access` */
  label: string;
  run: (ctx: BootstrapContext) => Promise<StepOutcome>;
  /** 逾時視為 failed（預設 8 秒），不阻塞啟動 */
  timeoutMs?: number;
};

/** 各步驟共享並累積的結果 */
export type BootstrapContext = {
  onboardingComplete: boolean;
  walletConnected: boolean;
  /** 有 cached dashboard 時才允許 `Use offline data` */
  hasCache: boolean;
  cacheTimestamp?: number;
  minVersionOk: boolean;
};

export type BootstrapRoute = 'Landing' | 'Main';

export type BootstrapPhase =
  | 'hidden' // < 300ms：不顯示畫面以免閃爍
  | 'loading' // 300ms–3s：logo pulse 與目前步驟
  | 'slow' // > 3s：顯示步驟與 Use offline data（有快取時）
  | 'stalled' // > 10s：Retry、診斷摘要、離線進入；停止無限 spinner
  | 'forceUpdate'
  | 'maintenance'
  | 'done';

export const BOOTSTRAP_TIMING = { showAfterMs: 300, slowAfterMs: 3_000, stalledAfterMs: 10_000 } as const;

export const LOADING_COPY = {
  default: 'Syncing your shift',
  profile: 'Restoring your profile',
  health: 'Checking health access',
  wallet: 'Restoring wallet session',
  network: 'Contacting devnet',
  offline: 'Live data unavailable',
} as const;
