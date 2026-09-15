//! PDA seeds、常數與 Config 預設值（SD 3.1／3.4、BRD 8）。

use anchor_lang::prelude::*;

pub const PROGRAM_VERSION: u8 = 1;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const PLAYER_SEED: &[u8] = b"player";
#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";
#[constant]
pub const TOURNAMENT_SEED: &[u8] = b"tournament";
#[constant]
pub const ENTRY_SEED: &[u8] = b"entry";

/// canonical attestation 的環境識別（SD 3.1 Config.cluster_id）；數值以 attestation-core 為準
pub use attestation_core::{CLUSTER_DEVNET, CLUSTER_LOCALNET, TASK_SLEEP, TASK_STEPS};

/// tSKR 固定 6 decimals（BR-22）
#[constant]
pub const TSKR_DECIMALS: u8 = 6;
pub const TSKR_UNIT: u64 = 1_000_000;

/// 基點基準：10000 bps = 1.0x
pub const BPS_ONE: u16 = 10_000;
/// streak 加成上限，避免誤設（2.0x）
pub const MAX_STREAK_BONUS_BPS: u16 = 20_000;
/// Core 倍率上限（5.0x）
pub const MAX_CORE_MULTIPLIER_BPS: u16 = 50_000;

// Config 預設值（BRD 8.2／8.3、SD 3.1）
pub const DEFAULT_DAILY_CAP: u64 = 40 * TSKR_UNIT;
pub const DEFAULT_BASE_STEPS_REWARD: u64 = 10 * TSKR_UNIT;
pub const DEFAULT_BASE_SLEEP_REWARD: u64 = 5 * TSKR_UNIT;
pub const DEFAULT_STREAK_BONUS_BPS: u16 = 11_000;
pub const DEFAULT_BURN_BPS: u16 = 7_000;
pub const DEFAULT_CORE_MULTIPLIER_BPS: [u16; 5] = [10_000, 12_000, 15_000, 18_000, 22_000];

/// 每次成功打卡的 XP（SA BR-34）；與代幣數量獨立
pub const XP_STEPS: u64 = 100;
pub const XP_SLEEP: u64 = 50;
/// 五階 XP 門檻預設值（SA BR-35）
pub const DEFAULT_SHOE_XP_THRESHOLDS: [u64; 5] = [0, 450, 1_500, 3_600, 7_500];
/// streak 加成生效所需連續任務日（BR-06）
pub const STREAK_BONUS_DAYS: u16 = 7;
pub const SECONDS_PER_DAY: i64 = 86_400;

#[constant]
pub const COLLECTIBLE_SEED: &[u8] = b"collectible";

/// 成就 NFT asset PDA seeds `["asset", wallet, kind]`：位址可由 App 直接推導，不需額外 keypair 簽章
#[constant]
pub const ASSET_SEED: &[u8] = b"asset";

/// 成就收藏種類（SD 3.2 `claim_collectible`）
pub const COLLECTIBLE_SHOE_LV1: u8 = 1;
pub const COLLECTIBLE_SHOE_LV5: u8 = 5;
pub const COLLECTIBLE_FIRST_CLAIM: u8 = 101;
pub const COLLECTIBLE_STREAK_7: u8 = 102;
/// 110 + 名次（1～9）
pub const COLLECTIBLE_TOURNAMENT_RANK_BASE: u8 = 110;

/// NFT metadata 靜態託管（SD 11A）；改網址需升級程式，之後可移入 Config
pub const COLLECTIBLE_BASE_URI: &str = "https://neonshift.cc/nft/";

