/**
 * 可觀測性（PG-B-18，SD 9）：process 內計數器／直方圖，以 Prometheus 文字格式輸出。
 * 業務指標：attestation 簽發數、拒絕率與各拒絕碼；安全：重放嘗試（CHALLENGE_INVALID）、簽發量基線。
 */
export class Metrics {
  private counters = new Map<string, number>();
  private latencyBuckets = [50, 100, 200, 400, 800, 1600, 3200];
  private latencyCounts = new Array<number>(this.latencyBuckets.length + 1).fill(0);
  private latencySum = 0;
  private latencyCount = 0;
  /** 15 分鐘簽發量滑動視窗（SD 9：超過移動基線 3 倍告警） */
  private issuanceWindow: number[] = [];

  inc(name: string, labels: Record<string, string> = {}, by = 1) {
    const key = `${name}${labelStr(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observeLatency(ms: number) {
    this.latencySum += ms;
    this.latencyCount += 1;
    const idx = this.latencyBuckets.findIndex((b) => ms <= b);
    this.latencyCounts[idx === -1 ? this.latencyBuckets.length : idx]! += 1;
  }

  recordIssuance(now: number) {
    this.issuanceWindow.push(now);
    const cutoff = now - 15 * 60 * 1000;
    while (this.issuanceWindow.length && this.issuanceWindow[0]! < cutoff) this.issuanceWindow.shift();
  }
  issuanceLast15m(): number {
    return this.issuanceWindow.length;
  }

  get(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(`${name}${labelStr(labels)}`) ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    let cum = 0;
    this.latencyBuckets.forEach((b, i) => {
      cum += this.latencyCounts[i]!;
      lines.push(`neonshift_api_latency_ms_bucket{le="${b}"} ${cum}`);
    });
    lines.push(`neonshift_api_latency_ms_bucket{le="+Inf"} ${this.latencyCount}`);
    lines.push(`neonshift_api_latency_ms_sum ${this.latencySum}`);
    lines.push(`neonshift_api_latency_ms_count ${this.latencyCount}`);
    lines.push(`neonshift_attestation_issued_15m ${this.issuanceLast15m()}`);
    return lines.join("\n") + "\n";
  }
}

function labelStr(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  return keys.length ? `{${keys.map((k) => `${k}="${labels[k]}"`).join(",")}}` : "";
}
