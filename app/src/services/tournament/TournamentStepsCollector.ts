/**
 * 賽事步數彙整（PG-A-15，SD 4.3A）：把 Health Connect 在 `[starts_at, ends_at)` 窗內的步數轉成後端
 * `POST /tournament/steps` 的 body —— 逐 UTC 日呼叫 readSteps（原生分鐘桶只涵蓋 24 小時），
 * 依來源合併 data_origins，分鐘桶折成「自 starts_at 起算的每小時桶」。純資料轉換，不做判定。
 */
import type { StepsResult } from '../../../modules/neonshift-health';

const HOUR = 3600;
const DAY = 86_400;

export type CollectedSteps = {
  steps: number;
  reachedAt: number;
  dataOrigins: { package: string; source_kind: string; steps: number; records: number }[];
  buckets: [number, number][];
};

export type WindowReader = (startUnix: number, endUnix: number) => Promise<StepsResult>;

export async function collectTournamentSteps(startsAt: number, endsAt: number, nowUnix: number, read: WindowReader): Promise<CollectedSteps> {
  const end = Math.min(endsAt, nowUnix);
  const origins = new Map<string, { package: string; source_kind: string; steps: number; records: number }>();
  const hours = new Map<number, number>();
  let reachedAt = startsAt;
  for (let segStart = startsAt; segStart < end; segStart += DAY) {
    const segEnd = Math.min(segStart + DAY, end);
    const r = await read(segStart, segEnd);
    for (const o of r.dataOrigins) {
      const cur = origins.get(o.package) ?? { package: o.package, source_kind: o.sourceKind, steps: 0, records: 0 };
      cur.steps += o.steps;
      cur.records += o.records;
      origins.set(o.package, cur);
    }
    for (const [minute, n] of r.stepRateSummary.buckets) {
      const abs = segStart + minute * 60;
      const hour = Math.floor((abs - startsAt) / HOUR);
      hours.set(hour, (hours.get(hour) ?? 0) + n);
      if (n > 0 && abs + 60 > reachedAt) reachedAt = Math.min(abs + 60, end);
    }
  }
  const buckets = [...hours.entries()].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]) as [number, number][];
  const steps = buckets.reduce((n, b) => n + b[1], 0);
  return { steps, reachedAt: Math.max(startsAt, Math.min(reachedAt, end - 1)), dataOrigins: [...origins.values()], buckets };
}
