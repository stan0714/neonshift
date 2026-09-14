//! `initialize_config`（PG-C-01，SD 3.1／3.2）。
//!
//! 首次管理員授權（SD 10 待定項，本實作定案）：只有程式的 **upgrade authority** 能執行，
//! 避免部署後被任何人搶先初始化；`admin` 由參數指定（多簽），之後的管理指令由 `admin` 簽章。
//! 帳戶為 PDA 且以 `init` 建立，因此天然只可執行一次。

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::ConfigInitialized;
use crate::state::Config;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct InitializeConfigParams {
    pub admin: Pubkey,
    pub cluster_id: u8,
    pub attestor_pubkey: Pubkey,
    pub daily_cap: u64,
    pub base_steps_reward: u64,
    pub base_sleep_reward: u64,
    pub streak_enabled: bool,
    pub streak_bonus_bps: u16,
    pub burn_bps: u16,
    pub core_multiplier_bps: [u16; 5],
    pub core_upgrade_costs: [u64; 4],
    pub shoe_xp_thresholds: [u64; 5],
}

impl InitializeConfigParams {
    /// 參數範圍檢查；任一不符即 `InvalidConfigParam`。
    pub fn validate(&self) -> Result<()> {
        require!(self.admin != Pubkey::default(), ErrorCode::InvalidConfigParam);
        require!(self.attestor_pubkey != Pubkey::default(), ErrorCode::InvalidConfigParam);
        require!(
            self.cluster_id == CLUSTER_DEVNET || self.cluster_id == CLUSTER_LOCALNET,
            ErrorCode::InvalidConfigParam
        );
        require!(self.base_steps_reward > 0 && self.base_sleep_reward > 0, ErrorCode::InvalidConfigParam);
        require!(
            self.daily_cap >= self.base_steps_reward.max(self.base_sleep_reward),
            ErrorCode::InvalidConfigParam
        );
        require!(
            (BPS_ONE..=MAX_STREAK_BONUS_BPS).contains(&self.streak_bonus_bps),
            ErrorCode::InvalidConfigParam
        );
        require!(self.burn_bps <= BPS_ONE, ErrorCode::InvalidConfigParam);
        // Core 1 必為 1.0x，之後單調不減且不超過上限
        require!(self.core_multiplier_bps[0] == BPS_ONE, ErrorCode::InvalidConfigParam);
        for w in self.core_multiplier_bps.windows(2) {
            require!(w[1] >= w[0] && w[1] <= MAX_CORE_MULTIPLIER_BPS, ErrorCode::InvalidConfigParam);
        }
        require!(self.core_upgrade_costs.iter().all(|c| *c > 0), ErrorCode::InvalidConfigParam);
        // Lv1 門檻為 0，之後嚴格遞增
        require!(self.shoe_xp_thresholds[0] == 0, ErrorCode::InvalidConfigParam);
        for w in self.shoe_xp_thresholds.windows(2) {
            require!(w[1] > w[0], ErrorCode::InvalidConfigParam);
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// 程式的 upgrade authority；同時支付 rent
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(constraint = mint.decimals == TSKR_DECIMALS @ ErrorCode::InvalidTokenAccount)]
    pub mint: Account<'info, Mint>,

    /// 獎勵金庫：mint 相符且由 Config PDA 持有，之後由程式簽章轉出
    #[account(
        constraint = reward_vault.mint == mint.key() @ ErrorCode::InvalidTokenAccount,
        constraint = reward_vault.owner == config.key() @ ErrorCode::InvalidTokenAccount,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    /// 國庫：mint 相符即可，owner 由治理決定
    #[account(constraint = treasury_vault.mint == mint.key() @ ErrorCode::InvalidTokenAccount)]
    pub treasury_vault: Account<'info, TokenAccount>,

    /// 本程式帳戶（upgradeable loader）
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::NeonshiftCore>,

    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ ErrorCode::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_config(ctx: Context<InitializeConfig>, params: InitializeConfigParams) -> Result<()> {
    params.validate()?;
    let now = Clock::get()?.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.admin = params.admin;
    config.cluster_id = params.cluster_id;
    config.attestor_pubkey = params.attestor_pubkey;
    config.attestor_valid_from = now;
    config.prev_attestor_pubkey = Pubkey::default();
    config.prev_attestor_valid_until = 0;
    config.mint = ctx.accounts.mint.key();
    config.mint_decimals = ctx.accounts.mint.decimals;
    config.reward_vault = ctx.accounts.reward_vault.key();
    config.treasury_vault = ctx.accounts.treasury_vault.key();
    config.daily_cap = params.daily_cap;
    config.base_steps_reward = params.base_steps_reward;
    config.base_sleep_reward = params.base_sleep_reward;
    config.streak_enabled = params.streak_enabled;
    config.streak_bonus_bps = params.streak_bonus_bps;
    config.burn_bps = params.burn_bps;
    config.core_multiplier_bps = params.core_multiplier_bps;
    config.core_upgrade_costs = params.core_upgrade_costs;
    config.shoe_xp_thresholds = params.shoe_xp_thresholds;
    config.paused = false;
    config.bump = ctx.bumps.config;

    emit!(ConfigInitialized {
        admin: config.admin,
        cluster_id: config.cluster_id,
        attestor_pubkey: config.attestor_pubkey,
        mint: config.mint,
        reward_vault: config.reward_vault,
        treasury_vault: config.treasury_vault,
        daily_cap: config.daily_cap,
    });
    Ok(())
}
