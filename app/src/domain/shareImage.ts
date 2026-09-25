import { fmtDur, fmtPace, type ShareCardFields, type ShareCardInput } from '@/domain/review';
import type { RawPoint } from '@/domain/gps/engine';
import { buildTrace, trimEnds } from '@/domain/gps/trace';

/**
 * 社群分享圖卡的版面資料（docs/social-share/README.md §4）。
 *
 * 這一層是純函式、不含任何 React 與色彩：圖卡「上面有什麼」在這裡決定，「長什麼樣」在 ShareCard 元件。
 * 拆開的理由是隱私可測——「關掉的欄位絕不出現」「路線預設不出現」要能用單元測試證明，
 * 而不是靠讀 SVG 程式碼確認。
 */
export const SHARE_IMAGE = { post: { width: 1080, height: 1350 } } as const;

/** 版面演算法版本（§4.6 ShareRenderSpec）：同一筆紀錄日後重分享，靠這個判斷是否同一版版面 */
export const SHARE_RENDERER_VERSION = 1;

/** 起終點各裁掉的公尺數（§5.2）：出發與結束的位置最敏感 */
export const SHARE_ROUTE_TRIM_M = 150;

export type ShareImageKind = 'workout' | 'achievement';

/** 路線形狀：已裁去起終點、正規化到 0–1 的單位方框，等比置中。不含座標、時間、距離與比例尺 */
export type ShareRouteShape = { segments: { x: number; y: number }[][] };

export type ShareImageLayout = {
  kind: ShareImageKind;
  /** 主標籤（模式／系列），必要 */
  label: string;
  /** 唯一放大的數字與單位（§4.2 一張圖一個主數字） */
  hero: { value: string; unit: string };
  /** 次要資訊，一列一行 */
  lines: string[];
  /** 小塊（分段配速等），可能為空 */
  chips: string[];
  /** 程序繪製的徽章代號（成就卡）；運動卡為 null */
  emblem: string | null;
  /** 只有使用者明確開啟才有值 */
  route: ShareRouteShape | null;
  /** 產品線索，必要（§4.2：沒用過的人要看得懂這個 App 在做什麼） */
  tagline: string;
  site: string;
  /** QR 內容（DEC-S1：只在 post 尺寸右下角）；不想放時 null */
  qr: string | null;
  /** 含鏈上資產時必標 DEVNET／測試代幣；無鏈上資產為 null */
  notice: string | null;
};

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * 可發布檢查（§4.2 最後一句）：成就卡是鏈上資產，缺環境標示一律不給出圖。
 * 出圖前呼叫；測試也用同一個判斷，不另寫一套規則。
 */
export function sharePublishable(layout: ShareImageLayout): boolean {
  if (!layout.hero.value || !layout.tagline) return false;
  if (layout.kind === 'achievement' && !layout.notice) return false;
  return true;
}

/**
 * 路線形狀：先裁去起終點各 SHARE_ROUTE_TRIM_M 公尺，再等比投影到 0–1 單位方框。
 * 裁完點數過少（或總長不足）回 null——寧可沒有形狀，也不要一段能對回街口的短軌跡。
 */
