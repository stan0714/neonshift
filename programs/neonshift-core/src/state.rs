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
    /// 升級燒毀比例，預設 7000
    pub burn_bps: u16,
    /// Core 1～5 倍率
    pub core_multiplier_bps: [u16; 5],
    /// 升至 Core 2～5 的成本
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

    /// 使用者側指令（clock_in、mint_shoe、upgrade_core、join_tournament）在 pause 時拒絕；
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
    /// 跑鞋資產位址；`Pubkey::default()` 表示未鑄造
    pub shoe_asset: Pubkey,
    /// 1～5，只能透過付費升級改變，控制獎勵倍率（BR-23）
    pub core_level: u8,
    /// 1～5，由 XP 門檻自動提升，只影響外觀（BR-23）
    pub shoe_level: u8,
    pub xp: u64,
    /// 最近完成任務的 UTC 日序
    pub last_task_date: u32,
    pub streak_days: u16,
    /// 當日已領取量，`task_date` 變更時歸零
    pub claimed_today: u64,
    /// `claimed_today` 對應的日序
    pub today_date: u32,
    pub bump: u8,
}

impl PlayerProfile {
    pub const SEED: &'static [u8] = crate::constants::PLAYER_SEED;
    pub const MIN_LEVEL: u8 = 1;
    pub const MAX_LEVEL: u8 = 5;

    pub fn has_shoe(&self) -> bool {
        self.shoe_asset != Pubkey::default()
    }
}
