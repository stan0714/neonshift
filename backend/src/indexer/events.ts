/**
 * Anchor 事件解碼（PG-B-16）：以 IDL（backend/idl/neonshift_core.json，由 scripts/chain/build.sh 複製）驅動，
 * 不手寫每個事件的佈局。`Program data: <base64>` = 8-byte discriminator ‖ borsh(struct)。
 * 只支援本程式事件用到的型別：pubkey、bool、u8/u16/u32/u64/i64、[u8; N]、string。
 */
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

type IdlType = string | { array: [IdlType, number] } | { defined: { name: string } };
type IdlField = { name: string; type: IdlType };
type Idl = { address: string; events: { name: string; discriminator: number[] }[]; types: { name: string; type: { kind: string; fields?: IdlField[] } }[] };

export type DecodedEvent = { name: string; data: Record<string, unknown> };

export class EventDecoder {
  private readonly byDisc = new Map<string, { name: string; fields: IdlField[] }>();
  readonly programId: string;

  constructor(idl: Idl) {
    this.programId = idl.address;
    const types = new Map(idl.types.map((t) => [t.name, t.type]));
    for (const e of idl.events) {
      const t = types.get(e.name);
      if (!t?.fields) throw new Error(`IDL 缺少事件型別 ${e.name}`);
      this.byDisc.set(Buffer.from(e.discriminator).toString("hex"), { name: e.name, fields: t.fields });
    }
  }

  static fromFile(path: string) {
    return new EventDecoder(JSON.parse(readFileSync(path, "utf8")) as Idl);
  }

  /** 非本程式事件（discriminator 未知）回 null */
  decode(bytes: Buffer): DecodedEvent | null {
    const ev = this.byDisc.get(bytes.subarray(0, 8).toString("hex"));
    if (!ev) return null;
    let o = 8;
    const data: Record<string, unknown> = {};
    const read = (t: IdlType): unknown => {
      if (typeof t === "string") {
        switch (t) {
          case "pubkey": {
            const v = new PublicKey(bytes.subarray(o, o + 32)).toBase58();
            o += 32;
            return v;
          }
          case "bool":
            return bytes.readUInt8(o++) === 1;
          case "u8":
            return bytes.readUInt8(o++);
          case "u16": {
            const v = bytes.readUInt16LE(o);
            o += 2;
            return v;
          }
          case "u32": {
            const v = bytes.readUInt32LE(o);
            o += 4;
            return v;
          }
          case "u64": {
            const v = bytes.readBigUInt64LE(o).toString();
            o += 8;
            return v;
          }
          case "i64": {
            const v = bytes.readBigInt64LE(o).toString();
            o += 8;
            return v;
          }
          case "string": {
            const len = bytes.readUInt32LE(o);
            o += 4;
            const v = bytes.subarray(o, o + len).toString("utf8");
            o += len;
            return v;
          }
          default:
            throw new Error(`不支援的 IDL 型別 ${t}`);
        }
      }
      if ("array" in t) {
        const [inner, n] = t.array;
        if (inner === "u8") {
          const v = bytes.subarray(o, o + n).toString("hex");
          o += n;
          return v;
        }
        return Array.from({ length: n }, () => read(inner));
      }
      throw new Error(`不支援的 IDL 型別 ${JSON.stringify(t)}`);
    };
    for (const f of ev.fields) data[f.name] = read(f.type);
    if (o !== bytes.length) throw new Error(`事件 ${ev.name} 長度不符：${o} != ${bytes.length}`);
    return { name: ev.name, data };
  }
}

/**
 * 從交易 log 取出本程式（含 CPI 深度追蹤）的事件。只把在本程式執行期間出現的 `Program data:` 當事件，
 * 其他程式（例如 Metaplex Core）的資料不會被誤解碼。
 */
export function parseProgramEvents(logs: string[], decoder: EventDecoder): DecodedEvent[] {
  const stack: string[] = [];
  const out: DecodedEvent[] = [];
  for (const line of logs) {
    let m = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (m) {
      stack.push(m[1]!);
      continue;
    }
    m = /^Program (\w+) (success|failed.*)$/.exec(line);
    if (m) {
      if (stack[stack.length - 1] === m[1]) stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === decoder.programId) {
      const ev = decoder.decode(Buffer.from(line.slice("Program data: ".length), "base64"));
      if (ev) out.push(ev);
    }
  }
  return out;
}
