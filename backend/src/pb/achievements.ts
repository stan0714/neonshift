/**
 * 成就 NFT 簽發（PG-R-08；activity-running-gallery 7、SD 13／15、BR-39／40）。
 * - achievement_id 伺服器穩定分配（sha256("neonshift-achievement|"+wallet+"|"+pb_id)），重試沿用，不由 client 自選。
 * - metadata 先 canonical 化並 hash，簽章綁定 metadata_hash；精確數值只在該次明確公開同意時寫入（BR-40）。
 * - 鑄造前需 admin 把 registry 寫上鏈（approved）；來源修正／刪除 → revoke_pending，由 ops 推上鏈後 revoked；已鑄造只標記不刪。
 * - 證明 194 bytes（NEONSHIFT_ACHIEVEMENT_V1）由 attestor 簽章，15 分鐘有效；費用（rent）明示揭露。
 * - PG-M-02 首次里程碑：achievement_id = sha256("neonshift-milestone|"+wallet+"|"+key)，key = category|environment|class（BR-47）；
 *   來源更正／更早回填／失效後重新達標都沿用同一 id（未鑄造重建 metadata、已鑄造只更新來源與有效性），終身只鑄一枚。
 */
import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { canonicalize, type Json } from "../claim/canonical.js";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { ACHIEVEMENT_MAX_TTL_SECONDS, ACHIEVEMENT_VERSION, CHAIN_CLOCK_SKEW_SECONDS, CATEGORY_CODE, CLASS_CODE, encodeAchievement, type AchievementProof } from "../lib/achievement.js";
import { MILESTONE_RULES_MAJOR, type MilestoneCandidate, type MilestoneResolution } from "../milestones/compute.js";
import { EVENT_BADGE_RULES_MAJOR, eventBadgeKeyOf, eventBadgeView, type EventBadgeResolution, type EventBadgeService } from "../milestones/eventBadges.js";
import type { MilestoneService } from "../milestones/service.js";
import type { SeasonalService } from "../seasonal/service.js";
import type { AttestorSigner } from "../signer/types.js";
import type { Achievement, PbRevision, Store } from "../store/types.js";
import type { PersonalBestService } from "./service.js";

/** PG-V-03：PB NFT 需達成當日 Active level ≥ 3（shoe-gameplay 2、5）；無可查歷史 → 只保留私人 PB */
export const PB_NFT_MIN_LEVEL = 3;
export type PbNftEligibility = { status: "eligible" | "level_required" | "history_unknown"; level: number | null; required: number; effective_from: number | null };
const dayOfDate = (d: Date) => Math.floor(d.getTime() / 86_400_000);
export async function pbNftEligibility(store: Store, wallet: string, achievedAt: Date): Promise<PbNftEligibility> {
  const h = await store.levelAt(wallet, dayOfDate(achievedAt));
  if (!h) return { status: "history_unknown", level: null, required: PB_NFT_MIN_LEVEL, effective_from: null };
  return { status: h.activeLevel >= PB_NFT_MIN_LEVEL ? "eligible" : "level_required", level: h.activeLevel, required: PB_NFT_MIN_LEVEL, effective_from: h.effectiveFromDate };
}

/** 估算玩家需付的 rent（receipt ≈ 119 bytes、Core asset ≈ 200 bytes）＋手續費；實際以鏈上為準 */
export const MINT_FEE_ESTIMATE_LAMPORTS = 3_500_000;
const IMAGE_BASE = "https://neonshift.cc/nft/achievements/";

export const achievementIdOf = (wallet: string, pbId: string) => createHash("sha256").update(`neonshift-achievement|${wallet}|${pbId}`).digest("hex");
/** PG-M-02：穩定 key 派生，不含來源／revision／規則版本／年份 */
export const milestoneAchievementIdOf = (wallet: string, key: string) => createHash("sha256").update(`neonshift-milestone|${wallet}|${key}`).digest("hex");
/** PG-M-04：活動留念章 key＝event|<event_id>|<kind>（與首次章不同 namespace） */
export const eventBadgeAchievementIdOf = (wallet: string, key: string) => createHash("sha256").update(`neonshift-event-badge|${wallet}|${key}`).digest("hex");
/** PG-SEASON-04：節日收藏 key＝seasonal|<campaign_id>（每屆一個 namespace，跨年份不共用） */
export const seasonalAchievementIdOf = (wallet: string, campaignId: string) => createHash("sha256").update(`neonshift-seasonal|${wallet}|${campaignId}`).digest("hex");
export const seasonalKeyOf = (campaignId: string) => `seasonal|${campaignId}`;
export const parseSeasonalKey = (key: string): string | null => (key.startsWith("seasonal|") ? key.slice("seasonal|".length) || null : null);

