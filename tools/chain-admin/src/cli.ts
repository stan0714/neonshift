/**
 * NeonShift 鏈上管理 CLI（PG-I-07）。
 *   npm run admin -- init-config <env> [--attestor <pubkey>]
 *   npm run admin -- status <env>
 *   npm run admin -- set-paused <env> true|false
 *   npm run admin -- rotate-attestor <env> <newPubkey> <graceSeconds>
 *   npm run admin -- tournament <sub> <env> <weekId> [...]   # 見 tournament.ts
 *   OPS_TOKEN=… npm run admin -- sync-achievements <env> [--dry-run]   # PG-R-08 registry
 *   npm run admin -- migrate-players <env> [--dry-run]                 # PG-V-02 舊帳戶遷移
 *   npm run admin -- settle-players <env> [--dry-run]                  # PG-V-02 批次結算
 *   npm run admin -- set-freeze <env> <startISO|0> <endISO|0> [reason]  # PG-V-05 全域凍結
 */
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { createCtx, DEFAULT_CONFIG, programDataAddress } from "./client.js";
import { loadKeypair, require_ } from "./env.js";
import { syncAchievements } from "./achievements.js";
import { migratePlayers, setFreeze, settlePlayers } from "./maintenance.js";
import { tournamentCommand } from "./tournament.js";

const argv = process.argv.slice(2);
// tournament <sub> <env> <weekId> ... → 統一成 cmd=tournament、envName、rest=[sub, weekId, ...]
const [cmd, envName, ...rest] = argv[0] === "tournament" ? ["tournament", argv[2], argv[1], ...argv.slice(3)] : argv;

async function main() {
  if (!cmd || !envName) {
    console.error("用法：admin <init-config|status|set-paused|rotate-attestor|tournament|sync-achievements|migrate-players|settle-players|set-freeze> <dev|demo> [...]");
    process.exit(2);
  }
  const ctx = createCtx(envName);
  const { program, admin, env, configPda, programId } = ctx;

  switch (cmd) {
    case "init-config": {
      const attestorArg = rest.indexOf("--attestor") >= 0 ? rest[rest.indexOf("--attestor") + 1] : undefined;
      const attestor = attestorArg ? new PublicKey(attestorArg) : loadKeypair(require_(env, "ATTESTOR_KEYPAIR")).publicKey;
      const mint = new PublicKey(require_(env, "TSKR_MINT"));
      const rewardVault = new PublicKey(require_(env, "REWARD_VAULT"));
      const treasuryVault = new PublicKey(require_(env, "TREASURY_VAULT"));
      const params = {
        admin: admin.publicKey,
        clusterId: Number(env.CLUSTER_ID),
        attestorPubkey: attestor,
        ...DEFAULT_CONFIG,
      };
      console.log(`initialize_config on ${env.ENV_NAME} (${env.RPC_URL})`);
      console.log({ programId: programId.toBase58(), configPda: configPda.toBase58(), attestor: attestor.toBase58(), mint: mint.toBase58() });
      const sig = await program.methods
        .initializeConfig(params)
        .accounts({
          authority: admin.publicKey,
          config: configPda,
          mint,
          rewardVault,
          treasuryVault,
          program: programId,
          programData: programDataAddress(programId),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
      console.log("signature:", sig);
      break;
    }
    case "status": {
      const cfg = await (program.account as Record<string, { fetch: (k: PublicKey) => Promise<Record<string, unknown>> }>).config!.fetch(configPda);
      console.log(JSON.stringify(cfg, (_k, v) => (v && typeof v === "object" && "toBase58" in (v as object) ? (v as PublicKey).toBase58() : typeof v === "bigint" ? v.toString() : v), 2));
      break;
    }
    case "set-paused": {
      const paused = rest[0] === "true";
      const sig = await program.methods.setPaused(paused).accounts({ admin: admin.publicKey, config: configPda }).signers([admin]).rpc();
      console.log(`paused=${paused} signature:`, sig);
      break;
    }
    case "rotate-attestor": {
      const [pk, grace] = rest;
      if (!pk) throw new Error("需要新 attestor 公鑰");
      const sig = await program.methods
        .rotateAttestor(new PublicKey(pk), Number(grace ?? "0"))
        .accounts({ admin: admin.publicKey, config: configPda })
        .signers([admin])
        .rpc();
      console.log("signature:", sig);
      break;
    }
    case "tournament":
      await tournamentCommand(ctx, rest[0]!, rest[1], rest.slice(2));
      break;
    case "sync-achievements":
      await syncAchievements(ctx, rest.includes("--dry-run"));
      break;
    case "migrate-players":
      await migratePlayers(ctx, rest.includes("--dry-run"));
      break;
    case "settle-players":
      await settlePlayers(ctx, rest.includes("--dry-run"));
      break;
    case "set-freeze":
      await setFreeze(ctx, rest[0]!, rest[1]!, rest.filter((x) => x !== "--dry-run").slice(2).join(" ") || "incident", rest.includes("--dry-run"));
      break;
    default:
      console.error(`未知指令 ${cmd}`);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
