# NeonShift 實機測試包建置指南（Build & Device Test Runbook）

| 項目 | 內容 |
|---|---|
| 文件版本 | v0.2（校正至 SA／SD v0.4：Node 24、brew prefix、env 腳本） |
| 建立日期 | 2026-09-09 |
| 適用平台 | macOS（Apple Silicon）開發機 → Android 裝置 |
| 目標裝置 | Solana Mobile Seeker；備援為任一 Android 14 以上實機 |
| 對應文件 | [BRD v0.6](./brd-detailed.md)、[SA v0.4](./sa.md)、[SD v0.4](./sd.md)、[PG](./pg.md) |
| 網路 | Solana devnet |

> **目前狀態**：`backend/`、`programs/attestation-core` 已建立；`app/` 由第 2 章步驟建立。第一次執行時請從第 1 章依序做完；之後的日常迭代直接跳到第 5 章。

---

## 目錄

| 章 | 內容 | 何時用 |
|---|---|---|
| 1 | 開發環境安裝 | 只做一次 |
| 2 | 專案初始化與套件 | 只做一次 |
| 3 | 原生設定（Manifest、Gradle） | 只做一次，之後偶爾調整 |
| 4 | 實機連線準備 | 換機或重開機時 |
| 5 | Debug build 實機安裝 | **每天** |
| 6 | 健康資料與權限驗證 | 每次測打卡 |
| 7 | 錢包與 devnet 準備 | 初次與換錢包時 |
| 8 | 測試包（Release APK）產出 | 每次要給隊友或評審 |
| 9 | 分發給隊友 | 同上 |
| 10 | 常用除錯指令 | 隨時 |
| 11 | 實機驗收檢查清單 | 里程碑驗收 |
| 12 | 疑難排解 | 出事時 |
| 13 | 一鍵腳本 | 熟悉後 |

---

## 1. 開發環境安裝

### 1.1 先檢查現況

```bash
java -version                      # 需要 JDK 17
node -v                            # 需要 24 LTS（SD 2.2；Node 20 已於 2026-03-24 EOL，不得使用）
echo "${ANDROID_HOME:-未設定}"
ls -d "$HOME/Library/Android/sdk" 2>/dev/null || echo "缺少 Android SDK"
uname -m                           # arm64
brew --prefix                      # Apple Silicon 為 /opt/homebrew；Rosetta 安裝的 brew 為 /usr/local
```

或直接執行 repo 內的檢查腳本，會逐項列出版本與缺項：

```bash
source scripts/env.sh && scripts/env-check.sh
```

### 1.2 安裝缺少的元件

```bash
# JDK 17（若尚未安裝）
brew install openjdk@17
sudo ln -sfn "$(brew --prefix)/opt/openjdk@17/libexec/openjdk.jdk" \
  /Library/Java/JavaVirtualMachines/openjdk-17.jdk

# Node.js 24 LTS（擇一：nvm 或 Homebrew）
nvm install 24 && nvm use 24      # repo 根目錄有 .nvmrc，之後 `nvm use` 即可
# 或
brew install node                 # Homebrew 的 node formula 目前即為 24.x

# Android Studio（內含 SDK 與 platform-tools）
brew install --cask android-studio

# Solana CLI 與 Anchor（鏈上開發需要）
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest && avm use latest
```

開啟 Android Studio，在 **Settings → Languages & Frameworks → Android SDK** 勾選並安裝：

- SDK Platforms：Android 14（API 34）與 Android 15（API 35）
- SDK Tools：Android SDK Build-Tools、Platform-Tools、Command-line Tools

### 1.3 設定環境變數

建議做法：每次開工先 `source scripts/env.sh`。它只影響目前 shell，會依 `brew --prefix` 自動找 JDK 17 與 Node 24，並設定 `ANDROID_HOME`、Solana、Anchor 路徑；不會改動 `~/.zshrc`。

若偏好寫進 shell 設定檔：

```bash
cat >> ~/.zshrc <<'EOF'

# --- Android / NeonShift ---
export JAVA_HOME="$(brew --prefix)/opt/openjdk@17"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools"
export PATH="$PATH:$ANDROID_HOME/emulator"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin"
EOF

source ~/.zshrc
```

注意 `~/.zshrc` 若有 `nvm use 18` 之類的預設，會蓋掉 Node 24；改為 `nvm use 24` 或移除。

