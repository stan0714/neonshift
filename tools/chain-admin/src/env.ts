/** 讀取 deploy/<env>.env（與 scripts/chain/lib.sh 相同的來源），展開 $HOME／$KEY_DIR */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";

export type DeployEnv = Record<string, string> & {
  ENV_NAME: string;
  CLUSTER: string;
  CLUSTER_ID: string;
  RPC_URL: string;
  ADMIN_KEYPAIR: string;
  PROGRAM_KEYPAIR: string;
  ATTESTOR_KEYPAIR: string;
  PROGRAM_ID: string;
  TSKR_MINT: string;
  REWARD_VAULT: string;
  TREASURY_VAULT: string;
};

export const ROOT = resolve(import.meta.dirname, "../../..");

export function loadEnv(name: string): DeployEnv {
  const file = resolve(ROOT, "deploy", `${name}.env`);
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) vars[m[1]!] = m[2]!;
  }
  const expand = (v: string) => v.replace(/\$\{?([A-Z_]+)\}?/g, (_, k: string) => (k === "HOME" ? homedir() : (vars[k] ?? "")));
  for (const k of Object.keys(vars)) vars[k] = expand(vars[k]!);
  // 二次展開處理 $KEY_DIR 內含 $HOME
  for (const k of Object.keys(vars)) vars[k] = expand(vars[k]!);
  // 環境變數可覆寫（例：API_URL 走 SSH tunnel 到 l1:6080 而非尚未設定的 api.neonshift.cc）
  for (const k of Object.keys(vars)) if (process.env[`NEONSHIFT_${k}`]) vars[k] = process.env[`NEONSHIFT_${k}`]!;
  return vars as DeployEnv;
}

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

export function require_(env: DeployEnv, key: keyof DeployEnv): string {
  const v = env[key];
  if (!v) throw new Error(`deploy/${env.ENV_NAME}.env 缺少 ${String(key)}`);
  return v;
}
