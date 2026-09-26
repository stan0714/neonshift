/**
 * PG-SHARE-05 分享成效彙總（docs/social-share §6.3）。
 *
 * - `POST /v1/metrics/share`：落地頁匿名回報，只收允許清單內的 kind／source／event。
 *   日期由伺服器決定（UTC），不收 referrer、不存 IP、不設 cookie、不回傳任何識別碼。
 * - `GET /v1/ops/metrics/share`：OPS_TOKEN 讀彙總（JSON 或 CSV）；OPS_TOKEN 未設定時 404。
 *
 * 計數是**非唯一事件數**：重新載入、社群爬蟲預抓與重試都會加一。不得用於發獎，
 * 也不能宣稱已串出「同一人從分享到安裝」的漏斗——沒有個人識別碼就串不起來。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { ApiError } from "../errors.js";
import { csvSafeCell } from "../partner/csv.js";
import type { Store } from "../store/types.js";

/** 與 App／落地頁同一份允許清單（app/src/domain/shareImage.ts、web/s/*.html） */
export const SHARE_KINDS = ["workout", "achievement", "gear", "guardian", "passport", "event", "seasonal"] as const;
export const SHARE_SOURCES = ["summary", "mint", "levelup", "guardian", "passport", "invite", "finish", "seasonal", "direct"] as const;
/** store_click／connect_complete 已定義但目前沒有送出端（尚未上架、也沒有跨安裝來源保留） */
export const SHARE_EVENTS = ["landing_view", "store_click", "app_open", "connect_complete"] as const;

const body = z
  .object({
    kind: z.enum(SHARE_KINDS),
    source: z.enum(SHARE_SOURCES).default("direct"),
    event: z.enum(SHARE_EVENTS),
  })
  .strict();

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** 驗證失敗回 422（與 partner 一致），不讓 zod 例外變成 500 */
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const r = schema.safeParse(input);
  if (!r.success) throw new ApiError(422, "VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
};

export async function metricsRoutes(app: FastifyInstance, opts: { store: Store; now: () => Date; publicLimit: number }) {
  // sendBeacon 送出的是 text/plain（CORS 安全清單，不會觸發 preflight）；只在這個 plugin 範圍內解析
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, payload, done) => {
    try {
      done(null, payload.length ? JSON.parse(payload as string) : {});
    } catch {
      done(new ApiError(400, "VALIDATION", "invalid json"), undefined);
    }
  });

  app.post("/metrics/share", { config: { rateLimit: { max: opts.publicLimit, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = parse(body, req.body ?? {});
    // 日期一律由伺服器決定，不接受呼叫端指定，避免回填或造假
    await opts.store.bumpShare(b.kind, b.source, dayOf(opts.now()), b.event);
    return reply.code(202).send({ recorded: true });
  });

  const ops = (req: FastifyRequest) => {
    const token = app.config.OPS_TOKEN;
    if (!token) throw new ApiError(404, "NOT_FOUND", "not found");
    if (req.headers.authorization !== `Bearer ${token}`) throw new ApiError(401, "UNAUTHORIZED", "ops token required");
  };

  app.get("/ops/metrics/share", async (req, reply) => {
    ops(req);
    const q = parse(z.object({ since: z.coerce.date().optional(), until: z.coerce.date().optional(), format: z.enum(["json", "csv"]).default("json") }), req.query ?? {});
    const now = opts.now();
    const since = q.since ?? new Date(now.getTime() - 30 * 86_400_000);
    const until = q.until ?? now;
    if (until < since) throw new ApiError(422, "VALIDATION", "until must not be before since");
    const rows = await opts.store.listShare(dayOf(since), dayOf(until));
    if (q.format === "csv") {
      const lines = ["kind,source,day,event_name,count", ...rows.map((r) => [csvSafeCell(r.kind), csvSafeCell(r.source), r.day, csvSafeCell(r.eventName), r.count].join(","))];
      return reply.header("content-type", "text/csv; charset=utf-8").send(`${lines.join("\n")}\n`);
    }
    const byKind: Record<string, Record<string, number>> = {};
    const bySource: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      (byKind[r.kind] ??= {})[r.eventName] = ((byKind[r.kind] ?? {})[r.eventName] ?? 0) + r.count;
      (bySource[r.source] ??= {})[r.eventName] = ((bySource[r.source] ?? {})[r.eventName] ?? 0) + r.count;
    }
    return {
      as_of: now.toISOString(),
      since: dayOf(since),
      until: dayOf(until),
      by_kind: byKind,
      by_source: bySource,
      daily: rows.map((r) => ({ kind: r.kind, source: r.source, day: r.day, event_name: r.eventName, count: r.count })),
      notes: [
        "counts_are_non_unique_events_reloads_and_crawlers_included",
        "no_ip_no_referrer_no_cookie_no_person_level_join",
        "store_click_and_connect_complete_have_no_emitter_yet",
        "not_usable_for_rewards",
      ],
    };
  });
}
