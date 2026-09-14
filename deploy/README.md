# 部署設定（PG-I-07，SD 8）

`dev` 與 `demo` 使用**不同**的 program id、attestor 金鑰、資料庫與 App build configuration。
每個環境一個 `<env>.env`，內容只有公開資訊與金鑰**路徑**；金鑰本身放在 `~/.config/neonshift/<env>/`，永不進 repo。

| 檔案 | 用途 |
|---|---|
| `dev.env` | 整合環境：devnet、dev program id、`api-dev.neonshift.cc` |
| `demo.env` | 錄影與評審：devnet、demo program id、`api.neonshift.cc`；資料保留 |
| `local.env` | 本機：localnet／LiteSVM，後端 docker compose |

## 流程（依 SD 8 部署順序）

```bash
scripts/chain/keys.sh dev        # 1. 產生 admin／program／attestor 金鑰（只做一次）
scripts/chain/build.sh dev       # 2. 以 dev program id 建置（anchor build --arch v0）
scripts/chain/deploy.sh dev      # 3. anchor deploy 到 devnet
scripts/chain/token.sh dev       # 4. tSKR：mint(6)、reward vault(owner=Config PDA)、treasury、鑄造固定供給
npm --prefix tools/chain-admin run init-config -- dev   # 5. initialize_config（attestor 公鑰寫入 Config）
scripts/chain/token.sh dev fund  # 6. 撥款 200,000 tSKR 至獎勵金庫並撤銷 mint authority（BR-22）
```

完成後把輸出的 `PROGRAM_ID`／`TSKR_MINT`／`REWARD_VAULT`／`TREASURY_VAULT` 回填到 `<env>.env`，
App 與後端的 build-time 參數即由同一份檔案產生（`scripts/app/build.sh <env>`、`backend/.env`）。

## 注意

- 同一環境不得混搭：App 的 `EXPO_PUBLIC_PROGRAM_ID`／`EXPO_PUBLIC_API_URL`／`EXPO_PUBLIC_CLUSTER_ID` 與後端 `PROGRAM_ID` 必須來自同一份 `<env>.env`。
- attestor 私鑰只給後端 signer 使用；`keys.sh` 產生的 `attestor.json` 需在部署後移入 KMS／受管 secret（PG-B-10），本機檔案僅供 dev。
- 撤銷 mint authority 不可逆；`token.sh <env> fund` 會先要求確認。
