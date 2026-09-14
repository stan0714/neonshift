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
