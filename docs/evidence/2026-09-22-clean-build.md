# 乾淨環境重建紀錄（2026-09-22）

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
