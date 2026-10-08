/**
 * SKR-07 對抗測試（docs/store/competition-development-plan.md §5／§6）：停用、資格、訂單冪等／重複點擊、錯 mint、他人付款、金額不足、
 * 重放（同 signature 兩張訂單）、RPC 找不到交易（confirming 不重扣）、交易失敗可重付、逾期寬限／超過寬限 needs_review、reference 反查復原、
 * 取消規則、錢包刪除、設定守門（主網必須官方 mint）。假鏈注入，不碰真實 RPC。
 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig, OFFICIAL_SKR_MINT } from "../config.js";
import type { Db } from "../db.js";
import { MemoryStore } from "../store/memory.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { associatedTokenAddress, TOKEN_PROGRAM_ID, type PaymentTx, type SkrChain } from "./chain.js";
import { verifyPayment } from "./verify.js";
import { formatBaseUnits } from "./catalog.js";

const RECIPIENT = Keypair.generate().publicKey.toBase58();
const PRICE = 2_500_000n; // 2.5 SKR

class FakeChain implements SkrChain {
  txs = new Map<string, PaymentTx>();
  byReference = new Map<string, string[]>();
  mint: { owner: string; decimals: number } | null = { owner: TOKEN_PROGRAM_ID, decimals: 6 };
  down = false;
  async getMint() { if (this.down) throw new Error("rpc down"); return this.mint; }
  async accountExists() { return true; }
  async getTransaction(sig: string) { if (this.down) throw new Error("rpc down"); return this.txs.get(sig) ?? null; }
  async getSignaturesForAddress(addr: string) { return this.byReference.get(addr) ?? []; }
  /** 造一筆「wallet 付 amount 到訂單收款 ATA」的交易 */
  pay(order: { reference: string; recipientTokenAccount: string; mint: string }, opts: { from: string; amount: bigint; sig?: string; err?: unknown; blockTime?: Date; mint?: string; withReference?: boolean }) {
    const sig = opts.sig ?? bs58.encode(nacl.randomBytes(64));
    const mint = opts.mint ?? order.mint;
    const payerAta = associatedTokenAddress(opts.from, mint);
    const tx: PaymentTx = { signature: sig, slot: 1000n, blockTime: opts.blockTime ?? new Date("2026-09-22T00:05:00Z"), err: opts.err ?? null, accountKeys: [opts.from, payerAta, order.recipientTokenAccount, ...(opts.withReference === false ? [] : [order.reference])], deltas: [
      { account: payerAta, owner: opts.from, mint, pre: 10_000_000n, post: 10_000_000n - opts.amount },
      { account: order.recipientTokenAccount, owner: RECIPIENT, mint, pre: 0n, post: opts.amount },
    ] };
    this.txs.set(sig, tx);
    this.byReference.set(order.reference, [sig, ...(this.byReference.get(order.reference) ?? [])]);
    return sig;
  }
}

