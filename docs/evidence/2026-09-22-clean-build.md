# 乾淨環境重建紀錄（2026-09-22）

## 提交版（demo env，commit 7efa81a）

由 `scripts/release/clean-build.sh demo` 產生：從 Git HEAD 重新 clone 到暫存目錄、`npm ci`、`scripts/app/build.sh demo release`。只帶入簽章設定（不在 repo），未複製任何未提交檔案。

| 項目 | 值 |
|---|---|
| commit | `7efa81a81ad893075c6ae876ddbb5d0e5bebe1eb` |
| env | demo（ABI: arm64-v8a） |
| 開始／耗時 | 2026-09-22T06:35:03Z · 274 s |
| 工具鏈 | node v24.8.0 · npm 11.6.0 · java 17.0.16 · Darwin arm64 |
| 重建 APK SHA-256 | `97b4a689371c9d998033b9c6a47a4f22b8486d2a67884013bf3ea70b4a58b915`（59534791 bytes） |
| 工作樹 APK SHA-256 | `d143e404af5bc17fa95856f402de81ea7919faa53f1282d88ef3336d6ef55139`（41b632e） |
| 結果 | SHA-256 不同；簽章區塊以外的 zip entry（名稱／大小／CRC）差異數：0（0 = 內容相同，只差簽章／時間戳） |
| 版本 | versionName"0.1.0" / versionCode1 |
| 展示覆寫 demoLevel | 0 |
| Program Id | 6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA |
| tSKR Mint | 2itshf7Xup3WZeeDRSXbstv4nbPcjfiLhdDpcQjU7RtZ |
| 後端 | https://api.neonshift.cc/v1 |
| 網路 | devnet |

建置 log：`/private/tmp/claude-501/-Users-liushih-hao-Documents-learn-project-neonshift/f3e2e54d-b574-4659-b2e1-ee44d97b8b41/scratchpad/clean/build.log`（暫存，未納入 repo）。

**判讀**：demo 與稍早 dev 重建（下節，commit 41b632e）的 APK 除簽章區塊外 zip entry 完全相同（含 `assets/index.android.bundle` 5,021,396 bytes、CRC `65ed5a7d`）——因 demo.env 已沿用 dev 的 program／tSKR／API／cluster，且 App 不讀 `EXPO_PUBLIC_APP_ENV`，兩次獨立 clone＋build 產出相同內容，可作「同一 commit 可重建出相同程式內容」的證據；SHA-256 差異僅來自 APK 簽章時間戳。提交版 APK 已複製到 `app/android/app/build/outputs/apk/release/`。

## 稍早 dev env 重建（commit 41b632e）

由 `scripts/release/clean-build.sh dev` 產生：從 Git HEAD 重新 clone 到暫存目錄、`npm ci`、`scripts/app/build.sh dev release`。只帶入簽章設定（不在 repo），未複製任何未提交檔案。

| 項目 | 值 |
|---|---|
| commit | `41b632e998089474f177c6346a2c278ddca52dc3` |
| env | dev（ABI: arm64-v8a） |
| 開始／耗時 | 2026-09-22T06:21:22Z · 444 s |
| 工具鏈 | node v24.8.0 · npm 11.6.0 · java 17.0.16（scripts/env.sh）· Darwin arm64 |
| 重建 APK SHA-256 | `d143e404af5bc17fa95856f402de81ea7919faa53f1282d88ef3336d6ef55139`（59534791 bytes） |
| 工作樹 APK SHA-256 | `50b28a1aa974ec25ca298e4d4a5d9dbdcb2b4b3c448b32e7724df05ed632156e`（08e3232） |
| 結果 | SHA-256 不同；簽章區塊以外的 zip entry（名稱／大小／CRC）差異數：22（0 = 內容相同，只差簽章／時間戳） |
| 版本 | versionName"0.1.0" / versionCode1 |
| 展示覆寫 demoLevel | 0 |
| Program Id | 6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA |
| tSKR Mint | 2itshf7Xup3WZeeDRSXbstv4nbPcjfiLhdDpcQjU7RtZ |
| 後端 | https://api.neonshift.cc/v1 |
| 網路 | devnet |

建置 log：`/private/tmp/claude-501/-Users-liushih-hao-Documents-learn-project-neonshift/f3e2e54d-b574-4659-b2e1-ee44d97b8b41/scratchpad/clean/build.log`（暫存，未納入 repo）。

2026-09-22 14:30：此重建 APK（`d143e404…`）已安裝至負責人 Seeker（SM02G4061936379，Android 16），冷啟動正常、既有 Seeker Wallet 登入 session 保留、首頁顯示 9/21 20:38 的 5.31 km 跑步已同步。工作樹 APK（`08e3232`）與本次（`41b632e`）差異為程式內容不同（22 個 zip entry），非簽章差異。

2026-09-22 14:45：提交版 APK（demo，`97b4a689…`）已覆蓋安裝至負責人 Seeker（同簽章金鑰，升級安裝成功）。
