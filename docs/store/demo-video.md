# Demo 影片腳本（PG-D-03，≤ 3 分鐘）

前置：devnet 已部署（PG-I-07／I-08 完成）、後端 dev 上線、Seeker 已有 Health Connect 步數資料（當日 ≥ 8,000）與 tSKR 餘額 ≥ 50。錄製：Seeker 螢幕錄影（`adb shell screenrecord`）＋畫外音；所有畫面顯示 DEVNET 標籤與「Test Token · No monetary value」。

| 時間 | 畫面 | 旁白（重點） |
|---|---|---|
| 0:00–0:15 | Landing → Connect wallet（MWA／Seed Vault） | 問題：健身 App 的獎勵不可驗證、不可攜。NeonShift 把每日運動變成錢包可簽的鏈上打卡。 |
| 0:15–0:35 | Onboarding：Health Connect 權限、動作檢查、免費領取初階跑鞋（顯示 rent 費用、無購買） | 原始健康資料留在手機；跑鞋是贈與，不是 NFT 銷售。 |
| 0:35–1:05 | Dashboard：今日步數達標 → Clock in → 驗證 → 錢包簽章 → 確認（tSKR 入帳） | 後端只收摘要並簽 attestation；鏈上驗簽、防重領、每日上限。展示 explorer 交易。 |
| 1:05–1:25 | Gear：XP ring、等級自動提升的 reveal、My collection 按 Claim 領取成就 NFT（Metaplex Core） | 升級免費；NFT 是成就收藏，只付 devnet rent。 |
| 1:25–1:55 | Arena：質押報名（確認框顯示最差損失）→ 進行中排行榜 → 結算後領獎 | 資金守恆與 rolling hash 承諾；可審計的結算。 |
| 1:55–2:15 | Gallery：排行、點任一玩家看等級／收藏 | 社群與炫耀，不含任何健康數值。 |
| 2:15–2:40 | 後端／鏈上片段：`cargo test` 90 案例、三方向量、風險規則、Profile 刪除資料（30 天保留） | 防作弊與隱私設計。 |
| 2:40–3:00 | 架構圖 + 路線圖（合作活動、SKR 整合） | 收尾與 CTA。 |

素材：`docs/evidence/*.png` 作為靜態備援；架構圖用 README mermaid 匯出。
