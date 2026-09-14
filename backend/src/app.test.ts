import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { Db } from "./db.js";

const fakeDb = (ok: boolean, configured = true): Db => ({
  pool: configured ? ({} as Db["pool"]) : null,
  ping: async () => ok,
  close: async () => {},
});

const make = (db: Db) => buildApp({ config: loadConfig({ NODE_ENV: "test", BODY_LIMIT_BYTES: "256" }), db });

describe("PG-B-01 Fastify 骨架", () => {
  let app: ReturnType<typeof make> | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it("GET /healthz 回 ok 與環境資訊", async () => {
    app = make(fakeDb(true));
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", env: "local", cluster_id: 1 });
  });

  it("GET /readyz：DB 可用 200，不可用 503，未設定標示 not_configured", async () => {
    app = make(fakeDb(true));
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    await app.close();

    app = make(fakeDb(false));
    const down = await app.inject({ method: "GET", url: "/readyz" });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ status: "degraded", checks: { db: "unreachable" } });
    await app.close();

    app = make(fakeDb(false, false));
    expect((await app.inject({ method: "GET", url: "/readyz" })).json().checks.db).toBe("not_configured");
  });

  it("未知路由回統一錯誤格式，且不含 rules_version", async () => {
    app = make(fakeDb(true));
    const res = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "NOT_FOUND", message: "route not found" } });
  });

  it("超過 body 上限回 413 統一格式", async () => {
    app = make(fakeDb(true));
    const res = await app.inject({ method: "POST", url: "/v1/", payload: { x: "a".repeat(1000) } });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("GET /v1 回服務名稱", async () => {
    app = make(fakeDb(true));
    expect((await app.inject({ method: "GET", url: "/v1/" })).json()).toEqual({ name: "neonshift-attestor", version: "v1" });
  });
});

describe("loadConfig", () => {
  it("預設值可載入", () => {
    expect(loadConfig({})).toMatchObject({ APP_ENV: "local", PORT: 3000, CLUSTER_ID: 1 });
  });
  it("PORT 非法時拒絕", () => {
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/PORT/);
  });
  it("dev／demo 必須成組提供 PROGRAM_ID 與 DATABASE_URL（SD 8）", () => {
    expect(() => loadConfig({ APP_ENV: "dev" })).toThrow(/PROGRAM_ID/);
    expect(() =>
      loadConfig({ APP_ENV: "dev", PROGRAM_ID: "5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf", DATABASE_URL: "postgres://u:p@h/db" }),
    ).not.toThrow();
  });
  it("PROGRAM_ID 必須是 base58", () => {
    expect(() => loadConfig({ PROGRAM_ID: "not-base58!" })).toThrow(/base58/);
  });
});