const categoryLabel: Record<string, string> = { fastest_1k: "Fastest 1K", fastest_5k: "Fastest 5K", fastest_10k: "Fastest 10K", fastest_half: "Fastest Half Marathon", fastest_marathon: "Fastest Marathon", longest_run: "Longest Run" };
/** 首次里程碑作品名（commemorative-nfts 1） */
const milestoneLabel: Record<string, { title: string; name: string }> = {
  first_5k: { title: "First 5K", name: "First Spark" }, first_10k: { title: "First 10K", name: "Double Horizon" }, first_half: { title: "First Half Marathon", name: "Halfway to Infinity" }, first_marathon: { title: "First Marathon", name: "Marathon Genesis" }, first_finish: { title: "First Finish", name: "First Finish" },
};
const fmtMs = (ms: bigint) => { const s = Number(ms / 1000n); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`; };

/** canonical metadata（Metaplex JSON 標準子集）；未同意公開時不含精確數值與日期 */
export function buildMetadata(pb: PbRevision, achievementId: string, publicConsent: boolean, capability: { active_level: number; effective_from: number } | null = null): Record<string, Json> {
  const cls = pb.verificationClass === "organizer" ? "Official" : "Device";
  const attrs: Json[] = [
    { trait_type: "Category", value: categoryLabel[pb.category] ?? pb.category },
    { trait_type: "Verification", value: cls },
    { trait_type: "Environment", value: pb.environment },
    { trait_type: "Record", value: pb.isBaseline ? "Baseline" : "Improved" },
    { trait_type: "Rules", value: `v${pb.rulesMajor}` },
  ];
  if (publicConsent) {
    attrs.push({ trait_type: pb.category === "longest_run" ? "Distance" : "Time", value: pb.category === "longest_run" ? `${(Number(pb.value) / 1_000_000).toFixed(2)} km` : fmtMs(pb.value) });
    attrs.push({ trait_type: "Achieved", value: pb.achievedAt.toISOString().slice(0, 10) });
  }
  return {
    name: `NeonShift PB · ${categoryLabel[pb.category] ?? pb.category} (${cls})`,
    symbol: "NSPB",
    description: publicConsent ? `Personal best verified by NeonShift (${cls.toLowerCase()} record). Value shared by the runner.` : "Personal best verified by NeonShift. Exact value kept private by the runner.",
    image: `${IMAGE_BASE}${pb.category}-${pb.verificationClass}.svg`,
    external_url: `https://neonshift.cc/nft/achievements/${achievementId}`,
    attributes: attrs,
    // PG-V-03：能力快照綁進 metadata commitment（簽章綁 metadata_hash），不信任 client 自報歷史等級
    properties: { category: "image", achievement_id: achievementId, public: publicConsent, ...(capability ? { capability } : {}) },
  };
}
export const metadataHashOf = (m: Record<string, Json>) => createHash("sha256").update(canonicalize(m)).digest();

/** PG-M-02 canonical metadata：預設只公開類別、門檻、驗證等級、環境；精確距離／日期須逐次公開同意。不含 GPS／體重／心率／卡路里 */
export function buildMilestoneMetadata(m: MilestoneResolution, first: MilestoneCandidate, achievementId: string, publicConsent: boolean): Record<string, Json> {
  const cls = m.verificationClass === "organizer" ? "Official" : "Device";
  const label = milestoneLabel[m.category] ?? { title: m.category, name: m.category };
  const attrs: Json[] = [
    { trait_type: "Series", value: m.category === "first_finish" ? "First Finish" : "Genesis Distance" },
    { trait_type: "Milestone", value: label.title },
    { trait_type: "Verification", value: cls },
    { trait_type: "Environment", value: m.environment },
    { trait_type: "Rules", value: `v${m.rulesMajor}` },
  ];
  if (m.thresholdMm !== null) attrs.push({ trait_type: "Threshold", value: `${(Number(m.thresholdMm) / 1_000_000).toFixed(m.category === "first_half" ? 4 : 3)} km` });
  if (publicConsent) {
    attrs.push({ trait_type: "Distance", value: `${(Number(first.distanceMm) / 1_000_000).toFixed(3)} km` });
    if (first.achievedAt) attrs.push({ trait_type: "Achieved", value: first.achievedAt.toISOString().slice(0, 10) });
  }
  return {
    name: `NeonShift · ${label.name} (${cls})`,
    symbol: "NSMS",
    description: m.verificationClass === "organizer"
      ? `${label.title} confirmed by an event organizer and recorded by NeonShift. Not an official race certification.${publicConsent ? " Details shared by the runner." : ""}`
      : `${label.title} recorded on the runner's device and verified by NeonShift rules. Device recorded distance, not an official race.${publicConsent ? " Details shared by the runner." : " Exact details kept private by the runner."}`,
    image: `${IMAGE_BASE}milestones/${m.category}-${m.verificationClass}.svg`,
    external_url: `https://neonshift.cc/nft/achievements/${achievementId}`,
    attributes: attrs,
    properties: { category: "image", achievement_id: achievementId, milestone_key: m.key, public: publicConsent },
  };
}

