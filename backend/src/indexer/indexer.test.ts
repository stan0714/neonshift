/** PG-B-16：IDL 事件解碼（含 CPI 深度）、confirmed→finalized、orphan 標記、redeemed_sig 回填、游標與冪等。 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { MemoryStore } from "../store/memory.js";
import { EventDecoder, parseProgramEvents } from "./events.js";
import { ChainIndexer, CURSOR_NAME, redeemedSigProjection, type IndexerRpc, type SignatureInfo, type TxInfo } from "./indexer.js";

const decoder = EventDecoder.fromFile(resolve(process.cwd(), "idl/neonshift_core.json"));
const PROGRAM = decoder.programId;
const MPL = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

/** 依 IDL 手組 ClockedIn 事件 bytes（與程式 borsh 一致） */
function clockedInBytes(wallet: PublicKey, nonce: Buffer, over: Partial<{ xp: bigint; shoe: number; streak: number; maxStreak: number }> = {}) {
  const disc = (decoder as unknown as { byDisc: Map<string, { name: string }> }).byDisc;
  const discHex = [...disc.entries()].find(([, v]) => v.name === "ClockedIn")![0];
  const b = Buffer.alloc(8 + 32 + 4 + 1 + 8 + 8 + 1 + 1 + 2 + 2 + 16);
  Buffer.from(discHex, "hex").copy(b, 0);
  wallet.toBuffer().copy(b, 8);
  let o = 40;
  b.writeUInt32LE(20_710, o); o += 4;
  b.writeUInt8(1, o++);
  b.writeBigUInt64LE(10_000_000n, o); o += 8;
  b.writeBigUInt64LE(over.xp ?? 100n, o); o += 8;
  b.writeUInt8(over.shoe ?? 1, o++);
  b.writeUInt8(1, o++);
  b.writeUInt16LE(over.streak ?? 1, o); o += 2;
  b.writeUInt16LE(over.maxStreak ?? 1, o); o += 2;
  nonce.copy(b, o);
  return b;
}

const logsFor = (program: string, data: Buffer, opts: { cpi?: boolean } = {}) => [
  `Program ${program} invoke [1]`,
  ...(opts.cpi ? [`Program ${MPL} invoke [2]`, `Program data: ${Buffer.from("junk-from-other-program").toString("base64")}`, `Program ${MPL} success`] : []),
  `Program data: ${data.toString("base64")}`,
  `Program ${program} success`,
];

class FakeRpc implements IndexerRpc {
  sigs: (SignatureInfo & { tx: TxInfo })[] = []; // 舊→新
  statuses = new Map<string, "confirmed" | "finalized" | null>();
  slot = 1_000;
  calls = { signatures: 0, tx: 0 };
  add(signature: string, slot: number, logs: string[], err: unknown = null) {
    this.sigs.push({ signature, slot, err, blockTime: null, tx: { slot, blockhash: "bh", logs, err } });
    this.statuses.set(signature, "confirmed");
  }
  async getSignaturesForAddress(_a: string, opts: { until?: string | undefined; before?: string | undefined; limit: number }) {
    this.calls.signatures++;
    let list = [...this.sigs].reverse(); // 新→舊
    if (opts.before) list = list.slice(list.findIndex((s) => s.signature === opts.before) + 1);
    if (opts.until) {
      const i = list.findIndex((s) => s.signature === opts.until);
      if (i >= 0) list = list.slice(0, i);
    }
    return list.slice(0, opts.limit).map(({ tx: _tx, ...s }) => s);
  }
  async getTransaction(signature: string) {
    this.calls.tx++;
    return this.sigs.find((s) => s.signature === signature)?.tx ?? null;
  }
  async getSignatureStatuses(signatures: string[]) {
    return signatures.map((s) => this.statuses.get(s) ?? null);
  }
  async getSlot() {
    return this.slot;
  }
}

describe("EventDecoder + parseProgramEvents", () => {
  it("解碼 IDL 事件；只取本程式深度的 Program data，忽略 CPI 內其他程式的資料", () => {
    const wallet = PublicKey.unique();
    const nonce = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
    const evs = parseProgramEvents(logsFor(PROGRAM, clockedInBytes(wallet, nonce, { xp: 450n, shoe: 2, streak: 3, maxStreak: 7 }), { cpi: true }), decoder);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.name).toBe("ClockedIn");
    expect(evs[0]!.data).toMatchObject({ wallet: wallet.toBase58(), task_date: 20_710, task_type: 1, amount: "10000000", xp: "450", shoe_level: 2, streak_days: 3, max_streak_days: 7, nonce: nonce.toString("hex") });
    // 其他程式的 data 不被當作本程式事件
    expect(parseProgramEvents(logsFor(MPL, clockedInBytes(wallet, nonce)), decoder)).toHaveLength(0);
    // 未知 discriminator → null
    expect(decoder.decode(Buffer.alloc(40))).toBeNull();
  });
});

