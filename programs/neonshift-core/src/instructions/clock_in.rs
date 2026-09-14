//! `clock_in`（PG-C-05，SD 3.3【定案】16 步）。
//!
//! 順序註解對照 SD 3.3。Anchor 在進入 handler 前先完成帳戶層檢查（步驟 9 的 mint／owner／
//! PDA seeds／token program 約束）；其餘步驟在 handler 內依序執行。`ClaimReceipt` 刻意不用
//! `init`，改在步驟 10 手動建立，讓「已領取」以 6009 明確回報而不是 system program 的
//! 一般錯誤，並保證它排在 attestation 驗證之後。

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_lang::Discriminator;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::attestation::{verify_attestation, AttestationArgs};
use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::ClockedIn;
use crate::reward::{capped_reward, effective_streak_days, raw_reward, shoe_level_for, xp_for};
use crate::state::{ClaimReceipt, Config, PlayerProfile};

#[derive(Accounts)]
#[instruction(args: AttestationArgs)]
pub struct ClockIn<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, player.key().as_ref()],
        bump = profile.bump,
        constraint = profile.wallet == player.key() @ ErrorCode::WalletMismatch,
    )]
    pub profile: Account<'info, PlayerProfile>,

    /// CHECK: PDA `["claim", wallet, task_date_le, task_type]`；在步驟 10 驗證 seeds 並手動建立
    #[account(mut)]
    pub receipt: UncheckedAccount<'info>,

    // ---- 步驟 9：token 相關帳戶全部對照 Config ----
    #[account(address = config.mint @ ErrorCode::InvalidTokenAccount)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        address = config.reward_vault @ ErrorCode::InvalidTokenAccount,
        constraint = reward_vault.mint == config.mint @ ErrorCode::InvalidTokenAccount,
        constraint = reward_vault.owner == config.key() @ ErrorCode::InvalidTokenAccount,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = player_token_account.mint == config.mint @ ErrorCode::InvalidTokenAccount,
        constraint = player_token_account.owner == player.key() @ ErrorCode::InvalidTokenAccount,
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// CHECK: 必須是 instructions sysvar，供步驟 2 讀取前一道指令
    #[account(address = solana_sdk_ids::sysvar::instructions::ID @ ErrorCode::MissingEd25519Instruction)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handle_clock_in(ctx: Context<ClockIn>, args: AttestationArgs) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let config = &ctx.accounts.config;
    let player_key = ctx.accounts.player.key();

    // 1. Config 未暫停
    config.require_active()?;

    // 未鑄鞋拒絕（SD 10 待定項，本實作定案：打卡需先完成 onboarding 鑄造）
    require!(ctx.accounts.profile.has_shoe(), ErrorCode::ShoeNotMinted);

    // 2～7. ed25519 前置指令、attestor 公鑰、canonical bytes、program／cluster、wallet、時效
    let att = verify_attestation(&ctx.accounts.instructions_sysvar, config, &player_key, &args, now)?;

    // 8. task_date 必須等於鏈上目前 UTC 日序
    let current_task_date = u32::try_from(now.div_euclid(SECONDS_PER_DAY)).map_err(|_| ErrorCode::InvalidTaskDate)?;
    require!(att.task_date == current_task_date, ErrorCode::InvalidTaskDate);

    // 9. token 帳戶檢查已由 Anchor 約束完成（見 struct）

    // 10. 建立 ClaimReceipt；已存在則 6009
    let task_date_le = att.task_date.to_le_bytes();
    let task_type_bytes = [att.task_type];
    let (receipt_key, receipt_bump) = Pubkey::find_program_address(
        &[CLAIM_SEED, player_key.as_ref(), &task_date_le, &task_type_bytes],
        &crate::ID,
    );
    require_keys_eq!(ctx.accounts.receipt.key(), receipt_key, ErrorCode::InvalidTokenAccount);
    let receipt_info = ctx.accounts.receipt.to_account_info();
    require!(
        receipt_info.lamports() == 0 && receipt_info.data_is_empty() && receipt_info.owner == &System::id(),
        ErrorCode::AlreadyClaimed
    );
    let space = 8 + ClaimReceipt::INIT_SPACE;
    let lamports = Rent::get()?.minimum_balance(space);
    invoke_signed(
        &system_instruction::create_account(&player_key, &receipt_key, lamports, space as u64, &crate::ID),
        &[
            ctx.accounts.player.to_account_info(),
            receipt_info.clone(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&[CLAIM_SEED, player_key.as_ref(), &task_date_le, &task_type_bytes, &[receipt_bump]]],
    )?;

    // 11. 日額狀態：日序前進則歸零；倒退視為狀態錯誤
    let profile = &mut ctx.accounts.profile;
    if profile.today_date < att.task_date {
        profile.today_date = att.task_date;
        profile.claimed_today = 0;
    } else if profile.today_date > att.task_date {
        return Err(error!(ErrorCode::InvalidTaskDate));
    }

    // 12. 依 core_level 倍率與 streak 計算，再以剩餘日額收斂（BR-02／BR-04／BR-06）
    let streak_days = effective_streak_days(profile, att.task_date)?;
    let raw = raw_reward(config, profile.core_level, att.task_type, streak_days)?;
    let amount = capped_reward(raw, config.daily_cap, profile.claimed_today);

    // 13. 額度用盡
    require!(amount > 0, ErrorCode::DailyCapReached);

    // 14. 由 reward vault（Config PDA 為 authority）轉出，更新 claimed_today／xp／streak
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[config.bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.reward_vault.to_account_info(),
                to: ctx.accounts.player_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[config_seeds],
        ),
        amount,
    )?;
    let profile = &mut ctx.accounts.profile;
    profile.claimed_today = profile.claimed_today.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
    profile.xp = profile.xp.checked_add(xp_for(att.task_type)?).ok_or(ErrorCode::MathOverflow)?;
    if profile.last_task_date < att.task_date {
        profile.streak_days = streak_days;
        profile.last_task_date = att.task_date;
    }

    // 15. 依 XP 門檻更新 shoe_level；不動 core_level（BR-23）
    profile.shoe_level = shoe_level_for(profile.xp, &config.shoe_xp_thresholds);

    // 寫入 receipt 內容（帳戶已於步驟 10 建立）
    {
        let mut data = receipt_info.try_borrow_mut_data()?;
        let receipt = ClaimReceipt {
            wallet: player_key,
            task_date: att.task_date,
            task_type: att.task_type,
            amount,
            nonce: att.nonce,
            claimed_at: now,
            bump: receipt_bump,
        };
        data[..8].copy_from_slice(ClaimReceipt::DISCRIMINATOR);
        let mut cursor = &mut data[8..];
        receipt.serialize(&mut cursor)?;
    }

    // 16. 事件
    emit!(ClockedIn {
        wallet: player_key,
        task_date: att.task_date,
        task_type: att.task_type,
        amount,
        xp: profile.xp,
        shoe_level: profile.shoe_level,
        core_level: profile.core_level,
        streak_days: profile.streak_days,
        nonce: att.nonce,
    });
    Ok(())
}
