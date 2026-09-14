//! 結算（PG-C-13～C-16，SD 3.2／6.2）：forfeit_entry → begin_settlement → submit_results_batch ×N
//! → settle_tournament → claim_prize；取消路徑 cancel_tournament → refund_all。
//! 金額計算全部走 `tournament_math`，begin_settlement 的預算與 claim_prize 的逐筆金額同源，
//! settle／claim 皆做資金守恆斷言並以 vault 實際餘額對帳（SD 6.2「不得只用帳面等式」）。

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{tournament_status as st, *};
use crate::error::ErrorCode;
use crate::events::*;
use crate::state::{Config, Tournament, TournamentEntry};
use crate::tournament_math as tm;

fn tournament_signer_seeds(t: &Tournament) -> [Vec<u8>; 3] {
    [TOURNAMENT_SEED.to_vec(), t.week_id.to_le_bytes().to_vec(), vec![t.bump]]
}

fn ranked_count(t: &Tournament) -> Result<u32> {
    t.valid_entrant_count.checked_sub(t.forfeited_count).ok_or_else(|| error!(ErrorCode::MathOverflow))
}

/// 帳面等式（SD 6.2）
fn assert_conservation(t: &Tournament) -> Result<()> {
    let lhs = t.total_staked.checked_add(t.treasury_injection).ok_or(ErrorCode::MathOverflow)?;
    let rhs = t.total_refund.checked_add(t.total_prize).and_then(|x| x.checked_add(t.treasury_remainder)).ok_or(ErrorCode::MathOverflow)?;
    require!(lhs == rhs, ErrorCode::ConservationViolation);
    require!(t.results_submitted == ranked_count(t)?, ErrorCode::ConservationViolation);
    require!(t.distributed <= t.total_refund.checked_add(t.total_prize).ok_or(ErrorCode::MathOverflow)?, ErrorCode::ConservationViolation);
    Ok(())
}

// ---------------------------------------------------------------- forfeit_entry（C-15）

#[derive(Accounts)]
pub struct ForfeitEntry<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut, seeds = [ENTRY_SEED, tournament.key().as_ref(), entry.wallet.as_ref()], bump = entry.bump, has_one = tournament @ ErrorCode::InvalidTournamentState)]
    pub entry: Account<'info, TournamentEntry>,
}

pub fn handle_forfeit_entry(ctx: Context<ForfeitEntry>, evidence_hash: [u8; 32], rules_version: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::RUNNING)?;
    require!(now >= t.ends_at, ErrorCode::TournamentTimingViolation);
    require!(evidence_hash != [0u8; 32], ErrorCode::MissingEvidence);
    require!(rules_version == t.rules_version, ErrorCode::RulesVersionMismatch);
    let e = &mut ctx.accounts.entry;
    require!(!e.forfeited, ErrorCode::EntryForfeited);
    e.forfeited = true;
    e.evidence_hash = evidence_hash;
    t.forfeited_count = t.forfeited_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
    emit!(EntryForfeited { tournament: t.key(), wallet: e.wallet, evidence_hash, rules_version, forfeited_count: t.forfeited_count });
    Ok(())
}

// ---------------------------------------------------------------- begin_settlement／submit_results_batch（C-13）

#[derive(Accounts)]
pub struct AdminSettlement<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump)]
    pub tournament: Account<'info, Tournament>,
}

pub fn handle_begin_settlement(ctx: Context<AdminSettlement>, expected_count: u32, results_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::RUNNING)?;
    require!(now >= t.ends_at, ErrorCode::TournamentTimingViolation);
    let ranked = ranked_count(t)?;
    require!(expected_count == ranked, ErrorCode::InvalidResultBatch);

    let (total_refund, total_prize, remainder, pool) = tm::budget(t, ranked).ok_or(ErrorCode::MathOverflow)?;
    t.total_refund = total_refund;
    t.total_prize = total_prize;
    t.treasury_remainder = remainder;
    t.distributable_pool = pool;
    t.results_hash = results_hash;
    t.results_rolling_hash = [0u8; 32];
    t.results_submitted = 0;
    t.status = st::SETTLING;
    emit!(SettlementBegan { tournament: t.key(), expected_count, results_hash, distributable_pool: pool, total_refund, total_prize, treasury_remainder: remainder });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ResultItem {
    pub wallet: Pubkey,
    pub final_steps: u64,
    /// BR-20 同分決勝依據；只納入 hash 供稽核，不另存
    pub first_reached_at: i64,
}

