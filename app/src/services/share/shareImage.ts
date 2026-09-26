import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import type Svg from 'react-native-svg';

import { SHARE_IMAGE, sharePublishable, type ShareFormat, type ShareImageLayout, type ShareRenderSpec } from '@/domain/shareImage';

/**
 * 出圖與分享（docs/social-share §6.1）。
 *
 * 用 react-native-svg 的 `toDataURL(cb, { width, height })`：原生端依 viewBox 重算後畫成
 * 所選格式的點陣（post 1080×1350、story 1080×1920，不受 PixelRatio 影響），
 * 所以畫面上只顯示縮圖也能輸出正確尺寸的圖。
 *
 * 兩條規格上的硬性要求：
 * 1. **不在分享 API 返回時刪檔**。接收 App 可能還沒讀完，只能記到期時間，下次啟動或下次產圖再清。
 * 2. **失敗不自動彈第二個面板**。回傳原因讓畫面給「重試／改分享文字／複製文案」，
 *    使用者自己選；使用者取消分享不是錯誤。
 */
export type ShareOutcome =
  | { ok: true; withImage: true }
  | { ok: false; reason: 'unpublishable' | 'no_target' | 'render_failed' | 'stale' };

const PREFIX = 'neonshift-share-';
/** 暫存期限：本專案建議值，待實機確認慢速接收端讀得完（§6.1） */
export const SHARE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 數量上限：避免長期累積；超量時連未到期的最舊檔一起清 */
export const SHARE_CACHE_MAX_FILES = 8;
const RENDER_TIMEOUT_MS = 10_000;

/** 正在交付中的檔案：清理時絕不刪這些（§9.1「不刪正在交付的檔案」） */
const active = new Set<string>();

const expiryOf = (name: string): number => {
  const m = /^neonshift-share-[a-z]+-(\d+)-[0-9a-f]+\.png$/.exec(name);
  return m ? Number(m[1]) : 0;
};

/** 檔名不含使用者資料：kind ＋ 到期時間 ＋ 隨機值（§6.1） */
const nameFor = (kind: string, now: number) => `${PREFIX}${kind}-${now + SHARE_CACHE_TTL_MS}-${Math.floor(Math.random() * 0xfffffff).toString(16)}.png`;

/**
 * 清理過期暫存。啟動時與每次產圖前各跑一次；回傳刪掉的檔數。
 * 只刪「已到期且不在本次分享中」的檔；超過數量上限時，也清掉最舊的（同樣跳過交付中）。
 */
export function cleanupShareCache(now = Date.now()): number {
  let removed = 0;
  try {
    const files = new Directory(Paths.cache)
      .list()
      .filter((e): e is File => e instanceof File && e.name.startsWith(PREFIX))
      .map((f) => ({ f, expiry: expiryOf(f.name) }))
      .filter((x) => !active.has(x.f.uri));
    for (const x of files.filter((y) => y.expiry <= now)) {
      try { x.f.delete(); removed++; } catch { /* 已不存在 */ }
    }
    const rest = files.filter((y) => y.expiry > now).sort((a, b) => a.expiry - b.expiry);
    for (const x of rest.slice(0, Math.max(0, rest.length - SHARE_CACHE_MAX_FILES))) {
      try { x.f.delete(); removed++; } catch { /* 已不存在 */ }
    }
  } catch {
    // 快取目錄讀不到不影響分享本身
  }
  return removed;
}

function toPngBase64(svg: Svg, format: ShareFormat): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('SHARE_IMAGE_TIMEOUT')); } }, RENDER_TIMEOUT_MS);
    try {
      svg.toDataURL(
        (b64) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (b64) resolve(b64);
          else reject(new Error('SHARE_IMAGE_EMPTY'));
        },
        // 尺寸**依所選格式**，不寫死 post：story 是 1080×1920，輸出錯尺寸等於裁掉內容
        { width: SHARE_IMAGE[format].width, height: SHARE_IMAGE[format].height },
      );
    } catch (e) {
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error('SHARE_IMAGE_FAILED'));
    }
  });
}

/**
 * 出圖並交給系統分享面板。一次只做一件事由呼叫端以狀態控制（`rendering`／`handing_off`）；
 * 回傳 ok 只代表「交付流程返回」，不代表對方社群已發布。
 */
export async function shareLayout(opts: {
  svg: Svg | null;
  layout: ShareImageLayout;
  dialogTitle: string;
  /** 預覽當下凍結的輸入；帳號或來源變了就作廢，不讓延遲的匯出寫到別的帳號 */
  spec?: ShareRenderSpec;
  stillValid?: (spec: ShareRenderSpec) => boolean;
  /** 輸出尺寸（§4.1）；預設 post 1080×1350 */
  format?: ShareFormat;
}): Promise<ShareOutcome> {
  // 缺必要的網路標示一律不匯出：寧可不分享，也不讓人以為是主網資產或官方 SKR（§4.2）
  if (!sharePublishable(opts.layout)) return { ok: false, reason: 'unpublishable' };
  if (opts.spec && opts.stillValid && !opts.stillValid(opts.spec)) return { ok: false, reason: 'stale' };
  if (!opts.svg) return { ok: false, reason: 'render_failed' };
  cleanupShareCache();
  let uri: string | null = null;
  try {
    if (!(await Sharing.isAvailableAsync())) return { ok: false, reason: 'no_target' };
    const b64 = await toPngBase64(opts.svg, opts.format ?? 'post');
    const file = new File(Paths.cache, nameFor(opts.layout.kind, Date.now()));
    file.create({ overwrite: true });
    file.write(b64, { encoding: 'base64' });
    uri = file.uri;
    active.add(uri);
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: opts.dialogTitle });
    return { ok: true, withImage: true };
  } catch {
    return { ok: false, reason: 'render_failed' };
  } finally {
    // 交付結束就不再保護，但**不刪**：接收 App 可能還在讀，交給 TTL 清理
    if (uri) active.delete(uri);
  }
}

/** 使用者自己選「改成分享文字」時才走純文字，不由失敗自動觸發 */
export async function shareTextInstead(message: string): Promise<boolean> {
  try {
    await Share.share({ message });
    return true;
  } catch {
    return false;
  }
}

/** Android 上 IG 等只取圖、丟掉文字 → 文案與連結要能一鍵複製（§6.1） */
export async function copyCaption(message: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(message);
  } catch {
    return false;
  }
}
