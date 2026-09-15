/**
 * 告警（PG-B-18，SD 9）。門檻只做偵測與通知（log warn ＋ 可選 webhook）；
 * pause 由持有 admin 金鑰的人以 tools/chain-admin set-paused 執行，後端不持有 admin 金鑰。
 */
import type { FastifyBaseLogger } from "fastify";

import type { Metrics } from "./metrics.js";

export type AlertConfig = {
  webhookUrl?: string;
  /** 15 分鐘簽發量超過基線的倍數（SD 9：3 倍） */
  issuanceSpikeFactor: number;
  /** 單一錢包單日重放嘗試上限（SD 9：10 次） */
  replayPerWalletPerDay: number;
  fetchImpl?: typeof fetch;
};

export class Alerts {
  private baseline15m = 0;
  private replayCounts = new Map<string, { day: number; n: number }>();
  private fired = new Set<string>();

  constructor(
    private readonly log: FastifyBaseLogger,
    private readonly metrics: Metrics,
    private readonly cfg: AlertConfig,
  ) {}

  /** 每次簽發後呼叫；基線為指數移動平均 */
  onIssued(now: number) {
    this.metrics.recordIssuance(now);
    const current = this.metrics.issuanceLast15m();
    if (this.baseline15m >= 5 && current > this.baseline15m * this.cfg.issuanceSpikeFactor) {
      void this.fire("ISSUANCE_SPIKE", { current, baseline: this.baseline15m }, "attestation issuance exceeds baseline; consider set-paused");
    }
    this.baseline15m = this.baseline15m === 0 ? current : this.baseline15m * 0.95 + current * 0.05;
  }

  onReplayAttempt(wallet: string, now: number) {
    const day = Math.floor(now / 86_400_000);
    const rec = this.replayCounts.get(wallet);
    const n = rec && rec.day === day ? rec.n + 1 : 1;
    this.replayCounts.set(wallet, { day, n });
    this.metrics.inc("neonshift_replay_attempts_total");
    if (n === this.cfg.replayPerWalletPerDay + 1) {
      void this.fire("REPLAY_WALLET", { wallet, n }, "wallet exceeded replay attempts for today");
    }
  }

  onConservationViolation(detail: Record<string, unknown>) {
    void this.fire("CONSERVATION_VIOLATION", detail, "ConservationViolation observed onchain — highest severity");
  }

  private async fire(kind: string, detail: Record<string, unknown>, message: string) {
    const key = `${kind}:${JSON.stringify(detail.wallet ?? "")}:${Math.floor(Date.now() / 3_600_000)}`;
    if (this.fired.has(key)) return; // 每小時每類最多一次
    this.fired.add(key);
    this.metrics.inc("neonshift_alerts_total", { kind });
    this.log.warn({ alert: kind, ...detail }, message);
    if (this.cfg.webhookUrl) {
      try {
        await (this.cfg.fetchImpl ?? fetch)(this.cfg.webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, message, detail, at: new Date().toISOString() }),
        });
      } catch (e) {
        this.log.error({ err: e }, "alert webhook failed");
      }
    }
  }
}
