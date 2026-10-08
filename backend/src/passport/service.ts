/**
 * XD-03 成就護照（mobile-differentiation 4.3）：跨 PB／里程碑／活動章／探索任務的只讀旅程視圖。
 * - 只引用既有 achievement_id／pb_id／milestone key／quest receipt／event-history，不複製健康資料；不含路線、座標、健康數字。
 * - 每項標示來源分類（organizer 主辦確認／device 裝置紀錄／pending 待驗證）、規則版本、目前有效狀態（valid／pending／revoked／locked）、
 *   公開狀態（public_consent）與 NFT 資產（若已鑄）。estimated／needs_review 永不標為 verified。
 * - 撤銷後更新有效狀態；鏈上 NFT 留作歷史（asset 仍列出、validity=revoked）。
 * 信任邊界：裝置紀錄＝手機感測器摘要經伺服器規則檢查，不是「硬體證明真實運動」；主辦確認＝主辦方發布的成績。
 */
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import type { EventBadgeService } from "../milestones/eventBadges.js";
import type { MilestoneService } from "../milestones/service.js";
import type { PersonalBestService } from "../pb/service.js";
import type { QuestService } from "../quests/service.js";
import type { Achievement, Store } from "../store/types.js";

export type PassportSourceClass = "organizer" | "device" | "pending";
export type PassportValidity = "valid" | "pending" | "revoked" | "locked";
export type PassportEntry = {
  id: string;
  kind: "pb" | "milestone" | "event_badge" | "quest";
  category: string;
  title_key: string;
  /** 主辦確認／裝置紀錄／待驗證 */
  source_class: PassportSourceClass;
  source: { kind: string; id: string; revision: number } | null;
  rules_version: string;
  achieved_at: string | null;
  validity: PassportValidity;
  /** 撤銷／待審原因（可顯示） */
  reason: string | null;
  public: boolean;
  nft: { status: Achievement["status"]; asset: string | null; achievement_id: string } | null;
  /** 原達成者（NFT 轉移不轉移資格；本護照永遠是本人） */
  original_holder: "you";
};

const cls = (verification: "organizer" | "device", pending: boolean): PassportSourceClass => (pending ? "pending" : verification);

export class PassportService {
  constructor(private readonly store: Store, private readonly pbs: PersonalBestService, private readonly milestones: MilestoneService, private readonly eventBadges: EventBadgeService, private readonly quests: QuestService) {}

  async build(wallet: string): Promise<{ entries: PassportEntry[]; counts: Record<PassportValidity, number> }> {
    const [pbRows, ms, badges, questList, cosmetics, achievements] = await Promise.all([
      this.pbs.recompute(wallet), this.milestones.resolve(wallet), this.eventBadges.resolve(wallet), this.quests.reevaluate(wallet), this.store.listCosmetics(wallet), this.store.listAchievements(wallet),
    ]);
    const byPb = new Map(achievements.filter((a) => a.pbId).map((a) => [a.pbId!, a]));
    const byKey = new Map(achievements.filter((a) => a.milestoneKey).map((a) => [a.milestoneKey!, a]));
    const nftOf = (a: Achievement | undefined) => (a ? { status: a.status, asset: a.asset, achievement_id: a.achievementId } : null);
    const revokedNft = (a: Achievement | undefined) => a?.status === "revoked" || a?.status === "revoke_pending";
    const entries: PassportEntry[] = [];

    for (const p of pbRows.filter((x) => x.status === "current")) {
      const a = byPb.get(p.pbId);
      entries.push({ id: `pb:${p.pbId}`, kind: "pb", category: p.category, title_key: `pb.cat.${p.category}`, source_class: cls(p.verificationClass as "organizer" | "device", false), source: { kind: p.sourceKind, id: p.sourceId, revision: p.sourceRevision }, rules_version: `pb/${p.rulesMajor}`, achieved_at: p.achievedAt.toISOString(), validity: revokedNft(a) ? "revoked" : "valid", reason: null, public: a?.publicConsent ?? false, nft: nftOf(a), original_holder: "you" });
    }
    for (const m of ms.resolutions) {
      if (m.status === "locked") continue;
      const a = byKey.get(m.key);
      const src = m.first ?? m.pending;
      const pending = m.status !== "eligible";
      entries.push({ id: `milestone:${m.key}`, kind: "milestone", category: m.category, title_key: `ms.cat.${m.category}`, source_class: cls(m.verificationClass, pending), source: src ? { kind: src.sourceKind, id: src.sourceId, revision: src.sourceRevision } : null, rules_version: `milestone/${m.rulesMajor}`, achieved_at: src?.achievedAt?.toISOString() ?? null, validity: revokedNft(a) ? "revoked" : pending ? "pending" : "valid", reason: pending ? (m.pending?.reason ?? m.status) : null, public: a?.publicConsent ?? false, nft: nftOf(a), original_holder: "you" });
    }
    for (const b of badges) {
      if (b.status === "locked" || b.status === "cancelled") continue;
      const a = byKey.get(b.key);
      const locked = b.status === "level_locked";
      entries.push({ id: `event:${b.key}`, kind: "event_badge", category: b.category, title_key: `evb.cat.${b.kind}`, source_class: "organizer", source: b.source ? { kind: b.source.kind, id: b.source.id, revision: b.source.revision } : null, rules_version: "event/1", achieved_at: b.source?.achievedAt?.toISOString() ?? null, validity: revokedNft(a) ? "revoked" : locked ? "locked" : "valid", reason: locked ? "level_locked" : null, public: a?.publicConsent ?? false, nft: nftOf(a), original_holder: "you" });
    }
    for (const q of questList) {
      const e = q.enrollment;
      if (e.status !== "claimed" && e.status !== "revoked" && e.status !== "completed") continue;
      const c = cosmetics.find((x) => x.cosmeticId === q.template.cosmeticId);
      const first = q.evaluation.contributions[0];
      entries.push({ id: `quest:${e.enrollmentId}`, kind: "quest", category: q.template.templateId, title_key: `explore.cosmetic.${q.template.cosmeticId}`, source_class: "device", source: first ? { kind: first.sourceKind, id: first.sourceId, revision: first.sourceRevision } : null, rules_version: `quest/${e.templateVersion}`, achieved_at: e.completedAt?.toISOString() ?? null, validity: e.status === "revoked" || c?.status === "revoked" ? "revoked" : e.status === "completed" ? "pending" : "valid", reason: e.status === "revoked" ? "source_removed_or_corrected" : e.status === "completed" ? "not_claimed" : null, public: false, nft: null, original_holder: "you" });
    }
    entries.sort((a, b) => (b.achieved_at ?? "").localeCompare(a.achieved_at ?? ""));
    const counts: Record<PassportValidity, number> = { valid: 0, pending: 0, revoked: 0, locked: 0 };
    for (const e of entries) counts[e.validity]++;
    return { entries, counts };
  }
}

export async function passportRoutes(app: FastifyInstance, opts: { auth: AuthService; passport: PassportService }) {
  app.get("/me/passport", { preHandler: requireAuth(opts.auth) }, async (req) => {
    const r = await opts.passport.build(req.auth!.wallet);
    return { ...r, trust_note: "device_records_are_sensor_summaries_checked_by_server_rules_not_hardware_proof" };
  });
}