/** PG-M-04 canonical metadata：活動名稱為公開資訊；精確完賽時間／名次只在公開同意時寫入；不含主辦方商標 */
export function buildEventBadgeMetadata(b: EventBadgeResolution, achievementId: string, publicConsent: boolean): Record<string, Json> {
  const kindLabel = b.kind === "check_in" ? "Check-in" : "Finisher";
  const attrs: Json[] = [
    { trait_type: "Series", value: "Event Memory" },
    { trait_type: "Badge", value: kindLabel },
    { trait_type: "Event", value: b.event.title },
    { trait_type: "Verification", value: "Official" },
    { trait_type: "Rules", value: `v${EVENT_BADGE_RULES_MAJOR}` },
  ];
  if (b.event.startsAt) attrs.push({ trait_type: "Event date", value: b.event.startsAt.toISOString().slice(0, 10) });
  if (publicConsent && b.source?.result) {
    attrs.push({ trait_type: "Time", value: fmtMs(BigInt(b.source.result.elapsedMs)) });
    if (b.source.result.rank !== null) attrs.push({ trait_type: "Rank", value: String(b.source.result.rank) });
  }
  return {
    name: `NeonShift · ${b.event.title} · ${kindLabel}`,
    symbol: "NSEV",
    description: b.kind === "check_in" ? `Checked in at ${b.event.title}, confirmed by the organizer and recorded by NeonShift.` : `Finished ${b.event.title}, confirmed by the organizer's published results and recorded by NeonShift. Not an official race certification.${publicConsent ? " Details shared by the runner." : ""}`,
    image: `${IMAGE_BASE}milestones/event-${b.kind}.svg`,
    external_url: `https://neonshift.cc/nft/achievements/${achievementId}`,
    attributes: attrs,
    properties: { category: "image", achievement_id: achievementId, event_id: b.eventId, badge_kind: b.kind, public: publicConsent },
  };
}

/**
 * PG-SEASON-04 canonical metadata：**主題與年份寫在這裡**，不在鏈上 category。
 *
 * 鏈上整個系列只有一個 category（`CATEGORY_SEASONAL`），名稱是系列名；能區分「哪一屆」的
 * 是每一枚自己的 metadata URI（以 achievement_id 為檔名）。這樣每年新增主題不必升級程式。
 *
 * 預設只公開**公開資訊**：主題、年份、活動窗口、規則／美術版本、驗證等級與日期依據。
 * 使用者自己達標的時間屬私人詳情，只有逐次公開同意才寫入（設計 §4.5／§5）。
 * 不含 Activity ID、起終點、GPS 與錢包。
 */
export function buildSeasonalMetadata(
  c: { campaignId: string; themeId: string; year: number; artVersion: number; rulesVersion: number; startsAt: Date; endsAt: Date; displayTimezone: string; minMovingMs: number; source: { fact: string; url: string } },
  first: { startedAt: Date } | null,
  achievementId: string,
  publicConsent: boolean,
): Record<string, Json> {
  const theme = c.themeId.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const attrs: Json[] = [
    { trait_type: "Series", value: "Seasonal Footprints" },
    { trait_type: "Edition", value: `${theme} ${c.year}` },
    { trait_type: "Theme", value: theme },
    { trait_type: "Year", value: String(c.year) },
    // 活動窗口是公開主題（節日日期本身就是公開的），與「使用者何時達標」是兩件事
    { trait_type: "Window", value: `${c.startsAt.toISOString().slice(0, 10)} → ${new Date(c.endsAt.getTime() - 1).toISOString().slice(0, 10)} (${c.displayTimezone})` },
    { trait_type: "Requirement", value: `${Math.round(c.minMovingMs / 60_000)} min moving time, single session` },
    { trait_type: "Verification", value: "Device" },
    { trait_type: "Art", value: `v${c.artVersion}` },
    { trait_type: "Rules", value: `v${c.rulesVersion}` },
  ];
  if (publicConsent && first) attrs.push({ trait_type: "Earned", value: first.startedAt.toISOString().slice(0, 10) });
  return {
    name: `NeonShift · ${theme} ${c.year}`,
    symbol: "NSSF",
    description: `Seasonal Footprints ${c.year}: one walk or run with ${Math.round(c.minMovingMs / 60_000)} minutes of moving time inside the published window, recorded on the runner's device and verified by NeonShift rules. Walking counts. Date reference: ${c.source.fact}.${publicConsent ? " Earned date shared by the runner." : " Earned date kept private by the runner."}`,
    image: `${IMAGE_BASE}seasonal/${c.themeId}-${c.year}.svg`,
    external_url: `https://neonshift.cc/nft/achievements/${achievementId}`,
    attributes: attrs,
    properties: { category: "image", achievement_id: achievementId, campaign_id: c.campaignId, theme_id: c.themeId, year: c.year, source_url: c.source.url, public: publicConsent },
  };
}

export class AchievementService {
  constructor(private readonly store: Store, private readonly config: AppConfig, private readonly signer: AttestorSigner, private readonly now: () => Date, private readonly milestones: MilestoneService | null = null, private readonly eventBadges: EventBadgeService | null = null, private readonly seasonal: SeasonalService | null = null) {}

