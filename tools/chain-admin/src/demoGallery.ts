/**
 * Demo 情境：藝廊「看別人的 NFT 成就」測試玩家（docs/store/event-demo-playbook.md 4.8）。
 *   OPS_TOKEN=… npm run admin -- demo-gallery <env> [--dry-run] [--players 3]
 * 以 demo 專屬金鑰（$KEY_DIR/demo/demo-player-<n>.json，不進 repo、不動使用者錢包）在 devnet 建立真實帳戶：
 *   1. 餘額不足 → 向 devnet faucet 申請 airdrop（失敗只提示，不改用其他金鑰）
 *   2. `init_player`（PlayerProfile）與 `claim_collectible(1)`（Origin 紀念 NFT）
 *   3. SIWS 登入 dev 後端 → 匯入運動摘要（gps、不含座標）→ 首次里程碑（first_5k／first_10k · device）
 *   4. `POST /me/milestones/mint-intent` → pending_registry → admin `set_achievement_eligibility`（沿用 sync-achievements）→ 取證明
 *   5. [ed25519, claim_achievement] 由 demo 玩家自簽鑄造
 * 全程幂等：帳戶存在就跳過；後端匯入以 external_record_id 去重；已鑄造的成就不重送。
 * 產出寫到 $KEY_DIR/demo/gallery-fixture.json（錢包、asset、tx），供 playbook 登錄。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Ed25519Program, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

import { syncAchievements } from "./achievements.js";
import type { Ctx } from "./client.js";
import { require_, ROOT } from "./env.js";

const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const MIN_BALANCE = 0.05 * LAMPORTS_PER_SOL;
const AIRDROP = 1 * LAMPORTS_PER_SOL;

/** 三位示範玩家：跑者 A（5K＋10K 兩枚首次章）、跑者 B（5K 一枚）、健走者 C（只有 Origin 收藏，示範「還沒有成就」） */
const PLAYERS = [
  { name: "demo-player-1", label: "Runner A · 5K + 10K", sessions: [run("2026-09-06T22:10:00Z", 5_420_000, 32 * 60 + 10), run("2026-09-13T22:05:00Z", 10_640_000, 62 * 60 + 30)] },
  { name: "demo-player-2", label: "Runner B · 5K", sessions: [run("2026-09-10T11:30:00Z", 5_180_000, 34 * 60 + 40)] },
  { name: "demo-player-3", label: "Walker C · no achievements yet", sessions: [walk("2026-09-12T09:00:00Z", 6_100_000, 78 * 60)] },
];

type Session = ReturnType<typeof run> & { sport: "run" | "walk"; intent: "run" | "brisk" | "casual" };
function run(startedAt: string, distanceMm: number, elapsedS: number) {
  const started = new Date(startedAt);
  const ended = new Date(started.getTime() + elapsedS * 1000);
  const movingMs = Math.round(elapsedS * 1000 * 0.97);
  return {
    sport: "run" as "run" | "walk", intent: "run" as "run" | "brisk" | "casual", goal: null, environment: "outdoor" as const, origin: "gps" as const, source_id: "neonshift-demo-gallery",
    external_record_id: `demo-gallery|${startedAt}`, source_revision: 1, started_at: started.toISOString(), ended_at: ended.toISOString(), paused_ms: 0,
    distance_mm: distanceMm, distance_method: "gps" as const, steps: Math.round(distanceMm / 1_000_000 * 1_150), active_energy_mkcal: Math.round(distanceMm / 1_000_000 * 62_000), energy_method: "estimated" as const, total_energy_mkcal: null, step_length_mm: null,
    client_flags: [] as string[],
    extras: { moving_ms: movingMs, max_speed_5s_kmh: 15.2, quality: { accepted: Math.round(movingMs / 1000), rejected: 3 }, rules: "gps-v2" },
  };
}
function walk(startedAt: string, distanceMm: number, elapsedS: number): Session {
  const s = run(startedAt, distanceMm, elapsedS);
  return { ...s, sport: "walk", intent: "brisk", steps: Math.round(distanceMm / 1_000_000 * 1_380), extras: { ...s.extras, max_speed_5s_kmh: 7.4 } };
}

/** 直接讀原始 IDL（Anchor Program.idl 會把名稱轉成 camelCase） */
const RAW_IDL = JSON.parse(readFileSync(resolve(ROOT, "programs/idl/neonshift_core.json"), "utf8")) as { [k: string]: { name: string; discriminator: number[] }[] };
const disc = (_ctx: Ctx, kind: "instructions" | "accounts", name: string) => {
  const list = RAW_IDL[kind] ?? [];
  const found = list.find((x) => x.name === name);
  if (!found) throw new Error(`IDL ${kind} 沒有 ${name}`);
  return Buffer.from(found.discriminator);
};
const pda = (ctx: Ctx, seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, ctx.programId)[0];

