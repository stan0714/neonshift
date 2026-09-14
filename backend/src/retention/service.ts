/**
 * 30 天保留清理（PG-B-17，SD 4.5、BR-25）。
 * 每次執行：(1) 刪除超過 RETENTION_DAYS 的健康摘要／判定／attestation／idempotency 快取／賽事步數，
 * 並清過期 challenge 與 session；(2) 執行已到期的延後刪除（有質押賽事而延後的錢包），走與 DELETE /player/data
 * 相同的刪除路徑。查詢路徑另外拒用逾期資料（history days ≤ 30），清理只是補強，不能作為唯一防線。
 */
import { RETENTION_DAYS } from "../player/routes.js";
import type { Store } from "../store/types.js";

export type RetentionReport = { cutoff: string; purged: Awaited<ReturnType<Store["purgeExpired"]>>; deferredDeletions: string[] };

export class RetentionService {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
    private readonly retentionDays = RETENTION_DAYS,
  ) {}

  async runOnce(): Promise<RetentionReport> {
    const now = this.now();
    const cutoff = new Date(now.getTime() - this.retentionDays * 86_400_000);
    const purged = await this.store.purgeExpired(cutoff, now);
    const due = await this.store.listDueDeletions(now);
    for (const wallet of due) {
      await this.store.deletePlayerData(wallet, now, null);
      await this.store.markDeletionDone(wallet);
    }
    return { cutoff: cutoff.toISOString(), purged, deferredDeletions: due };
  }
}

export function startRetention(store: Store, log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }, intervalMs: number, now?: () => Date) {
  const svc = new RetentionService(store, now);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await svc.runOnce();
      if (Object.values(r.purged).some((n) => n > 0) || r.deferredDeletions.length) log.info(r, "retention run");
    } catch (e) {
      log.error({ err: e }, "retention run failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return { stop: () => clearInterval(timer), service: svc };
}