describe("verifyPayment（純函式）", () => {
  const order = { orderId: "o", wallet: "W", sku: "genesis_mint_frame", skuVersion: 1, cosmeticId: "c", network: "mainnet-beta" as const, mint: "M", decimals: 6, amount: PRICE, recipient: RECIPIENT, recipientTokenAccount: "RATA", reference: "REF", eligibilityRef: "a", sourceEnv: "test", status: "confirming" as const, signature: null, paidAmount: null, paidSlot: null, paidAt: null, failureReason: null, expiresAt: new Date("2026-09-22T00:15:00Z"), createdAt: new Date(), updatedAt: new Date() };
  const tx = (o: Partial<PaymentTx>): PaymentTx => ({ signature: "s", slot: 1n, blockTime: new Date("2026-09-22T00:05:00Z"), err: null, accountKeys: ["W", "RATA", "REF"], deltas: [{ account: "PATA", owner: "W", mint: "M", pre: 5_000_000n, post: 2_500_000n }, { account: "RATA", owner: RECIPIENT, mint: "M", pre: 0n, post: 2_500_000n }], ...o });
  it("成功／失敗／缺 reference／錯 mint／金額不足／他人付款／逾期寬限", () => {
    expect(verifyPayment(tx({}), order, 600)).toMatchObject({ ok: true, paid: PRICE });
    expect(verifyPayment(tx({ err: { InstructionError: [0, "Custom"] } }), order, 600)).toMatchObject({ ok: false, reason: "tx_failed" });
    expect(verifyPayment(tx({ accountKeys: ["W", "RATA"] }), order, 600)).toMatchObject({ ok: false, reason: "reference_missing" });
    expect(verifyPayment(tx({ deltas: [{ account: "PATA", owner: "W", mint: "OTHER", pre: 5_000_000n, post: 0n }, { account: "RATA", owner: RECIPIENT, mint: "OTHER", pre: 0n, post: 5_000_000n }] }), order, 600)).toMatchObject({ ok: false, reason: "recipient_not_credited" });
    expect(verifyPayment(tx({ deltas: [{ account: "PATA", owner: "W", mint: "M", pre: 5_000_000n, post: 4_000_000n }, { account: "RATA", owner: RECIPIENT, mint: "M", pre: 0n, post: 1_000_000n }] }), order, 600)).toMatchObject({ ok: false, reason: "underpaid" });
    expect(verifyPayment(tx({ deltas: [{ account: "XATA", owner: "SOMEONE", mint: "M", pre: 5_000_000n, post: 2_500_000n }, { account: "RATA", owner: RECIPIENT, mint: "M", pre: 0n, post: 2_500_000n }] }), order, 600)).toMatchObject({ ok: false, reason: "payer_mismatch" });
    expect(verifyPayment(tx({ blockTime: new Date("2026-09-22T00:24:00Z") }), order, 600).ok).toBe(true); // 期限 00:15 ＋ 寬限 10 分
    expect(verifyPayment(tx({ blockTime: new Date("2026-09-22T00:26:00Z") }), order, 600)).toMatchObject({ ok: false, reason: "late" });
    expect(verifyPayment(tx({ deltas: [{ account: "PATA", owner: "W", mint: "M", pre: 5_000_000n, post: 2_000_000n }, { account: "RATA", owner: RECIPIENT, mint: "M", pre: 0n, post: 3_000_000n }] }), order, 600)).toMatchObject({ ok: true, paid: 3_000_000n }); // 多付照記實收
  });
  it("最小單位顯示", () => { expect(formatBaseUnits(2_500_000n, 6)).toBe("2.5"); expect(formatBaseUnits(1_000_000n, 6)).toBe("1"); expect(formatBaseUnits(1n, 6)).toBe("0.000001"); });
});

describe("設定守門（SKR-01）", () => {
  const base = { NODE_ENV: "test", SKR_ENABLED: "true", SKR_RECIPIENT: RECIPIENT, SKR_GENESIS_FRAME_PRICE: String(PRICE) };
  it("主網必須官方 mint；devnet 不可沿用官方 mint；缺價格／收款人拒絕", () => {
    expect(() => loadConfig({ ...base, SKR_MINT: Keypair.generate().publicKey.toBase58() })).toThrow(/官方/);
    expect(() => loadConfig({ ...base, SKR_NETWORK: "devnet" })).toThrow(/devnet/);
    expect(() => loadConfig({ NODE_ENV: "test", SKR_ENABLED: "true", SKR_RECIPIENT: RECIPIENT })).toThrow(/SKR_GENESIS_FRAME_PRICE/);
    expect(loadConfig(base).SKR_MINT).toBe(OFFICIAL_SKR_MINT);
    expect(loadConfig({ ...base, SKR_NETWORK: "devnet", SKR_MINT: Keypair.generate().publicKey.toBase58() }).SKR_NETWORK).toBe("devnet");
  });
});

