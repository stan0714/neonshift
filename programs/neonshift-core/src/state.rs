//! 帳戶結構（SD 3.1）。所有金額使用 tSKR 最小單位（6 decimals）。

use anchor_lang::prelude::*;

/// PDA seeds `["config"]`
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// 多簽位址；update_config／rotate_attestor 等管理指令的簽章者
    pub admin: Pubkey,
    /// canonical attestation 的環境識別；devnet = 1
    pub cluster_id: u8,
    pub attestor_pubkey: Pubkey,
    /// 輪替生效時間，支援新舊並行
    pub attestor_valid_from: i64,
    pub prev_attestor_pubkey: Pubkey,
    pub prev_attestor_valid_until: i64,
    pub mint: Pubkey,
    /// 初始化時要求等於 mint 的 6 decimals
    pub mint_decimals: u8,
    pub reward_vault: Pubkey,
    pub treasury_vault: Pubkey,
    pub daily_cap: u64,
    pub base_steps_reward: u64,
    pub base_sleep_reward: u64,
    /// FR-03.6 功能開關，MVP 預設 false
    pub streak_enabled: bool,
    /// 啟用後加成，預設 11000；停用時一律使用 10000
    pub streak_bonus_bps: u16,
    /// 保留：升級改為免費（2026-09-14）後不使用
    pub burn_bps: u16,
    /// Core 1～5 倍率
    pub core_multiplier_bps: [u16; 5],
    /// 保留：升級改為免費（2026-09-14）後不使用
    pub core_upgrade_costs: [u64; 4],
    /// 跑鞋 Lv1～5 的累積 XP 門檻
    pub shoe_xp_thresholds: [u64; 5],
    pub paused: bool,
    /// 最近一次 pause 的時間；BR-24 以此判斷有效 attestation 是否已全部過期
    pub paused_at: i64,
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = crate::constants::CONFIG_SEED;

    /// 使用者側指令（clock_in、join_tournament）在 pause 時拒絕；
    /// 取回資金的 claim_prize／refund_all 與管理指令不受影響（SD 3.2 pause 範圍）。
    pub fn require_active(&self) -> anchor_lang::Result<()> {
        anchor_lang::require!(!self.paused, crate::error::ErrorCode::ProgramPaused);
        Ok(())
    }

    /// BR-24：已 pause 且超過最長 attestation 有效期（600 秒），才可改動影響金額的參數
    pub fn reward_params_unlocked(&self, now: i64) -> bool {
        self.paused && now.saturating_sub(self.paused_at) >= attestation_core::MAX_TTL_SECONDS
    }

    /// 給定時間點可接受的 attestor 公鑰（含輪替寬限期內的舊鑰）
    pub fn attestor_accepts(&self, key: &Pubkey, now: i64) -> bool {
        (key == &self.attestor_pubkey && now >= self.attestor_valid_from)
            || (self.prev_attestor_pubkey != Pubkey::default()
                && key == &self.prev_attestor_pubkey
                && now < self.prev_attestor_valid_until)
    }
}

/// PDA seeds `["player", wallet]`
#[account]
#[derive(InitSpace)]
pub struct PlayerProfile {
    pub wallet: Pubkey,
    /// 1～5，只能透過付費升級改變，控制獎勵倍率（BR-23）
    pub core_level: u8,
    /// 1～5，由 XP 門檻自動提升，只影響外觀（BR-23）
    pub shoe_level: u8,
    pub xp: u64,
    /// 最近完成任務的 UTC 日序
    pub last_task_date: u32,
    pub streak_days: u16,
    /// 歷史最高連續天數（連續 7 天徽章資格；斷日不下降）
    pub max_streak_days: u16,
    /// 當日已領取量，`task_date` 變更時歸零
    pub claimed_today: u64,
    /// `claimed_today` 對應的日序
    pub today_date: u32,
    pub bump: u8,
    // ---- PG-V-02 維持挑戰（shoe-gameplay 4、7）；舊帳戶以 `migrate_player` 補齊 ----
    /// 歷史最高真正啟用過的鞋階（永不因降級下降；鞋階 NFT 與回歸目標依此）
    pub highest_level: u8,
    /// 週期 anchor（UTC 日序；init_player／migrate 當日）。期 k 區間 `[anchor+7k, anchor+7(k+1))`
    pub epoch_anchor: u32,
    /// 已結算期數（cursor）；目前開放期＝此值。受限交易前必須追到當前期
    pub last_settled_epoch: u32,
    /// 目前開放期累積維持點（步數 +100、睡眠 +50；每期重算，不是花費 XP）
    pub epoch_points: u16,
    /// 目前開放期 7-bit 活躍日 bitmap（bit i＝期內第 i 日）
    pub epoch_bitmap: u8,
    /// 維持規則版本（改門檻只向未來生效）
    pub maintenance_rules_version: u16,
}

impl PlayerProfile {
    pub const SEED: &'static [u8] = crate::constants::PLAYER_SEED;
    pub const MIN_LEVEL: u8 = 1;
    pub const MAX_LEVEL: u8 = 5;
    /// PG-V-02 前的資料長度（不含 discriminator）：wallet 32＋levels 2＋xp 8＋last_task_date 4＋streak 4＋claimed_today 8＋today_date 4＋bump 1
    pub const V1_SPACE: usize = 63;
}

