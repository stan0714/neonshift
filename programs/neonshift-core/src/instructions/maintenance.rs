//! PG-V-02：`migrate_player`（舊帳戶補欄位）與 `settle_player_epochs`（bounded、冪等、單調 cursor）。
//! 結算邏輯集中在 `settle_pending`，`clock_in` 期末順帶結算也呼叫它（shoe-gameplay 7）。

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_lang::Discriminator;

use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::{EpochSettled, IncidentFreezeSet, PlayerMigrated};
use crate::maintenance::{epoch_index, settle_one, xp_cap_level};
use crate::state::{Config, IncidentFreeze, PlayerProfile};

/// 追到目前期：逐期結算（缺席期 points 0），最多 `max` 期；回傳結算期數。呼叫端決定是否要求追平。
/// `freeze`：PG-V-05 全域凍結；與該期重疊 → 不降不升（只重置期內累計），事件標 `frozen`。
pub fn settle_pending(profile: &mut PlayerProfile, config: &Config, freeze: Option<&IncidentFreeze>, wallet: Pubkey, now: i64, max: u32) -> Result<u32> {
    let today = u32::try_from(now.div_euclid(SECONDS_PER_DAY)).map_err(|_| ErrorCode::InvalidTaskDate)?;
    let current = epoch_index(profile.epoch_anchor, today);
    let mut settled = 0u32;
    while profile.last_settled_epoch < current && settled < max {
        let epoch = profile.last_settled_epoch;
        let points = profile.epoch_points;
        let active_days = profile.epoch_bitmap.count_ones() as u8;
        let before = profile.core_level;
        let epoch_start = (profile.epoch_anchor as i64 + epoch as i64 * EPOCH_DAYS as i64) * SECONDS_PER_DAY;
        let epoch_end = epoch_start + EPOCH_DAYS as i64 * SECONDS_PER_DAY;
        let frozen = freeze.map(|f| f.covers(epoch_start, epoch_end)).unwrap_or(false);
        let (after, highest) = if frozen {
            (before, profile.highest_level)
        } else {
            settle_one(before, profile.highest_level, xp_cap_level(profile.xp, &config.shoe_xp_thresholds), points, active_days)
        };
        profile.core_level = after;
        profile.shoe_level = after;
        profile.highest_level = highest;
        profile.epoch_points = 0;
        profile.epoch_bitmap = 0;
        profile.last_settled_epoch = epoch.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
        settled += 1;
        emit!(EpochSettled { wallet, epoch, points, active_days, level_before: before, level_after: after, highest_level: highest, rules_version: profile.maintenance_rules_version, settled_at: now, frozen });
    }
    Ok(settled)
}

pub fn is_settled(profile: &PlayerProfile, now: i64) -> Result<bool> {
    let today = u32::try_from(now.div_euclid(SECONDS_PER_DAY)).map_err(|_| ErrorCode::InvalidTaskDate)?;
    Ok(profile.last_settled_epoch >= epoch_index(profile.epoch_anchor, today))
}

#[derive(Accounts)]
pub struct SettlePlayerEpochs<'info> {
    /// 任何 payer（只付交易費；帳戶已存在不需 rent）
    pub payer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [PLAYER_SEED, profile.wallet.as_ref()], bump = profile.bump)]
    pub profile: Account<'info, PlayerProfile>,

    /// PG-V-05：全域凍結（未設定時傳 program id 表示 None）
    #[account(seeds = [FREEZE_SEED], bump = freeze.bump)]
    pub freeze: Option<Account<'info, IncidentFreeze>>,
}

pub fn handle_settle_player_epochs(ctx: Context<SettlePlayerEpochs>, max_epochs: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let max = (max_epochs.min(MAX_BATCH_SETTLE_EPOCHS).max(1)) as u32;
    let wallet = ctx.accounts.profile.wallet;
    let freeze = ctx.accounts.freeze.as_deref();
    settle_pending(&mut ctx.accounts.profile, &ctx.accounts.config, freeze, wallet, now, max)?;
    Ok(())
}

#[derive(Accounts)]
pub struct SetIncidentFreeze<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = admin, space = 8 + IncidentFreeze::INIT_SPACE, seeds = [FREEZE_SEED], bump)]
    pub freeze: Account<'info, IncidentFreeze>,
    pub system_program: Program<'info, System>,
}

