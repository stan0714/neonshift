# Pitch 簡報大綱（PG-D-04）

1. **問題**：健身獎勵不可驗證、不可攜；「動起來賺幣」App 充斥假步數。
2. **方案**：NeonShift — Health Connect 摘要 → 後端風險驗證與 attestation → 鏈上驗簽發放；資料最小化（原始紀錄不出手機、摘要 30 天）。
3. **產品**：每日兩任務打卡、跑鞋五階免費進化、成就 NFT 收藏、週末質押錦標賽、藝廊。（截圖：Dashboard／Gear／Arena／Gallery）
4. **Solana Mobile 整合**：MWA 2.0 sign-in 與交易、Seed Vault 相容、Seeker 實機驗證、dApp Store 上架素材。
5. **技術亮點**：164-byte canonical attestation（三語言向量）、ed25519 前置指令驗簽、receipt PDA 防重領、pause／attestor 輪替治理、Metaplex Core 手組 CPI、結算 rolling hash 承諾＋資金守恆＋vault 對帳、ChainIndexer 投影。
6. **防作弊**：來源歸因、速率夾限、動作統計、規則版本綁定、沒收需證據摘要與多簽。
7. **代幣經濟**：固定供給 1,000,000 tSKR、獎勵金庫 200,000、每日上限 40；100 人 30 天模擬每人每日 10.2、runway ~196 天；消耗機制待決（docs/economics）。
8. **測試與品質**：Rust 90、後端 150、App 154、DB 約束 13、跨語言向量 20；`scripts/test-all.sh` 一鍵。
9. **時程與路線圖**：M1–M4；後續：合作活動（PG-E）、SKR integration track、主網。
10. **團隊與 Ask**。
