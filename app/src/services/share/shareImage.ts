import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import type Svg from 'react-native-svg';

import { SHARE_IMAGE, sharePublishable, type ShareImageLayout } from '@/domain/shareImage';

/**
 * 出圖與分享（docs/social-share §6.1）。
 *
 * 用 react-native-svg 的 `toDataURL(cb, { width, height })`：原生端以 viewBox 重算後
 * 畫成 1080×1350 的點陣，所以畫面上只顯示縮圖也能輸出清楚的圖，不需要截畫面。
 * 圖檔寫在 cache，分享面板關掉就刪；任何一步失敗都退回純文字分享，不讓使用者卡住。
 */
export type ShareOutcome = { ok: true; withImage: boolean } | { ok: false; reason: 'unpublishable' | 'failed' };

const TIMEOUT_MS = 10_000;

/** 出圖逾時要有上限：SVG 節點多時原生繪製可能久，但不能讓按鈕一直轉 */
function toPngBase64(svg: Svg): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('SHARE_IMAGE_TIMEOUT')); } }, TIMEOUT_MS);
    try {
      svg.toDataURL(
        (b64) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (b64) resolve(b64);
          else reject(new Error('SHARE_IMAGE_EMPTY'));
        },
        { width: SHARE_IMAGE.post.width, height: SHARE_IMAGE.post.height },
      );
    } catch (e) {
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error('SHARE_IMAGE_FAILED'));
    }
  });
}

async function shareTextOnly(message: string): Promise<ShareOutcome> {
  try {
    await Share.share({ message });
    return { ok: true, withImage: false };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export async function shareLayout(opts: { svg: Svg | null; layout: ShareImageLayout; message: string; dialogTitle: string }): Promise<ShareOutcome> {
  // 鏈上資產缺環境標示一律不出圖也不發文（§4.2）：寧可不分享，也不讓人以為是官方 SKR
  if (!sharePublishable(opts.layout)) return { ok: false, reason: 'unpublishable' };
  if (!opts.svg) return shareTextOnly(opts.message);
  let file: File | null = null;
  try {
    if (!(await Sharing.isAvailableAsync())) return shareTextOnly(opts.message);
    const b64 = await toPngBase64(opts.svg);
    file = new File(Paths.cache, `neonshift-${opts.layout.kind}-${Date.now()}.png`);
    file.create({ overwrite: true });
    file.write(b64, { encoding: 'base64' });
    await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: opts.dialogTitle });
    return { ok: true, withImage: true };
  } catch {
    return shareTextOnly(opts.message);
  } finally {
    // 分享面板關閉後（不論送出或取消）就沒有留著的理由；不寫相簿、不留殘檔（§5.7）
    try { file?.delete(); } catch { /* 已不存在 */ }
  }
}

/** Android 上 Instagram 等只取圖、丟掉文字 → 文案要能一鍵複製（§6.1） */
export async function copyCaption(message: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(message);
  } catch {
    return false;
  }
}
