/**
 * BR-20 排序：verified_steps DESC → first_reached_at ASC（NULL 最後）→ wallet 位元組序 ASC。
 * 「位元組序」定義為 base58 字串的位元組序（PostgreSQL `COLLATE "C"`），兩端一致且可由任何人重算。
 */
import type { TournamentStepsRow } from "./types.js";

export function compareLeaderboard(a: TournamentStepsRow, b: TournamentStepsRow): number {
  if (a.verifiedSteps !== b.verifiedSteps) return b.verifiedSteps - a.verifiedSteps;
  const ta = a.firstReachedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const tb = b.firstReachedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return Buffer.compare(Buffer.from(a.wallet, "ascii"), Buffer.from(b.wallet, "ascii"));
}