export function routeShapeOf(points: RawPoint[], opts?: { trimM?: number }): ShareRouteShape | null {
  const kept = trimEnds(points, opts?.trimM ?? SHARE_ROUTE_TRIM_M);
  if (kept.length < 10) return null;
  const trace = buildTrace(kept, { width: 1, height: 1, padding: 0 });
  const segments = trace.segments.filter((s) => s.length > 1).map((s) => s.map((p) => ({ x: round3(p.x), y: round3(p.y) })));
  return segments.length ? { segments } : null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * 運動成績卡（卡型 A）。欄位開關沿用文字卡的 ShareCardFields，不另開一套——
 * 否則會出現「文字沒寫但圖裡有」。route 只有呼叫端明確傳入才會出現。
 */
export function workoutShareLayout(
  w: ShareCardInput,
  fields: ShareCardFields,
  opts: { t: T; labels: { mode: string; tagline: string; site: string }; route?: ShareRouteShape | null; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  const lines = [t('share.time', { t: fmtDur(w.elapsedMs) })];
  if (w.movingMs > 0 && w.movingMs < w.elapsedMs - 1000) lines.push(t('share.moving', { t: fmtDur(w.movingMs) }));
  if (fields.pace) {
    if (w.sport === 'run' && w.avgPaceSPerKm !== null) lines.push(t('share.avgPace', { p: fmtPace(w.avgPaceSPerKm) }));
    else if (w.avgSpeedKmh !== null) lines.push(t('share.avgSpeed', { v: w.avgSpeedKmh.toFixed(1) }));
    if (w.maxSpeed5sKmh !== null) lines.push(t('share.maxSpeed', { v: w.maxSpeed5sKmh.toFixed(1) }));
  }
  if (fields.goal && w.goal && w.goal.kind !== 'free') {
    const target = w.goal.kind === 'time' ? t('share.goalMin', { n: Math.round(w.goal.target / 60) }) : t('share.goalKm', { n: w.goal.target / 1_000_000 });
    lines.push(w.goalMet ? t('share.goalMet', { target }) : t('share.goalMissed', { target }));
  }
  if (fields.quality) lines.push(t('share.quality', { accepted: w.qualityAccepted, rejected: w.qualityRejected }));
  const chips: string[] = [];
  if (fields.splits) {
    const full = w.splits.filter((x) => !x.isPartial && x.paceSPerKm !== null) as { index: number; paceSPerKm: number }[];
    // 圖上放得下 8 格；再多就只看得到一堆小字（§4.2 最小字級 28 px）
    for (const x of full.slice(0, 8)) chips.push(`${x.index}k ${fmtPace(x.paceSPerKm)}`);
    if (w.lapCount > 0) chips.push(t('share.laps', { n: w.lapCount }));
  }
  return {
    kind: 'workout',
    label: fields.mode ? labels.mode : t('share.workout'),
    hero: { value: (w.distanceMm / 1_000_000).toFixed(2), unit: 'km' },
    lines,
    chips,
    emblem: null,
    route: opts.route ?? null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    // 運動成績卡不含鏈上資產與代幣，不掛 DEVNET；日期只有勾選才出現，且只到月份
    notice: fields.date ? monthOf(w.startedAt) : null,
  };
}

/** 成就收藏卡（卡型 B）。§4.3：日期與精確數值都預設關閉，需要本次社群分享另外勾選 */
export type AchievementShareInput = {
  category: string;
  /** 已翻譯的章名 */
  title: string;
  /** 已翻譯的系列字 */
  series: string;
  /** 精確值（距離／時間）；勾選 detail 才會進圖 */
  detail: string | null;
  achievedAt: Date | null;
  verification: 'organizer' | 'device';
  /** 收藏編號（No. 12）；查不到時 null */
  edition: string | null;
};

/**
 * 成就卡的分享欄位（§5.4）：與 NFT metadata 的 `pb.consentShare` 是兩件事，
 * NFT 已公開也不自動勾選——所以預設兩個都關。
 */
export type AchievementShareFields = { detail: boolean; date: boolean };
export const ACHIEVEMENT_SHARE_DEFAULT: AchievementShareFields = { detail: false, date: false };

export function achievementShareLayout(
  a: AchievementShareInput,
  fields: AchievementShareFields,
  opts: { t: T; labels: { tagline: string; site: string; notice: string }; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  const lines = [t(`share.card.class.${a.verification}`)];
  if (fields.detail && a.detail) lines.push(a.detail);
  if (fields.date && a.achievedAt) lines.push(monthOf(a.achievedAt));
  return {
    kind: 'achievement',
    label: a.series,
    hero: { value: a.title, unit: '' },
    lines,
    chips: a.edition ? [a.edition] : [],
    emblem: a.category,
    // 成就卡不放路線：這是收藏品，不是運動紀錄
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    notice: labels.notice,
  };
}

/**
 * 分享連結（§6.2／§6.3）：落地頁路徑帶 kind、query 只帶允許清單內的 source。
 * 不含任何個人識別，也不帶來源紀錄 ID——ShareRenderSpec 的來源 ID 只留在本機。
 */
export const SHARE_KINDS = ['workout', 'achievement', 'gear', 'guardian', 'passport'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
export const SHARE_SOURCES = ['summary', 'mint', 'levelup', 'guardian', 'passport', 'invite', 'finish'] as const;
export type ShareSource = (typeof SHARE_SOURCES)[number];

export function shareUrl(site: string, kind: ShareKind, source: ShareSource): string {
  return `${site}/s/${kind}?source=${source}`;
}

/**
 * 一次預覽的凍結輸入（§4.6）。來源 ID／revision 只供本機重建與失效判斷，
 * 不寫進圖檔 metadata、QR 或歸因連結；帳號換了或來源紀錄被刪改就作廢重新確認。
 */
export type ShareRenderSpec = {
  kind: ShareImageKind;
  source: { id: string; revision: number } | null;
  owner: string | null;
  rendererVersion: number;
  locale: string;
  format: 'post';
};
