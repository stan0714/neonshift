/**
 * 運動摘要上傳佇列（PG-LINK-02，docs/shoe-sync-activity.md §3）。
 * - 待傳項＝已結束、有摘要、尚未取得伺服器 session id 的本機 session，綁定建立時的玩家（`meta.owner`）；訪客紀錄（owner null）
 *   不會自動歸屬，需使用者確認 `assign()` 到目前錢包（不得把 A 的紀錄傳給 B）。
 * - 順序固定：`startedAtUtc ASC, endedAtUtc ASC, sessionId ASC`（UTC 時點，不用顯示字串／檔案時間）；09/17、09/18、09/19 三筆離線紀錄
 *   即使 UI 倒序，也必須 17 → 18 → 19 上傳；單筆「立即同步」不能跳過較早待傳項。
 * - 同一玩家只有一個 worker／一筆在途：結束運動、立即同步、重連、回前景共用同一把鎖；等後端 ACK 且本機提交後才取下一筆。
 * - 暫時失敗（離線／逾時／5xx）→ 隊首 retry_wait，有上限退避；未登入／被拒 → 隊首 blocked（本人處理：登入、排除）；後續一律暫停，不靜默跳過。
 * - 自動同步（`autoSync`）預設關閉：關閉時不啟動新請求（已送出的單筆可能完成）；手動「立即同步」是一次授權，走同一佇列，不永久打開自動同步。
 * - 幂等：後端以 (owner, source_id, external_record_id=sessionId, source_revision) 判重；本機同鍵重送回同結果，不重複建立。
 */
import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';

import type { LocalWorkoutStore, SessionMeta } from './LocalWorkoutStore';
import { workoutRecorder, type SyncOutcome } from './WorkoutRecorder';
import { useSyncPrefs } from '@/state/syncPrefsStore';
import { useWalletStore } from '@/state/walletStore';

export type OutboxStatus = 'queued' | 'sending' | 'retry_wait' | 'blocked' | 'acked' | 'excluded';
export type OutboxEntry = { meta: SessionMeta; status: OutboxStatus; attempt: number; nextAttemptAt: number | null; lastError: { code: string; message: string } | null; revision: number };
export type OutboxRunResult = { sent: number; /** 佇列停在哪一筆與原因（null＝全部送完） */ stoppedAt: { sessionId: string; outcome: SyncOutcome } | null; /** 指定 target 時：該筆的結果（未輪到 → BLOCKED_EARLIER） */ target?: SyncOutcome };
export type OutboxKickReason = 'finish' | 'foreground' | 'network' | 'startup' | 'toggle';

/** 退避：1 s 起倍增，最長 5 分鐘 */
export const OUTBOX_BACKOFF = { baseMs: 1_000, maxMs: 300_000 } as const;
export const backoffMs = (attempt: number) => Math.min(OUTBOX_BACKOFF.maxMs, OUTBOX_BACKOFF.baseMs * 2 ** Math.max(0, attempt - 1));

/** 穩定排序：運動開始 UTC → 結束 UTC → canonical id */
export const outboxOrder = (a: SessionMeta, b: SessionMeta) =>
  a.startedAtUtc - b.startedAtUtc || (a.endedAtUtc ?? 0) - (b.endedAtUtc ?? 0) || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);

const isPendingMeta = (m: SessionMeta) => (m.status === 'saved' || m.status === 'needs_review') && !!m.summary && !m.syncedSessionId;

type Deps = {
  store?: LocalWorkoutStore;
  send?: (meta: SessionMeta) => Promise<SyncOutcome>;
  now?: () => number;
  autoEnabled?: (owner: string | null) => boolean;
  currentOwner?: () => string | null;
  online?: () => Promise<boolean>;
};