describe("ChainIndexer", () => {
  it("confirmed 寫入（冪等）→ finalized 才跑 projection（redeemed_sig）→ 游標續抓 → 不在鏈上者標 orphaned", async () => {
    const store = new MemoryStore();
    const rpc = new FakeRpc();
    const wallet = PublicKey.unique();
    const nonce = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
    await store.insertAttestation({ nonce, idempotencyKey: randomUUID(), requestHash: Buffer.alloc(32), wallet: wallet.toBase58(), taskDate: 20_710, taskType: 1, rulesVersion: 3, evidenceHash: Buffer.alloc(32), issuedAt: new Date(), expiresAt: new Date() });
    rpc.add("sig1", 100, logsFor(PROGRAM, clockedInBytes(wallet, nonce)));
    rpc.add("sigFail", 101, logsFor(PROGRAM, clockedInBytes(wallet, nonce)), { InstructionError: [0, "Custom"] });
    rpc.add("sig2", 102, logsFor(PROGRAM, clockedInBytes(PublicKey.unique(), Buffer.alloc(16, 9))));
    const indexer = new ChainIndexer(rpc, store, decoder, [redeemedSigProjection], { pageLimit: 2, orphanAfterSlots: 10, now: () => new Date("2026-09-14T00:00:00Z") });

    let r = await indexer.runOnce();
    expect(r).toMatchObject({ transactions: 2, events: 2, finalized: 0, orphaned: 0 }); // 失敗交易略過
    expect(rpc.calls.signatures).toBe(2); // 分頁 2 + 2（第二頁不足 limit）
    expect((await store.getCursor(CURSOR_NAME))?.signature).toBe("sig2");
    expect((await store.listHistory(wallet.toBase58(), 0))[0]!.redeemedSig).toBeNull(); // 尚未 finalized

    // 再跑一次：沒有新簽章、不重複寫入
    r = await indexer.runOnce();
    expect(r.events).toBe(0);
    expect((await store.listChainEvents({}, 10))).toHaveLength(2);

    // sig1 finalized → 回填；sig2 消失且超過 orphanAfterSlots → orphaned
    rpc.statuses.set("sig1", "finalized");
    rpc.statuses.set("sig2", null);
    rpc.slot = 200;
    r = await indexer.runOnce();
    expect(r).toMatchObject({ finalized: 1, orphaned: 1 });
    expect((await store.listHistory(wallet.toBase58(), 0))[0]!.redeemedSig).toBe("sig1");
    const evs = await store.listChainEvents({}, 10);
    expect(evs.find((e) => e.signature === "sig1")).toMatchObject({ commitment: "finalized", orphanedAt: null });
    expect(evs.find((e) => e.signature === "sig2")?.orphanedAt).toBeInstanceOf(Date);
    expect(await store.listChainEvents({ finalizedOnly: true }, 10)).toHaveLength(1);
    expect(await store.listChainEvents({ eventName: "ClockedIn", wallet: wallet.toBase58() }, 10)).toHaveLength(1);

    // 新簽章接在游標後
    rpc.add("sig3", 300, logsFor(PROGRAM, clockedInBytes(wallet, Buffer.alloc(16, 1))));
    r = await indexer.runOnce();
    expect(r.events).toBe(1);
    expect((await store.getCursor(CURSOR_NAME))?.signature).toBe("sig3");
  });

  it("尚未超過 orphanAfterSlots 的 null 狀態保持 pending（RPC 暫時查不到不算 orphan）", async () => {
    const store = new MemoryStore();
    const rpc = new FakeRpc();
    rpc.add("s", 100, logsFor(PROGRAM, clockedInBytes(PublicKey.unique(), Buffer.alloc(16))));
    const indexer = new ChainIndexer(rpc, store, decoder, [], { orphanAfterSlots: 300 });
    await indexer.runOnce();
    rpc.statuses.set("s", null);
    rpc.slot = 150;
    expect(await indexer.finalize()).toEqual({ finalized: 0, orphaned: 0 });
    expect(await store.listPendingChainEvents(10)).toHaveLength(1);
  });
});
