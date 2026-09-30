import { fmtDur, fmtPace, type ShareCardFields, type ShareCardInput } from '@/domain/review';
import type { RawPoint } from '@/domain/gps/engine';
import { shareRouteShape, type ShareRouteConfig } from '@/domain/gps/shareRoute';

/**
 * 社群分享圖卡的版面資料（docs/social-share/README.md §4）。
 *
 * 這一層是純函式、不含任何 React 與色彩：圖卡「上面有什麼」在這裡決定，「長什麼樣」在 ShareCard 元件。
 * 拆開的理由是隱私可測——「關掉的欄位絕不出現」「路線預設不出現」要能用單元測試證明，
 * 而不是靠讀 SVG 程式碼確認。
 */
/**
 * 兩種輸出尺寸（§4.1）。`post` 是版面的唯一真實尺寸；`story` 用同一塊 1080×1350 內容
 * **垂直置中**在 1080×1920 的畫布上，上下各留 285 px 空白——比規格要求的 250 px 安全區
 * 再寬一點，而且不必為 9:16 重算一套版面：使用者預覽到的那張圖與 story 的內容完全相同，
 * 只是畫布更高。這是「送出同一份已預覽內容」（§4.6）最省風險的做法。
 */
export const SHARE_IMAGE = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;
export const SHARE_FORMATS = ['post', 'story'] as const;
export type ShareFormat = (typeof SHARE_FORMATS)[number];
/** story 的安全區下限（§4.1）：上下各要留這麼多才不會被平台 UI 蓋住 */
export const SHARE_STORY_SAFE_PX = 250;

/** 版面演算法版本（§4.6 ShareRenderSpec）：同一筆紀錄日後重分享，靠這個判斷是否同一版版面 */
export const SHARE_RENDERER_VERSION = 1;

/** 路線形狀的裁切與保護區規則都在 `domain/gps/shareRoute`（PG-SHARE-09） */
export { SHARE_ROUTE } from '@/domain/gps/shareRoute';

export type ShareImageKind = 'workout' | 'achievement' | 'event' | 'gear' | 'guardian' | 'passport' | 'finish' | 'seasonal';

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
  /**
   * 多格徽章（護照卡）：一張圖放多枚收藏的短標。空陣列代表這張卡只有單一徽章或沒有徽章。
   * 只放**目前有效**的項目——待核准與已撤銷不得出現在格子裡，否則圖會比護照畫面多算幾枚。
   */
  grid: string[];
  /**
   * 真正的主題徽章美術（節日卡）：ShareCard 用 `SeasonalBadgeArt` 畫那一章的插畫。
   * 這一層只說「畫哪一章、哪一年、什麼狀態」——`state` 必須如實反映資格，
   * 不能用 `earned` 去畫一個還在待審的章。
   */
  badge: { themeId: string; year: number; state: 'locked' | 'pending' | 'earned' } | null;
  /** 只有使用者明確開啟才有值 */
  route: ShareRouteShape | null;
  /** 產品線索，必要（§4.2：沒用過的人要看得懂這個 App 在做什麼） */
  tagline: string;
  site: string;
  /** QR 內容（DEC-S1：只在 post 尺寸右下角）；不想放時 null */
  qr: string | null;
  /** 含鏈上資產時必標所屬網路；無鏈上資產為 null */
  notice: string | null;
  /**
   * 這張圖是否描繪鏈上資產（成就收藏、已領取的跑鞋紀念 NFT）。
   * true 時 notice 必填，否則 `sharePublishable` 直接擋掉——看圖的人要知道是哪個網路。
   */
  chainAsset: boolean;
};

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * 可發布檢查（§4.2 最後一句）：描繪鏈上資產的卡缺環境標示一律不給出圖。
 * 判斷依「這張圖是否畫了鏈上資產」而不是卡型——未領取的跑鞋只是本機里程，不該硬掛網路標示。
 * 出圖前呼叫；測試也用同一個判斷，不另寫一套規則。
 */
export function sharePublishable(layout: ShareImageLayout): boolean {
  if (!layout.hero.value || !layout.tagline) return false;
  if (layout.chainAsset && !layout.notice) return false;
  return true;
}

/**
 * 路線形狀（PG-SHARE-09）。規則全在 `shareRouteShape`：按距離裁兩端、移除全程再次進入
 * 起終點保護區的點、不跨缺口與裁掉的區段補連線、裁完才正規化、長度不足就不給形狀。
 * 這裡只把結果收成版面用的型別——`keptM` 不往上傳，圖卡不需要也不該知道剩多長。
 */