/// 視窗檢查：end > start、最長 28 天、start ≥ now − 7 天（不回寫更早已結束的週期）；(0, 0) 清除
pub fn handle_set_incident_freeze(ctx: Context<SetIncidentFreeze>, start: i64, end: i64, reason_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    if !(start == 0 && end == 0) {
        require!(end > start && end - start <= MAX_FREEZE_SECONDS && start >= now - MAX_FREEZE_BACKDATE_SECONDS, ErrorCode::InvalidFreezeWindow);
    }
    let f = &mut ctx.accounts.freeze;
    f.start = start;
    f.end = end;
    f.set_at = now;
    f.reason_hash = reason_hash;
    f.bump = ctx.bumps.freeze;
    emit!(IncidentFreezeSet { admin: ctx.accounts.admin.key(), start, end, reason_hash, set_at: now });
    Ok(())
}

#[derive(Accounts)]
pub struct MigratePlayer<'info> {
    /// 任何 payer 付 rent 差額
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: 舊版 PlayerProfile（長度 8＋V1_SPACE）；手動驗 owner／discriminator／seeds 後 realloc
    #[account(mut)]
    pub profile: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_migrate_player(ctx: Context<MigratePlayer>) -> Result<()> {
    let info = ctx.accounts.profile.to_account_info();
    require_keys_eq!(*info.owner, crate::ID, ErrorCode::InvalidProfileAccount);
    let old_len = 8 + PlayerProfile::V1_SPACE;
    let new_len = 8 + PlayerProfile::INIT_SPACE;
    {
        let data = info.try_borrow_data()?;
        require!(data.len() >= 8 && &data[..8] == PlayerProfile::DISCRIMINATOR, ErrorCode::InvalidProfileAccount);
        require!(data.len() < new_len, ErrorCode::AlreadyMigrated);
        require!(data.len() == old_len, ErrorCode::InvalidProfileAccount);
    }
    // 讀舊欄位（borsh 前 63 bytes）
    let (wallet, core_level, shoe_level, xp, last_task_date, streak_days, max_streak_days, claimed_today, today_date, bump) = {
        let data = info.try_borrow_data()?;
        let b = &data[8..];
        let wallet = Pubkey::new_from_array(b[0..32].try_into().unwrap());
        (
            wallet,
            b[32],
            b[33],
            u64::from_le_bytes(b[34..42].try_into().unwrap()),
            u32::from_le_bytes(b[42..46].try_into().unwrap()),
            u16::from_le_bytes(b[46..48].try_into().unwrap()),
            u16::from_le_bytes(b[48..50].try_into().unwrap()),
            u64::from_le_bytes(b[50..58].try_into().unwrap()),
            u32::from_le_bytes(b[58..62].try_into().unwrap()),
            b[62],
        )
    };
    let (expected, _) = Pubkey::find_program_address(&[PLAYER_SEED, wallet.as_ref()], &crate::ID);
    require_keys_eq!(info.key(), expected, ErrorCode::InvalidProfileAccount);

    // rent 差額由 payer 補足，再 realloc（不清零新區段之外的舊資料）
    let required = Rent::get()?.minimum_balance(new_len);
    let diff = required.saturating_sub(info.lamports());
    if diff > 0 {
        invoke(
            &system_instruction::transfer(&ctx.accounts.payer.key(), &info.key(), diff),
            &[ctx.accounts.payer.to_account_info(), info.clone(), ctx.accounts.system_program.to_account_info()],
        )?;
    }
    info.resize(new_len)?;

    let now = Clock::get()?.unix_timestamp;
    let today = u32::try_from(now.div_euclid(SECONDS_PER_DAY)).map_err(|_| ErrorCode::InvalidTaskDate)?;
    let active = core_level.max(shoe_level).clamp(PlayerProfile::MIN_LEVEL, PlayerProfile::MAX_LEVEL);
    let profile = PlayerProfile {
        wallet,
        core_level: active,
        shoe_level: active,
        xp,
        last_task_date,
        streak_days,
        max_streak_days,
        claimed_today,
        today_date,
        bump,
        highest_level: active,
        epoch_anchor: today,
        last_settled_epoch: 0,
        epoch_points: 0,
        epoch_bitmap: 0,
        maintenance_rules_version: MAINTENANCE_RULES_VERSION,
    };
    {
        let mut data = info.try_borrow_mut_data()?;
        let mut cursor = &mut data[8..];
        profile.serialize(&mut cursor)?;
    }
    emit!(PlayerMigrated { wallet, epoch_anchor: today, active_level: active, highest_level: active, rules_version: MAINTENANCE_RULES_VERSION });
    Ok(())
}
