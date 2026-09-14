import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @coral-xyz/anchor 是 CJS，Node ESM 無法靜態偵測 BN 等具名匯出：改 default import 再解構
import anchor, { type Idl } from "@coral-xyz/anchor";
const { AnchorProvider, BN, Program, Wallet } = anchor;
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { loadEnv, loadKeypair, ROOT, require_, type DeployEnv } from "./env.js";

/** Config 預設值（BRD 8、SA BR-34／35；與 programs/neonshift-core/src/constants.rs 一致） */
export const TSKR_UNIT = 1_000_000;
export const DEFAULT_CONFIG = {
  dailyCap: new BN(40 * TSKR_UNIT),
  baseStepsReward: new BN(10 * TSKR_UNIT),
  baseSleepReward: new BN(5 * TSKR_UNIT),
  streakEnabled: false,
  streakBonusBps: 11_000,
  burnBps: 7_000,
  coreMultiplierBps: [10_000, 12_000, 15_000, 18_000, 22_000],
  coreUpgradeCosts: [50, 120, 250, 500].map((n) => new BN(n * TSKR_UNIT)),
  shoeXpThresholds: [0, 450, 1_500, 3_600, 7_500].map((n) => new BN(n)),
};

export type Ctx = {
  env: DeployEnv;
  connection: Connection;
  admin: Keypair;
  programId: PublicKey;
  program: InstanceType<typeof Program>;
  configPda: PublicKey;
};

export function createCtx(envName: string): Ctx {
  const env = loadEnv(envName);
  const admin = loadKeypair(require_(env, "ADMIN_KEYPAIR"));
  const programId = new PublicKey(require_(env, "PROGRAM_ID"));
  const connection = new Connection(require_(env, "RPC_URL"), "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(resolve(ROOT, "programs/idl/neonshift_core.json"), "utf8")) as Idl;
  // IDL 內的 address 為建置當時的 id；以環境的 PROGRAM_ID 為準
  const program = new Program({ ...idl, address: programId.toBase58() }, provider);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  return { env, connection, admin, programId, program, configPda };
}

export function programDataAddress(programId: PublicKey): PublicKey {
  const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  return PublicKey.findProgramAddressSync([programId.toBytes()], BPF_UPGRADEABLE)[0];
}