export function routeShapeOf(points: RawPoint[], opts?: Partial<ShareRouteConfig>): ShareRouteShape | null {
  const r = shareRouteShape(points, opts ?? {});
  return r ? { segments: r.segments } : null;
}
const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * 運動成績卡（卡型 A）。欄位開關沿用文字卡的 ShareCardFields，不另開一套——
 * 否則會出現「文字沒寫但圖裡有」。route 只有呼叫端明確傳入才會出現。
 */
/**
 * 運動的真實狀態（§4.5）：本機完成、待同步或待審的紀錄一律標「個人紀錄／尚未驗證」，
 * 不得讓圖看起來像官方認證或已取得 NFT。`synced` 也只是裝置記錄，不是主辦方驗證。
 */
export type WorkoutShareStatus = 'local' | 'needs_review' | 'synced';

export function workoutShareLayout(
  w: ShareCardInput,
  fields: ShareCardFields,
  opts: { t: T; labels: { mode: string; tagline: string; site: string }; route?: ShareRouteShape | null; qr?: string | null; status?: WorkoutShareStatus },
): ShareImageLayout {
  const { t, labels } = opts;
  // 狀態放在第一行：看圖的人先知道這是「誰的紀錄、驗到什麼程度」，再看數字
  const lines = [t(`share.card.status.${opts.status ?? 'local'}`), t('share.time', { t: fmtDur(w.elapsedMs) })];
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
    grid: [],
    badge: null,
    route: opts.route ?? null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    // 運動成績卡不含鏈上資產與代幣，不掛網路標示；日期只有勾選才出現，且只到月份
    notice: fields.date ? monthOf(w.startedAt) : null,
    chainAsset: false,
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
    grid: [],
    badge: null,
    // 成就卡不放路線：這是收藏品，不是運動紀錄
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    notice: labels.notice,
    chainAsset: true,
  };
}

/**
 * 活動邀請卡（卡型 C）。只放主辦方公開資訊：活動名、時間、城市層級地點、主辦方。
 * 名額會變動，所以圖上不寫剩幾位——落地頁才是即時資訊（§4.3）。
 * 不含個人報名資料、報到碼、NFC tag 或其他參加者。
 */