describe("SKR 訂單 API", () => {
  const db: Db = { pool: null, ping: async () => false, close: async () => {} };
  let app: ReturnType<typeof buildApp>;
  let store: MemoryStore;
  let chain: FakeChain;
  let clock = new Date("2026-09-22T00:00:00Z");
  const mk = (env: Record<string, string> = {}) => { store = new MemoryStore(); chain = new FakeChain(); app = buildApp({ config: loadConfig({ NODE_ENV: "test", RATE_LIMIT_SENSITIVE_PER_MINUTE: "1000", RATE_LIMIT_PER_MINUTE: "5000", SKR_ENABLED: "true", SKR_RECIPIENT: RECIPIENT, SKR_GENESIS_FRAME_PRICE: String(PRICE), SKR_ORDER_TTL_SEC: "900", SKR_PAYMENT_GRACE_SEC: "600", ...env }), db, store, now: () => clock, signer: LocalKeypairSigner.random(), skrChain: chain }); return app.ready(); };
  beforeEach(async () => { clock = new Date("2026-09-22T00:00:00Z"); await mk(); });
  afterEach(async () => app.close());
  type U = { wallet: string; h: { authorization: string }; refresh: () => Promise<void> };
  /** 時鐘推進後 access token 會過期：呼叫 refresh 以同一把錢包重新登入 */
  async function login(): Promise<U> {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const auth = async () => {
      const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
      const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
      const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
      return { authorization: `Bearer ${v.access_token as string}` };
    };
    const u: U = { wallet, h: await auth(), refresh: async () => { u.h = await auth(); } };
    return u;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (r: { json: () => unknown }) => r.json() as Record<string, any>;
  /** 直接在 store 造一枚已登錄的 first_5k 成就（真實路徑：跑步匯入 → 里程碑 → ops 登錄 approved） */
  const grant5k = async (wallet: string, status: "approved" | "minted" | "pending_registry" | "revoked" = "approved") => {
    const achievementId = `ach-${wallet.slice(0, 6)}`;
    await store.upsertAchievement({ achievementId, wallet, kind: "milestone", pbId: null, milestoneKey: "first_5k|outdoor|device", sourceKind: "workout", sourceId: "s1", category: "first_5k", verificationClass: "device", sourceRevision: 1, rulesMajor: 1, publicConsent: false, metadata: {}, metadataHash: Buffer.alloc(32), status: "pending_registry", registrySignature: null, registryUpdatedAt: null, asset: null, mintedSignature: null, mintedAt: null }, clock);
    if (status !== "pending_registry") await store.setAchievementStatus(achievementId, status, {}, clock);
  };
  const create = (u: U) => app.inject({ method: "POST", url: "/v1/me/skr/orders", headers: u.h, payload: { sku: "genesis_mint_frame" } });
  const confirm = (u: U, id: string, signature: string) => app.inject({ method: "POST", url: `/v1/me/skr/orders/${id}/confirm`, headers: u.h, payload: { signature } });

  it("停用時目錄 enabled=false、建單 503；mint 不是 SPL Token 也停用", async () => {
    await app.close(); await mk({ SKR_ENABLED: "false" });
    const u = await login();
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/catalog", headers: u.h }))).toEqual({ enabled: false, reason: "not_configured" });
    expect((await create(u)).statusCode).toBe(503);
    await app.close(); store = new MemoryStore(); chain = new FakeChain(); chain.mint = { owner: "SomeOtherProgram11111111111111111111111111111", decimals: 6 };
    app = buildApp({ config: loadConfig({ NODE_ENV: "test", SKR_ENABLED: "true", SKR_RECIPIENT: RECIPIENT, SKR_GENESIS_FRAME_PRICE: String(PRICE) }), db, store, now: () => clock, signer: LocalKeypairSigner.random(), skrChain: chain }); await app.ready();
    const u2 = await login();
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/catalog", headers: u2.h })).reason).toBe("mint_owner_mismatch");
  });

  it("目錄：資格由伺服器成就狀態決定（not_achieved／pending_registry／eligible／revoked）；價格與收款 ATA 由伺服器給", async () => {
    const u = await login();
    let c = j(await app.inject({ method: "GET", url: "/v1/me/skr/catalog", headers: u.h }));
    expect(c).toMatchObject({ enabled: true, network: "mainnet-beta", mint: OFFICIAL_SKR_MINT, decimals: 6, recipient: RECIPIENT, recipient_token_account: associatedTokenAddress(RECIPIENT, OFFICIAL_SKR_MINT) });
    expect(c.skus[0]).toMatchObject({ sku: "genesis_mint_frame", version: 1, cosmetic_id: "skr_genesis_mint_frame_v1", price_base_units: "2500000", price_display: "2.5", eligibility: "not_achieved", owned: false, open_order: null });
    expect(j(await create(u))).toMatchObject({ error: { code: "NOT_ELIGIBLE" } });
    await grant5k(u.wallet, "pending_registry");
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/catalog", headers: u.h })).skus[0].eligibility).toBe("pending_registry");
    expect((await create(u)).statusCode).toBe(409);
    await grant5k(u.wallet, "approved");
    c = j(await app.inject({ method: "GET", url: "/v1/me/skr/catalog", headers: u.h }));
    expect(c.skus[0].eligibility).toBe("eligible");
  });

  it("建單冪等（重複點擊回同一張）；確認：RPC 未見 → confirming 不重扣；見到且正確 → fulfilled＋權限；再確認回同結果；已擁有不能再建", async () => {
    const u = await login(); await grant5k(u.wallet);
    const r1 = await create(u); expect(r1.statusCode).toBe(201);
    const o = j(r1).order;
    expect(o).toMatchObject({ status: "awaiting_payment", amount_base_units: "2500000", amount_display: "2.5", network: "mainnet-beta", mint: OFFICIAL_SKR_MINT, recipient_token_account: associatedTokenAddress(RECIPIENT, OFFICIAL_SKR_MINT), expires_at: "2026-09-22T00:15:00.000Z" });
    const r2 = await create(u); expect([r2.statusCode, j(r2).created, j(r2).order.order_id]).toEqual([200, false, o.order_id]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/catalog", headers: u.h })).skus[0].open_order.order_id).toBe(o.order_id);
    const sig = bs58.encode(nacl.randomBytes(64));
    let c = j(await confirm(u, o.order_id, sig));
    expect(c).toMatchObject({ found: false, order: { status: "confirming", signature: sig } });
    chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE, sig });
    c = j(await confirm(u, o.order_id, sig));
    expect(c).toMatchObject({ found: true, order: { status: "fulfilled", signature: sig, paid_amount_base_units: "2500000" } });
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/entitlements", headers: u.h })).entitlements).toEqual([{ cosmetic_id: "skr_genesis_mint_frame_v1", order_id: o.order_id, status: "active", granted_at: clock.toISOString() }]);
    expect(j(await confirm(u, o.order_id, sig)).order.status).toBe("fulfilled");
    expect(j(await create(u))).toMatchObject({ error: { code: "ALREADY_OWNED" } });
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/catalog", headers: u.h })).skus[0]).toMatchObject({ owned: true, open_order: null });
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/orders", headers: u.h })).orders).toHaveLength(1);
  });

  it("重放：同一筆付款不得兌換第二張訂單（另一錢包／同錢包新訂單）", async () => {
    const a = await login(); await grant5k(a.wallet);
    const b = await login(); await grant5k(b.wallet);
    const oa = j(await create(a)).order;
    const sig = chain.pay({ reference: oa.reference, recipientTokenAccount: oa.recipient_token_account, mint: oa.mint }, { from: a.wallet, amount: PRICE });
    expect(j(await confirm(a, oa.order_id, sig)).order.status).toBe("fulfilled");
    const ob = j(await create(b)).order;
    expect(j(await confirm(b, ob.order_id, sig))).toMatchObject({ error: { code: "PAYMENT_ALREADY_USED" } });
    expect(j(await app.inject({ method: "GET", url: `/v1/me/skr/orders/${ob.order_id}`, headers: b.h })).order.status).toBe("awaiting_payment");
  });

  it("他人付款／錯 mint／金額不足 → needs_review 不履約；交易失敗 → 回 awaiting_payment 可重付；缺 reference 不算", async () => {
    const u = await login(); await grant5k(u.wallet);
    const o = j(await create(u)).order;
    const other = Keypair.generate().publicKey.toBase58();
    let sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: other, amount: PRICE });
    let c = j(await confirm(u, o.order_id, sig));
    expect(c).toMatchObject({ found: true, verify: "payer_mismatch", order: { status: "needs_review" } });
    expect(j(await app.inject({ method: "GET", url: "/v1/me/skr/entitlements", headers: u.h })).entitlements).toEqual([]);
    // needs_review 不可取消（付款可能已發生）
    expect((await app.inject({ method: "POST", url: `/v1/me/skr/orders/${o.order_id}/cancel`, headers: u.h })).statusCode).toBe(409);
    const o2 = j(await create(u)).order; // 既有 needs_review 視為未終結 → 回同一張
    expect(o2.order_id).toBe(o.order_id);
    sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE, mint: Keypair.generate().publicKey.toBase58() });
    expect(j(await confirm(u, o.order_id, sig)).verify).toBe("recipient_not_credited");
    sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: 1_000_000n });
    expect(j(await confirm(u, o.order_id, sig)).verify).toBe("underpaid");
    sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE, withReference: false });
    expect(j(await confirm(u, o.order_id, sig)).verify).toBe("reference_missing");
    sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE, err: { InstructionError: [1, "Custom"] } });
    c = j(await confirm(u, o.order_id, sig));
    expect(c).toMatchObject({ verify: "tx_failed", order: { status: "awaiting_payment", signature: null } });
    // 之後正確付款仍可履約
    sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE });
    expect(j(await confirm(u, o.order_id, sig)).order.status).toBe("fulfilled");
  });

  it("逾期：未付 → expired（可重建）；逾期後寬限內付款仍履約；超過寬限 → needs_review 不要求再付", async () => {
    const u = await login(); await grant5k(u.wallet);
    const o = j(await create(u)).order;
    clock = new Date("2026-09-22T00:16:00Z"); await u.refresh();
    expect(j(await app.inject({ method: "GET", url: `/v1/me/skr/orders/${o.order_id}`, headers: u.h })).order.status).toBe("expired");
    const o2 = j(await create(u)).order; expect(o2.order_id).not.toBe(o.order_id);
    // 舊訂單在寬限內付款（blockTime 00:20 ≤ 00:15 + 10 分）
    let sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE, blockTime: new Date("2026-09-22T00:20:00Z") });
    expect(j(await confirm(u, o.order_id, sig)).order.status).toBe("fulfilled");
    // 另一位：超過寬限
    const v = await login(); await grant5k(v.wallet);
    const ov = j(await create(v)).order;
    expect(ov.status).toBe("awaiting_payment");
    sig = chain.pay({ reference: ov.reference, recipientTokenAccount: ov.recipient_token_account, mint: ov.mint }, { from: v.wallet, amount: PRICE, blockTime: new Date("2026-09-22T00:45:00Z") }); // 建於 00:16 → 期限 00:31 ＋ 寬限 10 分 = 00:41
    expect(j(await confirm(v, ov.order_id, sig))).toMatchObject({ verify: "late", order: { status: "needs_review" } });
  });

  it("復原：App 遺失 signature → 以 reference 反查；未付 → found=false；取消只限 awaiting_payment；RPC 中斷 → 500 不改狀態", async () => {
    const u = await login(); await grant5k(u.wallet);
    const o = j(await create(u)).order;
    let r = j(await app.inject({ method: "POST", url: `/v1/me/skr/orders/${o.order_id}/recover`, headers: u.h }));
    expect(r).toMatchObject({ found: false, order: { status: "awaiting_payment" } });
    chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE });
    r = j(await app.inject({ method: "POST", url: `/v1/me/skr/orders/${o.order_id}/recover`, headers: u.h }));
    expect(r.order.status).toBe("fulfilled");
    const w = await login(); await grant5k(w.wallet);
    const ow = j(await create(w)).order;
    chain.down = true;
    expect((await confirm(w, ow.order_id, bs58.encode(nacl.randomBytes(64)))).statusCode).toBe(500);
    chain.down = false;
    // signature 已記錄 → confirming；期限內不可取消（付款可能已送出）
    expect(j(await app.inject({ method: "GET", url: `/v1/me/skr/orders/${ow.order_id}`, headers: w.h })).order.status).toBe("confirming");
    expect((await app.inject({ method: "POST", url: `/v1/me/skr/orders/${ow.order_id}/cancel`, headers: w.h })).statusCode).toBe(409);
    // 期限＋寬限過後 RPC 仍查無此交易 → 可取消並重建
    clock = new Date("2026-09-22T00:30:00Z"); await w.refresh();
    expect(j(await app.inject({ method: "POST", url: `/v1/me/skr/orders/${ow.order_id}/cancel`, headers: w.h })).order.status).toBe("cancelled");
    expect((await create(w)).statusCode).toBe(201); // 取消後可重建
  });

  it("他人不可讀取／確認我的訂單；錢包刪除清除權限與未履約訂單但保留已履約紀錄", async () => {
    const u = await login(); await grant5k(u.wallet);
    const v = await login();
    const o = j(await create(u)).order;
    expect((await app.inject({ method: "GET", url: `/v1/me/skr/orders/${o.order_id}`, headers: v.h })).statusCode).toBe(404);
    expect((await confirm(v, o.order_id, bs58.encode(nacl.randomBytes(64)))).statusCode).toBe(404);
    const sig = chain.pay({ reference: o.reference, recipientTokenAccount: o.recipient_token_account, mint: o.mint }, { from: u.wallet, amount: PRICE });
    expect(j(await confirm(u, o.order_id, sig)).order.status).toBe("fulfilled");
    await store.deletePlayerData(u.wallet, clock, null);
    expect(await store.listSkrEntitlements(u.wallet)).toEqual([]);
    expect((await store.getSkrOrder(o.order_id))?.status).toBe("fulfilled");
    expect((await store.getSkrReceipt(sig))?.orderId).toBe(o.order_id);
  });
});
