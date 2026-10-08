/**
 * SKR-02～06：官方 SKR 外觀付款（docs/store/competition-development-plan.md §5 驗收契約）。
 * - 訂單由伺服器決定 SKU／版本、資格、wallet、價格、mint、收款人、reference、期限（App 不得自報）。
 * - 狀態：awaiting_payment → confirming → fulfilled；expired／needs_review／cancelled。錢包取消 ≠ 鏈上失敗；送出 ≠ 完成。
 * - receipt 與權限原子寫入；同 signature 不可替第二張訂單授權；重試回同一結果。
 * - 過期後才觀察到的付款：寬限內照履約，超過 → needs_review（不要求再付，人工處理）。
 * - 遺失 signature：以 reference 反查（recover）。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Keypair } from "@solana/web3.js";
import { z } from "zod";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { SkrEntitlement, SkrOrder, Store } from "../store/types.js";
import { associatedTokenAddress, TOKEN_PROGRAM_ID, type SkrChain } from "./chain.js";
import { eligibilityFor, findSku, formatBaseUnits, SKUS, type Sku } from "./catalog.js";
import { verifyPayment } from "./verify.js";

export type SkrSettings = { enabled: boolean; network: "mainnet-beta" | "devnet"; mint: string; recipient: string | null; prices: Record<string, bigint>; ttlSec: number; graceSec: number; sourceEnv: string };

export function skrSettingsFrom(config: AppConfig): SkrSettings {
  return {
    enabled: config.SKR_ENABLED,
    network: config.SKR_NETWORK,
    mint: config.SKR_MINT,
    recipient: config.SKR_RECIPIENT ?? null,
    prices: config.SKR_GENESIS_FRAME_PRICE ? { genesis_mint_frame: BigInt(config.SKR_GENESIS_FRAME_PRICE) } : {},
    ttlSec: config.SKR_ORDER_TTL_SEC,
    graceSec: config.SKR_PAYMENT_GRACE_SEC,
    sourceEnv: config.APP_ENV,
  };
}

export class SkrService {
  /** init() 於啟動時向鏈上核對 mint（SKR-01：不按 symbol 認幣、不硬編 decimals）；失敗 → 停用並記錄 */
  private mintDecimals: number | null = null;
  private disabledReason: string | null = null;
  constructor(private readonly store: Store, private readonly chain: SkrChain, private readonly settings: SkrSettings, private readonly now: () => Date, private readonly log: { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void } = console) {}

  get enabled() { return this.settings.enabled && this.disabledReason === null && this.mintDecimals !== null; }

  async init() {
    if (!this.settings.enabled) return;
    try {
      const mint = await this.chain.getMint(this.settings.mint);
      if (!mint) { this.disabledReason = "mint_not_found"; this.log.warn({ mint: this.settings.mint, network: this.settings.network }, "SKR 停用：找不到 mint"); return; }
      if (mint.owner !== TOKEN_PROGRAM_ID) { this.disabledReason = "mint_owner_mismatch"; this.log.warn({ owner: mint.owner }, "SKR 停用：mint 不是 SPL Token program"); return; }
      this.mintDecimals = mint.decimals;
      const ata = associatedTokenAddress(this.settings.recipient!, this.settings.mint);
      if (!(await this.chain.accountExists(ata))) this.log.warn({ ata }, "SKR 收款 ATA 尚未建立：App 會在付款交易內以 idempotent 指令建立（由付款人付租金），建議先手動建立");
      this.log.info({ network: this.settings.network, mint: this.settings.mint, decimals: mint.decimals, recipient: this.settings.recipient }, "SKR ready");
    } catch (e) {
      this.disabledReason = "rpc_error";
      this.log.warn({ err: e }, "SKR 停用：無法核對 mint");
    }
  }

  private requireEnabled() { if (!this.enabled) throw new ApiError(503, "SKR_DISABLED", this.disabledReason ?? "SKR payments are not enabled"); }

  async catalog(wallet: string) {
    if (!this.enabled) return { enabled: false as const, reason: this.settings.enabled ? this.disabledReason : "not_configured" };
    const [achievements, entitlements] = await Promise.all([this.store.listAchievements(wallet), this.store.listSkrEntitlements(wallet)]);
    const skus = [];
    for (const sku of SKUS) {
      const price = this.settings.prices[sku.sku];
      if (price === undefined) continue;
      const el = eligibilityFor(sku, achievements);
      const owned = entitlements.some((e) => e.cosmeticId === sku.cosmeticId && e.status === "active");
      const open = await this.store.findOpenSkrOrder(wallet, sku.sku, sku.version);
      const openOrder = open ? await this.expireIfDue(open) : null;
      skus.push({ sku: sku.sku, version: sku.version, cosmetic_id: sku.cosmeticId, requires: sku.requires, price_base_units: price.toString(), price_display: formatBaseUnits(price, this.mintDecimals!), eligibility: el.status, achievement_id: el.achievementId, owned, open_order: openOrder && openOrder.status !== "expired" ? orderView(openOrder) : null });
    }
    return { enabled: true as const, network: this.settings.network, mint: this.settings.mint, decimals: this.mintDecimals!, recipient: this.settings.recipient!, recipient_token_account: associatedTokenAddress(this.settings.recipient!, this.settings.mint), order_ttl_sec: this.settings.ttlSec, skus, entitlements: entitlements.map(entitlementView) };
  }

  /** 冪等：同錢包同 SKU 尚未終結的訂單直接回傳（created=false）；已擁有 → 409 */
  async createOrder(wallet: string, skuId: string): Promise<{ order: SkrOrder; created: boolean }> {
    this.requireEnabled();
    const sku = findSku(skuId);
    const price = sku ? this.settings.prices[sku.sku] : undefined;
    if (!sku || price === undefined) throw new ApiError(404, "SKU_NOT_FOUND", "unknown sku");
    const entitlements = await this.store.listSkrEntitlements(wallet);
    if (entitlements.some((e) => e.cosmeticId === sku.cosmeticId && e.status === "active")) throw new ApiError(409, "ALREADY_OWNED", "you already own this cosmetic");
    const el = eligibilityFor(sku, await this.store.listAchievements(wallet));
    if (el.status !== "eligible") throw new ApiError(409, "NOT_ELIGIBLE", `achievement ${sku.requires.category} is ${el.status}`);
    const open = await this.store.findOpenSkrOrder(wallet, sku.sku, sku.version);
    if (open) {
      const cur = await this.expireIfDue(open);
      if (cur.status !== "expired") return { order: cur, created: false };
    }
    const now = this.now();
    const order = await this.store.createSkrOrder({
      orderId: randomUUID(), wallet, sku: sku.sku, skuVersion: sku.version, cosmeticId: sku.cosmeticId, network: this.settings.network, mint: this.settings.mint, decimals: this.mintDecimals!, amount: price,
      recipient: this.settings.recipient!, recipientTokenAccount: associatedTokenAddress(this.settings.recipient!, this.settings.mint), reference: Keypair.generate().publicKey.toBase58(), eligibilityRef: el.achievementId, sourceEnv: this.settings.sourceEnv,
      expiresAt: new Date(now.getTime() + this.settings.ttlSec * 1000),
    }, now);
    return { order, created: true };
  }

  async getOrder(wallet: string, orderId: string): Promise<SkrOrder> {
    const o = await this.store.getSkrOrder(orderId);
    if (!o || o.wallet !== wallet) throw new ApiError(404, "ORDER_NOT_FOUND", "order not found");
    return this.expireIfDue(o);
  }

  async listOrders(wallet: string) { const list = await this.store.listSkrOrders(wallet, 20); return Promise.all(list.map((o) => this.expireIfDue(o))); }

  async cancel(wallet: string, orderId: string): Promise<SkrOrder> {
    const o = await this.getOrder(wallet, orderId);
    if (o.status === "awaiting_payment") return (await this.store.updateSkrOrder(orderId, { status: "cancelled" }, this.now()))!;
    if (o.status === "cancelled" || o.status === "expired") return o;
    // confirming：App 送過 signature 但鏈上還沒看到——只有在期限＋寬限已過且 RPC 仍查無此交易（blockhash 早已失效，不可能再落地）才允許取消
    if (o.status === "confirming" && o.signature && this.now().getTime() > o.expiresAt.getTime() + this.settings.graceSec * 1000) {
      const tx = await this.chain.getTransaction(o.signature);
      if (!tx) return (await this.store.updateSkrOrder(orderId, { status: "cancelled", failureReason: "signature_not_found_after_expiry" }, this.now()))!;
      const r = await this.confirm(wallet, orderId, o.signature); // 其實已落地：照驗證流程處理，不取消
      throw new ApiError(409, "ORDER_NOT_CANCELLABLE", `order is ${r.order.status}`);
    }
    throw new ApiError(409, "ORDER_NOT_CANCELLABLE", `order is ${o.status}`); // confirming（期限內）／fulfilled／needs_review：付款可能已發生，不可取消
  }

  /**
   * 確認付款。回 { order, found }：found=false 表示 RPC 尚未看到交易（維持 confirming，App 稍後再查，不要求再付）。
   * 查到但驗證失敗：tx_failed → 回到 awaiting_payment（可重付）；其餘（他人付款、金額不足、逾期）→ needs_review。
   */
  async confirm(wallet: string, orderId: string, signature: string): Promise<{ order: SkrOrder; found: boolean; verify?: string }> {
    this.requireEnabled();
    const o = await this.getOrder(wallet, orderId);
    if (o.status === "fulfilled") return { order: o, found: true };
    if (o.status === "cancelled" || o.status === "expired") {
      // 取消／逾期後仍送來 signature：照查——若真的已付且在寬限內，仍履約（不要求再付）
    }
    const used = await this.store.getSkrReceipt(signature);
    if (used && used.orderId !== orderId) throw new ApiError(409, "PAYMENT_ALREADY_USED", "this payment already fulfilled another order");
    const now = this.now();
    if (o.status !== "confirming" || o.signature !== signature) await this.store.updateSkrOrder(orderId, { status: "confirming", signature, failureReason: null }, now);
    const tx = await this.chain.getTransaction(signature);
    if (!tx) return { order: (await this.store.getSkrOrder(orderId))!, found: false };
    const v = verifyPayment(tx, o, this.settings.graceSec);
    if (v.ok) {
      const r = await this.store.fulfillSkrOrder(orderId, { signature, orderId, wallet, amount: v.paid, slot: v.slot, blockTime: v.blockTime }, this.now());
      if (r.kind === "signature_used") throw new ApiError(409, "PAYMENT_ALREADY_USED", "this payment already fulfilled another order");
      if (r.kind === "not_found") throw new ApiError(404, "ORDER_NOT_FOUND", "order not found");
      return { order: r.order, found: true };
    }
    const next = v.reason === "tx_failed" ? "awaiting_payment" : "needs_review";
    const order = (await this.store.updateSkrOrder(orderId, { status: next, signature: v.reason === "tx_failed" ? null : signature, failureReason: `${v.reason}${v.detail ? `: ${v.detail}` : ""}` }, this.now()))!;
    return { order, found: true, verify: v.reason };
  }

  /** App 遺失 signature（timeout／重裝）：有記錄的 signature 先查，否則以 reference 反查最近交易 */
  async recover(wallet: string, orderId: string): Promise<{ order: SkrOrder; found: boolean; verify?: string }> {
    this.requireEnabled();
    const o = await this.getOrder(wallet, orderId);
    if (o.status === "fulfilled") return { order: o, found: true };
    if (o.signature) {
      const r = await this.confirm(wallet, orderId, o.signature);
      if (r.found) return r;
    }
    const sigs = await this.chain.getSignaturesForAddress(o.reference, 10);
    for (const sig of sigs) {
      const r = await this.confirm(wallet, orderId, sig);
      if (r.order.status === "fulfilled" || r.order.status === "needs_review") return r;
    }
    return { order: (await this.getOrder(wallet, orderId)), found: false };
  }

  async entitlements(wallet: string) { return this.store.listSkrEntitlements(wallet); }

  private async expireIfDue(o: SkrOrder): Promise<SkrOrder> {
    if (o.status === "awaiting_payment" && o.expiresAt.getTime() <= this.now().getTime()) return (await this.store.updateSkrOrder(o.orderId, { status: "expired" }, this.now())) ?? o;
    return o;
  }
}