export function eventShareLayout(
  e: { title: string; whenLabel: string; cityLabel: string | null; organizer: string | null },
  opts: { t: T; labels: { tagline: string; site: string }; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  const lines = [e.whenLabel];
  if (e.cityLabel) lines.push(e.cityLabel);
  if (e.organizer) lines.push(t('share.card.organizer', { name: e.organizer }));
  lines.push(t('share.card.spotsNote'));
  return {
    kind: 'event',
    label: t('share.card.event'),
    hero: { value: e.title, unit: '' },
    lines,
    chips: [],
    emblem: 'event',
    grid: [],
    badge: null,
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    notice: null,
    chainAsset: false,
  };
}

/**
 * 跑鞋里程／升階卡（卡型 D）。主數字是這雙鞋的累積里程。
 * 只有已在鏈上領取紀念 NFT 才算鏈上資產並帶網路標示；沒領取就只是本機里程，不硬掛 DEVNET。
 */
export function gearShareLayout(
  g: { levelName: string; level: number; kmTotal: string; nextLabel: string | null; claimedOnChain: boolean },
  opts: { t: T; labels: { tagline: string; site: string; notice?: string | null }; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  const lines = [t('share.card.stage', { n: g.level, name: g.levelName })];
  if (g.nextLabel) lines.push(g.nextLabel);
  lines.push(t(g.claimedOnChain ? 'share.card.gear.claimed' : 'share.card.gear.unclaimed'));
  return {
    kind: 'gear',
    label: t('share.card.gear'),
    hero: { value: g.kmTotal, unit: 'km' },
    lines,
    chips: [],
    emblem: `shoe:${g.level}`,
    grid: [],
    badge: null,
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    notice: g.claimedOnChain ? (labels.notice ?? null) : null,
    chainAsset: g.claimedOnChain,
  };
}

/**
 * Guardian 故事卡（卡型 E）。分享的是故事與共同進度，**不含任何個人數據**。
 * 也不宣稱已捐款或救援動物——這是學習里程碑（見 guardian.impactNote）。
 */
export function guardianShareLayout(
  g: { speciesName: string; storyLine: string; progressLabel: string | null; level: number },
  opts: { t: T; labels: { tagline: string; site: string }; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  const lines = [g.storyLine];
  if (g.progressLabel) lines.push(g.progressLabel);
  lines.push(t('share.card.guardian.note'));
  return {
    kind: 'guardian',
    label: t('share.card.guardian'),
    hero: { value: g.speciesName, unit: '' },
    lines,
    chips: [],
    emblem: `guardian:${g.level}`,
    grid: [],
    badge: null,
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    notice: null,
    chainAsset: false,
  };
}

/** 護照卡一次最多放幾格徽章（§4.3 卡型 B 多格）：再多就只看得到一堆看不清的小圈 */
export const PASSPORT_SHARE_EMBLEMS = 8;

/**
 * 成就護照卡（卡型 B 多格，時機 S3）。主數字是**目前有效**的枚數。
 *
 * 「有效」的定義與護照畫面同一個（`validity === 'valid'`）：待核准（pending）、已撤銷（revoked）
 * 與上鎖（locked）都不計入，也不進格子——圖上的數字比畫面多一枚，就是在對外宣稱沒有的收藏。
 * 有效不等於鏈上：一枚已核准但還沒鑄造的成就仍然有效，所以**是否標網路取決於已鑄造的枚數**，
 * 不是有效枚數（§4.5）。達成時間屬個人資訊，這張卡完全不放。
 */
export type PassportShareInput = {
  /** 目前有效的枚數 */
  validCount: number;
  /** 其中已在鏈上鑄造完成（confirmed）的枚數；交易中、待核准都不算 */
  mintedCount: number;
  /** 格子裡的徽章代號，只取有效項目 */
  emblems: string[];
};

export function passportShareLayout(
  p: PassportShareInput,
  opts: { t: T; labels: { tagline: string; site: string; notice: string }; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  const minted = p.mintedCount > 0;
  return {
    kind: 'passport',
    label: t('share.card.passport'),
    hero: { value: String(p.validCount), unit: t('share.card.passport.unit') },
    lines: [
      minted ? t('share.card.passport.minted', { n: p.mintedCount }) : t('share.card.passport.noneMinted'),
      // 計數規則寫在圖上：看圖的人才知道這個數字不含待核准與已撤銷
      t('share.card.passport.rule'),
    ],
    chips: [],
    emblem: null,
    grid: p.emblems.slice(0, PASSPORT_SHARE_EMBLEMS),
    badge: null,
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    // 一枚都沒鑄造時這張圖沒有鏈上資產，不掛網路標示
    notice: minted ? labels.notice : null,
    chainAsset: minted,
  };
}

/**
 * 完賽卡（時機 S5，卡型 B／C 之間）。成績只由主辦方發布（`rank_source: organizer`），
 * 所以第一行先說這筆成績「是否已由主辦方公布」，而不是先放時間。
 *
 * **完賽時間與名次預設關閉**：這是本次社群分享的獨立同意，與公開成績榜的 `public_consent`
 * 是兩件事（§5.4）；成績榜已公開也不自動勾選。名次另外要求 official——主辦方還沒公布時
 * 沒有可引用的名次來源。這張卡不描繪鏈上資產：完賽章是另一枚收藏，由成就卡呈現。
 */
export type FinishShareFields = { time: boolean; rank: boolean };
export const FINISH_SHARE_DEFAULT: FinishShareFields = { time: false, rank: false };

export type FinishShareInput = {
  eventTitle: string;
  /** 活動時間（已格式化、含時區） */
  whenLabel: string;
  /** 項目（10K、半馬…）＋距離，已翻譯 */
  disciplineLabel: string;
  /** 主辦方公布的完賽時間，已格式化；勾選 time 才進圖 */
  finishTime: string | null;
  /** 主辦方公布的名次；勾選 rank 且 official 才進圖 */
  rank: number | null;
  /** 這筆成績是否已由主辦方公布 */
  official: boolean;
  /** 主辦方更正過這筆成績——圖上要說，否則舊圖與新成績對不上也沒人知道 */
  corrected: boolean;
};

export function finishShareLayout(
  f: FinishShareInput,
  fields: FinishShareFields,
  opts: { t: T; labels: { tagline: string; site: string }; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  const lines = [t(f.official ? 'share.card.finish.official' : 'share.card.finish.unofficial'), f.whenLabel, f.disciplineLabel];
  if (fields.time && f.finishTime) lines.push(t('share.card.finish.time', { t: f.finishTime }));
  if (fields.rank && f.official && f.rank !== null) lines.push(t('share.card.finish.rank', { n: f.rank }));
  if (f.corrected) lines.push(t('share.card.finish.corrected'));
  return {
    kind: 'finish',
    label: t('share.card.finish'),
    hero: { value: f.eventTitle, unit: '' },
    lines,
    chips: [],
    emblem: 'event_finish',
    grid: [],
    badge: null,
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    notice: null,
    chainAsset: false,
  };
}

/**
 * 節日收藏卡（PG-SEASON-05；docs/design/seasonal-achievement-nfts.md §4.5）。
 *
 * 分享的是「這一屆、這個主題、我的真實狀態」。三件事在這張卡上不可協商：
 *
 * 1. **狀態如實**。後端目前 `mint_enabled: false`，沒有任何鏈上資產，所以只能寫
 *    「已達標 · 本屆尚未開放領取」；`chainAsset` 一律 false，也就不掛網路標示。
 *    PG-SEASON-04 接上 registry／mint 之後才會有 `minted` 狀態與網路標示——**在那之前
 *    這張卡不能出現「已鑄造」**，否則使用者會拿一張沒有對應 NFT 的圖去證明自己有收藏。
 * 2. **節日日期是公開主題，取得時間是個人資訊。** 活動窗口（公開）預設出現；
 *    使用者自己達標的時間預設**不**出現，勾選後也只到月份（§4.5「日期與時間屬私人詳情」）。
 * 3. **不含自己的 Activity ID、起終點與錢包。** 連結導向主題介紹，不是個人紀錄。
 */
export type SeasonalShareStatus = 'pending_review' | 'eligible';
/** 節日卡的分享欄位：與公開的節日日期無關，這是「我什麼時候達標的」 */
export type SeasonalShareFields = { date: boolean };
export const SEASONAL_SHARE_DEFAULT: SeasonalShareFields = { date: false };

export type SeasonalShareInput = {
  /** 已翻譯的活動名 */
  themeName: string;
  themeId: string;
  year: number;
  status: SeasonalShareStatus;
  /** 活動窗口的公開日期字串（含時區），由呼叫端格式化 */
  windowLabel: string;
  /** 使用者達標那筆運動的時間；勾選 date 才進圖，且只到月份 */
  achievedAt: Date | null;
  /** 後端是否已開放這一屆領取（`mint_enabled`）。false 時圖上明寫尚未開放 */
  mintEnabled: boolean;
};

export function seasonalShareLayout(
  s: SeasonalShareInput,
  fields: SeasonalShareFields,
  opts: { t: T; labels: { tagline: string; site: string }; qr?: string | null },
): ShareImageLayout {
  const { t, labels } = opts;
  // 第一行永遠是真實狀態：待審不能寫成已達標，已達標不能寫成已領取
  const statusKey =
    s.status === 'pending_review' ? 'share.card.seasonal.pending' : s.mintEnabled ? 'share.card.seasonal.claimable' : 'share.card.seasonal.notOpen';
  const lines = [t(statusKey), s.windowLabel];
  if (fields.date && s.achievedAt) lines.push(t('share.card.seasonal.achieved', { month: monthOf(s.achievedAt) }));
  return {
    kind: 'seasonal',
    label: t('share.card.seasonal'),
    hero: { value: s.themeName, unit: '' },
    lines,
    // 年份已經印在徽章底部，chips 不重複一次
    chips: [],
    emblem: null,
    grid: [],
    // 待審畫虛線軌道、達標才填滿——徽章本身就是狀態，不靠文字補救
    badge: { themeId: s.themeId, year: s.year, state: s.status === 'eligible' ? 'earned' : 'pending' },
    route: null,
    tagline: labels.tagline,
    site: labels.site,
    qr: opts.qr ?? null,
    // 04 之前 mint_enabled 一律 false，圖上沒有鏈上資產，因此不掛網路標示
    notice: null,
    chainAsset: false,
  };
}

/**
 * 分享連結（§6.2／§6.3）：落地頁路徑帶 kind、query 只帶允許清單內的 source。
 * 不含任何個人識別，也不帶來源紀錄 ID——ShareRenderSpec 的來源 ID 只留在本機。
 */
export const SHARE_KINDS = ['workout', 'achievement', 'gear', 'guardian', 'passport', 'seasonal'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
export const SHARE_SOURCES = ['summary', 'mint', 'levelup', 'guardian', 'passport', 'invite', 'finish', 'seasonal'] as const;
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
  format: ShareFormat;
};

/**
 * R3：一張已經預覽過的運動分享圖，什麼情況下就不該再送出去。
 * 出圖要好幾秒，這段期間紀錄可能被編輯、被刪除，或使用者換了帳號——
 * 任何一種都代表這張圖已經不是他按下分享時看到的那一張。
 *
 * `revision` 用紀錄的 updatedAt（內容版本），不是 rulesVersion：後者是品質規則的版本，
 * 紀錄被編輯過它不會變，拿來判斷「還是同一份內容嗎」等於沒判斷。
 */
export function workoutShareStillValid(
  spec: ShareRenderSpec,
  meta: { owner?: string | null; updatedAt?: number; deletedAt?: number | null } | null,
  currentAddress: string | null,
): boolean {
  if (!meta || meta.deletedAt) return false;
  if ((meta.owner ?? null) !== spec.owner) return false; // 歸屬改變（首次歸屬確認）
  // 訪客紀錄（owner null）沒綁帳號，換帳號不影響；已綁定的就必須還在同一個帳號
  if (spec.owner !== null && currentAddress !== spec.owner) return false;
  return (meta.updatedAt ?? 0) === (spec.source?.revision ?? 0);
}
