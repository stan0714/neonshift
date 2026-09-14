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
