/**
 * PG-R-08：成就 registry 同步。從後端 ops 端點取 pending（approved／revoked），逐筆送 `set_achievement_eligibility`，
 * 交易確認後回報簽章。需環境變數 OPS_TOKEN（l1 /etc/neonshift/api.env）與 env 檔的 API_URL。
 *   npm run admin -- sync-achievements <env> [--dry-run]
 */
import { PublicKey, SystemProgram } from "@solana/web3.js";

import type { Ctx } from "./client.js";
import { require_ } from "./env.js";

type Pending = { achievement_id: string; wallet: string; desired_status: "approved" | "revoked"; category_code: number; class_code: number; source_revision: number; metadata_hash: string };

export async function syncAchievements(ctx: Ctx, dryRun: boolean) {
  const { program, admin, env, configPda, programId } = ctx;
  const api = require_(env, "API_URL").replace(/\/$/, "");
  const token = process.env.OPS_TOKEN;
  if (!token) throw new Error("需要 OPS_TOKEN 環境變數");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const res = await fetch(`${api}/ops/achievements/pending`, { headers });
  if (!res.ok) throw new Error(`pending 取得失敗 ${res.status}`);
  const { items } = (await res.json()) as { items: Pending[] };
  console.log(`pending：${items.length} 筆`);
  for (const it of items) {
    const wallet = new PublicKey(it.wallet);
    const id = Buffer.from(it.achievement_id, "hex");
    const [eligibility] = PublicKey.findProgramAddressSync([Buffer.from("eligibility"), wallet.toBuffer(), id], programId);
    const params = { wallet, achievementId: Array.from(id), category: it.category_code, verificationClass: it.class_code, status: it.desired_status === "approved" ? 1 : 2, sourceRevision: it.source_revision, metadataHash: Array.from(Buffer.from(it.metadata_hash, "hex")) };
    console.log(`${it.desired_status} ${it.achievement_id.slice(0, 12)}… wallet ${it.wallet.slice(0, 6)}… rev ${it.source_revision} → ${eligibility.toBase58()}`);
    if (dryRun) continue;
    const sig = await program.methods
      .setAchievementEligibility(params)
      .accounts({ admin: admin.publicKey, config: configPda, eligibility, systemProgram: SystemProgram.programId })
      .signers([admin])
      .rpc({ commitment: "confirmed" });
    const post = await fetch(`${api}/ops/achievements/${it.achievement_id}/registry`, { method: "POST", headers, body: JSON.stringify({ status: it.desired_status, signature: sig }) });
    if (!post.ok) throw new Error(`回報失敗 ${post.status}（tx ${sig} 已上鏈，請手動回報）`);
    console.log(`  tx ${sig}`);
  }
}
