/**
 * 錦標賽管理指令（PG-C-11～C-16 的 ops 入口，SD 6.2）。全部由 admin 簽章；結算流程：
 *   tournament create <env> <weekId> [--stake 50] [--injection-cap 1000] [--min 10] [--reg-end <unix>] [--start <unix>] [--end <unix>] [--rules 3]
 *   tournament open|lock|start|settle|cancel <env> <weekId>
 *   tournament forfeit <env> <weekId> <wallet> <evidenceHashHex>
 *   tournament begin <env> <weekId> --manifest <file.json>      # 後端 GET /tournament/{weekId}/manifest 的輸出
 *   tournament submit <env> <weekId> --manifest <file.json> [--batch 8]
 *   tournament show <env> <weekId>
 */
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
const { BN } = anchor;
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import type { Ctx } from "./client.js";
import { TSKR_UNIT } from "./client.js";
import { require_ } from "./env.js";

export function tournamentPda(programId: PublicKey, weekId: number) {
  const le = Buffer.alloc(4);
  le.writeUInt32LE(weekId);
  return PublicKey.findProgramAddressSync([Buffer.from("tournament"), le], programId)[0];
}
export const vaultPda = (programId: PublicKey, t: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), t.toBuffer()], programId)[0];
export const entryPda = (programId: PublicKey, t: PublicKey, wallet: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("entry"), t.toBuffer(), wallet.toBuffer()], programId)[0];

const flag = (rest: string[], name: string) => (rest.indexOf(name) >= 0 ? rest[rest.indexOf(name) + 1] : undefined);

type Manifest = { week_id: number; tournament: string; expected_count: number; results_hash_hex: string; consistent?: boolean; items: { rank: number; wallet: string; final_steps: number; first_reached_at: number }[] };