/// PDA seeds `["claim", wallet, task_date_le, task_type]`。帳戶存在即代表已領取（BR-03）。
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub wallet: Pubkey,
    pub task_date: u32,
    pub task_type: u8,
    /// 實發金額（最小單位）
    pub amount: u64,
    /// attestation nonce，供稽核關聯
    pub nonce: [u8; 16],
    pub claimed_at: i64,
    pub bump: u8,
}

impl ClaimReceipt {
    pub const SEED: &'static [u8] = crate::constants::CLAIM_SEED;
}

/// 成就收藏 NFT 領取紀錄（FR-04.6）。PDA seeds `["collectible", wallet, kind]`，存在即代表已領取。
#[account]
#[derive(InitSpace)]
pub struct CollectibleReceipt {
    pub wallet: Pubkey,
    pub kind: u8,
    /// Metaplex Core asset 位址
    pub asset: Pubkey,
    pub claimed_at: i64,
    pub bump: u8,
}

/// 週末錦標賽（SD 3.1）。PDA seeds `["tournament", week_id_le]`。
/// 金額、分組比例、國庫挹注上限與時間窗於 `create_tournament` 寫入後不可變（BRD 8.4）。
#[account]
#[derive(InitSpace, Default)]
pub struct Tournament {
    /// ISO week-based year × 100 + ISO week，例如 202641
    pub week_id: u32,
    /// 0 Draft、1 Registration、2 Locked、3 Running、4 Settling、5 Settled、6 Cancelled
    pub status: u8,
    /// 本賽事專用 tSKR token account，owner = Tournament PDA
    pub vault: Pubkey,
    pub stake_amount: u64,
    pub total_staked: u64,
    /// 建立時固定的國庫挹注上限
    pub treasury_injection_cap: u64,
    /// lock 時實際轉入 vault 的國庫挹注（≤ cap 且 ≤ 國庫餘額）
    pub treasury_injection: u64,
    pub entrant_count: u32,
    /// 報名截止時固定；join 已逐筆驗證格式與資金，故等於 entrant_count
    pub valid_entrant_count: u32,
    pub forfeited_count: u32,
    pub group_a_size: u32,
    pub group_b_size: u32,
    pub distributable_pool: u64,
    pub distributed: u64,
    pub total_refund: u64,
    pub total_prize: u64,
    pub treasury_remainder: u64,
    pub results_submitted: u32,
    /// begin_settlement 承諾的最終 rolling hash
    pub results_hash: [u8; 32],
    /// 鏈上逐筆更新的 rolling hash（初始 32 bytes zero）
    pub results_rolling_hash: [u8; 32],
    pub min_entrants: u32,
    pub registration_ends_at: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub rules_version: u16,
    /// 可分配獎金池 A／B 組占比、未得獎者退款比例（bps；建立時寫入）
    pub prize_a_bps: u16,
    pub prize_b_bps: u16,
    pub loser_refund_bps: u16,
    pub created_at: i64,
    pub bump: u8,
}

impl Tournament {
    pub fn require_status(&self, expected: u8) -> anchor_lang::Result<()> {
        anchor_lang::require!(self.status == expected, crate::error::ErrorCode::InvalidTournamentState);
        Ok(())
    }

    /// BR-18：得獎人數 max(1, ceil(n×30%))，A 組 max(1, ceil(n×10%))，B 組為其餘（可為 0）
    pub fn group_sizes(valid_entrants: u32) -> (u32, u32) {
        use crate::constants::{GROUP_A_BPS, WINNER_BPS};
        let ceil_bps = |n: u32, bps: u32| -> u32 { ((n as u64 * bps as u64).div_ceil(10_000)) as u32 };
        let winners = ceil_bps(valid_entrants, WINNER_BPS).max(1);
        let a = ceil_bps(valid_entrants, GROUP_A_BPS).max(1).min(winners);
        (a, winners - a)
    }
}

/// 報名紀錄（SD 3.1）。PDA seeds `["entry", tournament, wallet]`。
#[account]
#[derive(InitSpace)]
pub struct TournamentEntry {
    pub tournament: Pubkey,
    pub wallet: Pubkey,
    pub stake: u64,
    pub final_steps: u64,
    /// 0 表示未排名
    pub rank: u32,
    /// 0 無、1 A 組、2 B 組
    pub group: u8,
    pub forfeited: bool,
    pub settled: bool,
    pub evidence_hash: [u8; 32],
    pub joined_at: i64,
    pub bump: u8,
}

/// 成就資格 registry（PG-R-08，activity-running-gallery 7）：由 admin 寫入／更新；
/// 鑄造必查最新狀態、source_revision 與 metadata_hash 需與簽章證明一致。撤銷交易 finalized 才算鏈上已撤銷。
#[account]
#[derive(InitSpace)]
pub struct AchievementEligibility {
    pub wallet: Pubkey,
    pub achievement_id: [u8; 32],
    pub category: u8,
    pub verification_class: u8,
    pub status: u8,
    pub source_revision: u32,
    pub metadata_hash: [u8; 32],
    pub updated_at: i64,
    pub bump: u8,
}

/// 成就 NFT 領取憑證：每個 achievement_id 一枚（BR-39）。
#[account]
#[derive(InitSpace)]
pub struct AchievementReceipt {
    pub wallet: Pubkey,
    pub achievement_id: [u8; 32],
    pub category: u8,
    pub verification_class: u8,
    pub source_revision: u32,
    pub asset: Pubkey,
    pub claimed_at: i64,
    pub bump: u8,
}
