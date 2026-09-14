//! 事件定義（SD 3.2）。

use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub cluster_id: u8,
    pub attestor_pubkey: Pubkey,
    pub mint: Pubkey,
    pub reward_vault: Pubkey,
    pub treasury_vault: Pubkey,
    pub daily_cap: u64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    /// 是否變更了影響獎勵金額的參數（BR-24 受控欄位）
    pub reward_params_changed: bool,
}

#[event]
pub struct AttestorRotated {
    pub new_attestor: Pubkey,
    pub prev_attestor: Pubkey,
    pub prev_valid_until: i64,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
    pub at: i64,
}

#[event]
pub struct PlayerInitialized {
    pub wallet: Pubkey,
    pub profile: Pubkey,
    /// 隨 profile 直接贈與的初階跑鞋等級（1）
    pub shoe_level: u8,
}

#[event]
pub struct ClockedIn {
    pub wallet: Pubkey,
    pub task_date: u32,
    pub task_type: u8,
    /// 實發金額（已受每日上限收斂）
    pub amount: u64,
    pub xp: u64,
    pub shoe_level: u8,
    pub core_level: u8,
    pub streak_days: u16,
    pub nonce: [u8; 16],
}