  /** 依 PB 建立／更新成就（冪等）；PB 需為 current／historical */
  async ensure(wallet: string, pbId: string, publicConsent: boolean): Promise<{ achievement: Achievement; pb: PbRevision }> {
    const pb = (await this.store.listPbRevisions(wallet)).find((p) => p.pbId === pbId);
    if (!pb) throw new ApiError(404, "NOT_FOUND", "personal best not found");
    if (pb.status === "invalidated") throw new ApiError(409, "ACHIEVEMENT_INVALIDATED", "this record was corrected or deleted");
    // PG-V-03：達成時的有效等級 ≥ Lv3（用歷史，不用現在等級）；歷史缺失不自動授予
    const cap = await pbNftEligibility(this.store, wallet, pb.achievedAt);
    if (cap.status === "history_unknown") throw new ApiError(409, "LEVEL_HISTORY_UNKNOWN", "no level history for the day this record was achieved; the personal best stays private");
    if (cap.status === "level_required") throw new ApiError(409, "LEVEL_REQUIRED", `personal best NFTs need Lv${PB_NFT_MIN_LEVEL} at the time of the record (you were Lv${cap.level})`);
    const achievementId = achievementIdOf(wallet, pbId);
    const metadata = buildMetadata(pb, achievementId, publicConsent, { active_level: cap.level!, effective_from: cap.effective_from! });
    const achievement = await this.store.upsertAchievement({ achievementId, wallet, kind: "pb", pbId, milestoneKey: null, sourceKind: pb.sourceKind, sourceId: pb.sourceId, category: pb.category, verificationClass: pb.verificationClass as "organizer" | "device", sourceRevision: pb.sourceRevision, rulesMajor: pb.rulesMajor, publicConsent, metadata, metadataHash: metadataHashOf(metadata), status: "pending_registry", registrySignature: null, registryUpdatedAt: null, asset: null, mintedSignature: null, mintedAt: null }, this.now());
    return { achievement, pb };
  }

  /** PG-M-02：依穩定 key 建立／更新里程碑成就（冪等；key 需 eligible） */
  async ensureMilestone(wallet: string, key: string, publicConsent: boolean): Promise<{ achievement: Achievement; milestone: MilestoneResolution }> {
    if (!this.milestones) throw new ApiError(503, "MILESTONES_UNAVAILABLE", "milestones not configured");
    const { resolutions } = await this.milestones.resolve(wallet);
    const m = resolutions.find((x) => x.key === key);
    if (!m) throw new ApiError(404, "NOT_FOUND", "milestone not found");
    if (m.status !== "eligible" || !m.first) throw new ApiError(409, "MILESTONE_NOT_ELIGIBLE", `milestone is ${m.status}`);
    const achievementId = milestoneAchievementIdOf(wallet, key);
    const metadata = buildMilestoneMetadata(m, m.first, achievementId, publicConsent);
    let achievement = await this.store.upsertAchievement({ achievementId, wallet, kind: "milestone", pbId: null, milestoneKey: key, sourceKind: m.first.sourceKind, sourceId: m.first.sourceId, category: m.category, verificationClass: m.verificationClass, sourceRevision: m.first.sourceRevision, rulesMajor: MILESTONE_RULES_MAJOR, publicConsent, metadata, metadataHash: metadataHashOf(metadata), status: "pending_registry", registrySignature: null, registryUpdatedAt: null, asset: null, mintedSignature: null, mintedAt: null }, this.now());
    // PG-LINK-03：晚到的更早紀錄讓「首次」換了來源，但未公開的 metadata 可能一字不差（無日期／數值）→ upsert 不會動；來源欄位仍須跟著更正
    if (!achievement.mintedSignature && (achievement.sourceKind !== m.first.sourceKind || achievement.sourceId !== m.first.sourceId || achievement.sourceRevision !== m.first.sourceRevision)) {
      await this.store.setAchievementSource(achievementId, { sourceKind: m.first.sourceKind, sourceId: m.first.sourceId, sourceRevision: m.first.sourceRevision }, this.now());
      achievement = (await this.store.getAchievement(achievementId)) ?? achievement;
    }
    return { achievement, milestone: m };
  }

