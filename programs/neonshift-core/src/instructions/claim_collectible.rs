//! `claim_collectible`（PG-C-09，FR-04.6、SD 3.2／11A）：達成等級／里程碑後免費領取成就 NFT。
//! 資格以鏈上 PlayerProfile 驗證；`CollectibleReceipt` PDA `init` 保證每種一枚；
//! CPI Metaplex Core `CreateV1` 鑄造到玩家錢包（玩家付 rent，不收 tSKR）；受 pause 影響。

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::CollectibleClaimed;
use crate::mpl_core::{create_v1, CreateV1Accounts, MPL_CORE_ID};
use crate::state::{CollectibleReceipt, Config, PlayerProfile};

#[derive(Accounts)]
#[instruction(kind: u8)]
pub struct ClaimCollectible<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(seeds = [PLAYER_SEED, player.key().as_ref()], bump = profile.bump, constraint = profile.wallet == player.key() @ ErrorCode::WalletMismatch)]
    pub profile: Account<'info, PlayerProfile>,

    #[account(
        init,
        payer = player,
        space = 8 + CollectibleReceipt::INIT_SPACE,
        seeds = [COLLECTIBLE_SEED, player.key().as_ref(), &[kind]],
        bump,
    )]
    pub receipt: Account<'info, CollectibleReceipt>,

    /// CHECK: 新 asset keypair，由 Metaplex Core 初始化
    #[account(mut)]
    pub asset: Signer<'info>,

    /// CHECK: Metaplex Core program
    #[account(address = MPL_CORE_ID @ ErrorCode::InvalidTokenAccount)]
    pub mpl_core_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// 名稱與 metadata URI（SD 11A：`<base>/<kind>.json`）
pub fn collectible_metadata(kind: u8) -> Option<(String, String)> {
    let name = match kind {
        1 => "NeonShift Shoe · Origin".to_string(),
        2 => "NeonShift Shoe · Pulse".to_string(),
        3 => "NeonShift Shoe · Surge".to_string(),
        4 => "NeonShift Shoe · Apex".to_string(),
        5 => "NeonShift Shoe · Zenith".to_string(),
        COLLECTIBLE_FIRST_CLAIM => "NeonShift Badge · First Clock-In".to_string(),
        COLLECTIBLE_STREAK_7 => "NeonShift Badge · 7-Day Streak".to_string(),
        k if (COLLECTIBLE_TOURNAMENT_RANK_BASE + 1..=COLLECTIBLE_TOURNAMENT_RANK_BASE + 9).contains(&k) => {
            format!("NeonShift Badge · Arena #{}", k - COLLECTIBLE_TOURNAMENT_RANK_BASE)
        }
        _ => return None,
    };
    Some((name, format!("{COLLECTIBLE_BASE_URI}{kind}.json")))
}

/// 資格（SD 3.2）：跑鞋 kind ≤ shoe_level；首次打卡 xp > 0；連續 7 天 max_streak_days ≥ 7；
/// 錦標賽名次待 C-14（TournamentEntry）接入，目前一律不合格。
pub fn eligible(profile: &PlayerProfile, kind: u8) -> bool {
    match kind {
        COLLECTIBLE_SHOE_LV1..=COLLECTIBLE_SHOE_LV5 => profile.shoe_level >= kind,
        COLLECTIBLE_FIRST_CLAIM => profile.xp > 0,
        COLLECTIBLE_STREAK_7 => profile.max_streak_days >= 7,
        _ => false,
    }
}

pub fn handle_claim_collectible(ctx: Context<ClaimCollectible>, kind: u8) -> Result<()> {
    ctx.accounts.config.require_active()?;
    let (name, uri) = collectible_metadata(kind).ok_or(ErrorCode::InvalidCollectibleKind)?;
    require!(eligible(&ctx.accounts.profile, kind), ErrorCode::CollectibleNotEligible);

    create_v1(
        CreateV1Accounts {
            mpl_core_program: &ctx.accounts.mpl_core_program.to_account_info(),
            asset: &ctx.accounts.asset.to_account_info(),
            payer: &ctx.accounts.player.to_account_info(),
            owner: &ctx.accounts.player.to_account_info(),
            update_authority: &ctx.accounts.config.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
        },
        &name,
        &uri,
    )?;

    let receipt = &mut ctx.accounts.receipt;
    receipt.wallet = ctx.accounts.player.key();
    receipt.kind = kind;
    receipt.asset = ctx.accounts.asset.key();
    receipt.claimed_at = Clock::get()?.unix_timestamp;
    receipt.bump = ctx.bumps.receipt;

    emit!(CollectibleClaimed { wallet: receipt.wallet, kind, asset: receipt.asset });
    Ok(())
}
