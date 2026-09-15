//! 管理指令（PG-C-02，SD 3.2）：`set_paused`、`update_config`、`rotate_attestor`。
//! 簽章者必須是 `Config.admin`（多簽）。
//!
//! pause 作用範圍（SD 10 待定項，本實作定案）：`clock_in`、`mint_shoe`、`upgrade_core`、
//! `join_tournament` 在 pause 時拒絕（`Config::require_active`）；`claim_prize`、`refund_all`
//! 與所有管理指令不受影響，使用者永遠能取回資金。
//!
//! BR-24：`daily_cap`、`base_*_reward`、`streak_*`、`core_multiplier_bps` 會改變有效 attestation 的
//! 結算金額，只能在 `paused == true` 且距 `paused_at` ≥ 600 秒後更新；其餘欄位可即時更新。

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::{AttestorRotated, ConfigUpdated, PauseChanged};
use crate::state::Config;

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
}

pub fn handle_set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    if paused && !config.paused {
        config.paused_at = now;
    }
    config.paused = paused;
    emit!(PauseChanged { paused, at: now });
    Ok(())
}

/// 全部欄位可選；`None` 表示不變。
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct UpdateConfigParams {
    pub admin: Option<Pubkey>,
    // ---- BR-24 受控（影響獎勵金額） ----
    pub daily_cap: Option<u64>,
    pub base_steps_reward: Option<u64>,
    pub base_sleep_reward: Option<u64>,
    pub streak_enabled: Option<bool>,
    pub streak_bonus_bps: Option<u16>,
    pub core_multiplier_bps: Option<[u16; 5]>,
    // ---- 可即時更新 ----
    pub burn_bps: Option<u16>,
    pub core_upgrade_costs: Option<[u64; 4]>,
    pub shoe_xp_thresholds: Option<[u64; 5]>,
}

impl UpdateConfigParams {
    pub fn touches_reward_params(&self) -> bool {
        self.daily_cap.is_some()
            || self.base_steps_reward.is_some()
            || self.base_sleep_reward.is_some()
            || self.streak_enabled.is_some()
            || self.streak_bonus_bps.is_some()
            || self.core_multiplier_bps.is_some()
    }
}

pub fn handle_update_config(ctx: Context<AdminOnly>, params: UpdateConfigParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;

    let reward_params_changed = params.touches_reward_params();
    if reward_params_changed {
        require!(config.reward_params_unlocked(now), ErrorCode::RewardParamsChangeRequiresPause);
    }

    // 先套用到副本並以 initialize 的同一套規則驗證，任何欄位不合法即整筆拒絕
    let mut next = crate::instructions::initialize_config::InitializeConfigParams {
        admin: params.admin.unwrap_or(config.admin),
        cluster_id: config.cluster_id,
        attestor_pubkey: config.attestor_pubkey,
        daily_cap: params.daily_cap.unwrap_or(config.daily_cap),
        base_steps_reward: params.base_steps_reward.unwrap_or(config.base_steps_reward),
        base_sleep_reward: params.base_sleep_reward.unwrap_or(config.base_sleep_reward),
        streak_enabled: params.streak_enabled.unwrap_or(config.streak_enabled),
        streak_bonus_bps: params.streak_bonus_bps.unwrap_or(config.streak_bonus_bps),
        burn_bps: params.burn_bps.unwrap_or(config.burn_bps),
        core_multiplier_bps: params.core_multiplier_bps.unwrap_or(config.core_multiplier_bps),
        core_upgrade_costs: params.core_upgrade_costs.unwrap_or(config.core_upgrade_costs),
        shoe_xp_thresholds: params.shoe_xp_thresholds.unwrap_or(config.shoe_xp_thresholds),
    };
    next.validate()?;

    config.admin = next.admin;
    config.daily_cap = next.daily_cap;
    config.base_steps_reward = next.base_steps_reward;
    config.base_sleep_reward = next.base_sleep_reward;
    config.streak_enabled = next.streak_enabled;
    config.streak_bonus_bps = next.streak_bonus_bps;
    config.burn_bps = next.burn_bps;
    config.core_multiplier_bps = next.core_multiplier_bps;
    config.core_upgrade_costs = next.core_upgrade_costs;
    config.shoe_xp_thresholds = std::mem::take(&mut next.shoe_xp_thresholds);

    emit!(ConfigUpdated { admin: config.admin, reward_params_changed });
    Ok(())
}

/// 計畫輪替：`grace_seconds` ≤ 600 讓已簽發的證明在寬限期內仍可用；
/// 金鑰疑似外洩時傳 0 立即讓舊鑰失效。
pub fn handle_rotate_attestor(ctx: Context<AdminOnly>, new_attestor: Pubkey, grace_seconds: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    require!(new_attestor != Pubkey::default(), ErrorCode::InvalidConfigParam);
    require!(new_attestor != config.attestor_pubkey, ErrorCode::InvalidConfigParam);
    require!((0..=attestation_core::MAX_TTL_SECONDS).contains(&grace_seconds), ErrorCode::InvalidConfigParam);

    let prev = config.attestor_pubkey;
    let prev_valid_until = now.checked_add(grace_seconds).ok_or(ErrorCode::MathOverflow)?;
    config.prev_attestor_pubkey = if grace_seconds > 0 { prev } else { Pubkey::default() };
    config.prev_attestor_valid_until = if grace_seconds > 0 { prev_valid_until } else { 0 };
    config.attestor_pubkey = new_attestor;
    config.attestor_valid_from = now;

    emit!(AttestorRotated { new_attestor, prev_attestor: prev, prev_valid_until: config.prev_attestor_valid_until });
    Ok(())
}
