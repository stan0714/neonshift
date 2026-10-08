/**
 * PG-SEASON-02：節日章資格判定（docs/design/seasonal-achievement-nfts.md §5）。純函式。
 *
 * 首版是**嚴格單筆**：同一筆運動的開始與結束都要落在 `[starts_at, ends_at)` 內，
 * moving time（elapsed − paused）≥ 門檻。多筆不能拼滿門檻，跨窗口不算。
 * 窗口本身依「運動發生時間」判定，上傳寬限只放寬「什麼時候同步上來」。
 *
 * 一屆一枚：多筆合格時取最早開始的那筆（同時間以 sessionId 穩定排序），
 * 重匯入、改時區、換鞋、重複按鍵都不會換來源，也不會多發一枚。
 */
import type { SeasonalCampaign } from "./campaigns.js";

export type WorkoutForSeasonal = {
  sessionId: string;
  sourceRevision: number;
  sport: "run" | "walk";
  origin: "health_connect" | "device" | "gps" | "organizer" | "manual";
  status: "saved" | "needs_review" | "invalid" | "deleted";
  quality: "complete" | "partial" | "estimated" | "needs_review" | "invalid";
  rulesVersion: number;
  startedAt: Date;
  endedAt: Date;
  elapsedMs: bigint;
  pausedMs: bigint;
  /** 伺服器收到的時間：只用來判斷上傳寬限，不用來判斷是否在活動窗口內 */
  importedAt: Date;
};

/** 不合格原因（同時是 UI 說明碼；不合格不代表資料有問題） */
export type SeasonalReason =
  | "outside_window"
  | "too_short"
  | "needs_review"
  | "estimated"
  | "manual"
  | "gps_rules_pending"
  | "late_upload"
  | "deleted";

export type SeasonalCandidate = {
  campaignId: string;
  sessionId: string;
  sourceRevision: number;
  startedAt: Date;
  movingMs: number;
  eligible: boolean;
  reason: SeasonalReason | null;
};

/** 活動狀態：upcoming → open → grace（窗口結束但還收補同步）→ closed */
export type SeasonalWindowState = "upcoming" | "open" | "grace" | "closed";

export type SeasonalStatus = "locked" | "pending_review" | "eligible";

export type SeasonalResolution = {
  campaign: SeasonalCampaign;
  windowState: SeasonalWindowState;
  status: SeasonalStatus;
  /** eligible 時的來源（該屆唯一一枚的來源） */
  first: SeasonalCandidate | null;
  /** 只因待審而還不算的最早一筆（不揭露為已取得） */
  pending: SeasonalCandidate | null;
  /** 窗口內最長的 moving time（毫秒）；讓詳情頁顯示「本次有效運動時間」而不是只給倒數 */
  bestMovingMs: number;
};

export function windowStateOf(c: SeasonalCampaign, now: Date): SeasonalWindowState {
  const t = now.getTime();
  if (t < c.startsAt.getTime()) return "upcoming";
  if (t < c.endsAt.getTime()) return "open";
  return t < c.endsAt.getTime() + c.graceMs ? "grace" : "closed";
}

const movingMsOf = (w: WorkoutForSeasonal) => Number(w.elapsedMs - w.pausedMs);

/**
 * 單筆對單屆的判定。gpsMinRulesVersion 與每日任務用同一道門檻：
 * GPS 品質規則版本未開放時不發資格（否則卡片會說會算、實際永遠不合格）。
 */
export function candidateFor(c: SeasonalCampaign, w: WorkoutForSeasonal, gpsMinRulesVersion: number | null): SeasonalCandidate | null {
  if (w.sport !== "run" && w.sport !== "walk") return null;
  const moving = movingMsOf(w);
  const base = { campaignId: c.campaignId, sessionId: w.sessionId, sourceRevision: w.sourceRevision, startedAt: w.startedAt, movingMs: moving };
  // 窗口比對用運動發生時間；ends_at 為排除端點（跨午夜／跨窗口都不算）
  const inWindow = w.startedAt.getTime() >= c.startsAt.getTime() && w.endedAt.getTime() < c.endsAt.getTime();
  if (!inWindow) return { ...base, eligible: false, reason: "outside_window" };
  if (w.status === "deleted" || w.status === "invalid") return { ...base, eligible: false, reason: "deleted" };
  if (moving < c.minMovingMs) return { ...base, eligible: false, reason: "too_short" };
  if (w.origin === "manual") return { ...base, eligible: false, reason: "manual" };
  if (w.quality === "estimated") return { ...base, eligible: false, reason: "estimated" };
  if (w.status === "needs_review" || w.quality === "needs_review") return { ...base, eligible: false, reason: "needs_review" };
  if (w.origin === "gps" && (gpsMinRulesVersion === null || w.rulesVersion < gpsMinRulesVersion)) return { ...base, eligible: false, reason: "gps_rules_pending" };
  // 上傳寬限：按時運動、晚一點同步仍算；伺服器處理延誤不該取消資格
  if (w.importedAt.getTime() > c.endsAt.getTime() + c.graceMs) return { ...base, eligible: false, reason: "late_upload" };
  return { ...base, eligible: true, reason: null };
}

const byStart = (a: SeasonalCandidate, b: SeasonalCandidate) => a.startedAt.getTime() - b.startedAt.getTime() || a.sessionId.localeCompare(b.sessionId);

export function resolveSeasonal(campaigns: readonly SeasonalCampaign[], workouts: readonly WorkoutForSeasonal[], now: Date, gpsMinRulesVersion: number | null): SeasonalResolution[] {
  return campaigns
    .filter((c) => c.enabled)
    .map((c) => {
      const cands = workouts.map((w) => candidateFor(c, w, gpsMinRulesVersion)).filter((x): x is SeasonalCandidate => x !== null && x.reason !== "outside_window");
      const eligible = cands.filter((x) => x.eligible).sort(byStart);
      const pending = cands.filter((x) => x.reason === "needs_review").sort(byStart);
      return {
        campaign: c,
        windowState: windowStateOf(c, now),
        status: eligible.length ? "eligible" : pending.length ? "pending_review" : "locked",
        first: eligible[0] ?? null,
        pending: eligible.length ? null : (pending[0] ?? null),
        bestMovingMs: cands.reduce((m, x) => (x.movingMs > m ? x.movingMs : m), 0),
      } satisfies SeasonalResolution;
    });
}
