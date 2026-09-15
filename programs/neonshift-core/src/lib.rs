//! NeonShift 鏈上程式（SD 3）。帳戶、指令與錯誤碼依 docs/sd.md 第 3 章逐項由 PG-C-01 起實作。

use anchor_lang::prelude::*;

pub mod attestation;
pub mod reward;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod maintenance;
pub mod mpl_core;
pub mod tournament_math;
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

    /// PG-V-02：舊版 PlayerProfile 補齊維持欄位（任何 payer 付 rent 差額；保留目前與歷史鞋階、自當日起新週期）
    pub fn migrate_player(ctx: Context<MigratePlayer>) -> Result<()> {
        instructions::maintenance::handle_migrate_player(ctx)
    }

    /// PG-V-02：結算已過期週期（任何 payer；冪等、單調 cursor、bounded batch）
    pub fn settle_player_epochs(ctx: Context<SettlePlayerEpochs>, max_epochs: u8) -> Result<()> {
        instructions::maintenance::handle_settle_player_epochs(ctx, max_epochs)
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

    /// 沒收質押（admin）：ends_at 後、begin_settlement 前；需非零 evidence_hash 與相符 rules_version
    pub fn forfeit_entry(ctx: Context<ForfeitEntry>, evidence_hash: [u8; 32], rules_version: u16) -> Result<()> {
        instructions::settlement::handle_forfeit_entry(ctx, evidence_hash, rules_version)
    }

    /// 開始結算（admin）：承諾有效人數與最終 rolling hash，預算退款／獎金／餘數
    pub fn begin_settlement(ctx: Context<AdminSettlement>, expected_count: u32, results_hash: [u8; 32]) -> Result<()> {
        instructions::settlement::handle_begin_settlement(ctx, expected_count, results_hash)
    }

    /// 提交連續排名批次（admin）；entry 依序放在 remaining_accounts
    pub fn submit_results_batch<'info>(ctx: Context<'info, AdminSettlement<'info>>, items: Vec<ResultItem>) -> Result<()> {
        instructions::settlement::handle_submit_results_batch(ctx, items)
    }

    /// 完成結算（admin）：筆數與 hash 相符、資金守恆、餘數歸庫
    pub fn settle_tournament(ctx: Context<SettleTournament>) -> Result<()> {
        instructions::settlement::handle_settle_tournament(ctx)
    }

    /// 領取退款＋獎金（玩家；不受 pause 影響）
    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        instructions::settlement::handle_claim_prize(ctx)
    }

    /// 取消賽事（admin 隨時；或任何人於 ends_at + 7 天後仍未 Settled 時）：挹注與沒收質押歸庫
    pub fn cancel_tournament(ctx: Context<CancelTournament>) -> Result<()> {
        instructions::settlement::handle_cancel_tournament(ctx)
    }

    /// 賽事 Cancelled 後取回全額質押（玩家；不受 pause 影響）
    pub fn refund_all(ctx: Context<ClaimPrize>) -> Result<()> {
        instructions::settlement::handle_refund_all(ctx)
    }

    /// PG-R-08：成就資格 registry（admin）
    pub fn set_achievement_eligibility(ctx: Context<SetAchievementEligibility>, params: SetEligibilityParams) -> Result<()> {
        instructions::claim_achievement::handle_set_achievement_eligibility(ctx, params)
    }

    /// PG-R-08：領取 PB 成就 NFT（attestor 簽章證明＋registry）
    pub fn claim_achievement(ctx: Context<ClaimAchievement>, args: AchievementArgs) -> Result<()> {
        instructions::claim_achievement::handle_claim_achievement(ctx, args)
    }

    /// 輪替 attestor 公鑰（admin），寬限期 0～600 秒
    pub fn rotate_attestor(ctx: Context<AdminOnly>, new_attestor: Pubkey, grace_seconds: i64) -> Result<()> {
        instructions::admin::handle_rotate_attestor(ctx, new_attestor, grace_seconds)
    }
}
