import { Buffer } from 'buffer';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';

import type { Lap, RawPoint, Summary } from '@/domain/gps/engine';
import type { WorkoutGoal, WorkoutIntent } from '@/services/api/ApiClient';

/**
 * LocalWorkoutStore（PG-R-03，SD 16）：本機加密軌跡與 checkpoint。
 * - 每個 session 一個目錄：`meta.json`（不含座標；狀態、時間、暫停區間）與 `points.log`（每行一批點，nacl.secretbox 加密、金鑰在 Keystore-backed SecureStore）。
 * - 先持久化再回報成功；恢復以 seq 去重、不重播累加；刪除 session 一併清除點與圈。
 * - 只有摘要（summary）會上傳；座標永不離開本機。
 */
export type SessionMeta = {
  sessionId: string;
  sport: 'run' | 'walk';
  /** PG-U-01：使用模式（走路 casual／健走 brisk／跑步 run）；開始後固定 */
  intent?: WorkoutIntent | null;
  /** PG-U-01：目標快照；達標只提醒一次、不自動停止 */
  goal?: WorkoutGoal | null;
  environment: 'outdoor' | 'indoor';
  autoLapMm: number | null;
  /** PG-R-12 跑道等效圈長（mm；null＝未啟用）；只作距離估算，非過線圈。舊 meta 可能缺此欄位 → 視為 null */
  trackLapMm?: number | null;
  splitLengthMm: number;
  status: 'recording' | 'paused' | 'recoverable' | 'saved' | 'needs_review' | 'discarded';
  startedAtUtc: number;
  /** 記錄用的單調時基（本 process 的 monotonic 起點對應的 UTC）；跨 process 恢復時改以 UTC 推算並標 interrupted */
  startedMonoMs: number;
  processId: string;
  pauses: { atMs: number; resumedAtMs: number | null }[];
  manualLapsAtMs: number[];
  lastSeq: number;
  acceptedCount: number;
  interrupted: boolean;
  endedAtUtc: number | null;
  summary: Summary | null;
  syncedSessionId: string | null;
  updatedAt: number;
};

const KEY_ID = 'neonshift.workouts.key.v1';
const ROOT = 'workouts';

type Fs = { root(): Directory; dir(id: string): Directory; file(id: string, name: string): File };
const defaultFs: Fs = {
  root: () => new Directory(Paths.document, ROOT),
  dir: (id) => new Directory(Paths.document, ROOT, id),
  file: (id, name) => new File(Paths.document, ROOT, id, name),
};

export class LocalWorkoutStore {
  private key: Uint8Array | null = null;
  constructor(private readonly fs: Fs = defaultFs, private readonly secure: Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync'> = SecureStore) {}

  private async keyBytes(): Promise<Uint8Array> {
    if (this.key) return this.key;
    let b64 = await this.secure.getItemAsync(KEY_ID);
    if (!b64) {
      const fresh = Buffer.from(nacl.randomBytes(nacl.secretbox.keyLength)).toString('base64');
      await this.secure.setItemAsync(KEY_ID, fresh);
      b64 = fresh;
    }
    this.key = new Uint8Array(Buffer.from(b64, 'base64'));
    return this.key;
  }
  private ensureDir(id: string) {
    const root = this.fs.root();
    if (!root.exists) root.create({ intermediates: true, idempotent: true });
    const d = this.fs.dir(id);
    if (!d.exists) d.create({ idempotent: true });
  }

  async create(meta: Omit<SessionMeta, 'pauses' | 'manualLapsAtMs' | 'lastSeq' | 'acceptedCount' | 'interrupted' | 'endedAtUtc' | 'summary' | 'syncedSessionId' | 'updatedAt'>): Promise<SessionMeta> {
    this.ensureDir(meta.sessionId);
    const full: SessionMeta = { ...meta, pauses: [], manualLapsAtMs: [], lastSeq: -1, acceptedCount: 0, interrupted: false, endedAtUtc: null, summary: null, syncedSessionId: null, updatedAt: Date.now() };
    await this.writeMeta(full);
    const log = this.fs.file(meta.sessionId, 'points.log');
    if (!log.exists) log.create({ overwrite: false });
    return full;
  }

  async writeMeta(meta: SessionMeta): Promise<void> {
    meta.updatedAt = Date.now();
    this.fs.file(meta.sessionId, 'meta.json').write(JSON.stringify(meta));
  }
  readMeta(sessionId: string): SessionMeta | null {
    const f = this.fs.file(sessionId, 'meta.json');
    if (!f.exists) return null;
    try {
      return JSON.parse(f.textSync()) as SessionMeta;
    } catch {
      return null;
    }
  }

  /** 追加一批接受的點（加密一行）；呼叫方在回報成功前先等這裡完成 */
  async appendPoints(sessionId: string, points: RawPoint[]): Promise<void> {
    if (points.length === 0) return;
    const key = await this.keyBytes();
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const box = nacl.secretbox(new Uint8Array(Buffer.from(JSON.stringify(points), 'utf8')), nonce, key);
    const line = Buffer.concat([Buffer.from(nonce), Buffer.from(box)]).toString('base64');
    this.fs.file(sessionId, 'points.log').write(`${line}\n`, { append: true });
  }

  /** 讀回全部點（依 seq 去重與排序）；壞行跳過 */
  async readPoints(sessionId: string): Promise<RawPoint[]> {
    const f = this.fs.file(sessionId, 'points.log');
    if (!f.exists) return [];
    const key = await this.keyBytes();
    const seen = new Set<number>();
    const out: RawPoint[] = [];
    for (const line of (await f.text()).split('\n')) {
      if (!line) continue;
      const buf = Buffer.from(line, 'base64');
      const nonce = new Uint8Array(buf.subarray(0, nacl.secretbox.nonceLength));
      const opened = nacl.secretbox.open(new Uint8Array(buf.subarray(nacl.secretbox.nonceLength)), nonce, key);
      if (!opened) continue;
      try {
        for (const p of JSON.parse(Buffer.from(opened).toString('utf8')) as RawPoint[]) {
          if (seen.has(p.seq)) continue;
          seen.add(p.seq);
          out.push(p);
        }
      } catch {
        /* 壞行跳過 */
      }
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  list(): SessionMeta[] {
    const root = this.fs.root();
    if (!root.exists) return [];
    const metas: SessionMeta[] = [];
    for (const entry of root.list()) {
      if (!(entry instanceof Directory)) continue;
      const id = entry.name;
      const m = this.readMeta(id);
      if (m) metas.push(m);
    }
    return metas.sort((a, b) => b.startedAtUtc - a.startedAtUtc);
  }
  /** 未正常結束的 session（recording／paused／recoverable） */
  recoverable(): SessionMeta[] {
    return this.list().filter((m) => m.status === 'recording' || m.status === 'paused' || m.status === 'recoverable');
  }

  /** 刪除 session：點、meta 一起清（LocalWorkoutStore 是唯一存放路線的地方） */
  delete(sessionId: string): void {
    const d = this.fs.dir(sessionId);
    if (d.exists) d.delete();
  }
}

export type { Lap };
