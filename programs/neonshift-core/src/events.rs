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
    /// 歷史最高連續天數（藝廊投影用，PG-G-01）
    pub max_streak_days: u16,
    pub nonce: [u8; 16],
}

#[event]
pub struct CollectibleClaimed {
    pub wallet: Pubkey,
    pub kind: u8,
    pub asset: Pubkey,
}

#[event]
pub struct TournamentCreated {
    pub tournament: Pubkey,
    pub week_id: u32,
    pub vault: Pubkey,
    pub stake_amount: u64,
    pub treasury_injection_cap: u64,
    pub min_entrants: u32,
    pub registration_ends_at: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub rules_version: u16,
}

#[event]
pub struct TournamentOpened {
    pub tournament: Pubkey,
    pub week_id: u32,
}

#[event]
pub struct TournamentJoined {
    pub tournament: Pubkey,
    pub wallet: Pubkey,
    pub stake: u64,
    pub entrant_count: u32,
}

#[event]
pub struct TournamentLocked {
    pub tournament: Pubkey,
    pub valid_entrant_count: u32,
    pub group_a_size: u32,
    pub group_b_size: u32,
    pub total_staked: u64,
    pub treasury_injection: u64,
}

#[event]
pub struct TournamentCancelled {
    pub tournament: Pubkey,
    pub entrant_count: u32,
    pub min_entrants: u32,
}

#[event]
pub struct TournamentStarted {
    pub tournament: Pubkey,
    pub at: i64,
}

#[event]
pub struct EntryForfeited {
    pub tournament: Pubkey,
    pub wallet: Pubkey,
    pub evidence_hash: [u8; 32],
    pub rules_version: u16,
    pub forfeited_count: u32,
}

#[event]
pub struct SettlementBegan {
    pub tournament: Pubkey,
    pub expected_count: u32,
    pub results_hash: [u8; 32],
    pub distributable_pool: u64,
    pub total_refund: u64,
    pub total_prize: u64,
    pub treasury_remainder: u64,
}

#[event]
pub struct ResultsBatchSubmitted {
    pub tournament: Pubkey,
    pub from_rank: u32,
    pub to_rank: u32,
    pub rolling_hash: [u8; 32],
}

#[event]
pub struct TournamentSettled {
    pub tournament: Pubkey,
    pub results_submitted: u32,
    pub treasury_remainder: u64,
}

#[event]
pub struct PrizeClaimed {
    pub tournament: Pubkey,
    pub wallet: Pubkey,
    pub rank: u32,
    pub group: u8,
    pub refund: u64,
    pub prize: u64,
}

#[event]
pub struct Refunded {
    pub tournament: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TournamentCancelledLate {
    pub tournament: Pubkey,
    pub by: Pubkey,
    pub returned_to_treasury: u64,
}

/// PG-R-08：成就 NFT 已鑄造（indexer 以此標記 minted 並更新藝廊）
#[event]
pub struct AchievementClaimed {
    pub wallet: Pubkey,
    pub achievement_id: [u8; 32],
    pub category: u8,
    pub verification_class: u8,
    pub source_revision: u32,
    pub asset: Pubkey,
}

/// PG-R-08：資格 registry 更新（approved／revoked）
#[event]
pub struct AchievementEligibilitySet {
    pub wallet: Pubkey,
    pub achievement_id: [u8; 32],
    pub status: u8,
    pub source_revision: u32,
}