// ---- 錦標賽（BRD 8.4、SA BR-17～BR-19）；建立賽事時寫入 Tournament 後不可變 ----
pub const DEFAULT_STAKE_AMOUNT: u64 = 50 * TSKR_UNIT;
pub const DEFAULT_MIN_ENTRANTS: u32 = 10;
/// 國庫挹注上限（BRD 8.4「不得依賴未設上限的國庫補貼」）：單一賽事最多 5,000 tSKR
pub const MAX_TREASURY_INJECTION: u64 = 5_000 * TSKR_UNIT;
/// 得獎人數 = max(1, ceil(n × 30%))；A 組 = max(1, ceil(n × 10%))（BR-18）
pub const WINNER_BPS: u32 = 3_000;
pub const GROUP_A_BPS: u32 = 1_000;
/// 可分配獎金池 A／B 組占比與未得獎者退款比例（BRD 8.4）
pub const PRIZE_A_BPS: u16 = 6_000;
pub const PRIZE_B_BPS: u16 = 4_000;
pub const LOSER_REFUND_BPS: u16 = 5_000;
/// ends_at 後超過此期限仍未 Settled，任何人可 cancel_tournament 讓玩家取回質押（BRD P0：不得無限期鎖住）
pub const SETTLEMENT_DEADLINE_SECONDS: i64 = 7 * SECONDS_PER_DAY;
/// week_id = ISO 年 × 100 + ISO 週（SD 3.1）
pub const MIN_WEEK_ID: u32 = 2026_01;
pub const MAX_WEEK_ID: u32 = 2100_53;

/// 賽事狀態（Tournament.status）
pub mod tournament_status {
    pub const DRAFT: u8 = 0;
    pub const REGISTRATION: u8 = 1;
    pub const LOCKED: u8 = 2;
    pub const RUNNING: u8 = 3;
    pub const SETTLING: u8 = 4;
    pub const SETTLED: u8 = 5;
    pub const CANCELLED: u8 = 6;
}

// ---- PG-V-02：跑鞋維持挑戰（shoe-gameplay 3、4；tools/maintenance-sim/rules.mjs 同版參數）----
/// 維持規則版本
pub const MAINTENANCE_RULES_VERSION: u16 = 1;
/// 每期任務日數
pub const EPOCH_DAYS: u32 = 7;
/// 每階每期維持點門檻（index＝level−1；Lv1 不要求）
pub const MAINTENANCE_POINTS: [u16; 5] = [0, 200, 450, 700, 900];
/// 每階每期至少活躍日
pub const MAINTENANCE_ACTIVE_DAYS: [u8; 5] = [0, 2, 3, 5, 6];
/// 維持點：步數／睡眠（與 XP 數字相同，但每期重算）
pub const MAINTENANCE_POINTS_STEPS: u16 = 100;
pub const MAINTENANCE_POINTS_SLEEP: u16 = 50;
/// clock_in 內可順帶結算的最多期數；超過須先呼叫 `settle_player_epochs`（bounded，禁止無界迴圈）
pub const MAX_INLINE_SETTLE_EPOCHS: u32 = 8;
/// `settle_player_epochs` 單次最多結算期數
pub const MAX_BATCH_SETTLE_EPOCHS: u8 = 64;
/// PG-V-05：incident freeze PDA seed；視窗最長 4 期；start 不得早於 now − 7 天（不回寫更早已結束的週期）
pub const FREEZE_SEED: &[u8] = b"freeze";
pub const MAX_FREEZE_SECONDS: i64 = 28 * SECONDS_PER_DAY;
pub const MAX_FREEZE_BACKDATE_SECONDS: i64 = 7 * SECONDS_PER_DAY;

// ---- PG-R-08：成就（PB）NFT ----
/// eligibility registry PDA seeds `["eligibility", wallet, achievement_id]`
pub const ELIGIBILITY_SEED: &[u8] = b"eligibility";
/// receipt PDA seeds `["achievement", wallet, achievement_id]`（每個 achievement_id 最多一枚）
pub const ACHIEVEMENT_SEED: &[u8] = b"achievement";
/// asset PDA seeds `["aasset", wallet, achievement_id]`
pub const ACHIEVEMENT_ASSET_SEED: &[u8] = b"aasset";
/// 成就 metadata URI：`<base><achievement_id hex>.json`（由後端依 canonical metadata 提供）
pub const ACHIEVEMENT_BASE_URI: &str = "https://api.neonshift.cc/v1/nft/achievements/";
/// registry 狀態
pub const ELIGIBILITY_APPROVED: u8 = 1;
/// registry 狀態：已撤銷
pub const ELIGIBILITY_REVOKED: u8 = 2;