async function api<T>(base: string, method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: T }> {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await r.json().catch(() => null)) as T;
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  return { status: r.status, json };
}

async function siws(base: string, kp: Keypair) {
  const wallet = kp.publicKey.toBase58();
  const n = await api<{ message: string }>(base, "POST", "/auth/nonce", { wallet });
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.json.message), kp.secretKey)).toString("base64");
  const v = await api<{ access_token: string }>(base, "POST", "/auth/verify", { message: n.json.message, signature_b64: sig });
  return v.json.access_token;
}

export async function demoGallery(ctx: Ctx, opts: { dryRun: boolean; players: number }) {
  const { connection, env, configPda } = ctx;
  const base = require_(env, "API_URL").replace(/\/$/, "");
  const keyDir = resolve(require_(env, "KEY_DIR"), "demo");
  mkdirSync(keyDir, { recursive: true });
  const fixture: Record<string, unknown>[] = [];

  for (const p of PLAYERS.slice(0, opts.players)) {
    const file = resolve(keyDir, `${p.name}.json`);
    let kp: Keypair;
    if (existsSync(file)) kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]));
    else {
      kp = Keypair.generate();
      if (!opts.dryRun) { writeFileSync(file, JSON.stringify(Array.from(kp.secretKey))); chmodSync(file, 0o600); }
      console.log(`建立金鑰 ${file}`);
    }
    const wallet = kp.publicKey;
    console.log(`\n== ${p.label} · ${wallet.toBase58()}`);

    // 1. 餘額／airdrop
    let balance = await connection.getBalance(wallet);
    console.log(`餘額 ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
    if (balance < MIN_BALANCE && !opts.dryRun) {
      try {
        const sig = await connection.requestAirdrop(wallet, AIRDROP);
        await connection.confirmTransaction(sig, "confirmed");
        balance = await connection.getBalance(wallet);
        console.log(`airdrop 1 SOL → ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
      } catch (e) {
        console.warn(`airdrop 失敗（devnet faucet 限流？稍後重跑或用 https://faucet.solana.com 對 ${wallet.toBase58()} 手動領）：${(e as Error).message}`);
        continue;
      }
    }

    // 2. init_player ＋ Origin 紀念 NFT（皆為玩家自簽、只付 rent）
    const player = pda(ctx, [Buffer.from("player"), wallet.toBuffer()]);
    const receipt1 = pda(ctx, [Buffer.from("collectible"), wallet.toBuffer(), Buffer.from([1])]);
    const asset1 = pda(ctx, [Buffer.from("asset"), wallet.toBuffer(), Buffer.from([1])]);
    const ixs: TransactionInstruction[] = [];
    if (!(await connection.getAccountInfo(player))) {
      ixs.push(new TransactionInstruction({ programId: ctx.programId, keys: [
        { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: configPda, isSigner: false, isWritable: false }, { pubkey: player, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ], data: disc(ctx, "instructions", "init_player") }));
    }
    if (!(await connection.getAccountInfo(receipt1))) {
      ixs.push(new TransactionInstruction({ programId: ctx.programId, keys: [
        { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: configPda, isSigner: false, isWritable: false }, { pubkey: player, isSigner: false, isWritable: false },
        { pubkey: receipt1, isSigner: false, isWritable: true }, { pubkey: asset1, isSigner: false, isWritable: true }, { pubkey: MPL_CORE, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ], data: Buffer.concat([disc(ctx, "instructions", "claim_collectible"), Buffer.from([1])]) }));
    }
    if (ixs.length) {
      console.log(`鏈上：${ixs.length === 2 ? "init_player ＋ claim_collectible(1)" : ixs.length === 1 && (await connection.getAccountInfo(player)) ? "claim_collectible(1)" : "init_player"}`);
      if (!opts.dryRun) {
        const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [kp], { commitment: "confirmed" });
        console.log(`  tx ${sig}`);
      }
    } else console.log("鏈上：PlayerProfile 與 Origin 已存在");

    // 3. 後端：SIWS → 匯入運動摘要 → 里程碑
    if (opts.dryRun) { fixture.push({ label: p.label, wallet: wallet.toBase58(), origin_asset: asset1.toBase58(), dry_run: true }); continue; }
    const token = await siws(base, kp);
    const imp = await api<{ imported: number; results: { outcome: string; external_record_id: string }[] }>(base, "POST", "/workouts/import", { sessions: p.sessions }, token);
    console.log(`匯入 ${imp.json.imported} 筆（${imp.json.results.map((r) => r.outcome).join("、")}）`);
    const ms = await api<{ items: { key: string; status: string }[] }>(base, "GET", "/me/milestones", undefined, token);
    const eligible = (ms.json.items ?? []).filter((m) => m.status === "eligible" || m.status === "pending_registry" || m.status === "approved" || m.status === "minted");
    console.log(`里程碑：${eligible.map((m) => `${m.key}=${m.status}`).join("、") || "（無）"}`);
    const minted: { key: string; asset: string; signature: string | null }[] = [];
    for (const m of eligible) {
      const intent = await api<{ status: string; achievement: { achievement_id: string }; proof: { message_b64: string; signature_b64: string; attestor: string } | null }>(base, "POST", "/me/milestones/mint-intent", { key: m.key, public_consent: true }, token);
      console.log(`  ${m.key} → ${intent.json.status}`);
    }
    fixture.push({ label: p.label, wallet: wallet.toBase58(), origin_asset: asset1.toBase58(), milestones: eligible.map((m) => m.key), minted, token });
  }

  if (opts.dryRun) { console.log(JSON.stringify(fixture, null, 2)); return; }

  // 4. registry：admin 核准所有 pending（沿用 sync-achievements；需 OPS_TOKEN）
  console.log("\n== registry 同步（admin set_achievement_eligibility）");
  await syncAchievements(ctx, false);

  // 5. 鑄造：重新取 intent（此時有證明）→ [ed25519, claim_achievement] 玩家自簽
  for (const f of fixture) {
    const token = f.token as string;
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(keyDir, `${PLAYERS.find((p) => p.label === f.label)!.name}.json`), "utf8")) as number[]));
    const wallet = kp.publicKey;
    const minted = f.minted as { key: string; asset: string; signature: string | null }[];
    for (const key of f.milestones as string[]) {
      const intent = await api<{ status: string; achievement: { achievement_id: string }; proof: { message_b64: string; signature_b64: string; attestor: string } | null }>(base, "POST", "/me/milestones/mint-intent", { key, public_consent: true }, token);
      const id = Buffer.from(intent.json.achievement.achievement_id, "hex");
      const receipt = pda(ctx, [Buffer.from("achievement"), wallet.toBuffer(), id]);
      const asset = pda(ctx, [Buffer.from("aasset"), wallet.toBuffer(), id]);
      if (intent.json.status === "minted" || (await connection.getAccountInfo(receipt))) { minted.push({ key, asset: asset.toBase58(), signature: null }); console.log(`${f.label}：${key} 已鑄造 ${asset.toBase58()}`); continue; }
      if (!intent.json.proof) { console.warn(`${f.label}：${key} 仍為 ${intent.json.status}，略過`); continue; }
      const message = Buffer.from(intent.json.proof.message_b64, "base64");
      const signature = Buffer.from(intent.json.proof.signature_b64, "base64");
      const attestor = bs58.decode(intent.json.proof.attestor);
      const ed = Ed25519Program.createInstructionWithPublicKey({ publicKey: attestor, message, signature });
      const claim = new TransactionInstruction({ programId: ctx.programId, keys: [
        { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: pda(ctx, [Buffer.from("eligibility"), wallet.toBuffer(), id]), isSigner: false, isWritable: false },
        { pubkey: receipt, isSigner: false, isWritable: true }, { pubkey: asset, isSigner: false, isWritable: true },
        { pubkey: MPL_CORE, isSigner: false, isWritable: false }, { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ], data: Buffer.concat([disc(ctx, "instructions", "claim_achievement"), message.subarray(24)]) });
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ed, claim), [kp], { commitment: "confirmed" });
      minted.push({ key, asset: asset.toBase58(), signature: sig });
      console.log(`${f.label}：${key} 鑄造 ${asset.toBase58()} tx ${sig}`);
    }
    delete f.token;
  }

  const out = { api: base, cluster: env.CLUSTER, program_id: ctx.programId.toBase58(), created_at: new Date().toISOString(), players: fixture };
  writeFileSync(resolve(keyDir, "gallery-fixture.json"), JSON.stringify(out, null, 2));
  console.log(`\n${JSON.stringify(out, null, 2)}\n寫入 ${resolve(keyDir, "gallery-fixture.json")}；App：Home → Gallery（需 indexer 抓到事件後才會列出）`);
}
