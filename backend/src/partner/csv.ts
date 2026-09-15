/**
 * 成績 CSV（SD 11.5 schema v1）：`participant_ref, discipline, division, finish_status, distance_m, elapsed_ms, rank`。
 * 只做解析與逐列驗證，不寫 DB；未知選手、重複列、單位錯誤都變成逐列錯誤，阻止發布。
 */
export const RESULT_CSV_COLUMNS = ["participant_ref", "discipline", "division", "finish_status", "distance_m", "elapsed_ms", "rank"] as const;
export const RESULT_CSV_MAX_BYTES = 512 * 1024;
export const RESULT_CSV_MAX_ROWS = 5000;
const FINISH = new Set(["finished", "dnf", "dns", "dq"]);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type StagedResultRow = { line: number; wallet: string; discipline: string; division: string | null; finishStatus: "finished" | "dnf" | "dns" | "dq"; distanceM: number; elapsedMs: number; rank: number | null };
export type ResultRowError = { line: number; field: string; message: string };

/** RFC 4180 子集：逗號分隔、雙引號欄位（含 "" 跳脫與換行）、CRLF／LF */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** 防試算表公式注入：匯出時以 `'` 前綴（SD 11.5） */
export const csvSafeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function stageResultsCsv(text: string, participants: Map<string, "registered" | "checked_in" | "cancelled">): { rows: StagedResultRow[]; errors: ResultRowError[] } {
  const errors: ResultRowError[] = [];
  const rows: StagedResultRow[] = [];
  if (Buffer.byteLength(text, "utf8") > RESULT_CSV_MAX_BYTES) return { rows, errors: [{ line: 0, field: "file", message: `file exceeds ${RESULT_CSV_MAX_BYTES} bytes` }] };
  const table = parseCsv(text.replace(/^﻿/, ""));
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  if (header.join(",") !== RESULT_CSV_COLUMNS.join(",")) return { rows, errors: [{ line: 1, field: "header", message: `header must be exactly: ${RESULT_CSV_COLUMNS.join(",")}` }] };
  if (table.length - 1 > RESULT_CSV_MAX_ROWS) return { rows, errors: [{ line: 0, field: "file", message: `more than ${RESULT_CSV_MAX_ROWS} rows` }] };
  const seen = new Set<string>();
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const c = table[i]!.map((x) => x.trim());
    if (c.length !== RESULT_CSV_COLUMNS.length) { errors.push({ line, field: "row", message: `expected ${RESULT_CSV_COLUMNS.length} columns, got ${c.length}` }); continue; }
    const [ref, disciplineRaw, divisionRaw, statusRaw, distRaw, elapsedRaw, rankRaw] = c as [string, string, string, string, string, string, string];
    let bad = false;
    const err = (field: string, message: string) => { errors.push({ line, field, message }); bad = true; };
    if (!BASE58.test(ref)) err("participant_ref", "must be a wallet address");
    else if (!participants.has(ref)) err("participant_ref", "unknown participant");
    else if (participants.get(ref) === "cancelled") err("participant_ref", "registration was cancelled");
    const discipline = (disciplineRaw || "run").toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(discipline)) err("discipline", "invalid discipline");
    const division = divisionRaw === "" ? null : divisionRaw;
    if (division && division.length > 40) err("division", "max 40 chars");
    const finishStatus = statusRaw.toLowerCase();
    if (!FINISH.has(finishStatus)) err("finish_status", "must be finished|dnf|dns|dq");
    const distanceM = distRaw === "" ? 0 : Number(distRaw);
    if (!Number.isInteger(distanceM) || distanceM < 0 || distanceM > 1_000_000) err("distance_m", "integer metres 0..1000000");
    const elapsedMs = elapsedRaw === "" ? 0 : Number(elapsedRaw);
    if (!Number.isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 604_800_000) err("elapsed_ms", "integer milliseconds 0..604800000");
    else if (/[:.]/.test(elapsedRaw)) err("elapsed_ms", "use integer milliseconds, not hh:mm:ss");
    const rank = rankRaw === "" ? null : Number(rankRaw);
    if (rank !== null && (!Number.isInteger(rank) || rank <= 0)) err("rank", "positive integer or empty");
    if (finishStatus === "finished" && (elapsedMs <= 0 || distanceM <= 0)) err("finish_status", "finished requires distance_m > 0 and elapsed_ms > 0");
    if (finishStatus !== "finished" && rank !== null) err("rank", "rank only for finished");
    const key = `${ref}|${discipline}`;
    if (seen.has(key)) err("participant_ref", "duplicate participant/discipline");
    seen.add(key);
    if (!bad) rows.push({ line, wallet: ref, discipline, division, finishStatus: finishStatus as StagedResultRow["finishStatus"], distanceM, elapsedMs, rank });
  }
  return { rows, errors };
}