  /** PG-M-02：里程碑成就與目前判定同步。失效 → revoke_pending（已鑄造亦標記）；重新達標 → 同 id 恢復（未鑄造重建、已鑄造只更新來源）；來源更正 → 未鑄造重建 metadata、已鑄造只更新來源欄位 */
  async reconcileMilestones(wallet: string) {
    if (!this.milestones) return;
    const list = (await this.store.listAchievements(wallet)).filter((a) => a.kind === "milestone");
    if (!list.length) return;
    const { resolutions } = await this.milestones.resolve(wallet);
    for (const a of list) {
      const m = resolutions.find((x) => x.key === a.milestoneKey);
      const first = m?.status === "eligible" ? m.first : null;
      const revoked = a.status === "revoked" || a.status === "revoke_pending";
      if (!first) {
        if (!revoked) await this.store.setAchievementStatus(a.achievementId, "revoke_pending", {}, this.now());
        continue;
      }
      const sourceChanged = a.sourceKind !== first.sourceKind || a.sourceId !== first.sourceId || a.sourceRevision !== first.sourceRevision;
      if (a.mintedSignature) {
        // 鏈上作品保留；有效性恢復或來源更正只更新紀錄，不鑄第二枚
        if (revoked) await this.store.setAchievementStatus(a.achievementId, "minted", {}, this.now());
        if (sourceChanged) await this.store.setAchievementSource(a.achievementId, { sourceKind: first.sourceKind, sourceId: first.sourceId, sourceRevision: first.sourceRevision }, this.now());
      } else if (revoked || sourceChanged) {
        if (revoked) await this.store.setAchievementStatus(a.achievementId, "pending_registry", {}, this.now());
        await this.ensureMilestone(wallet, a.milestoneKey!, a.publicConsent);
      }
    }
  }

  /** PG-M-04：依活動留念章 key 建立／更新（冪等；需 eligible） */
  async ensureEventBadge(wallet: string, key: string, publicConsent: boolean): Promise<{ achievement: Achievement; badge: EventBadgeResolution }> {
    if (!this.eventBadges) throw new ApiError(503, "EVENT_BADGES_UNAVAILABLE", "event badges not configured");
    const b = (await this.eventBadges.resolve(wallet)).find((x) => x.key === key);
    if (!b) throw new ApiError(404, "NOT_FOUND", "event badge not found");
    if (b.status !== "eligible" || !b.source) throw new ApiError(409, "EVENT_BADGE_NOT_ELIGIBLE", `event badge is ${b.status}`);
    const achievementId = eventBadgeAchievementIdOf(wallet, key);
    const metadata = buildEventBadgeMetadata(b, achievementId, publicConsent);
    const achievement = await this.store.upsertAchievement({ achievementId, wallet, kind: "event", pbId: null, milestoneKey: key, sourceKind: b.source.kind === "result" ? "result" : "workout", sourceId: b.source.id, category: b.category, verificationClass: "organizer", sourceRevision: b.source.revision, rulesMajor: EVENT_BADGE_RULES_MAJOR, publicConsent, metadata, metadataHash: metadataHashOf(metadata), status: "pending_registry", registrySignature: null, registryUpdatedAt: null, asset: null, mintedSignature: null, mintedAt: null }, this.now());
    return { achievement, badge: b };
  }

  /** PG-M-04：活動章與目前判定同步（取消報名／結果更正 → revoke_pending；重新符合 → 同 id 恢復） */
  async reconcileEventBadges(wallet: string) {
    if (!this.eventBadges) return;
    const list = (await this.store.listAchievements(wallet)).filter((a) => a.kind === "event");
    if (!list.length) return;
    const res = await this.eventBadges.resolve(wallet);
    for (const a of list) {
      const b = res.find((x) => x.key === a.milestoneKey);
      const ok = b?.status === "eligible" && b.source ? b.source : null;
      const revoked = a.status === "revoked" || a.status === "revoke_pending";
      if (!ok) { if (!revoked) await this.store.setAchievementStatus(a.achievementId, "revoke_pending", {}, this.now()); continue; }
      const sourceChanged = a.sourceId !== ok.id || a.sourceRevision !== ok.revision;
      if (a.mintedSignature) {
        if (revoked) await this.store.setAchievementStatus(a.achievementId, "minted", {}, this.now());
        if (sourceChanged) await this.store.setAchievementSource(a.achievementId, { sourceKind: ok.kind === "result" ? "result" : "workout", sourceId: ok.id, sourceRevision: ok.revision }, this.now());
      } else if (revoked || sourceChanged) {
        if (revoked) await this.store.setAchievementStatus(a.achievementId, "pending_registry", {}, this.now());
        await this.ensureEventBadge(wallet, a.milestoneKey!, a.publicConsent);
      }
    }
  }

