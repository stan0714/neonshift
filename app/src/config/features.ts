/**
 * 功能開關（build-time 常數，不含祕密）。
 * - `sleep`：睡眠任務與睡眠卡片（2026-09-20 負責人決定先隱藏，App 專心在運動數據呈現）。關閉時：Home 不顯示睡眠卡與睡眠任務、
 *   Health Connect 只要求步數權限（不再因缺睡眠權限判 partial）、上手／Profile 文案改為只讀步數；前景／背景停止睡眠讀取，manifest 不宣告 READ_SLEEP。鏈上 task_type=2 與後端睡眠規則保留、不移除。
 *   若重新啟用需同步恢復原生 worker、權限及現行文案，不能只切換此常數。
 *   打卡紀錄（ActivityHistory）仍會列出過去已領取的睡眠任務。
 */
const demoLevelRaw = Number(process.env.EXPO_PUBLIC_DEMO_LEVEL ?? '0');
/**
 * `demoLevel`（0＝關）：展示版覆寫——把鏈上讀到的 PlayerProfile 顯示成指定鞋階（外觀／擁有鞋款／棲地背景／路線底圖跟著出來），
 * 畫面固定顯示「DEMO DATA」、打卡與鑄造停用。只用於負責人 Seeker 的展示包（`EXPO_PUBLIC_DEMO_LEVEL=3 scripts/app/build.sh dev release`），
 * 提交 APK 不設定。不改鏈上、後端；影片中相關鏡頭須標 DESIGN PREVIEW／DEMO DATA。
 */
export const FEATURES = { sleep: false, demoLevel: Number.isFinite(demoLevelRaw) && demoLevelRaw >= 1 && demoLevelRaw <= 5 ? demoLevelRaw : 0 } as const;
