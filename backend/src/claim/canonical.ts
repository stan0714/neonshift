/**
 * RFC 8785 JSON Canonicalization Scheme（SD 3.5 evidence_hash、4.3 request_hash）。
 * 物件鍵以 UTF-16 code unit 排序、無空白、數字用 ES6 Number 序列化、字串用 JSON.stringify 逸出。
 */
import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalize(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number cannot be canonicalized");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k] as Json)}`)
    .join(",")}}`;
}

export function sha256Canonical(value: Json): Buffer {
  return createHash("sha256").update(canonicalize(value), "utf8").digest();
}

/** claim body 去掉 `claim_authorization` 後的 request_hash（SD 4.2） */
export function requestHashOf(body: Record<string, Json>): Buffer {
  const { claim_authorization: _omit, ...rest } = body;
  return sha256Canonical(rest as Json);
}