  /**
   * PG-SEASON-04：依節日屆次建立／更新（冪等；需 eligible）。
   *
   * **`mint_enabled` 關著時一律拒絕**：這個開關代表「鏈上程式已經支援 seasonal 類別且已部署」，
   * 在它打開之前就簽發證明，玩家會拿到一個鏈上必定失敗的交易。
   */
  async ensureSeasonal(wallet: string, campaignId: string, publicConsent: boolean): Promise<{ achievement: Achievement }> {
    if (!this.seasonal) throw new ApiError(503, "SEASONAL_UNAVAILABLE", "seasonal campaigns not configured");
    if (!this.seasonal.mintEnabled) throw new ApiError(409, "SEASONAL_MINT_NOT_OPEN", "claiming is not open for seasonal editions yet");
    const r = (await this.seasonal.resolve(wallet)).find((x) => x.campaign.campaignId === campaignId);
    if (!r) throw new ApiError(404, "NOT_FOUND", "seasonal campaign not found");
    if (r.status !== "eligible" || !r.first) throw new ApiError(409, "SEASONAL_NOT_ELIGIBLE", `seasonal edition is ${r.status}`);
    const achievementId = seasonalAchievementIdOf(wallet, campaignId);
    const key = seasonalKeyOf(campaignId);
    // 之前被標記撤銷、現在又符合資格（例如來源運動刪掉後重新匯入成另一筆）：
    // 同一枚恢復成待核准。能走到這裡代表**現在**的判定是 eligible，所以不會多發。
    // 已鑄造的不動——鏈上那一枚還在，狀態由 intent 回報 minted。
    const existing = await this.store.getAchievement(achievementId);
    if (existing && !existing.mintedSignature && (existing.status === "revoked" || existing.status === "revoke_pending")) {
      await this.store.setAchievementStatus(achievementId, "pending_registry", {}, this.now());
    }
    const metadata = buildSeasonalMetadata(r.campaign, r.first, achievementId, publicConsent);
    let achievement = await this.store.upsertAchievement({ achievementId, wallet, kind: "seasonal", pbId: null, milestoneKey: key, sourceKind: "workout", sourceId: r.first.sessionId, category: "seasonal", verificationClass: "device", sourceRevision: r.first.sourceRevision, rulesMajor: r.campaign.rulesVersion, publicConsent, metadata, metadataHash: metadataHashOf(metadata), status: "pending_registry", registrySignature: null, registryUpdatedAt: null, asset: null, mintedSignature: null, mintedAt: null }, this.now());
    // 與里程碑同一個問題（PG-LINK-03）：換了來源運動但公開的 metadata 一字不差（沒有日期／數值），
    // upsert 不會動任何欄位——來源仍須跟著更正，否則護照與撤銷判定會指向一筆已經不存在的運動。
    if (!achievement.mintedSignature && (achievement.sourceId !== r.first.sessionId || achievement.sourceRevision !== r.first.sourceRevision)) {
      await this.store.setAchievementSource(achievementId, { sourceKind: "workout", sourceId: r.first.sessionId, sourceRevision: r.first.sourceRevision }, this.now());
      achievement = (await this.store.getAchievement(achievementId)) ?? achievement;
    }
    return { achievement };
  }

  /**
   * PG-SEASON-04：節日收藏與目前判定同步。資格消失（來源運動被刪／更正到窗口外）→ revoke_pending；
   * 重新符合 → 同一個 achievement_id 恢復，不鑄第二枚（設計 §5「更正／撤銷沿用資格更新流程」）。
   */
  async reconcileSeasonal(wallet: string) {
    if (!this.seasonal) return;
    const list = (await this.store.listAchievements(wallet)).filter((a) => a.kind === "seasonal");
    if (!list.length) return;
    const res = await this.seasonal.resolve(wallet);
    for (const a of list) {
      const campaignId = a.milestoneKey ? parseSeasonalKey(a.milestoneKey) : null;
      const r = campaignId ? res.find((x) => x.campaign.campaignId === campaignId) : undefined;
      const ok = r?.status === "eligible" ? r.first : null;
      const revoked = a.status === "revoked" || a.status === "revoke_pending";
      if (!ok) { if (!revoked) await this.store.setAchievementStatus(a.achievementId, "revoke_pending", {}, this.now()); continue; }
      const sourceChanged = a.sourceId !== ok.sessionId || a.sourceRevision !== ok.sourceRevision;
      if (a.mintedSignature) {
        // 鏈上作品保留；恢復或來源更正只更新紀錄
        if (revoked) await this.store.setAchievementStatus(a.achievementId, "minted", {}, this.now());
        if (sourceChanged) await this.store.setAchievementSource(a.achievementId, { sourceKind: "workout", sourceId: ok.sessionId, sourceRevision: ok.sourceRevision }, this.now());
      } else if (revoked || sourceChanged) {
        if (revoked) await this.store.setAchievementStatus(a.achievementId, "pending_registry", {}, this.now());
        if (this.seasonal.mintEnabled) await this.ensureSeasonal(wallet, campaignId!, a.publicConsent);
        else await this.store.setAchievementSource(a.achievementId, { sourceKind: "workout", sourceId: ok.sessionId, sourceRevision: ok.sourceRevision }, this.now());
      }
    }
  }

