import * as SecureStore from 'expo-secure-store';

/**
 * XD-02（mobile-differentiation 4.2）：錢包互動時間線——每次 MWA 操作分開記錄
 * App 等待（按下到切去錢包）、錢包等待（在錢包裡的時間）、回來後等待（回前景到收到結果），
 * 以及是否發生在運動記錄中；只存操作種類與時間，不存地址、簽章或交易內容。
 * 用途：驗收「記錄中自動彈出錢包次數必為 0」與「主觀簽名時間不當成網路延遲」；Profile 可看、證據包可抄。
 */
export type WalletTimelineEntry = {
  id: number;
  op: string;
  startedAt: number;
  endedAt: number | null;
  appWaitMs: number | null;
  walletWaitMs: number | null;
  returnWaitMs: number | null;
  result: 'ok' | 'no_reply' | 'error' | 'pending';
  code?: string;
  duringRecording: boolean;
  initiatedBy: 'user';
};

const KEY = 'neonshift.wallet.timeline.v1';
const MAX = 30;
let entries: WalletTimelineEntry[] = [];
let nextId = 1;
let recordingProbe: () => boolean = () => false;
let loaded = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());
async function persist() { try { await SecureStore.setItemAsync(KEY, JSON.stringify(entries.slice(-MAX))); } catch { /* 診斷資料，丟了無妨 */ } }

export const walletTimeline = {
  /** 由 WorkoutRecorder 於模組載入時註冊（避免 wallet → workouts 反向 import） */
  setRecordingProbe(fn: () => boolean) { recordingProbe = fn; },
  async load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) { entries = (JSON.parse(raw) as WalletTimelineEntry[]).map((e) => (e.result === 'pending' ? { ...e, result: 'no_reply' as const } : e)); nextId = (entries[entries.length - 1]?.id ?? 0) + 1; }
    } catch { /* 空白開始 */ }
    notify();
  },
  begin(op: string, now = Date.now()): number {
    const e: WalletTimelineEntry = { id: nextId++, op, startedAt: now, endedAt: null, appWaitMs: null, walletWaitMs: null, returnWaitMs: null, result: 'pending', duringRecording: recordingProbe(), initiatedBy: 'user' };
    entries = [...entries, e].slice(-MAX);
    notify();
    return e.id;
  },
  /** App 切去背景（＝錢包接手） */
  leftApp(id: number, now = Date.now()) {
    const e = entries.find((x) => x.id === id);
    if (e && e.appWaitMs === null) { e.appWaitMs = now - e.startedAt; e.walletWaitMs = null; e.returnWaitMs = null; (e as { _bg?: number })._bg = now; }
  },
  /** 回到前景 */
  returned(id: number, now = Date.now()) {
    const e = entries.find((x) => x.id === id) as (WalletTimelineEntry & { _bg?: number }) | undefined;
    if (e && e._bg !== undefined) { e.walletWaitMs = (e.walletWaitMs ?? 0) + (now - e._bg); e._bg = undefined; (e as { _fg?: number })._fg = now; }
  },
  end(id: number, result: 'ok' | 'no_reply' | 'error', code?: string, now = Date.now()) {
    const e = entries.find((x) => x.id === id) as (WalletTimelineEntry & { _bg?: number; _fg?: number }) | undefined;
    if (!e || e.result !== 'pending') return;
    if (e._bg !== undefined) { e.walletWaitMs = (e.walletWaitMs ?? 0) + (now - e._bg); e._bg = undefined; }
    if (e._fg !== undefined) { e.returnWaitMs = now - e._fg; e._fg = undefined; }
    if (e.appWaitMs === null) e.appWaitMs = now - e.startedAt; // 從未切去錢包（例如本機就失敗）
    e.endedAt = now; e.result = result; if (code) e.code = code;
    notify();
    void persist();
  },
  list(): WalletTimelineEntry[] { return entries.map(({ ...e }) => { delete (e as { _bg?: number })._bg; delete (e as { _fg?: number })._fg; return e; }); },
  /** 驗收摘要：總次數、記錄中發生次數（全部都是使用者按鈕觸發；自動彈出應為 0） */
  summary() {
    const done = entries.filter((e) => e.result !== 'pending');
    return { total: done.length, duringRecording: done.filter((e) => e.duringRecording).length, noReply: done.filter((e) => e.result === 'no_reply').length, medianWalletWaitMs: median(done.map((e) => e.walletWaitMs).filter((v): v is number => v !== null)) };
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  async clear() { entries = []; notify(); await persist(); },
  _resetForTests() { entries = []; nextId = 1; loaded = false; recordingProbe = () => false; listeners.clear(); },
};

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}
