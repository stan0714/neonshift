//! 錦標賽生命週期（PG-C-11／C-12，SD 3.1／3.2、BRD 8.4）：
//! `create_tournament`（admin，Draft）→ `open_tournament`（Registration）→ `join_tournament`（玩家質押）
//! → `lock_tournament`（截止：固定分組、國庫挹注、對帳 vault；人數不足轉 Cancelled）→ `start_tournament`（任意 payer）。
//! 結算（begin_settlement／submit_results_batch／settle_tournament／claim_prize／forfeit／refund）見 C-13～C-16。

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{tournament_status as st, *};
use crate::error::ErrorCode;
use crate::events::*;
use crate::state::{Config, Tournament, TournamentEntry};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct CreateTournamentParams {
    pub week_id: u32,
    pub stake_amount: u64,
    pub treasury_injection_cap: u64,
    pub min_entrants: u32,
    pub registration_ends_at: i64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub rules_version: u16,
}

impl CreateTournamentParams {
    pub fn validate(&self, now: i64) -> Result<()> {
        let ok = (MIN_WEEK_ID..=MAX_WEEK_ID).contains(&self.week_id)
            && (1..=53).contains(&(self.week_id % 100))
            && self.stake_amount > 0
            && self.treasury_injection_cap <= MAX_TREASURY_INJECTION
            && self.min_entrants >= 1
            && self.rules_version > 0
            && now < self.registration_ends_at
            && self.registration_ends_at <= self.starts_at
            && self.starts_at < self.ends_at;
        require!(ok, ErrorCode::InvalidTournamentParam);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(params: CreateTournamentParams)]
pub struct CreateTournament<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized, has_one = mint @ ErrorCode::InvalidTokenAccount)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Tournament::INIT_SPACE,
        seeds = [TOURNAMENT_SEED, &params.week_id.to_le_bytes()],
        bump,
    )]
    pub tournament: Account<'info, Tournament>,
    pub mint: Account<'info, Mint>,
    /// 專用 vault：由 Tournament PDA 持有，BR-22
    #[account(
        init,
        payer = admin,
        seeds = [b"vault", tournament.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = tournament,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_tournament(ctx: Context<CreateTournament>, params: CreateTournamentParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    params.validate(now)?;
    let t = &mut ctx.accounts.tournament;
    t.week_id = params.week_id;
    t.status = st::DRAFT;
    t.vault = ctx.accounts.vault.key();
    t.stake_amount = params.stake_amount;
    t.treasury_injection_cap = params.treasury_injection_cap;
    t.min_entrants = params.min_entrants;
    t.registration_ends_at = params.registration_ends_at;
    t.starts_at = params.starts_at;
    t.ends_at = params.ends_at;
    t.rules_version = params.rules_version;
    t.prize_a_bps = PRIZE_A_BPS;
    t.prize_b_bps = PRIZE_B_BPS;
    t.loser_refund_bps = LOSER_REFUND_BPS;
    t.created_at = now;
    t.bump = ctx.bumps.tournament;
    emit!(TournamentCreated {
        tournament: t.key(),
        week_id: t.week_id,
        vault: t.vault,
        stake_amount: t.stake_amount,
        treasury_injection_cap: t.treasury_injection_cap,
        min_entrants: t.min_entrants,
        registration_ends_at: t.registration_ends_at,
        starts_at: t.starts_at,
        ends_at: t.ends_at,
        rules_version: t.rules_version,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AdminTournament<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump)]
    pub tournament: Account<'info, Tournament>,
}

pub fn handle_open_tournament(ctx: Context<AdminTournament>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::DRAFT)?;
    require!(now < t.registration_ends_at, ErrorCode::TournamentTimingViolation);
    t.status = st::REGISTRATION;
    emit!(TournamentOpened { tournament: t.key(), week_id: t.week_id });
    Ok(())
}

