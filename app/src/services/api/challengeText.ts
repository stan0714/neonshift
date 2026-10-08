import { Buffer } from 'buffer';

/**
 * 敏感操作 challenge 的 V2 簽署文字（SD 4.2）——與後端 backend/src/auth/challenge.ts 的
 * `challengeText` 逐字相同（兩邊測試用同一組向量）。
 *
 * 2026-10-06 實機：V1 簽的是二進位 bytes（domain || nonce || request_hash || expiry），Seed Vault 顯示
 * 「This message contains characters that can't be safely displayed. It may hide a transaction」。
 * V2 改為純 ASCII、以換行分隔的可讀文字；綁定內容不變（錢包、用途、任務日、任務類型、request hash、nonce、到期）。
 */
export type ChallengePurpose = 'claim' | 'tournament_steps';

const MISSION_NAME: Record<number, string> = { 1: 'Steps', 2: 'Sleep', 3: 'Workout' };
const VERSION: Record<ChallengePurpose, string> = { claim: 'NEONSHIFT_CLAIM_V2', tournament_steps: 'NEONSHIFT_TOURNAMENT_STEPS_V2' };
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const utcDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const utcTime = (unix: number) => new Date(unix * 1000).toISOString().replace('.000Z', 'Z');

export function challengeText(
  purpose: ChallengePurpose,
  wallet: string,
  taskDate: number,
  taskType: number,
  nonce: Uint8Array,
  requestHash: Uint8Array,
  expiresAtUnix: number,
): Uint8Array {
  const lines =
    purpose === 'claim'
      ? ['NeonShift daily claim', "Approve in your wallet to claim today's mission reward.", '', `Wallet: ${wallet}`, `Mission: ${MISSION_NAME[taskType] ?? taskType}`, `Day (UTC): ${utcDay(taskDate)}`]
      : ['NeonShift tournament steps', 'Approve in your wallet to submit your tournament steps.', '', `Wallet: ${wallet}`, `Week: ${taskDate}`];
  lines.push(`Request: ${hex(requestHash)}`, `Nonce: ${hex(nonce)}`, `Expires (UTC): ${utcTime(expiresAtUnix)}`, 'Domain: neonshift.cc', `Version: ${VERSION[purpose]}`);
  return new Uint8Array(Buffer.from(lines.join('\n'), 'ascii'));
}