export class WorkoutOutbox {
  private readonly store: () => LocalWorkoutStore;
  private readonly send: (meta: SessionMeta) => Promise<SyncOutcome>;
  private readonly now: () => number;
  private readonly autoEnabled: (owner: string | null) => boolean;
  private readonly currentOwner: () => string | null;
  private readonly online: () => Promise<boolean>;
  private running = new Map<string, Promise<OutboxRunResult>>();
  private sendingId: string | null = null;
  private listeners = new Set<() => void>();
  private lastRun: Record<string, { at: number; result: OutboxRunResult } | undefined> = {};
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: Deps = {}) {
    this.store = deps.store ? () => deps.store! : () => workoutRecorder.localStore();
    this.send = deps.send ?? ((meta) => workoutRecorder.syncMeta(meta));
    this.now = deps.now ?? (() => Date.now());
    this.autoEnabled = deps.autoEnabled ?? ((owner) => useSyncPrefs.getState().isAutoEnabled(owner));
    this.currentOwner = deps.currentOwner ?? (() => useWalletStore.getState().session?.address ?? null);
    this.online = deps.online ?? (async () => { try { const s = await Network.getNetworkStateAsync(); return s.isConnected !== false && s.isInternetReachable !== false; } catch { return true; } });
  }

  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit() { for (const l of this.listeners) l(); }

  /** 該玩家的佇列（含已排除；已 ACK 的不列） */
  list(owner: string | null): OutboxEntry[] {
    if (!owner) return [];
    const metas = this.store().list().filter((m) => isPendingMeta(m) && m.owner === owner).sort(outboxOrder);
    return metas.map((meta) => this.entryOf(meta));
  }
  /** 訪客紀錄（未綁定玩家）：需本人確認歸屬 */
  unassigned(): SessionMeta[] {
    return this.store().list().filter((m) => isPendingMeta(m) && !m.owner).sort(outboxOrder);
  }
  /** 使用者確認：把訪客紀錄歸屬到目前錢包（首次歸屬） */
  async assign(sessionIds: string[], owner: string) {
    for (const id of sessionIds) {
      const m = this.store().readMeta(id);
      if (!m || m.owner) continue;
      m.owner = owner;
      await this.store().writeMeta(m);
    }
    this.emit();
  }
  /** 永久無效項由使用者明確排除：保留原因與待審狀態，不增加統計／成就 */
  async exclude(sessionId: string, reason: string) {
    const m = this.store().readMeta(sessionId);
    if (!m) return;
    m.sync = { ...(m.sync ?? { attempt: 0, nextAttemptAt: null, lastError: null, revision: 1 }), excluded: { at: this.now(), reason } };
    m.status = 'needs_review';
    await this.store().writeMeta(m);
    this.emit();
  }
  async unexclude(sessionId: string) {
    const m = this.store().readMeta(sessionId);
    if (!m?.sync?.excluded) return;
    m.sync = { attempt: 0, nextAttemptAt: null, lastError: null, revision: m.sync.revision };
    await this.store().writeMeta(m);
    this.emit();
  }

  private entryOf(meta: SessionMeta): OutboxEntry {
    const s = meta.sync ?? { attempt: 0, nextAttemptAt: null, lastError: null, revision: 1 };
    const status: OutboxStatus = meta.syncedSessionId ? 'acked'
      : s.excluded ? 'excluded'
      : this.sendingId === meta.sessionId ? 'sending'
      : s.lastError && (s.lastError.code === 'NO_SESSION' || s.lastError.code === 'REJECTED') ? 'blocked'
      : s.lastError ? 'retry_wait'
      : 'queued';
    return { meta, status, attempt: s.attempt, nextAttemptAt: s.nextAttemptAt, lastError: s.lastError, revision: s.revision };
  }

  /** 摘要（畫面用）：待傳筆數、隊首是否卡住、最後一次結果 */
  summary(owner: string | null) {
    const list = this.list(owner);
    const pending = list.filter((e) => e.status !== 'excluded');
    const head = pending[0] ?? null;
    return { pending: pending.length, excluded: list.length - pending.length, head, running: !!owner && this.running.has(owner), lastRun: owner ? this.lastRun[owner] ?? null : null, unassigned: this.unassigned().length };
  }

  /**
   * 跑佇列：同一玩家只有一個 worker（重複呼叫回同一個 promise）。
   * `manual`：一次授權——忽略退避／blocked 直接從隊首重試，且不受自動同步開關影響（仍不跳過較早項）。
   * `target`：指定要送的那筆（畫面上的「立即同步」）；佇列仍從隊首開始，未輪到就回 BLOCKED_EARLIER。
   */
  run(owner: string, opts: { manual?: boolean; target?: string } = {}): Promise<OutboxRunResult> {
    const existing = this.running.get(owner);
    if (existing) return existing;
    const p = this.runLocked(owner, opts).finally(() => { if (this.running.get(owner) === p) this.running.delete(owner); this.emit(); });
    this.running.set(owner, p);
    this.emit();
    return p;
  }

  private async runLocked(owner: string, opts: { manual?: boolean; target?: string }): Promise<OutboxRunResult> {
    const result: OutboxRunResult = { sent: 0, stoppedAt: null };
    for (;;) {
      // 每一筆重新取件：晚到的更早紀錄會在目前在途項完成後插到前面（§3.2）
      const entry = this.list(owner).find((e) => e.status !== 'excluded');
      if (!entry) break;
      const { meta } = entry;
      if (!opts.manual) {
        if (!this.autoEnabled(owner)) { result.stoppedAt = { sessionId: meta.sessionId, outcome: { ok: false, code: 'DISABLED', message: 'auto sync off' } }; break; } // 中途關閉：不取下一筆
        if (entry.status === 'blocked') { result.stoppedAt = { sessionId: meta.sessionId, outcome: { ok: false, code: entry.lastError!.code as 'NO_SESSION' | 'REJECTED', message: entry.lastError!.message } }; break; }
        if (entry.status === 'retry_wait' && entry.nextAttemptAt !== null && entry.nextAttemptAt > this.now()) { result.stoppedAt = { sessionId: meta.sessionId, outcome: { ok: false, code: 'NETWORK_ERROR', message: entry.lastError?.message ?? 'retry later' } }; this.scheduleRetry(owner, entry.nextAttemptAt - this.now()); break; }
      }
      if (this.currentOwner() !== owner) { result.stoppedAt = { sessionId: meta.sessionId, outcome: { ok: false, code: 'NO_SESSION', message: 'wallet changed' } }; break; } // 換錢包：不把 A 的紀錄以 B 的 session 上傳
      this.sendingId = meta.sessionId;
      this.emit();
      let outcome: SyncOutcome;
      try { outcome = await this.send(meta); } catch (e) { outcome = { ok: false, code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }; }
      this.sendingId = null;
      const fresh = this.store().readMeta(meta.sessionId) ?? meta;
      if (outcome.ok && !fresh.syncedSessionId && !this.store().readMeta(meta.sessionId)?.syncedSessionId) {
        // 送出成功但本機沒記到伺服器 id（不該發生）：不能再取同一筆，否則會無限重送
        outcome = { ok: false, code: 'UNKNOWN', message: 'synced but not committed locally' };
      }
      if (outcome.ok) {
        result.sent += 1;
        if (fresh.sync?.lastError) { fresh.sync = { ...fresh.sync, lastError: null, nextAttemptAt: null }; await this.store().writeMeta(fresh); }
        void useSyncPrefs.getState().markSuccess(owner, this.now());
        if (opts.target === meta.sessionId) result.target = outcome;
        this.emit();
        continue;
      }
      const prev = fresh.sync ?? { attempt: 0, nextAttemptAt: null, lastError: null, revision: 1 };
      const transient = outcome.code === 'NETWORK_ERROR' || outcome.code === 'UNKNOWN';
      const attempt = transient ? prev.attempt + 1 : prev.attempt;
      fresh.sync = { ...prev, attempt, nextAttemptAt: transient ? this.now() + backoffMs(attempt) : null, lastError: { code: outcome.code, message: outcome.message } };
      await this.store().writeMeta(fresh);
      result.stoppedAt = { sessionId: meta.sessionId, outcome };
      if (opts.target === meta.sessionId) result.target = outcome;
      if (transient && !opts.manual && this.autoEnabled(owner)) this.scheduleRetry(owner, backoffMs(attempt));
      this.emit();
      break;
    }
    if (opts.target && !result.target) {
      const still = this.list(owner).find((e) => e.meta.sessionId === opts.target);
      result.target = still ? (still.status === 'excluded' ? { ok: false, code: 'EXCLUDED', message: still.meta.sync?.excluded?.reason ?? 'excluded' } : { ok: false, code: 'BLOCKED_EARLIER', message: result.stoppedAt?.outcome.ok === false ? result.stoppedAt.outcome.message : 'earlier workout pending' }) : { ok: true };
    }
    this.lastRun[owner] = { at: this.now(), result };
    return result;
  }

  private scheduleRetry(owner: string, delayMs: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const timer = setTimeout(() => { this.retryTimer = null; void this.kick('network'); }, Math.max(250, delayMs));
    (timer as unknown as { unref?: () => void }).unref?.();
    this.retryTimer = timer;
  }

  /** 自動入口（結束運動／重開 App／回前景／網路恢復／開啟開關）：只在該玩家已開啟自動同步且可連線時啟動 */
  async kick(reason: OutboxKickReason): Promise<OutboxRunResult | null> {
    const owner = this.currentOwner();
    if (!owner || !this.autoEnabled(owner)) return null;
    if (reason !== 'finish' && !(await this.online())) return null;
    if (!this.list(owner).some((e) => e.status !== 'excluded')) return null;
    return this.run(owner);
  }

  /** 結束運動後（recorder 掛鉤）：自動同步開啟才上傳；關閉時只保存本機並回 DISABLED */
  async afterFinish(meta: SessionMeta): Promise<SyncOutcome> {
    const owner = meta.owner ?? null;
    if (!owner || !this.autoEnabled(owner)) return { ok: false, code: 'DISABLED', message: 'auto sync off' };
    const r = await this.run(owner, { target: meta.sessionId });
    return r.target ?? { ok: false, code: 'UNKNOWN', message: 'not processed' };
  }

  /** 安裝自動入口：回前景、網路恢復（只裝一次）；回傳解除函式 */
  installTriggers(): () => void {
    if (this.uninstall) return this.uninstall;
    const app = AppState.addEventListener('change', (s: AppStateStatus) => { if (s === 'active') void this.kick('foreground'); });
    let net: { remove: () => void } | null = null;
    try { net = Network.addNetworkStateListener((s) => { if (s.isConnected && s.isInternetReachable !== false) void this.kick('network'); }); } catch { /* 無原生實作（測試） */ }
    this.uninstall = () => { app.remove(); net?.remove(); this.uninstall = null; };
    return this.uninstall;
  }
  private uninstall: (() => void) | null = null;
}

export const workoutOutbox = new WorkoutOutbox();
workoutRecorder.setAfterFinish((meta) => workoutOutbox.afterFinish(meta));