### 1.4 驗證

```bash
scripts/env-check.sh   # 一次列出下列全部
java -version          # openjdk 17.x
node -v                # v24.x
adb version            # Android Debug Bridge 版本資訊
solana --version
anchor --version
```

`env-check.sh` 的必要項目（node、java、Android SDK 的 API 34／35、platform-tools、build-tools 35）全部 ✔ 才能做 App；solana／anchor 只在做鏈上程式時需要。`sdkmanager` 在舊版 cmdline-tools 搭配 JDK 11 以上會報 `NoClassDefFoundError: javax/xml/bind`，請由 Android Studio 更新 Command-line Tools 至 latest。

---

## 2. 專案初始化與套件

> 只在第一次建立專案時執行。

### 2.1 建立 Expo 專案

```bash
cd <repo 根目錄>
npx create-expo-app@latest app --template blank-typescript
cd app
```

實際建立時使用 Expo SDK 57（React Native 0.86、React 19.2、TypeScript 6）。`package.json` 只保留 Android 相關 script（`start` 帶 `--dev-client`、`android`、`android:release`、`typecheck`、`lint`、`test`），移除 `ios`／`web`。

專案結構建議如下，與 SD 第 2 章的分層對應。

```
neonshift/
├── app/            # React Native（本章）
├── backend/        # Attestor 後端
├── programs/       # Anchor 鏈上程式
└── docs/           # 現有文件
```

### 2.2 安裝套件

```bash
# 開發建置必備
npx expo install expo-dev-client

# Solana Mobile
npm install \
  @solana-mobile/mobile-wallet-adapter-protocol \
  @solana-mobile/mobile-wallet-adapter-protocol-web3js \
  @solana/web3.js \
  @coral-xyz/anchor

# polyfill（web3.js 在 RN 需要）
npm install react-native-get-random-values buffer
npx expo install expo-crypto

# 健康資料與感測器
npm install react-native-health-connect
npx expo install expo-sensors expo-location expo-task-manager

# 儲存與狀態
npx expo install expo-secure-store
npm install @tanstack/react-query zustand

# UI（對應 style.md）
npx expo install react-native-reanimated react-native-svg expo-haptics expo-linear-gradient
npm install lottie-react-native
```

### 2.3 設定 app.json

```jsonc
{
  "expo": {
    "name": "NeonShift",
    "slug": "neonshift",
    "version": "0.1.0",
    "scheme": "neonshift",
    "userInterfaceStyle": "dark",
    "backgroundColor": "#050711",
    "platforms": ["android"],
    "android": {
      "package": "cc.neonshift.app",   // 反向網域 neonshift.cc（SD 8）
      "versionCode": 1,
      "permissions": [
        "android.permission.ACTIVITY_RECOGNITION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.health.READ_STEPS",
        "android.permission.health.READ_SLEEP",
        "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
      ],
      // FR-07.3 只用粗粒度定位；expo-location 預設會加 FINE，明確擋掉
      "blockedPermissions": [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION"
      ]
    },
    "plugins": [
      "expo-dev-client",
      "expo-secure-store",
      "react-native-health-connect",
      // SDK 57 起 android.minSdkVersion 等欄位不再由 app.json 直接套用，改用 expo-build-properties
      ["expo-build-properties", { "android": {
        "minSdkVersion": 34, "compileSdkVersion": 36, "targetSdkVersion": 36, "buildToolsVersion": "36.0.0"
      } }],
      // Style 8.1：canvas 背景、置中 mark、無 spinner
      ["expo-splash-screen", { "backgroundColor": "#050711", "image": "./assets/splash-icon.png", "imageWidth": 160, "resizeMode": "contain" }]
    ]
  }
}
```

`"platforms": ["android"]` 明確排除 iOS，對應 BRD 決策 D-04。

compileSdk／targetSdk 採 36 而非原規劃的 35：React Native 0.86 與 Expo SDK 57 的原生模組以 API 36 編譯，強降 35 會讓部分相依無法解析；minSdk 維持 34（Health Connect 內建於系統的最低版本，BRD NFR 相容性）。完整可用版本以 `app/app.json` 為準。

### 2.4 生成原生目錄

```bash
npx expo prebuild --platform android --clean
```

**決策點**：依 SD 的建議，四週衝刺採「生成一次後提交 `android/`」，之後當一般原生專案維護。