pub fn handle_submit_results_batch<'info>(ctx: Context<'info, AdminSettlement<'info>>, items: Vec<ResultItem>) -> Result<()> {
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::SETTLING)?;
    require!(!items.is_empty() && items.len() == ctx.remaining_accounts.len(), ErrorCode::InvalidResultBatch);
    let ranked = ranked_count(t)?;
    require!(t.results_submitted as usize + items.len() <= ranked as usize, ErrorCode::InvalidResultBatch);

    let t_key = t.key();
    let t_bytes = t_key.to_bytes();
    let from_rank = t.results_submitted + 1;
    let mut rolling = t.results_rolling_hash;
    for (i, (item, acc)) in items.iter().zip(ctx.remaining_accounts.iter()).enumerate() {
        let rank = from_rank + i as u32;
        let (expected_entry, _) = Pubkey::find_program_address(&[ENTRY_SEED, t_bytes.as_ref(), item.wallet.as_ref()], ctx.program_id);
        require_keys_eq!(*acc.key, expected_entry, ErrorCode::InvalidResultBatch);
        require!(acc.is_writable, ErrorCode::InvalidResultBatch);
        let mut entry: Account<'info, TournamentEntry> = Account::try_from(acc)?;
        require!(entry.tournament == t_key && entry.wallet == item.wallet, ErrorCode::InvalidResultBatch);
        require!(!entry.forfeited, ErrorCode::EntryForfeited);
        require!(entry.rank == 0, ErrorCode::InvalidResultBatch); // 不可重複
        entry.rank = rank;
        entry.group = tm::group_of(t, rank);
        entry.final_steps = item.final_steps;
        entry.exit(ctx.program_id)?;
        rolling = tm::roll(&rolling, &tm::canonical_result(&t_bytes, &item.wallet.to_bytes(), item.final_steps, item.first_reached_at, rank, false));
    }
    t.results_submitted += items.len() as u32;
    t.results_rolling_hash = rolling;
    emit!(ResultsBatchSubmitted { tournament: t_key, from_rank, to_rank: t.results_submitted, rolling_hash: rolling });
    Ok(())
}

// ---------------------------------------------------------------- settle_tournament（C-14）

#[derive(Accounts)]
pub struct SettleTournament<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized, has_one = treasury_vault @ ErrorCode::InvalidTokenAccount)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump, has_one = vault @ ErrorCode::InvalidTokenAccount)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_settle_tournament(ctx: Context<SettleTournament>) -> Result<()> {
    let t = &mut ctx.accounts.tournament;
    t.require_status(st::SETTLING)?;
    require!(t.results_submitted == ranked_count(t)?, ErrorCode::InvalidResultBatch);
    require!(t.results_rolling_hash == t.results_hash, ErrorCode::ResultsHashMismatch);
    assert_conservation(t)?;
    // 對帳：結算前 vault 必須恰好持有 總質押 + 挹注
    let expected = t.total_staked.checked_add(t.treasury_injection).ok_or(ErrorCode::MathOverflow)?;
    require!(ctx.accounts.vault.amount == expected, ErrorCode::ConservationViolation);

    if t.treasury_remainder > 0 {
        let seeds = tournament_signer_seeds(t);
        let seeds_ref: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.treasury_vault.to_account_info(), authority: t.to_account_info() },
                &[&seeds_ref],
            ),
            t.treasury_remainder,
        )?;
    }
    t.status = st::SETTLED;
    emit!(TournamentSettled { tournament: t.key(), results_submitted: t.results_submitted, treasury_remainder: t.treasury_remainder });
    Ok(())
}

// ---------------------------------------------------------------- claim_prize／refund_all（C-14／C-16）

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    pub player: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump, has_one = vault @ ErrorCode::InvalidTokenAccount)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut, seeds = [ENTRY_SEED, tournament.key().as_ref(), player.key().as_ref()], bump = entry.bump, constraint = entry.wallet == player.key() @ ErrorCode::WalletMismatch)]
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
}

fn pay_out<'info>(ctx: &Context<ClaimPrize<'info>>, amount: u64) -> Result<()> {
    let t = &ctx.accounts.tournament;
    let seeds = tournament_signer_seeds(t);
    let seeds_ref: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.player_token_account.to_account_info(), authority: t.to_account_info() },
            &[&seeds_ref],
        ),
        amount,
    )
}

