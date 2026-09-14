//! NeonShift 鏈上程式（SD 3）。帳戶、指令與錯誤碼依 docs/sd.md 第 3 章逐項由 PG-C-01 起實作。

use anchor_lang::prelude::*;

pub mod attestation;
pub mod reward;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod mpl_core;
pub mod state;

pub use attestation::AttestationArgs;
pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA");

#[program]
pub mod neonshift_core {
    use super::*;

    /// 建立 Config PDA（僅可執行一次；只有 upgrade authority 可呼叫）
    pub fn initialize_config(ctx: Context<InitializeConfig>, params: InitializeConfigParams) -> Result<()> {
        instructions::initialize_config::handle_initialize_config(ctx, params)
    }

    /// 緊急停用／恢復（admin）。pause 範圍見 instructions/admin.rs
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::handle_set_paused(ctx, paused)
    }

    /// 更新 Config（admin）；影響獎勵金額的欄位受 BR-24 限制
    pub fn update_config(ctx: Context<AdminOnly>, params: UpdateConfigParams) -> Result<()> {
        instructions::admin::handle_update_config(ctx, params)
    }

    /// 建立 PlayerProfile PDA（玩家簽章、付 rent；每錢包一次）
    pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
        instructions::init_player::handle_init_player(ctx)
    }

    /// 每日打卡（SD 3.3 16 步）；前一道指令必須是 Ed25519 program 驗簽
    pub fn clock_in(ctx: Context<ClockIn>, args: AttestationArgs) -> Result<()> {
        instructions::clock_in::handle_clock_in(ctx, args)
    }

    /// 領取成就收藏 NFT（免費；玩家付 rent）；kind 見 constants
    pub fn claim_collectible(ctx: Context<ClaimCollectible>, kind: u8) -> Result<()> {
        instructions::claim_collectible::handle_claim_collectible(ctx, kind)
    }

    // ---- 錦標賽（PG-C-11／C-12） ----

    /// 建立週末錦標賽（admin）：金額、分組比例、挹注上限與時間窗寫入後不可變
    pub fn create_tournament(ctx: Context<CreateTournament>, params: CreateTournamentParams) -> Result<()> {
        instructions::tournament::handle_create_tournament(ctx, params)
    }

    /// Draft → Registration（admin）
    pub fn open_tournament(ctx: Context<AdminTournament>) -> Result<()> {
        instructions::tournament::handle_open_tournament(ctx)
    }

    /// 玩家質押報名（受 pause 影響）
    pub fn join_tournament(ctx: Context<JoinTournament>) -> Result<()> {
        instructions::tournament::handle_join_tournament(ctx)
    }

    /// 報名截止（admin）：固定分組、國庫挹注、對帳 vault；人數不足轉 Cancelled
    pub fn lock_tournament(ctx: Context<LockTournament>) -> Result<()> {
        instructions::tournament::handle_lock_tournament(ctx)
    }

    /// Locked → Running（任意 payer，到 starts_at 後）
    pub fn start_tournament(ctx: Context<StartTournament>) -> Result<()> {
        instructions::tournament::handle_start_tournament(ctx)
    }

    /// 輪替 attestor 公鑰（admin），寬限期 0～600 秒
    pub fn rotate_attestor(ctx: Context<AdminOnly>, new_attestor: Pubkey, grace_seconds: i64) -> Result<()> {
        instructions::admin::handle_rotate_attestor(ctx, new_attestor, grace_seconds)
    }
}
