/**
 * PG-SEASON-01／02 的讀取面：目錄（不需登入）與本人資格（需登入）。
 *
 * 這一版只回「狀態」，不發資格憑證也不能鑄造——seasonal 的 registry／mint 路徑是
 * PG-SEASON-04，鏈上相容性尚未確認。因此回應裡刻意沒有任何 mintable／achievement 欄位，
 * 免得 App 把「已達標」誤當成「已取得 NFT」（設計文件 §4.3）。
 */
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import type { Store } from "../store/types.js";
import type { SeasonalCampaign } from "./campaigns.js";
import { resolveSeasonal, windowStateOf, type SeasonalCandidate, type SeasonalResolution, type WorkoutForSeasonal } from "./compute.js";

export class SeasonalService {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
    readonly campaigns: readonly SeasonalCampaign[],
    private readonly gpsMinRulesVersion: number | null,
  ) {}

  /** 目錄只列已啟用的屆次；未啟用（來源尚未核對完成）不對外出現 */
  catalogue(): { campaign: SeasonalCampaign; windowState: ReturnType<typeof windowStateOf> }[] {
    const now = this.now();
    return this.campaigns.filter((c) => c.enabled).map((c) => ({ campaign: c, windowState: windowStateOf(c, now) }));
  }

  async resolve(wallet: string): Promise<SeasonalResolution[]> {
    const workouts = await this.store.listWorkouts(wallet, 1000, 0);
    const forSeasonal: WorkoutForSeasonal[] = workouts.map((w) => ({
      sessionId: w.sessionId,
      sourceRevision: w.sourceRevision,
      sport: w.sport,
      origin: w.origin,
      status: w.status,
      quality: w.quality,
      rulesVersion: w.rulesVersion,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      elapsedMs: w.elapsedMs,
      pausedMs: w.pausedMs,
      importedAt: w.importedAt,
    }));
    return resolveSeasonal(this.campaigns, forSeasonal, this.now(), this.gpsMinRulesVersion);
  }

  get gpsCounts(): boolean {
    return this.gpsMinRulesVersion !== null;
  }
}

const campaignView = (c: SeasonalCampaign, state: string, gpsCounts: boolean) => ({
  campaign_id: c.campaignId,
  theme_id: c.themeId,
  year: c.year,
  art_version: c.artVersion,
  rules_version: c.rulesVersion,
  /** 測試窗口一律標出來，避免 Demo 的畫面被當成真實節日紀錄 */
  prototype: c.prototype,
  window: { starts_at: c.startsAt.toISOString(), ends_at: c.endsAt.toISOString(), display_timezone: c.displayTimezone, state },
  rules: {
    min_moving_minutes: Math.round(c.minMovingMs / 60_000),
    grace_days: Math.round(c.graceMs / 86_400_000),
    single_session: true,
    gps_counts: gpsCounts,
  },
  source: { fact: c.source.fact, url: c.source.url, checked_on: c.source.checkedOn },
  /** 這一版只判定資格，尚未開放鑄造（PG-SEASON-04） */
  mint_enabled: false,
});

const candidateView = (x: SeasonalCandidate) => ({ source: { kind: "workout", id: x.sessionId, revision: x.sourceRevision }, started_at: x.startedAt.toISOString(), moving_ms: x.movingMs });

export async function seasonalRoutes(app: FastifyInstance, opts: { auth: AuthService; seasonal: SeasonalService }) {
  app.get("/seasonal", async () => ({
    items: opts.seasonal.catalogue().map(({ campaign, windowState }) => campaignView(campaign, windowState, opts.seasonal.gpsCounts)),
  }));

  app.get("/me/seasonal", { preHandler: requireAuth(opts.auth) }, async (req) => {
    const items = await opts.seasonal.resolve(req.auth!.wallet);
    return {
      items: items.map((r) => ({
        ...campaignView(r.campaign, r.windowState, opts.seasonal.gpsCounts),
        status: r.status,
        first: r.first ? candidateView(r.first) : null,
        pending: r.pending ? candidateView(r.pending) : null,
        progress: { best_moving_ms: r.bestMovingMs, required_ms: r.campaign.minMovingMs },
        reason: r.first ? null : (r.pending?.reason ?? null),
      })),
      notes: ["eligibility_only_no_mint_path_yet", "single_session_strict", "window_by_workout_time_grace_by_upload_time"],
    };
  });
}
