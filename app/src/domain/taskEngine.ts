/**
 * TaskEngine（PG-A-08，SD 5.3、SA 6.3、BR-01／05）：達標判定與每日任務狀態機。純函式，不讀資料。
 * 任務日一律 `floor(unixSeconds / 86400)`（UTC）；UI 顯示裝置時區並標註 UTC 換日倒數。
 */
export const SECONDS_PER_DAY = 86_400;
export const STEPS_GOAL = 8_000;
export const SLEEP_GOAL_MINUTES = 420;

export type TaskType = 'steps' | 'sleep';

/** SA 6.3 每日任務狀態 */
export type TaskStatus =
  | 'not_met' // 未達標
  | 'ready' // 可打卡
  | 'verifying' // 送出後端驗證
  | 'awaiting_signature' // 取得 attestation，待錢包簽章
  | 'confirming' // 交易已送出，等待確認
  | 'claimed' // 已領取（ClaimReceipt 存在）
  | 'rejected'; // 風險未通過

export type TaskProgress = { type: TaskType; value: number; goal: number; met: boolean; remaining: number; ratio: number };

export function taskDateOf(unixSeconds: number): number {
  return Math.floor(unixSeconds / SECONDS_PER_DAY);
}

/** 距 UTC 換日的秒數 */
export function secondsUntilUtcMidnight(unixSeconds: number): number {
  return (taskDateOf(unixSeconds) + 1) * SECONDS_PER_DAY - unixSeconds;
}

export function progress(type: TaskType, value: number): TaskProgress {
  const goal = type === 'steps' ? STEPS_GOAL : SLEEP_GOAL_MINUTES;
  const v = Math.max(0, Math.floor(value));
  return { type, value: v, goal, met: v >= goal, remaining: Math.max(0, goal - v), ratio: Math.min(1, v / goal) };
}

export type TaskEvent =
  | { kind: 'data'; value: number }
  | { kind: 'submit' }
  | { kind: 'attested' }
  | { kind: 'rejected' }
  | { kind: 'sent' }
  | { kind: 'confirmed' }
  | { kind: 'cancel' } // 使用者取消或 attestation 過期
  | { kind: 'failed' } // 交易確定失敗、可重試
  | { kind: 'receipt_exists' } // 冪等查詢發現已領取
  | { kind: 'new_day' };

/**
 * 狀態轉移（SA 6.3）。非法事件回原狀態，不丟例外，方便 UI 直接 reduce。
 * `claimed` 只在 UTC 換日重置；`rejected` 同日取得新資料達標可回 `ready`。
 */
export function reduce(status: TaskStatus, ev: TaskEvent, type: TaskType): TaskStatus {
  if (ev.kind === 'new_day') return 'not_met';
  if (ev.kind === 'receipt_exists') return 'claimed';
  switch (status) {
    case 'not_met':
    case 'ready':
      if (ev.kind === 'data') return progress(type, ev.value).met ? 'ready' : 'not_met';
      if (ev.kind === 'submit' && status === 'ready') return 'verifying';
      return status;
    case 'verifying':
      if (ev.kind === 'attested') return 'awaiting_signature';
      if (ev.kind === 'rejected') return 'rejected';
      if (ev.kind === 'failed') return 'ready';
      return status;
    case 'awaiting_signature':
      if (ev.kind === 'sent') return 'confirming';
      if (ev.kind === 'cancel') return 'ready';
      return status;
    case 'confirming':
      if (ev.kind === 'confirmed') return 'claimed';
      if (ev.kind === 'failed') return 'awaiting_signature';
      return status;
    case 'rejected':
      if (ev.kind === 'data') return progress(type, ev.value).met ? 'ready' : 'rejected';
      return status;
    case 'claimed':
      return status;
    default:
      return status;
  }
}

export type MissionCtaKey = 'mission.cta.keepMoving' | 'mission.cta.clockIn' | 'mission.cta.verifying' | 'mission.cta.openWallet' | 'mission.cta.viewTx' | 'mission.cta.claimed' | 'mission.cta.tryAgain';

/** Style 7.3 Mission Card 對應：CTA 文案（i18n key）與是否可按 */
export function ctaFor(status: TaskStatus, p: TaskProgress): { label: MissionCtaKey; enabled: boolean } {
  switch (status) {
    case 'not_met':
      return { label: 'mission.cta.keepMoving', enabled: false };
    case 'ready':
      return { label: 'mission.cta.clockIn', enabled: true };
    case 'verifying':
      return { label: 'mission.cta.verifying', enabled: false };
    case 'awaiting_signature':
      return { label: 'mission.cta.openWallet', enabled: true };
    case 'confirming':
      return { label: 'mission.cta.viewTx', enabled: true };
    case 'claimed':
      return { label: 'mission.cta.claimed', enabled: false };
    case 'rejected':
      return { label: p.met ? 'mission.cta.tryAgain' : 'mission.cta.keepMoving', enabled: p.met };
    default:
      return { label: 'mission.cta.clockIn', enabled: false };
  }
}