pub fn handle_claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
    // 不受 pause 影響（SD 3.2）
    let t = &ctx.accounts.tournament;
    t.require_status(st::SETTLED)?;
    let e = &ctx.accounts.entry;
    require!(!e.settled, ErrorCode::EntryAlreadySettled);
    require!(!e.forfeited, ErrorCode::EntryForfeited);
    require!(e.rank > 0, ErrorCode::InvalidResultBatch);

    let ranked = ranked_count(t)?;
    let (_, pool_a, pool_b) = tm::pools(t, t.total_refund).ok_or(ErrorCode::MathOverflow)?;
    let refund = tm::refund_for(t, e.rank);
    let prize = tm::prize_for(t, ranked, pool_a, pool_b, e.rank);
    let amount = refund.checked_add(prize).ok_or(ErrorCode::MathOverflow)?;

    {
        let t = &mut ctx.accounts.tournament;
        t.distributed = t.distributed.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        assert_conservation(t)?;
    }
    if amount > 0 {
        pay_out(&ctx, amount)?;
    }
    let e = &mut ctx.accounts.entry;
    e.settled = true;
    emit!(PrizeClaimed { tournament: ctx.accounts.tournament.key(), wallet: e.wallet, rank: e.rank, group: e.group, refund, prize });
    Ok(())
}

pub fn handle_refund_all(ctx: Context<ClaimPrize>) -> Result<()> {
    let t = &ctx.accounts.tournament;
    t.require_status(st::CANCELLED)?;
    let e = &ctx.accounts.entry;
    require!(!e.settled, ErrorCode::EntryAlreadySettled);
    require!(!e.forfeited, ErrorCode::EntryForfeited);
    let amount = e.stake;
    {
        let t = &mut ctx.accounts.tournament;
        t.distributed = t.distributed.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        require!(t.distributed <= t.total_refund, ErrorCode::ConservationViolation);
    }
    pay_out(&ctx, amount)?;
    let e = &mut ctx.accounts.entry;
    e.settled = true;
    emit!(Refunded { tournament: ctx.accounts.tournament.key(), wallet: e.wallet, amount });
    Ok(())
}

// ---------------------------------------------------------------- cancel_tournament（C-16）

#[derive(Accounts)]
pub struct CancelTournament<'info> {
    /// admin 隨時可取消；其他人只能在 ends_at + SETTLEMENT_DEADLINE 後
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury_vault @ ErrorCode::InvalidTokenAccount)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TOURNAMENT_SEED, &tournament.week_id.to_le_bytes()], bump = tournament.bump, has_one = vault @ ErrorCode::InvalidTokenAccount)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Registration／Locked／Running／Settling → Cancelled。挹注與沒收者質押歸庫，其餘由 refund_all 全額退還。
pub fn handle_cancel_tournament(ctx: Context<CancelTournament>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let is_admin = ctx.accounts.signer.key() == ctx.accounts.config.admin;
    let t = &mut ctx.accounts.tournament;
    require!(matches!(t.status, st::REGISTRATION | st::LOCKED | st::RUNNING | st::SETTLING), ErrorCode::InvalidTournamentState);
    if !is_admin {
        require!(now >= t.ends_at.saturating_add(SETTLEMENT_DEADLINE_SECONDS), ErrorCode::TournamentTimingViolation);
    }
    // Registration 狀態 valid_entrant_count 尚未固定
    if t.status == st::REGISTRATION {
        t.valid_entrant_count = t.entrant_count;
    }
    let refundable = (t.valid_entrant_count - t.forfeited_count) as u64 * t.stake_amount;
    let to_treasury = t.total_staked.checked_add(t.treasury_injection).and_then(|x| x.checked_sub(refundable)).ok_or(ErrorCode::MathOverflow)?;
    // 取消後帳面：退款 = 可退質押；獎金 0；餘數 = 挹注 + 沒收質押
    t.total_refund = refundable;
    t.total_prize = 0;
    t.treasury_remainder = to_treasury;
    t.distributable_pool = 0;
    require!(ctx.accounts.vault.amount == t.total_staked.checked_add(t.treasury_injection).ok_or(ErrorCode::MathOverflow)?, ErrorCode::ConservationViolation);
    if to_treasury > 0 {
        let seeds = tournament_signer_seeds(t);
        let seeds_ref: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.treasury_vault.to_account_info(), authority: t.to_account_info() },
                &[&seeds_ref],
            ),
            to_treasury,
        )?;
    }
    t.status = st::CANCELLED;
    emit!(TournamentCancelledLate { tournament: t.key(), by: ctx.accounts.signer.key(), returned_to_treasury: to_treasury });
    Ok(())
}
