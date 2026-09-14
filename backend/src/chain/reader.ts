/** 只讀鏈上狀態（PG-B-14）。RPC 實作附短快取，避免每個請求都打 RPC；測試用 StaticChainReader。 */
import { Connection, PublicKey } from "@solana/web3.js";

import bs58 from "bs58";

import { decodeEntry, decodeTournament, ENTRY_DISCRIMINATOR, entryPda, tournamentPda, type EntryView, type TournamentView } from "./tournament.js";

export interface ChainReader {
  getTournament(weekId: number): Promise<TournamentView | null>;
  hasEntry(weekId: number, wallet: string): Promise<boolean>;
  /** 該賽事所有 TournamentEntry（結算 manifest 需要全體報名者，含未回報步數者） */
  listEntries(weekId: number): Promise<EntryView[]>;
}

export class RpcChainReader implements ChainReader {
  private readonly conn: Connection;
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    rpcUrl: string,
    private readonly programId: PublicKey,
    private readonly ttlMs = 15_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.conn = new Connection(rpcUrl, "confirmed");
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  getTournament(weekId: number) {
    return this.cached(`t:${weekId}`, async () => {
      const pda = tournamentPda(this.programId, weekId);
      const info = await this.conn.getAccountInfo(pda, "confirmed");
      if (!info || !info.owner.equals(this.programId)) return null;
      return decodeTournament(pda, Buffer.from(info.data));
    });
  }

  listEntries(weekId: number) {
    return this.cached(`entries:${weekId}`, async () => {
      const tournament = tournamentPda(this.programId, weekId);
      const accounts = await this.conn.getProgramAccounts(this.programId, {
        commitment: "confirmed",
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode(ENTRY_DISCRIMINATOR) } }, { memcmp: { offset: 8, bytes: tournament.toBase58() } }],
      });
      return accounts.map((a) => decodeEntry(Buffer.from(a.account.data)));
    });
  }

  hasEntry(weekId: number, wallet: string) {
    return this.cached(`e:${weekId}:${wallet}`, async () => {
      const pda = entryPda(this.programId, tournamentPda(this.programId, weekId), new PublicKey(wallet));
      const info = await this.conn.getAccountInfo(pda, "confirmed");
      return info !== null && info.owner.equals(this.programId);
    });
  }
}

/** 測試／未設定 PROGRAM_ID 時：固定資料 */
export class StaticChainReader implements ChainReader {
  tournaments = new Map<number, TournamentView>();
  entries = new Set<string>();
  forfeited = new Set<string>();
  async getTournament(weekId: number) {
    return this.tournaments.get(weekId) ?? null;
  }
  async hasEntry(weekId: number, wallet: string) {
    return this.entries.has(`${weekId}:${wallet}`);
  }
  async listEntries(weekId: number) {
    return [...this.entries]
      .filter((k) => k.startsWith(`${weekId}:`))
      .map((k) => k.slice(String(weekId).length + 1))
      .map((wallet) => ({ wallet, stake: 0n, finalSteps: 0n, rank: 0, group: 0, forfeited: this.forfeited.has(`${weekId}:${wallet}`), settled: false, joinedAt: 0 }));
  }
}