```bash
# 移除 gitignore 中的 android 條目後提交
git add android/
git commit -m "chore: prebuild Android native project"
```

之後**不要**再執行 `prebuild --clean`，否則手改的原生檔案會被覆蓋。

---

## 3. 原生設定

### 3.1 Health Connect 權限說明頁

Android 14 起 Health Connect 已內建於系統，不需另外安裝 App。但必須在 `android/app/src/main/AndroidManifest.xml` 的 `<application>` 內宣告權限說明頁，否則權限請求會被拒絕。

```xml
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".MainActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
    <intent-filter>
        <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
        <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
    </intent-filter>
</activity-alias>
```

因為 minSdk 為 34，**不需要**舊版的 `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` intent filter，也不需要 `<queries>` 宣告 Health Connect 套件。

`react-native-health-connect` 的 config plugin 在 prebuild 時會自動加入上述 `activity-alias`（同時也會加舊版 rationale filter，無害）；prebuild 後以 `grep -n activity-alias android/app/src/main/AndroidManifest.xml` 確認即可，不需手改。

### 3.2 本地後端連線（僅 debug）

實機要連開發機的後端時，在 `android/app/src/debug/` 建立 `AndroidManifest.xml`：

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:usesCleartextTraffic="true" />
</manifest>
```

放在 `debug/` 目錄，release 版不受影響。

Expo SDK 57 的 prebuild 模板已內建這份 debug manifest（含 `usesCleartextTraffic="true"`），不需手動建立；確認 `android/app/src/debug/AndroidManifest.xml` 存在即可。

### 3.3 確認 Gradle 設定

```bash
grep -n "SdkVersion" android/gradle.properties
```

應為 `android.minSdkVersion=34`、`android.compileSdkVersion=36`、`android.targetSdkVersion=36`（由 expo-build-properties 寫入；SDK 57 不再放在 `build.gradle` 的 `ext`）。

---

## 4. 實機連線準備

### 4.1 裝置端設定

在 Seeker 上操作：

1. **設定 → 關於手機**，連點「版本號碼」七次啟用開發者選項。
2. **設定 → 系統 → 開發者選項**，開啟「USB 偵錯」。
3. 需要無線連線時另外開啟「無線偵錯」。

### 4.2 USB 連線

```bash
adb devices -l
```

首次連接時裝置會跳出授權對話框，勾選「一律允許」後再執行一次。看到 `device` 而非 `unauthorized` 才算成功。

```bash
# 確認裝置資訊
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release   # 應為 14 以上
adb shell getprop ro.build.version.sdk       # 應為 34 以上
```

### 4.3 無線連線（選用）

跑步實測時會用到，因為插著線沒辦法走路。

```bash
# 裝置：開發者選項 → 無線偵錯 → 使用配對碼配對裝置
adb pair 192.168.1.50:37419        # 輸入畫面上的六位配對碼
adb connect 192.168.1.50:41235     # 使用無線偵錯主畫面顯示的埠號
adb devices -l
```

### 4.4 確認 Health Connect 可用

```bash
adb shell am start -a android.health.connect.action.HEALTH_HOME_SETTINGS
```

裝置上應開啟 Health Connect 設定畫面。

---

## 5. Debug build 實機安裝（日常迭代）

### 5.1 建置並安裝

```bash
cd app
npx expo run:android --device
```

首次建置 Gradle 需下載依賴，約 5 至 15 分鐘。之後增量建置約 1 分鐘。

指定裝置：

```bash
adb devices -l                          # 取得 serial
npx expo run:android --device <serial>
```

### 5.2 Metro 連線

USB 連線時建立埠轉發，讓實機連得到開發機的 Metro：

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000           # 本地後端
```

**每次重新插拔 USB 或重開機都要重跑**，這是最常見的「App 打不開」原因。

### 5.3 只改 JS 時

原生程式碼沒動的話不需重新建置：

```bash
npx expo start --dev-client
# 按 r 重新載入，按 m 開啟開發者選單
```

### 5.4 改了原生程式碼時

```bash
cd android && ./gradlew clean && cd ..
npx expo run:android --device
```

---

## 6. 健康資料與權限驗證

### 6.1 授予權限

首次開啟 App 會依序請求：Health Connect 讀取權限、活動辨識、粗略位置。

手動檢查與調整：

