/**
 * SKR-04 付款查驗（純函式）：交易成功、帶訂單 reference、目的 token account 為訂單收款 ATA 且 mint 正確、實收 ≥ 金額、
 * 來源帳戶 owner 為訂單錢包（他人代付不算）、鏈上時間在期限＋寬限內。不查驗的部分（網路）由 RPC 本身決定：
 * devnet 的 signature 在主網 RPC 查不到 → 不履約。
 */
import type { PaymentTx } from "./chain.js";
import type { SkrOrder } from "../store/types.js";

export type VerifyResult =
  | { ok: true; paid: bigint; slot: bigint; blockTime: Date | null }
  | { ok: false; reason: "tx_failed" | "reference_missing" | "recipient_not_credited" | "underpaid" | "payer_mismatch" | "late"; detail?: string };

export function verifyPayment(tx: PaymentTx, order: SkrOrder, graceSec: number): VerifyResult {
  if (tx.err !== null && tx.err !== undefined) return { ok: false, reason: "tx_failed", detail: JSON.stringify(tx.err) };
  if (!tx.accountKeys.includes(order.reference)) return { ok: false, reason: "reference_missing" };
  const credited = tx.deltas.find((d) => d.account === order.recipientTokenAccount && d.mint === order.mint);
  const received = credited ? credited.post - credited.pre : 0n;
  if (received <= 0n) return { ok: false, reason: "recipient_not_credited" };
  if (received < order.amount) return { ok: false, reason: "underpaid", detail: `${received.toString()} < ${order.amount.toString()}` };
  // 來源：訂單錢包擁有的同 mint 帳戶必須減少至少訂單金額（避免第三方替另一張訂單付款、或以他人交易冒領）
  const debited = tx.deltas.filter((d) => d.mint === order.mint && d.owner === order.wallet).reduce((acc, d) => acc + (d.pre - d.post), 0n);
  if (debited < order.amount) return { ok: false, reason: "payer_mismatch", detail: `debited ${debited.toString()}` };
  if (tx.blockTime && tx.blockTime.getTime() > order.expiresAt.getTime() + graceSec * 1000) return { ok: false, reason: "late", detail: tx.blockTime.toISOString() };
  return { ok: true, paid: received, slot: tx.slot, blockTime: tx.blockTime };
}
