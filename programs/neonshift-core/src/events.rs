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