```bash
# 查看目前已授予的權限
adb shell dumpsys package cc.neonshift.app | grep -A 40 "runtime permissions"

# 開啟本 App 的 Health Connect 權限頁
adb shell am start -a android.health.connect.action.MANAGE_HEALTH_PERMISSIONS \
  --es android.intent.extra.PACKAGE_NAME cc.neonshift.app
```

### 6.2 重測 onboarding 流程

驗收 FR-02.5 的權限拒絕引導時，把權限撤掉重來：

```bash
adb shell pm revoke cc.neonshift.app android.permission.health.READ_STEPS
adb shell pm revoke cc.neonshift.app android.permission.health.READ_SLEEP
adb shell pm revoke cc.neonshift.app android.permission.ACTIVITY_RECOGNITION
adb shell pm revoke cc.neonshift.app android.permission.ACCESS_COARSE_LOCATION

# 或完整重置 App 狀態（含 SecureStore 與快取）
adb shell pm clear cc.neonshift.app
```

### 6.3 產生測試用步數資料

真實步數要靠走路，但驗證讀取邏輯時可以用其他健身 App 寫入 Health Connect，再確認本 App 的來源歸因（BR-07、BR-08）能正確排除非裝置來源。

**開發診斷頁**：debug build 內建 `Health Connect (dev)` 畫面（`src/screens/dev/HealthDiagnosticsScreen.tsx`，只在 `__DEV__` 註冊），可逐項呼叫 getStatus／權限／readSteps／readSleep 並顯示原始回傳。開啟方式：`EXPO_PUBLIC_DEV_ROUTE=DevHealth npx expo start --dev-client`，冷啟動後會直接疊在 Landing 之上。

**Metro 注意**：修改 `src/` 後若實機仍載入舊畫面，重啟 `npx expo start --clear`（本機 watchman 監看偶爾失效）。原生模組（`modules/`）改動一律要重新 `assembleDebug`。

**2026-09-14 Seeker 實測**：`availability=available`、API 36、SDK extension 22；framework 尚無 `getCurrentDeviceDataSource`（`spnQuerySupported=false`），因此只接受歷史 `android` 來源；權限對話框正確顯示 App 名稱與隱私政策連結；當日無任何 StepsRecord／SleepSessionRecord（`dataOrigins: []`），需實際走動或以其他 App 寫入後再驗證四種來源分類。SensorModule 靜置實測：取樣 49.5 Hz、兩視窗各約 495 點、step counter 可用、step_delta 0；診斷頁 `Sensors` 區可重跑 20 秒 live motion check（步行時 `dominant_freq_hz` 應落在 1.5～2.5、`step_delta` ≥ 10）。

**注意**：以第三方 App 寫入的資料**應該**被本 App 拒絕。若沒有被拒絕，代表 FR-07.1 有問題，這正是要測的重點。

### 6.4 驗證 UTC 日界線（BR-05）

```bash
# 關閉自動時間，手動設到接近 UTC 換日
adb shell settings put global auto_time 0
adb shell "su 0 date 090923592026.50"    # 需 root，一般裝置改用設定畫面手動調整

# 測完務必還原
adb shell settings put global auto_time 1
```

一般未 root 的 Seeker 請直接在設定畫面調時間與時區，測試跨午夜與時區切換情境。

---

## 7. 錢包與 devnet 準備

### 7.1 裝置端錢包

在 Seeker 安裝一款 MWA 相容錢包，切換到 **devnet**，並記下公鑰。

### 7.2 開發機 Solana 設定

```bash
solana config set --url devnet
solana-keygen new -o ~/.config/solana/neonshift-admin.json
solana config set --keypair ~/.config/solana/neonshift-admin.json
solana address
solana airdrop 2
solana balance
```

### 7.3 給測試錢包 SOL

```bash
solana airdrop 2 <裝置錢包公鑰> --url devnet
```

devnet airdrop 有速率限制，失敗時稍等再試或改用 faucet 網頁。

### 7.4 建立 tSKR 測試代幣

tSKR 為 **6 decimals**（SD 1.2／PG-I-08；早期版本誤寫 9），總供給 1,000,000、獎勵金庫預撥 200,000（BRD 8.5 假設）。一律用腳本，避免手動步驟漏掉 vault owner：