export async function tournamentCommand(ctx: Ctx, sub: string, weekArg: string | undefined, rest: string[]) {
  const { program, admin, env, configPda, programId } = ctx;
  if (!sub || !weekArg) throw new Error("用法：tournament <create|open|lock|start|forfeit|begin|submit|settle|cancel|show> <env> <weekId> [...]");
  const weekId = Number(weekArg);
  if (!Number.isInteger(weekId) || weekId < 2026_01 || weekId > 2100_53) throw new Error("weekId 必須是 ISO 年×100+週，例如 202638");
  const tournament = tournamentPda(programId, weekId);
  const vault = vaultPda(programId, tournament);
  const treasuryVault = new PublicKey(require_(env, "TREASURY_VAULT"));
  const mint = new PublicKey(require_(env, "TSKR_MINT"));
  const accounts = { admin: admin.publicKey, config: configPda, tournament };

  switch (sub) {
    case "create": {
      const now = Math.floor(Date.now() / 1000);
      const params = {
        weekId,
        stakeAmount: new BN(Number(flag(rest, "--stake") ?? 50) * TSKR_UNIT),
        treasuryInjectionCap: new BN(Number(flag(rest, "--injection-cap") ?? 1000) * TSKR_UNIT),
        minEntrants: Number(flag(rest, "--min") ?? 10),
        registrationEndsAt: new BN(Number(flag(rest, "--reg-end") ?? now + 86_400)),
        startsAt: new BN(Number(flag(rest, "--start") ?? now + 2 * 86_400)),
        endsAt: new BN(Number(flag(rest, "--end") ?? now + 4 * 86_400)),
        rulesVersion: Number(flag(rest, "--rules") ?? 3),
      };
      console.log({ tournament: tournament.toBase58(), vault: vault.toBase58(), ...params, stakeAmount: params.stakeAmount.toString(), treasuryInjectionCap: params.treasuryInjectionCap.toString() });
      const sig = await program.methods.createTournament(params).accounts({ ...accounts, mint, vault, tokenProgram: TOKEN_PROGRAM_ID }).signers([admin]).rpc();
      console.log("signature:", sig);
      break;
    }
    case "open":
      console.log("signature:", await program.methods.openTournament().accounts(accounts).signers([admin]).rpc());
      break;
    case "lock":
      console.log("signature:", await program.methods.lockTournament().accounts({ ...accounts, vault, treasuryVault, tokenProgram: TOKEN_PROGRAM_ID }).signers([admin]).rpc());
      break;
    case "start":
      console.log("signature:", await program.methods.startTournament().accounts({ payer: admin.publicKey, tournament }).signers([admin]).rpc());
      break;
    case "forfeit": {
      const [walletArg, evidenceHex] = rest;
      if (!walletArg || !evidenceHex || evidenceHex.length !== 64) throw new Error("需要 <wallet> <evidenceHashHex 32 bytes>");
      const t = await fetchTournament(ctx, tournament);
      const sig = await program.methods
        .forfeitEntry([...Buffer.from(evidenceHex, "hex")], t.rulesVersion)
        .accounts({ ...accounts, entry: entryPda(programId, tournament, new PublicKey(walletArg)) })
        .signers([admin])
        .rpc();
      console.log("signature:", sig);
      break;
    }
    case "begin": {
      const m = loadManifest(rest, weekId, tournament);
      const sig = await program.methods.beginSettlement(m.expected_count, [...Buffer.from(m.results_hash_hex, "hex")]).accounts(accounts).signers([admin]).rpc();
      console.log(`begin_settlement expected=${m.expected_count} hash=${m.results_hash_hex} signature:`, sig);
      break;
    }
    case "submit": {
      const m = loadManifest(rest, weekId, tournament);
      const batch = Number(flag(rest, "--batch") ?? 8);
      const t = await fetchTournament(ctx, tournament);
      const items = m.items.filter((i) => i.rank > t.resultsSubmitted).sort((a, b) => a.rank - b.rank);
      console.log(`已提交 ${t.resultsSubmitted}/${m.expected_count}，本次續傳 ${items.length} 筆，每批 ${batch}`);
      for (let i = 0; i < items.length; i += batch) {
        const chunk = items.slice(i, i + batch);
        const sig = await program.methods
          .submitResultsBatch(chunk.map((it) => ({ wallet: new PublicKey(it.wallet), finalSteps: new BN(it.final_steps), firstReachedAt: new BN(it.first_reached_at) })))
          .accounts(accounts)
          .remainingAccounts(chunk.map((it) => ({ pubkey: entryPda(programId, tournament, new PublicKey(it.wallet)), isSigner: false, isWritable: true })))
          .signers([admin])
          .rpc();
        console.log(`rank ${chunk[0]!.rank}..${chunk[chunk.length - 1]!.rank} signature:`, sig);
      }
      break;
    }
    case "settle":
      console.log("signature:", await program.methods.settleTournament().accounts({ ...accounts, vault, treasuryVault, tokenProgram: TOKEN_PROGRAM_ID }).signers([admin]).rpc());
      break;
    case "cancel":
      console.log("signature:", await program.methods.cancelTournament().accounts({ signer: admin.publicKey, config: configPda, tournament, vault, treasuryVault, tokenProgram: TOKEN_PROGRAM_ID }).signers([admin]).rpc());
      break;
    case "show": {
      const t = await fetchTournament(ctx, tournament);
      console.log(JSON.stringify({ address: tournament.toBase58(), vault: vault.toBase58(), ...t }, (_k, v) => (v && typeof v === "object" && "toBase58" in (v as object) ? (v as PublicKey).toBase58() : v instanceof BN ? v.toString() : Array.isArray(v) && v.length === 32 ? Buffer.from(v).toString("hex") : v), 2));
      break;
    }
    default:
      throw new Error(`未知子指令 tournament ${sub}`);
  }
}

async function fetchTournament(ctx: Ctx, address: PublicKey) {
  const acct = (ctx.program.account as Record<string, { fetch: (k: PublicKey) => Promise<Record<string, unknown>> }>).tournament!;
  const t = await acct.fetch(address);
  return { ...t, rulesVersion: Number(t.rulesVersion), resultsSubmitted: Number(t.resultsSubmitted) };
}

function loadManifest(rest: string[], weekId: number, tournament: PublicKey): Manifest {
  const file = flag(rest, "--manifest");
  if (!file) throw new Error("需要 --manifest <file.json>（後端 GET /tournament/{weekId}/manifest）");
  const m = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  if (m.week_id !== weekId) throw new Error(`manifest week_id ${m.week_id} ≠ ${weekId}`);
  if (m.tournament !== tournament.toBase58()) throw new Error(`manifest tournament ${m.tournament} ≠ ${tournament.toBase58()}（PROGRAM_ID 或 week 不符）`);
  if (m.consistent === false) throw new Error("manifest 標示與鏈上人數不一致（有沒收未上鏈或反之），先處理再結算");
  return m;
}