#[derive(Accounts)]
pub struct JoinTournament<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump, has_one = vault @ ErrorCode::InvalidTokenAccount)]
    pub tournament: Account<'info, Tournament>,
    #[account(
        init,
        payer = player,
        space = 8 + TournamentEntry::INIT_SPACE,
        seeds = [ENTRY_SEED, tournament.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, TournamentEntry>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = player_token_account.owner == player.key() @ ErrorCode::InvalidTokenAccount,
        constraint = player_token_account.mint == config.mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub player_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_join_tournament(ctx: Context<JoinTournament>) -> Result<()> {
    ctx.accounts.config.require_active()?;
    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::REGISTRATION)?;
    require!(now < t.registration_ends_at, ErrorCode::TournamentTimingViolation);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        ),
        t.stake_amount,
    )?;

    t.entrant_count = t.entrant_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
    t.total_staked = t.total_staked.checked_add(t.stake_amount).ok_or(ErrorCode::MathOverflow)?;

    let e = &mut ctx.accounts.entry;
    e.tournament = t.key();
    e.wallet = ctx.accounts.player.key();
    e.stake = t.stake_amount;
    e.joined_at = now;
    e.bump = ctx.bumps.entry;

    emit!(TournamentJoined { tournament: t.key(), wallet: e.wallet, stake: e.stake, entrant_count: t.entrant_count });
    Ok(())
}

#[derive(Accounts)]
pub struct LockTournament<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized, has_one = treasury_vault @ ErrorCode::InvalidTokenAccount)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump, has_one = vault @ ErrorCode::InvalidTokenAccount)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    /// 國庫（owner = admin，token.sh）：挹注由 admin 以 owner 身分簽章轉出
    #[account(mut)]
    pub treasury_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_lock_tournament(ctx: Context<LockTournament>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::REGISTRATION)?;
    require!(now >= t.registration_ends_at, ErrorCode::TournamentTimingViolation);

    // join 已逐筆驗證格式與資金，因此有效人數 = 報名人數
    t.valid_entrant_count = t.entrant_count;
    if t.valid_entrant_count < t.min_entrants {
        t.status = st::CANCELLED;
        emit!(TournamentCancelled { tournament: t.key(), entrant_count: t.entrant_count, min_entrants: t.min_entrants });
        return Ok(());
    }

    let (a, b) = Tournament::group_sizes(t.valid_entrant_count);
    t.group_a_size = a;
    t.group_b_size = b;

    // 國庫挹注：受建立時的上限與國庫實際餘額約束
    let injection = t.treasury_injection_cap.min(ctx.accounts.treasury_vault.amount);
    if injection > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.treasury_vault.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.admin.to_account_info(),
                },
            ),
            injection,
        )?;
    }
    t.treasury_injection = injection;

    // 對帳：vault 實際餘額必須等於帳面（總質押 + 挹注），不得只靠帳面等式（SD 6.2）
    ctx.accounts.vault.reload()?;
    let expected = t.total_staked.checked_add(injection).ok_or(ErrorCode::MathOverflow)?;
    require!(ctx.accounts.vault.amount == expected, ErrorCode::ConservationViolation);

    t.status = st::LOCKED;
    emit!(TournamentLocked {
        tournament: t.key(),
        valid_entrant_count: t.valid_entrant_count,
        group_a_size: a,
        group_b_size: b,
        total_staked: t.total_staked,
        treasury_injection: injection,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct StartTournament<'info> {
    /// 任意 payer（SD 3.2）；不需為 admin
    pub payer: Signer<'info>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump)]
    pub tournament: Account<'info, Tournament>,
}

pub fn handle_start_tournament(ctx: Context<StartTournament>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::LOCKED)?;
    require!(now >= t.starts_at, ErrorCode::TournamentTimingViolation);
    t.status = st::RUNNING;
    emit!(TournamentStarted { tournament: t.key(), at: now });
    Ok(())
}