```bash
scripts/chain/keys.sh dev          # 產生 admin／program／attestor 金鑰（~/.config/neonshift/dev）
scripts/chain/build.sh dev         # 以 dev program id 建置
scripts/chain/deploy.sh dev        # anchor deploy 到 devnet
scripts/chain/token.sh dev         # mint(6)、reward vault（owner = Config PDA）、treasury vault → 回填 deploy/dev.env
npm --prefix tools/chain-admin run admin -- init-config dev   # initialize_config
scripts/chain/token.sh dev fund    # 鑄造固定供給、撥款金庫、撤銷 mint authority（不可逆）
```

`token.sh <env> fund` 最後會印出 `spl-token display`，其中 mint authority 應為空，這是 BR-22 的驗收證據，記得截圖存檔給 Pitch 用。demo 環境把 `dev` 換成 `demo`，兩者金鑰、program id、mint 完全分離（SD 8）。

### 7.5 部署鏈上程式

7.4 的腳本已涵蓋；手動等價指令：

```bash
cd programs
anchor build --arch v0          # 一律加 --arch v0，見下方說明
anchor deploy --provider.cluster devnet
# 記下 Program Id，填入 deploy/<env>.env；App 與後端由同一份檔案取得
```

**工具鏈注意事項**（本機實測 Anchor 1.2.0 + solana-cli 3.1.10）：

- Anchor 1.2 的 `anchor build` 預設 `--arch v3`，產出的 SBPF v3 ELF 無法被 LiteSVM 0.10 載入（`InvalidAccountData`），devnet 對 v3 的支援也未普及。所有建置一律 `anchor build --arch v0`。
- 鏈上測試用 LiteSVM 在程序內執行：`cargo test -p neonshift-core`。**不要**用 `anchor test`，它會嘗試啟動 `surfpool` 本機 validator。
- 程式 keypair 在 `programs/target/deploy/neonshift_core-keypair.json`（gitignore）。第一次 clone 後若 `declare_id!` 與本機 keypair 不同，執行 `anchor keys sync` 或依 PG-I-07 取得對應環境的 keypair；dev／demo 各自一把，不共用。
- `claim_collectible` 測試需要 Metaplex Core 程式：`programs/neonshift-core/tests/fixtures/mpl_core.so` 是 devnet dump（`solana program dump CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d <path> --url https://api.devnet.solana.com`，約 856 KB，已入庫）。Core 升版時重新 dump 並核對 `src/mpl_core.rs` 的指令佈局。
- 統一入口 `scripts/test-all.sh` 會依序跑 Rust／向量／DB／後端／App／鏈上六個區段。

---

## 8. 測試包（Release APK）產出

### 8.1 產生 keystore（只做一次）

```bash
cd app/android/app

keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore neonshift-release.keystore \
  -alias neonshift \
  -keyalg RSA -keysize 2048 -validity 10000
```

**這把金鑰遺失就無法更新已發布的 App**。依 SD 4.5 的要求離線保存，並且**絕對不要提交進 git**：

```bash
echo "android/app/*.keystore" >> ../../.gitignore
echo "android/keystore.properties" >> ../../.gitignore
```

### 8.2 設定簽章

建立 `app/android/keystore.properties`（不提交）：

```properties
storeFile=neonshift-release.keystore
storePassword=<密碼>
keyAlias=neonshift
keyPassword=<密碼>
```

在 `app/android/app/build.gradle` 加入：

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
        }
    }
}
```

### 8.3 建置

```bash
cd app
# 方法一：透過 Expo，建置後直接裝到實機
npx expo run:android --variant release --device

# 方法二：純 Gradle，只產出檔案
cd android
./gradlew clean
./gradlew assembleRelease
```

產物位置：

```
app/android/app/build/outputs/apk/release/app-release.apk
```

### 8.4 驗證簽章與內容

```bash
cd app/android/app/build/outputs/apk/release

# 確認已簽名並記錄指紋（交付清單需要）
"$ANDROID_HOME"/build-tools/35.0.0/apksigner verify --print-certs app-release.apk

# 確認 minSdk、版本與權限
"$ANDROID_HOME"/build-tools/35.0.0/aapt2 dump badging app-release.apk | \
  grep -E "package|sdkVersion|uses-permission"

