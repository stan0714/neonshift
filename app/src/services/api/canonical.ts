/** RFC 8785 JCS（與 backend/src/claim/canonical.ts 同義）；request_hash = SHA-256(canonical(body 去 claim_authorization)) */
import { sha256 } from '@noble/hashes/sha2.js';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalize(value: Json): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k] as Json)}`)
    .join(',')}}`;
}

export function requestHashOf(body: Record<string, Json>): Uint8Array {
  const { claim_authorization: _omit, ...rest } = body;
  return sha256(new TextEncoder().encode(canonicalize(rest as Json)));
}