  /** 已核准者簽發 15 分鐘證明；回傳鏈上指令參數與費用揭露（PB 以 pbId、里程碑／活動章／節日以穩定 key） */
  async intent(wallet: string, ref: { pbId: string } | { milestoneKey: string } | { eventBadgeKey: string } | { seasonalCampaignId: string }, publicConsent: boolean) {
    const achievement =
      "pbId" in ref ? (await this.ensure(wallet, ref.pbId, publicConsent)).achievement
      : "milestoneKey" in ref ? (await this.ensureMilestone(wallet, ref.milestoneKey, publicConsent)).achievement
      : "eventBadgeKey" in ref ? (await this.ensureEventBadge(wallet, ref.eventBadgeKey, publicConsent)).achievement
      : (await this.ensureSeasonal(wallet, ref.seasonalCampaignId, publicConsent)).achievement;
    const base = { achievement: achievementView(achievement), pb_id: achievement.pbId, milestone_key: achievement.milestoneKey, fee_estimate_lamports: MINT_FEE_ESTIMATE_LAMPORTS, metadata_preview: achievement.metadata };
    if (achievement.status === "minted") return { ...base, status: "minted" as const, proof: null };
    if (achievement.status !== "approved") return { ...base, status: achievement.status, proof: null };
    if (!this.config.PROGRAM_ID) throw new ApiError(503, "CHAIN_UNAVAILABLE", "PROGRAM_ID not configured");
    const issuedAt = Math.floor(this.now().getTime() / 1000) - CHAIN_CLOCK_SKEW_SECONDS; // 鏈上時鐘落後寬限
    const proof: AchievementProof = {
      version: ACHIEVEMENT_VERSION, programId: Buffer.from(bs58.decode(this.config.PROGRAM_ID)), clusterId: this.config.CLUSTER_ID, wallet: Buffer.from(bs58.decode(wallet)), achievementId: Buffer.from(achievement.achievementId, "hex"),
      category: CATEGORY_CODE[achievement.category as keyof typeof CATEGORY_CODE], verificationClass: CLASS_CODE[achievement.verificationClass], sourceRevision: achievement.sourceRevision, rulesVersion: achievement.rulesMajor, metadataHash: achievement.metadataHash,
      issuedAt: BigInt(issuedAt), expiry: BigInt(issuedAt + ACHIEVEMENT_MAX_TTL_SECONDS), nonce: randomBytes(16),
    };
    const message = encodeAchievement(proof);
    const signature = Buffer.from(await this.signer.sign(message));
    return {
      ...base,
      status: "approved" as const,
      proof: {
        message_b64: message.toString("base64"), signature_b64: signature.toString("base64"), attestor: bs58.encode(await this.signer.publicKey()), expires_at: new Date((issuedAt + ACHIEVEMENT_MAX_TTL_SECONDS) * 1000).toISOString(),
        args: { version: proof.version, program_id: this.config.PROGRAM_ID, cluster_id: proof.clusterId, wallet, achievement_id: achievement.achievementId, category: proof.category, verification_class: proof.verificationClass, source_revision: proof.sourceRevision, rules_version: proof.rulesVersion, metadata_hash: achievement.metadataHash.toString("hex"), issued_at: String(proof.issuedAt), expiry: String(proof.expiry), nonce: proof.nonce.toString("hex") },
      },
    };
  }

  /** PB 重算後：被 invalidated 的 PB 若已有成就 → revoke_pending（已鑄造亦標記，鏈上歷史不刪） */
  async reconcile(wallet: string, pbs: PbRevision[]) {
    for (const a of await this.store.listAchievements(wallet)) {
      if (a.kind !== "pb") continue; // 里程碑／活動章由 reconcileMilestones／reconcileEventBadges 處理
      const pb = pbs.find((p) => p.pbId === a.pbId);
      if ((!pb || pb.status === "invalidated") && a.status !== "revoked" && a.status !== "revoke_pending") await this.store.setAchievementStatus(a.achievementId, "revoke_pending", {}, this.now());
      else if (pb && pb.status !== "invalidated" && pb.sourceRevision !== a.sourceRevision && a.status !== "minted") {
        // 來源 revision 變了（例如成績更正但仍是最佳）→ metadata 重建，回到 pending_registry
        await this.ensure(wallet, pb.pbId, a.publicConsent);
      }
    }
  }
}

export const achievementView = (a: Achievement) => ({ achievement_id: a.achievementId, minted: a.mintedSignature !== null, kind: a.kind, pb_id: a.pbId, milestone_key: a.milestoneKey, source: a.sourceKind && a.sourceId ? { kind: a.sourceKind, id: a.sourceId, revision: a.sourceRevision } : null, category: a.category, verification_class: a.verificationClass, source_revision: a.sourceRevision, rules_major: a.rulesMajor, public_consent: a.publicConsent, status: a.status, metadata_hash: a.metadataHash.toString("hex"), metadata_uri: `/v1/nft/achievements/${a.achievementId}.json`, asset: a.asset, minted_signature: a.mintedSignature, minted_at: a.mintedAt?.toISOString() ?? null, registry_updated_at: a.registryUpdatedAt?.toISOString() ?? null, updated_at: a.updatedAt.toISOString() });