ls -lh app-release.apk
```

檢查重點：`sdkVersion:'34'`、權限清單只有預期的六項、憑證指紋與交付清單登記的一致。

### 8.5 版本號管理

每次要給隊友或評審的包都要遞增 `versionCode`，否則裝置會拒絕安裝舊版號。

```bash
# app.json 的 android.versionCode 加一，然後
npx expo prebuild --platform android   # 注意：不加 --clean
```

若已改為手動維護 `android/`，直接編輯 `android/app/build.gradle` 的 `versionCode` 與 `versionName`。

---

## 9. 分發給隊友

### 9.1 用 adb 安裝（建議）

```bash
adb install -r app-release.apk        # -r 覆蓋安裝
```

debug 版與 release 版簽章不同，切換時要先移除：

```bash
adb uninstall cc.neonshift.app
adb install app-release.apk
```

### 9.2 直接傳檔案的注意事項

Android 自 2026-09-30 起在巴西、印尼、新加坡、泰國要求已驗證開發者才能安裝 App，2027 年將擴及全球。**透過 adb 安裝不受此限制**，因此團隊內測請優先用 adb。

若必須傳 APK 檔給隊友，請一併說明需在裝置上允許安裝未知來源，並提醒未來全球生效後這條路會變麻煩。

### 9.3 測試包附帶資訊

每次分發時附上這幾項，方便回報問題時對得上：

```bash
{
  echo "版本: $(grep versionName android/app/build.gradle | head -1)"
  echo "Git: $(git rev-parse --short HEAD)"
  echo "Program Id: <填入>"
  echo "tSKR Mint: $TSKR_MINT"
  echo "後端: <填入 URL>"
  echo "網路: devnet"
} > release-notes.txt
```

---

## 10. 常用除錯指令

### 10.1 日誌

```bash
# 只看本 App
adb logcat --pid=$(adb shell pidof -s cc.neonshift.app)

# 只看 React Native 與錯誤
adb logcat *:S ReactNative:V ReactNativeJS:V AndroidRuntime:E

# 清空後重新觀察
adb logcat -c && adb logcat --pid=$(adb shell pidof -s cc.neonshift.app)

# 存檔給隊友看
adb logcat -d > /tmp/neonshift-$(date +%H%M%S).log
```

### 10.2 App 狀態

```bash
adb shell pm list packages | grep neonshift
adb shell dumpsys package cc.neonshift.app | head -40
adb shell am force-stop cc.neonshift.app
adb shell pm clear cc.neonshift.app          # 完整重置
```

### 10.3 冷啟動時間量測（對應 BRD KPI ≤ 3 秒 P95）

```bash
for i in $(seq 1 30); do
  adb shell am force-stop cc.neonshift.app
  adb shell am start-activity -W -n cc.neonshift.app/.MainActivity \
    | grep TotalTime
  sleep 2
