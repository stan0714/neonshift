# 提交候選版證據（2026-09-21）

依 [參賽開發計畫 §6](../store/competition-development-plan.md) 產生；只有實測才標 PASS。本檔由 `scripts/release/evidence.sh` 生成骨架，驗收欄位手動填寫。

## 建置

| 項目 | 值 |
|---|---|
| APK | `app-release.apk` |
| SHA-256 | `eb1cbcb7d76b681efe8225cbbb0e3264cc30fe9f3e591916027fa1f3acd020a3` |
| badging | `package: name='cc.neonshift.app' versionCode='1' versionName='0.1.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'` |
| env | dev (release) |
| 版本 | versionName"0.1.0" |
| Git | ca199f5 |
| Program Id | 6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA |
| tSKR Mint | 2itshf7Xup3WZeeDRSXbstv4nbPcjfiLhdDpcQjU7RtZ |
| 後端 | https://api.neonshift.cc/v1 |
| 網路 | devnet |
| 建置指令 | `APP_ARCHS=<abi> scripts/app/build.sh <env> release`（乾淨環境重建步驟：docs/build-and-test.md） |

## 裝置

| 項目 | 值 |
|---|---|
| 裝置 | Seeker · Android 16 · 安全性更新 2026-08-05 |
| 已安裝錢包／Health Connect | 見下表 |

| 套件 | 版本 |
|---|---|
| com.solanamobile.wallet | 1.16.2 |
| app.phantom | 26.6.0 |
| ag.jup.jupiter.android | 3.18.0+270 |
| com.solanamobile.seedvaultimpl | 1.1.1 |

## 驗收矩陣（預期／實際／證據／測試者／日期）

| 類別 | 案例 | 預期 | 實際 | 證據 | 測試者 | 日期 | 結果 |
|---|---|---|---|---|---|---|---|
| 錢包 | 未安裝相容錢包 | 顯示 No compatible wallet，不崩潰 |  |  |  |  | TODO |
| 錢包 | 取消授權 | 顯示已取消，未寫入 session |  |  |  |  | TODO |
| 錢包 | 連點連接 | 只開一次錢包 |  |  |  |  | TODO |
| 錢包 | 背景返回 | 回前景後狀態一致 |  |  |  |  | TODO |
| 錢包 | 已核准但錢包未回覆 | WALLET_NO_REPLY 指引改用 Seeker Wallet |  |  |  |  | TODO |
| 錢包 | session 過期 | 重新授權後同帳號繼續 |  |  |  |  | TODO |
| 錢包 | 切換帳戶 | 舊帳戶資料不混入 |  |  |  |  | TODO |
| 錢包 | 無 SOL | 交易前提示，不送出 |  |  |  |  | TODO |
| 錢包 | 重開 App／斷線 | session 與待送項恢復 |  |  |  |  | TODO |
| 運動 | GPS 權限拒絕／無訊號 | 不可開始或標示缺口 |  |  |  |  | TODO |
| 運動 | 暫停／恢復 | 時間與距離正確 |  |  |  |  | TODO |
| 運動 | 離線保存 | 本機保存，稍後同步 |  |  |  |  | TODO |
| 運動 | 三筆離線依序同步 | 舊到新，不跳過 |  |  |  |  | TODO |
| 運動 | 待審 vs 正式資格 | UI 區分，任務不誤判 |  |  |  |  | TODO |
| 運動 | UTC 換日 | 任務日與步數重置 |  |  |  |  | TODO |
| NFT | 未達標 | 不可領取並說明 |  |  |  |  | TODO |
| NFT | 待 registry | 顯示等待，不假造 |  |  |  |  | TODO |
| NFT | 取消簽章 | 無交易 |  |  |  |  | TODO |
| NFT | 成功領取 | Explorer 可查 asset |  |  |  |  | TODO |
| NFT | 重複領取 | receipt 擋下（6009／已領） |  |  |  |  | TODO |
| NFT | 回覆遺失 | 查 receipt 後正確顯示 |  |  |  |  | TODO |
| UI | 冷啟動 | 直接進 Home（有 session） |  |  |  |  | TODO |
| UI | 窄螢幕／字體放大 | 無截斷 |  |  |  |  | TODO |
| UI | 中英切換 | 兩語完整 |  |  |  |  | TODO |
| UI | Reduce Motion | 直接顯示結果 |  |  |  |  | TODO |
| UI | 返回鍵 | 不卡死 |  |  |  |  | TODO |
| UI | 舊路線背景固定 | 不隨偏好改變 |  |  |  |  | TODO |
| 發布 | release 無 debug 簽章／demoLevel=0 | release-notes 記錄 |  |  |  |  | TODO |
| 發布 | API／RPC 可達 | healthz 200、rules version |  |  |  |  | TODO |
| 發布 | APK／影片／GitHub／簡報同版 | commit 一致 |  |  |  |  | TODO |
| 發布 | 無私鑰／健康資料／證件洩漏 | repo 與素材檢查 |  |  |  |  | TODO |

## 鏈上／交易證據

| 項目 | 值 |
|---|---|
| cluster | devnet |
| program | 6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA |
| tSKR mint（測試代幣，非官方 SKR） | 2itshf7Xup3WZeeDRSXbstv4nbPcjfiLhdDpcQjU7RtZ |
| 打卡交易 signature | （實測後填） |
| 成就 NFT asset | （實測後填） |

## 素材

| 項目 | 值 |
|---|---|
| 影片網址／實測長度 | （≤ 3:00；填實際秒數） |
| GitHub | （公開可讀；release tag） |
| 簡報 | （網址／版本） |
| APK 下載 | （網址；SHA-256 同上） |
