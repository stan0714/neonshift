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
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = crate::constants::CONFIG_SEED;
}