export const orderView = (o: SkrOrder) => ({
  order_id: o.orderId, sku: o.sku, sku_version: o.skuVersion, cosmetic_id: o.cosmeticId, network: o.network, mint: o.mint, decimals: o.decimals, amount_base_units: o.amount.toString(), amount_display: formatBaseUnits(o.amount, o.decimals),
  recipient: o.recipient, recipient_token_account: o.recipientTokenAccount, reference: o.reference, status: o.status, signature: o.signature, paid_amount_base_units: o.paidAmount?.toString() ?? null, paid_at: o.paidAt?.toISOString() ?? null, failure_reason: o.failureReason,
  expires_at: o.expiresAt.toISOString(), created_at: o.createdAt.toISOString(), updated_at: o.updatedAt.toISOString(),
});
export const entitlementView = (e: SkrEntitlement) => ({ cosmetic_id: e.cosmeticId, order_id: e.orderId, status: e.status, granted_at: e.grantedAt.toISOString() });

export async function skrRoutes(app: FastifyInstance, opts: { auth: AuthService; skr: SkrService; sensitiveLimit: number }) {
  const { auth, skr } = opts;
  const sensitive = { config: { rateLimit: { max: opts.sensitiveLimit, timeWindow: "1 minute" } }, preHandler: requireAuth(auth) };
  app.get("/me/skr/catalog", { preHandler: requireAuth(auth) }, async (req) => skr.catalog(req.auth!.wallet));
  app.get("/me/skr/entitlements", { preHandler: requireAuth(auth) }, async (req) => ({ entitlements: (await skr.entitlements(req.auth!.wallet)).map(entitlementView) }));
  app.get("/me/skr/orders", { preHandler: requireAuth(auth) }, async (req) => ({ orders: (await skr.listOrders(req.auth!.wallet)).map(orderView) }));
  app.post("/me/skr/orders", sensitive, async (req, reply) => {
    const b = z.object({ sku: z.string().min(1).max(40) }).strict().safeParse(req.body ?? {});
    if (!b.success) throw new ApiError(422, "VALIDATION", "sku is required");
    const r = await skr.createOrder(req.auth!.wallet, b.data.sku);
    return reply.status(r.created ? 201 : 200).send({ order: orderView(r.order), created: r.created });
  });
  const orderId = (req: { params: unknown }) => { const p = z.string().uuid().safeParse((req.params as { id: string }).id); if (!p.success) throw new ApiError(422, "VALIDATION", "id must be a uuid"); return p.data; };
  app.get("/me/skr/orders/:id", { preHandler: requireAuth(auth) }, async (req) => ({ order: orderView(await skr.getOrder(req.auth!.wallet, orderId(req))) }));
  app.post("/me/skr/orders/:id/cancel", { preHandler: requireAuth(auth) }, async (req) => ({ order: orderView(await skr.cancel(req.auth!.wallet, orderId(req))) }));
  app.post("/me/skr/orders/:id/confirm", sensitive, async (req) => {
    const b = z.object({ signature: z.string().min(64).max(128).regex(/^[1-9A-HJ-NP-Za-km-z]+$/) }).strict().safeParse(req.body ?? {});
    if (!b.success) throw new ApiError(422, "VALIDATION", "signature is required");
    const r = await skr.confirm(req.auth!.wallet, orderId(req), b.data.signature);
    return { order: orderView(r.order), found: r.found, verify: r.verify ?? null };
  });
  app.post("/me/skr/orders/:id/recover", sensitive, async (req) => {
    const r = await skr.recover(req.auth!.wallet, orderId(req));
    return { order: orderView(r.order), found: r.found, verify: r.verify ?? null };
  });
}