done
```

務必用 **release build** 量測，debug build 有 dev 工具負擔，數字沒有參考價值。

### 10.4 截圖與錄影（Demo 影片素材）

```bash
adb exec-out screencap -p > /tmp/shot.png
adb shell screenrecord --time-limit 60 /sdcard/demo.mp4
adb pull /sdcard/demo.mp4 ./demo.mp4
```

### 10.5 網路

```bash
adb reverse --list
adb reverse tcp:8081 tcp:8081
adb reverse --remove-all
```

---

## 11. 實機驗收檢查清單

對應 BRD 第 4 章 KPI 與 SD 第 7 章測試策略。每個里程碑逐項打勾。

### M1 健康資料

- [ ] 實機顯示今日步數，與 Health Connect 設定畫面數值一致（誤差 ≤ 1 步）
- [ ] 顯示昨夜睡眠時長，跨午夜歸屬正確
- [ ] 拒絕權限時出現引導畫面與前往設定按鈕
- [ ] 第三方 App 寫入的步數**未**被計入
- [ ] 手動輸入的步數**未**被計入
- [ ] 飛航模式下顯示快取值與最後同步時間

### M2 鏈上打卡

- [ ] MWA 連線成功，顯示錢包位址與 devnet 標示
- [ ] 餘額顯示為 tSKR 並標明測試代幣、無金錢價值
- [ ] 達標後打卡成功，鏈上可查到交易
- [ ] **同一 attestation 重送失敗**，錯誤為 `AlreadyClaimed`
- [ ] 竄改 attestation 任一位元組後交易失敗
- [ ] 過期 attestation 交易失敗
- [ ] 交易逾時後重開 App 不會重複扣款或重複發放

### M3 機制完整

- [ ] 升級數據核心：扣款、燒毀、入庫、倍率變更同一筆交易完成
- [ ] 升級失敗時餘額與等級皆未變動
- [ ] 搖步機樣本被攔截（目標 ≥ 90%）
- [ ] 真實步行未被誤判（目標 ≤ 5%）
- [ ] 錦標賽報名質押鎖定，重複報名失敗
- [ ] 結算後資金守恆等式成立

### M4 交付品質

- [ ] Release APK 已簽名，指紋已登記
- [ ] 冷啟動 P95 ≤ 3 秒（release build，30 次量測）
- [ ] 打卡端到端 ≤ 10 秒（扣除錢包停留時間）
- [ ] 360dp 寬度下無文字截斷
- [ ] 無白底頁面
- [ ] 全 App 無任何處將 tSKR 標示為官方 SKR

---

## 12. 疑難排解

| 症狀 | 原因 | 解法 |
|---|---|---|
| `adb devices` 顯示 `unauthorized` | 未接受授權對話框 | 裝置上勾選一律允許；或 `adb kill-server && adb start-server` |
| App 開啟後停在白畫面 | Metro 沒連上 | `adb reverse tcp:8081 tcp:8081` 後重開 App |
| `Unable to load script` | 同上 | 同上，並確認 `npx expo start --dev-client` 在跑 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | debug 與 release 簽章不同 | `adb uninstall cc.neonshift.app` 後重裝 |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | versionCode 沒遞增 | 提高 versionCode 重新建置 |
| Health Connect 權限請求後直接關閉 | 缺 `ViewPermissionUsageActivity` | 依 3.1 補上 activity-alias |
| 讀到步數但全被拒絕 | 來源歸因判斷有誤 | 檢查是否硬編碼 `android`，需同時支援動態 SPN（BR-08） |
| 錢包沒有跳出來 | 裝置無 MWA 相容錢包或未設 devnet | 安裝錢包並切換網路 |
| 交易失敗 `custom program error: 0x1771` | 錯誤碼 6001，缺 ed25519 前置指令 | 檢查交易組裝順序 |
| 交易失敗 `0x1773` | 錯誤碼 6003，canonical bytes 不一致 | 比對 App 與後端的 164 bytes 佈局 |
| Gradle 建置失敗找不到 JDK | JAVA_HOME 未設 | 依 1.3 設定並 `source ~/.zshrc` |
| 建置卡在下載依賴 | 網路或 Gradle 快取 | `cd android && ./gradlew --stop && ./gradlew clean` |
| 無線 adb 連線一直斷 | 裝置換 IP 或休眠 | 重新 `adb connect`；測試時關閉自動休眠 |

---

## 13. 一鍵腳本

放在 `app/scripts/` 下，`chmod +x` 後使用。

### `dev.sh` 日常開發

```bash
#!/usr/bin/env bash
set -euo pipefail
PKG="cc.neonshift.app"

adb devices -l | grep -q "device$" || { echo "找不到裝置"; exit 1; }
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000
echo "埠轉發完成"
npx expo start --dev-client
```

### `release.sh` 產出測試包

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

APK="android/app/build/outputs/apk/release/app-release.apk"
BT="$ANDROID_HOME/build-tools/35.0.0"

echo "==> 建置 release"
(cd android && ./gradlew clean assembleRelease)

echo "==> 驗證簽章"
"$BT/apksigner" verify --print-certs "$APK"

echo "==> 套件資訊"
"$BT/aapt2" dump badging "$APK" | grep -E "package:|sdkVersion:"

echo "==> 產出：$APK （$(du -h "$APK" | cut -f1)）"
echo "==> 安裝到實機：adb install -r $APK"
```

### `reset-device.sh` 重測 onboarding

```bash
#!/usr/bin/env bash
set -euo pipefail
PKG="cc.neonshift.app"

adb shell pm clear "$PKG"
for p in health.READ_STEPS health.READ_SLEEP health.READ_HEALTH_DATA_IN_BACKGROUND \
         ACTIVITY_RECOGNITION ACCESS_COARSE_LOCATION; do
  adb shell pm revoke "$PKG" "android.permission.$p" 2>/dev/null || true
done
echo "已重置，可重新測試首次啟動流程"
```

---

## 附錄：每日開發最短路徑

環境裝好之後，日常只需要這三行。

```bash
cd app
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client
```

改了原生程式碼或加了新套件才需要：

```bash
npx expo run:android --device
```
