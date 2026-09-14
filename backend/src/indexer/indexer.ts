/**
 * ChainIndexer（PG-B-16，SD 4.5）。
 * 1. `syncConfirmed()`：以 `getSignaturesForAddress(program, confirmed)` 由游標往前抓新簽章，逐筆取交易 log、
 *    解碼事件並以 `(signature, event_index)` 冪等寫入 `chain_events`（commitment = confirmed）。失敗交易跳過。
 * 2. `finalize()`：對尚未 finalized 的 row 查 `getSignatureStatuses`：finalized → 升級並執行 projection
 *    （redeemed_sig 回填、藝廊等）；若簽章已不在鏈上（狀態 null 且已超過 `orphanAfterSlots`）→ 標 `orphaned_at`，
 *    不刪 row。projection 只吃 finalized，因此 orphan 不需回滾 projection；UI 可讀 confirmed 快速顯示。
 * 3. 游標存 `chain_cursor`；重啟從游標續抓，最舊一批不足 1,000 筆時再往回補（`getSignaturesForAddress` 的 before 分頁）。
 */
import type { GalleryStore, IndexerStore } from "../store/types.js";
import { parseProgramEvents, type DecodedEvent, type EventDecoder } from "./events.js";

export type SignatureInfo = { signature: string; slot: number; err: unknown | null; blockTime: number | null };
export type TxInfo = { slot: number; blockhash: string; logs: string[]; err: unknown | null } | null;

export interface IndexerRpc {
  getSignaturesForAddress(address: string, opts: { until?: string | undefined; before?: string | undefined; limit: number }): Promise<SignatureInfo[]>;
  getTransaction(signature: string): Promise<TxInfo>;
  /** 每個簽章：'confirmed' | 'finalized' | null（不在鏈上） */
  getSignatureStatuses(signatures: string[]): Promise<("processed" | "confirmed" | "finalized" | null)[]>;
  getSlot(): Promise<number>;
}

export type ChainEventRecord = { signature: string; eventIndex: number; slot: number; blockhash: string; name: string; payload: Record<string, unknown> };

/** projection：只在事件 finalized 時呼叫；必須冪等（同一事件可能因重啟被重放） */
export type ProjectionStore = IndexerStore & GalleryStore;
export type Projection = (event: ChainEventRecord, store: ProjectionStore, now: Date) => Promise<void>;

export const CURSOR_NAME = "neonshift_core";

export class ChainIndexer {
  constructor(
    private readonly rpc: IndexerRpc,
    private readonly store: ProjectionStore,
    private readonly decoder: EventDecoder,
    private readonly projections: Projection[],
    private readonly opts: { pageLimit?: number; orphanAfterSlots?: number; now?: () => Date; log?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void } } = {},
  ) {}

  private now(): Date {
    return (this.opts.now ?? (() => new Date()))();
  }

  /** 抓取游標之後的新簽章（回傳寫入的事件數） */
  async syncConfirmed(): Promise<{ transactions: number; events: number }> {
    const cursor = await this.store.getCursor(CURSOR_NAME);
    const limit = this.opts.pageLimit ?? 1000;
    const all: SignatureInfo[] = [];
    let before: string | undefined;
    // 新→舊分頁直到碰到游標或抓完
    for (;;) {
      const page = await this.rpc.getSignaturesForAddress(this.decoder.programId, { until: cursor?.signature, before, limit });
      all.push(...page);
      if (page.length < limit) break;
      before = page[page.length - 1]!.signature;
    }
    all.reverse(); // 舊→新處理
    let events = 0;
    let transactions = 0;
    for (const sig of all) {
      if (sig.err) {
        // 失敗交易沒有狀態變更；仍推進游標
        await this.store.setCursor(CURSOR_NAME, sig.signature, sig.slot);
        continue;
      }
      const tx = await this.rpc.getTransaction(sig.signature);
      if (!tx || tx.err) {
        await this.store.setCursor(CURSOR_NAME, sig.signature, sig.slot);
        continue;
      }
      const decoded = parseProgramEvents(tx.logs, this.decoder);
      for (const [i, ev] of decoded.entries()) {
        await this.store.insertChainEvent({ signature: sig.signature, eventIndex: i, slot: tx.slot, blockhash: tx.blockhash, commitment: "confirmed", eventName: ev.name, payload: ev.data }, this.now());
        events++;
      }
      transactions++;
      await this.store.setCursor(CURSOR_NAME, sig.signature, sig.slot);
    }
    return { transactions, events };
  }

  /** 把 confirmed 事件追蹤到 finalized（跑 projection）或 orphaned */
  async finalize(): Promise<{ finalized: number; orphaned: number }> {
    const pending = await this.store.listPendingChainEvents(500);
    if (pending.length === 0) return { finalized: 0, orphaned: 0 };
    const sigs = [...new Set(pending.map((p) => p.signature))];
    const statuses = await this.rpc.getSignatureStatuses(sigs);
    const status = new Map(sigs.map((s, i) => [s, statuses[i] ?? null]));
    const currentSlot = await this.rpc.getSlot();
    const orphanAfter = this.opts.orphanAfterSlots ?? 300;
    const now = this.now();
    let finalized = 0;
    let orphaned = 0;
    for (const ev of pending) {
      const st = status.get(ev.signature) ?? null;
      if (st === "finalized") {
        await this.store.finalizeChainEvent(ev.signature, ev.eventIndex);
        for (const p of this.projections) await p({ signature: ev.signature, eventIndex: ev.eventIndex, slot: ev.slot, blockhash: ev.blockhash, name: ev.eventName, payload: ev.payload }, this.store, now);
        finalized++;
      } else if (st === null && currentSlot - ev.slot > orphanAfter) {
        await this.store.markChainEventOrphaned(ev.signature, ev.eventIndex, now);
        this.opts.log?.warn({ signature: ev.signature, slot: ev.slot }, "chain event orphaned");
        orphaned++;
      }
    }
    return { finalized, orphaned };
  }

  async runOnce() {
    const s = await this.syncConfirmed();
    const f = await this.finalize();
    if (s.events || f.finalized || f.orphaned) this.opts.log?.info({ ...s, ...f }, "indexer tick");
    return { ...s, ...f };
  }
}

// ---------------- projections ----------------

/** ClockedIn → attestations.redeemed_sig 回填（以 nonce 對應） */
export const redeemedSigProjection: Projection = async (ev, store) => {
  if (ev.name !== "ClockedIn") return;
  const nonceHex = ev.payload.nonce as string;
  await store.backfillRedeemedSig(Buffer.from(nonceHex, "hex"), ev.signature);
};

export const eventDataOf = (e: DecodedEvent) => e.data;
