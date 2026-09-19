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
 * - meta.json 以「寫暫存檔 → 原子搬移」更新（review 7）；讀取時做 schema 檢查，壞檔會退回暫存檔，
 *   仍讀不到則保留目錄並可由 `corrupted()` 列出，不會讓紀錄無聲消失。
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
  /** 自動暫停（Style 23.7）：靜止 ≥ 10 s 自動暫停、移動 ≥ 15 m 自動繼續；舊 meta 缺欄位 → false */
  autoPause?: boolean;
  splitLengthMm: number;
  status: 'recording' | 'paused' | 'recoverable' | 'saved' | 'needs_review' | 'discarded';
  startedAtUtc: number;
  /** 記錄用的單調時基（本 process 的 monotonic 起點對應的 UTC）；跨 process 恢復時改以 UTC 推算並標 interrupted */
  startedMonoMs: number;
  processId: string;
  /** kind 缺省＝手動；auto＝自動暫停（摘要分開統計） */
  pauses: { atMs: number; resumedAtMs: number | null; kind?: 'manual' | 'auto' }[];
  manualLapsAtMs: number[];
  lastSeq: number;
  acceptedCount: number;
  interrupted: boolean;
  endedAtUtc: number | null;
  summary: Summary | null;
  syncedSessionId: string | null;
  updatedAt: number;
  /** review 2：結束時仍未落地的定位點數（寫入失敗且重試耗盡）；> 0 代表摘要距離含未持久化的部分。舊 meta 無此欄位 */
  unsavedPoints?: number;
  /** PG-LINK-01：開始時的跑鞋外觀快照（之後切鞋不回寫）；null／缺欄位＝未指定（未綁定玩家或舊紀錄），不推算 */
  shoeSnapshot?: { shoeId: string; level: 1 | 2 | 3 | 4 | 5; variant: string | null } | null;
  /** PG-LINK-02：建立時綁定的玩家（錢包地址）；null＝訪客紀錄，首次歸屬須確認 */
  owner?: string | null;
  /** PG-LINK-04：記錄時的裝置時區（IANA）；日誌月／日分組依此，改手機時區不改事件順序；舊紀錄缺 → 裝置時區 */
  recordedTimeZone?: string | null;
  /** PG-LINK-03：使用者要求刪除的時間（tombstone）；已同步者等伺服器確認刪除後才移除本機，未確認前顯示「刪除待同步」，且不會被一般上傳復活 */
  deletedAt?: number | null;
  /** PG-LINK-02：上傳佇列狀態（WorkoutOutbox）；缺欄位＝從未嘗試 */
  sync?: { attempt: number; nextAttemptAt: number | null; lastError: { code: string; message: string } | null; revision: number; excluded?: { at: number; reason: string } };
};

const META = 'meta.json';
const META_TMP = 'meta.json.tmp';

/** 最低限度的 schema 檢查：欄位齊、型別對，才當成有效 meta；避免半截 JSON 或別的檔案被當成紀錄 */
export function isSessionMeta(x: unknown): x is SessionMeta {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return typeof m.sessionId === 'string' && m.sessionId.length > 0
    && (m.sport === 'run' || m.sport === 'walk')
    && (m.environment === 'outdoor' || m.environment === 'indoor')
    && typeof m.status === 'string'
    && typeof m.startedAtUtc === 'number' && Number.isFinite(m.startedAtUtc)
    && typeof m.startedMonoMs === 'number'
    && typeof m.processId === 'string'
    && Array.isArray(m.pauses)
    && Array.isArray(m.manualLapsAtMs)
    && typeof m.lastSeq === 'number'
    && typeof m.acceptedCount === 'number';
}

const KEY_ID = 'neonshift.workouts.key.v1';
const ROOT = 'workouts';

type Fs = { root(): Directory; dir(id: string): Directory; file(id: string, name: string): File };
/** 讀取 meta 的結果：ok／不存在／損毀（兩個檔都解析失敗；保留原始內容供診斷，不含座標） */
export type MetaReadResult = { kind: 'ok'; meta: SessionMeta } | { kind: 'missing' } | { kind: 'corrupt'; sessionId: string; reason: string };
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

  /**
   * 原子更新 meta.json：先寫 meta.json.tmp，再 move 覆蓋。
   * 直接覆寫時 process 被殺會留下半截 JSON，整筆紀錄就從列表消失；rename 在同一檔案系統上是原子的。
   */
  async writeMeta(meta: SessionMeta): Promise<void> {
    meta.updatedAt = Date.now();
    const tmp = this.fs.file(meta.sessionId, META_TMP);
    tmp.write(JSON.stringify(meta));
    await tmp.move(this.fs.file(meta.sessionId, META), { overwrite: true });
  }
  private parseMeta(f: File): { meta: SessionMeta } | { error: string } | null {
    if (!f.exists) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.textSync());
    } catch (e) {
      return { error: `json: ${e instanceof Error ? e.message : String(e)}` };
    }
    return isSessionMeta(parsed) ? { meta: parsed } : { error: 'schema' };
  }
  /** 讀 meta；主檔壞了退回暫存檔（move 之前被殺的情況）；都不行才回報損毀 */
  readMetaResult(sessionId: string): MetaReadResult {
    const main = this.parseMeta(this.fs.file(sessionId, META));
    if (main && 'meta' in main) return { kind: 'ok', meta: main.meta };
    const tmp = this.parseMeta(this.fs.file(sessionId, META_TMP));
    if (tmp && 'meta' in tmp) return { kind: 'ok', meta: tmp.meta };
    if (!main && !tmp) return { kind: 'missing' };
    return { kind: 'corrupt', sessionId, reason: [main && 'error' in main ? `meta: ${main.error}` : null, tmp && 'error' in tmp ? `tmp: ${tmp.error}` : null].filter(Boolean).join('; ') };
  }
  readMeta(sessionId: string): SessionMeta | null {
    const r = this.readMetaResult(sessionId);
    return r.kind === 'ok' ? r.meta : null;
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
      const m = this.readMeta(entry.name);
      if (m) metas.push(m);
    }
    return metas.sort((a, b) => b.startedAtUtc - a.startedAtUtc);
  }
  /** meta 損毀的 session 目錄（點檔可能還在）；畫面用來提示「有一筆紀錄讀不出來」並提供刪除，而不是無聲消失 */
  corrupted(): { sessionId: string; reason: string }[] {
    const root = this.fs.root();
    if (!root.exists) return [];
    const out: { sessionId: string; reason: string }[] = [];
    for (const entry of root.list()) {
      if (!(entry instanceof Directory)) continue;
      const r = this.readMetaResult(entry.name);
      if (r.kind === 'corrupt') out.push({ sessionId: r.sessionId, reason: r.reason });
    }
    return out;
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
