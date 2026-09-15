/**
 * PG-V-02：既有玩家帳戶遷移（`migrate_player`，admin 付 rent 差額）與批次結算（`settle_player_epochs`）。
 *   npm run admin -- migrate-players <env> [--dry-run]     # 掃描 71-byte 舊版 PlayerProfile 逐一遷移
 *   npm run admin -- settle-players <env> [--dry-run]      # 對所有已遷移帳戶送結算（任何 payer；已追平者 no-op）
 * 遷移保留目前與歷史鞋階、自當日起新週期（shoe-gameplay 4.3）；App 端在下次打卡也會自動前置遷移，本命令供上線時一次性補齊。
 */
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";

import type { Ctx } from "./client.js";

const V1_SPACE = 8 + 63;
const V2_SPACE = 8 + 63 + 14;
const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

async function profiles(ctx: Ctx, dataSize: number) {
  // memcmp bytes 需 base58 編碼的 8-byte discriminator
  const accounts = await ctx.connection.getProgramAccounts(ctx.programId, { dataSlice: { offset: 8, length: 32 }, filters: [{ dataSize }, { memcmp: { offset: 0, bytes: encodeBase58(disc("PlayerProfile")) } }] });
  return accounts.map((a) => ({ profile: a.pubkey, wallet: new PublicKey(a.account.data.subarray(0, 32)) }));
}
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** 最小 base58 編碼（避免額外相依） */
function encodeBase58(buf: Buffer): string {
  let n = BigInt("0x" + buf.toString("hex"));
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}

export async function migratePlayers(ctx: Ctx, dryRun: boolean) {
  const old = await profiles(ctx, V1_SPACE);
  console.log(`舊版 PlayerProfile：${old.length} 個`);
  for (const p of old) {
    console.log(`migrate ${p.wallet.toBase58()} → ${p.profile.toBase58()}`);
    if (dryRun) continue;
    const sig = await ctx.program.methods.migratePlayer().accounts({ payer: ctx.admin.publicKey, profile: p.profile, systemProgram: SystemProgram.programId }).signers([ctx.admin]).rpc({ commitment: "confirmed" });
    console.log(`  tx ${sig}`);
  }
}

export async function settlePlayers(ctx: Ctx, dryRun: boolean) {
  const list = await profiles(ctx, V2_SPACE);
  console.log(`已遷移 PlayerProfile：${list.length} 個`);
  for (const p of list) {
    console.log(`settle ${p.wallet.toBase58()}`);
    if (dryRun) continue;
    const sig = await ctx.program.methods.settlePlayerEpochs(64).accounts({ payer: ctx.admin.publicKey, config: ctx.configPda, profile: p.profile }).signers([ctx.admin]).rpc({ commitment: "confirmed" });
    console.log(`  tx ${sig}`);
  }
}