export async function achievementRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; achievements: AchievementService; pbs: PersonalBestService; now: () => Date; eventBadges?: EventBadgeService }) {
  const { auth, store, achievements, pbs, now, eventBadges } = opts;
  const ops = (req: FastifyRequest) => {
    const token = app.config.OPS_TOKEN;
    if (!token) throw new ApiError(404, "NOT_FOUND", "not found");
    if (req.headers.authorization !== `Bearer ${token}`) throw new ApiError(401, "UNAUTHORIZED", "ops token required");
  };

  /** 玩家：申請鑄造（需該次公開同意選擇）；回 registry 狀態、metadata 預覽、費用與（已核准時）證明 */
  app.post("/me/achievements/:pbId/mint-intent", { preHandler: requireAuth(auth), config: { rateLimit: { max: app.config.RATE_LIMIT_SENSITIVE_PER_MINUTE, timeWindow: "1 minute" } } }, async (req) => {
    const pbId = z.string().uuid().safeParse((req.params as { pbId: string }).pbId);
    if (!pbId.success) throw new ApiError(422, "VALIDATION", "pbId must be a uuid");
    const b = z.object({ public_consent: z.boolean() }).strict().safeParse(req.body ?? {});
    if (!b.success) throw new ApiError(422, "VALIDATION", "public_consent (boolean) is required");
    await pbs.recompute(req.auth!.wallet); // 先確認 PB 仍有效（BR-40）
    return achievements.intent(req.auth!.wallet, { pbId: pbId.data }, b.data.public_consent);
  });

  /** PG-M-04：活動留念章目錄與鑄造申請 */
  app.get("/me/event-badges", { preHandler: requireAuth(auth) }, async (req) => {
    if (!eventBadges) throw new ApiError(503, "EVENT_BADGES_UNAVAILABLE", "event badges not configured");
    const list = await eventBadges.resolve(req.auth!.wallet);
    return { rules_major: EVENT_BADGE_RULES_MAJOR, items: list.map(eventBadgeView) };
  });
  app.post("/me/event-badges/mint-intent", { preHandler: requireAuth(auth), config: { rateLimit: { max: app.config.RATE_LIMIT_SENSITIVE_PER_MINUTE, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ event_id: z.string().uuid(), kind: z.enum(["check_in", "finish"]), public_consent: z.boolean() }).strict().safeParse(req.body ?? {});
    if (!b.success) throw new ApiError(422, "VALIDATION", "event_id, kind and public_consent (boolean) are required");
    return achievements.intent(req.auth!.wallet, { eventBadgeKey: eventBadgeKeyOf(b.data.event_id, b.data.kind) }, b.data.public_consent);
  });

  /** PG-M-02：里程碑鑄造申請（穩定 key）；讀取即重算資格 */
  app.post("/me/milestones/mint-intent", { preHandler: requireAuth(auth), config: { rateLimit: { max: app.config.RATE_LIMIT_SENSITIVE_PER_MINUTE, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ key: z.string().regex(/^[a-z0-9_]+\|[a-z]+\|(organizer|device)$/), public_consent: z.boolean() }).strict().safeParse(req.body ?? {});
    if (!b.success) throw new ApiError(422, "VALIDATION", "key and public_consent (boolean) are required");
    return achievements.intent(req.auth!.wallet, { milestoneKey: b.data.key }, b.data.public_consent);
  });

  app.get("/me/achievements", { preHandler: requireAuth(auth) }, async (req) => ({ items: (await store.listAchievements(req.auth!.wallet)).map(achievementView) }));

  /** 公開 metadata（Core asset URI 指向這裡；只含 canonical metadata） */
  app.get("/nft/achievements/:id.json", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const a = /^[0-9a-f]{64}$/.test(id) ? await store.getAchievement(id) : null;
    if (!a) throw new ApiError(404, "NOT_FOUND", "achievement not found");
    return reply.header("cache-control", "public, max-age=300").send(a.metadata);
  });

  // ---- ops：registry 同步（chain-admin `sync-achievements`） ----
  app.get("/ops/achievements/pending", async (req) => {
    ops(req);
    const list = await store.listAchievementsByStatus(["pending_registry", "revoke_pending"], 200);
    return { items: list.map((a) => ({ ...achievementView(a), wallet: a.wallet, desired_status: a.status === "revoke_pending" ? "revoked" : "approved", category_code: CATEGORY_CODE[a.category as keyof typeof CATEGORY_CODE], class_code: CLASS_CODE[a.verificationClass] })) };
  });
  app.post("/ops/achievements/:id/registry", async (req) => {
    ops(req);
    const id = (req.params as { id: string }).id;
    const b = z.object({ status: z.enum(["approved", "revoked"]), signature: z.string().min(32).max(128) }).strict().safeParse(req.body);
    if (!b.success) throw new ApiError(422, "VALIDATION", "status and signature are required");
    const a = await store.getAchievement(id);
    if (!a) throw new ApiError(404, "NOT_FOUND", "achievement not found");
    // approved：已鑄造者維持 minted；revoked：一律 revoked（已鑄造者由 minted_signature 保留鏈上事實，藝廊標 Invalidated）
    const next: Achievement["status"] = b.data.status === "approved" ? (a.mintedSignature ? "minted" : "approved") : "revoked";
    const updated = await store.setAchievementStatus(id, next, { registrySignature: b.data.signature }, now());
    return achievementView(updated!);
  });
}
