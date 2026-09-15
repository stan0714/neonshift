import { describe, expect, it } from "vitest";

import { csvSafeCell, parseCsv, stageResultsCsv } from "./csv.js";

const A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const parts = new Map<string, "registered" | "checked_in" | "cancelled">([[A, "checked_in"], [B, "registered"]]);
const HEAD = "participant_ref,discipline,division,finish_status,distance_m,elapsed_ms,rank";

describe("PG-E-07 results CSV", () => {
  it("parseCsv：引號、逗號、換行、CRLF、BOM", () => {
    expect(parseCsv('a,"b,c","d ""q""",e\r\n1,2,3,4\n')).toEqual([["a", "b,c", 'd "q"', "e"], ["1", "2", "3", "4"]]);
    expect(parseCsv('x,"multi\nline"\n')).toEqual([["x", "multi\nline"]]);
  });
  it("驗證：表頭固定；未知選手、重複列、單位（hh:mm:ss）、finished 需成績、非 finished 不可有名次、取消者", () => {
    const csv = [HEAD, `${A},run,M30,finished,5000,1500000,1`, `${B},run,,dnf,3000,,`, `${B},run,,finished,5000,1600000,2`, `${A},walk,,finished,5000,00:25:00,`, `Cxxx,run,,finished,5000,1,1`, `${A},run,,finished,5000,0,3`].join("\n");
    const r = stageResultsCsv(csv, parts);
    expect(r.rows.map((x) => `${x.wallet.slice(0, 2)}:${x.discipline}:${x.finishStatus}:${x.rank}`)).toEqual(["7x:run:finished:1", "9W:run:dnf:null"]);
    expect(r.errors.map((e) => `${e.line}:${e.field}`)).toEqual(["4:participant_ref", "5:elapsed_ms", "6:participant_ref", "7:finish_status", "7:participant_ref"]);
    expect(stageResultsCsv("wallet,time\nx,1", parts).errors[0]?.field).toBe("header");
    expect(stageResultsCsv(`﻿${HEAD}\n${A},run,,dq,0,0,1`, parts).errors[0]?.field).toBe("rank");
    expect(stageResultsCsv(`${HEAD}\n${A},run,,finished,5000,1,1`, new Map([[A, "cancelled" as const]])).errors[0]?.message).toMatch(/cancelled/);
  });
  it("匯出防公式注入", () => {
    expect(csvSafeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvSafeCell("Alice")).toBe("Alice");
  });
});
