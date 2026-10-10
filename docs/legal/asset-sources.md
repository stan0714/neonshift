# 素材來源與權利清單（COMP-08）

2026-09-21 建立，對應 [參賽開發計畫](../store/competition-development-plan.md) COMP-08「非機密提交、素材權利」。提交前逐項確認「可提交」欄；任何新素材加入時同步更新。這是自我盤點，不是法律意見；主辦方條款以官方為準。

| 素材 | 位置 | 來源／作者 | 授權／依據 | 可提交 | 備註 |
|---|---|---|---|---|---|
| 品牌識別（N 字標、splash、loading 概念稿） | `assets/brand/*.png`、`app/assets/brand/*.svg`、`app/assets/*.png` | 本專案，AI 生圖（image_gen，2026-09-14）＋自行向量化 | 專案自有；提示詞留存於 `assets/brand/README.md` | ✅ | 不含 Solana／SKR／Seeker 官方商標；App 內「DEVNET」「tSKR」為文字說明 |
| 跑鞋五階與四款動物圖紋 SVG | `app/src/components/ShoeHero.tsx`、`WildlifeShoePattern.tsx`、`HabitatScene.tsx` | 本專案手繪向量 | 專案自有 | ✅ | 動物靈感原創線稿，未使用任何攝影／插畫素材；「animal-inspired digital designs, never animal materials」 |
| 成就／里程碑 NFT 圖 | `web/nft/img/*.svg|png`、`web/nft/achievements/**` | 本專案由程式產生（SVG → PNG） | 專案自有 | ✅ | metadata 指向 `https://neonshift.cc/nft/...`；不含第三方圖 |
| 物種說明、保育行動、族群參考數字 | `app/src/i18n/{en,zh-TW}.ts`（`wild.story.*`、`wild.action.*`）、`app/src/config/guardianMilestones.ts` | 自行改寫，參考 WWF 公開物種頁；數字附來源連結與查核日 | 事實與短句改寫，未逐字複製；panda.org 文字 CC BY-NC 4.0（只需連回）；worldwildlife.org 站內文字未複製 | ✅（已寄／待寄通知） | [WWF 通知信](wwf-notice-2026-09-20/README.md)；不用熊貓 logo、不宣稱合作或捐款；標示「Species reference · WWF」屬來源標註，不作背書 |
| IUCN 保育等級（EN／CR） | 同上 | IUCN Red List 公開分類 | 事實資訊 | ✅ | 僅引用等級代碼 |
| 圖示 | `@expo/vector-icons`（Feather） | Feather Icons | MIT | ✅ | 隨套件授權 |
| 字型 | 系統字型（Roboto／Noto CJK） | Android 內建 | 系統授權 | ✅ | App 未內嵌字型（`expo-font` 未載入自訂字體） |
| 開源套件 | `app/package.json`、`backend/package.json`、`programs/Cargo.toml` | 各套件作者 | MIT／Apache-2.0／ISC 等 | ✅ | 提交前跑 `npx license-checker --summary`（app、backend）與 `cargo license`（programs）產出清單放 `docs/evidence/` |
| Demo 影片旁白 | `docs/store/demo-voiceover-en.txt`（逐頁 `output/hackathon-flexclip-en/flexclip-v4/narration/*.txt`）→ FlexClip AI PPT/PDF to Video 的 **Andrew Multilingual**（Microsoft TTS），2026-10-10 生成 | 文案本專案；聲音由 FlexClip 內建 TTS 生成 | FlexClip **Plus** 方案（使用者 10/10 確認）；[FlexClip Commercial Use Regulations](https://help.flexclip.com/en/articles/7266809-commercial-use-regulations)（2026-07-02 版，10/10 查）：Plus／Business／Team 可將 FlexClip 素材與 AI 工具產生內容用於商業用途，免另行授權；訂閱到期後，訂閱期間所製內容的權利仍有效 | ✅ | 不模仿真人聲音；未用 Voice Cloning；YouTube 已標示 AI 合成內容 |
| Demo 影片背景音樂 | FlexClip AI PPT/PDF to Video 生成時自動加入的曲庫配樂（10/10 成片；旁白結束後仍可聽到，約 −30 dB）；曲名待自 FlexClip 專案補記 | FlexClip 曲庫 | FlexClip **Plus** 方案；同上官方條款 | ✅（曲名待補） | 只用平台授權曲庫，不用外部音樂；若 YouTube 出現版權聲明，用 FlexClip 帳號的 YouTube 白名單處理 |
| 實機截圖／錄影 | `output/hackathon-flexclip-en/captures/**`、`docs/evidence/*.png` | 本專案 Seeker 實機 | 專案自有 | ✅ | 錢包畫面為黑（secure surface）；含負責人自己的錢包地址與運動摘要，無健康原始資料 |
| Nike Run Club 參考截圖 | 只在對話中作版面參考 | Nike | 第三方 | ❌ 不入 repo、不入素材 | Activity 版面為自行實作 |
| 簡報範本／圖表 | `output/**/build_deck.py` 產生 | 本專案（python-pptx） | 專案自有 | ✅ | 不含第三方模板 |
| 官方名稱 | 文案中的「Solana」「Seeker」「Mobile Wallet Adapter」「Seed Vault」 | Solana Mobile | 名稱性使用（描述相容性） | ✅ | 不使用其 logo；不暗示官方背書 |

## 提交前動作

1. ✅ 2026-09-22 產出 [docs/evidence/2026-09-22-licenses.md](../evidence/2026-09-22-licenses.md)（npm production）；注意 `rpc-websockets` LGPL-3.0（web3.js 傳遞依賴，App 需列授權頁）、本專案 LICENSE 待選；`cargo license` 待補。
2. ~~確認 TTS 與音樂授權並回填~~：10/10 完成（FlexClip Plus）；背景音樂曲名待補。
3. 全 repo 掃描：`git grep -nE "keypair|PRIVATE KEY|BEGIN (EC|RSA)"`、`git ls-files | grep -E "\.keystore$|keystore\.properties|-keypair\.json$"` 必須為空。
4. 影片與簡報中所有「合作」「捐款」「保育成果」字眼移除或改為「靈感／教育」。
