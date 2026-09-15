/**
 * 成就 NFT 簽發（PG-R-08；activity-running-gallery 7、SD 13／15、BR-39／40）。
 * - achievement_id 伺服器穩定分配（sha256("neonshift-achievement|"+wallet+"|"+pb_id)），重試沿用，不由 client 自選。
 * - metadata 先 canonical 化並 hash，簽章綁定 metadata_hash；精確數值只在該次明確公開同意時寫入（BR-40）。
 * - 鑄造前需 admin 把 registry 寫上鏈（approved）；來源修正／刪除 → revoke_pending，由 ops 推上鏈後 revoked；已鑄造只標記不刪。
 * - 證明 194 bytes（NEONSHIFT_ACHIEVEMENT_V1）由 attestor 簽章，15 分鐘有效；費用（rent）明示揭露。
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
import { ACHIEVEMENT_MAX_TTL_SECONDS, ACHIEVEMENT_VERSION, CATEGORY_CODE, CLASS_CODE, encodeAchievement, type AchievementProof } from "../lib/achievement.js";
import type { AttestorSigner } from "../signer/types.js";
import type { Achievement, PbRevision, Store } from "../store/types.js";
import type { PersonalBestService } from "./service.js";

/** 估算玩家需付的 rent（receipt ≈ 119 bytes、Core asset ≈ 200 bytes）＋手續費；實際以鏈上為準 */
export const MINT_FEE_ESTIMATE_LAMPORTS = 3_500_000;
const IMAGE_BASE = "https://neonshift.cc/nft/achievements/";

export const achievementIdOf = (wallet: string, pbId: string) => createHash("sha256").update(`neonshift-achievement|${wallet}|${pbId}`).digest("hex");

const categoryLabel: Record<string, string> = { fastest_1k: "Fastest 1K", fastest_5k: "Fastest 5K", fastest_10k: "Fastest 10K", fastest_half: "Fastest Half Marathon", fastest_marathon: "Fastest Marathon", longest_run: "Longest Run" };
const fmtMs = (ms: bigint) => { const s = Number(ms / 1000n); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`; };

/** canonical metadata（Metaplex JSON 標準子集）；未同意公開時不含精確數值與日期 */
export function buildMetadata(pb: PbRevision, achievementId: string, publicConsent: boolean): Record<string, Json> {
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
    properties: { category: "image", achievement_id: achievementId, public: publicConsent },
  };
}
export const metadataHashOf = (m: Record<string, Json>) => createHash("sha256").update(canonicalize(m)).digest();

export class AchievementService {
  constructor(private readonly store: Store, private readonly config: AppConfig, private readonly signer: AttestorSigner, private readonly now: () => Date) {}

  /** 依 PB 建立／更新成就（冪等）；PB 需為 current／historical */
  async ensure(wallet: string, pbId: string, publicConsent: boolean): Promise<{ achievement: Achievement; pb: PbRevision }> {
    const pb = (await this.store.listPbRevisions(wallet)).find((p) => p.pbId === pbId);
    if (!pb) throw new ApiError(404, "NOT_FOUND", "personal best not found");
    if (pb.status === "invalidated") throw new ApiError(409, "ACHIEVEMENT_INVALIDATED", "this record was corrected or deleted");
    const achievementId = achievementIdOf(wallet, pbId);
    const metadata = buildMetadata(pb, achievementId, publicConsent);
    const achievement = await this.store.upsertAchievement({ achievementId, wallet, pbId, category: pb.category, verificationClass: pb.verificationClass as "organizer" | "device", sourceRevision: pb.sourceRevision, rulesMajor: pb.rulesMajor, publicConsent, metadata, metadataHash: metadataHashOf(metadata), status: "pending_registry", registrySignature: null, registryUpdatedAt: null, asset: null, mintedSignature: null, mintedAt: null }, this.now());
    return { achievement, pb };
  }

  /** 已核准者簽發 15 分鐘證明；回傳鏈上指令參數與費用揭露 */
  async intent(wallet: string, pbId: string, publicConsent: boolean) {
    const { achievement, pb } = await this.ensure(wallet, pbId, publicConsent);
    const base = { achievement: achievementView(achievement), pb_id: pb.pbId, fee_estimate_lamports: MINT_FEE_ESTIMATE_LAMPORTS, metadata_preview: achievement.metadata };
    if (achievement.status === "minted") return { ...base, status: "minted" as const, proof: null };
    if (achievement.status !== "approved") return { ...base, status: achievement.status, proof: null };
    if (!this.config.PROGRAM_ID) throw new ApiError(503, "CHAIN_UNAVAILABLE", "PROGRAM_ID not configured");
    const issuedAt = Math.floor(this.now().getTime() / 1000);
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
      const pb = pbs.find((p) => p.pbId === a.pbId);
      if ((!pb || pb.status === "invalidated") && a.status !== "revoked" && a.status !== "revoke_pending") await this.store.setAchievementStatus(a.achievementId, "revoke_pending", {}, this.now());
      else if (pb && pb.status !== "invalidated" && pb.sourceRevision !== a.sourceRevision && a.status !== "minted") {
        // 來源 revision 變了（例如成績更正但仍是最佳）→ metadata 重建，回到 pending_registry
        await this.ensure(wallet, pb.pbId, a.publicConsent);
      }
    }
  }
}

export const achievementView = (a: Achievement) => ({ achievement_id: a.achievementId, minted: a.mintedSignature !== null, pb_id: a.pbId, category: a.category, verification_class: a.verificationClass, source_revision: a.sourceRevision, rules_major: a.rulesMajor, public_consent: a.publicConsent, status: a.status, metadata_hash: a.metadataHash.toString("hex"), metadata_uri: `/v1/nft/achievements/${a.achievementId}.json`, asset: a.asset, minted_signature: a.mintedSignature, minted_at: a.mintedAt?.toISOString() ?? null, registry_updated_at: a.registryUpdatedAt?.toISOString() ?? null, updated_at: a.updatedAt.toISOString() });

export async function achievementRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; achievements: AchievementService; pbs: PersonalBestService; now: () => Date }) {
  const { auth, store, achievements, pbs, now } = opts;
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
    return achievements.intent(req.auth!.wallet, pbId.data, b.data.public_consent);
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
