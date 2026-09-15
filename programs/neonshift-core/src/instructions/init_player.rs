//! `init_player`（PG-C-03，SD 3.1／3.2）。
//! 由玩家自己簽章並支付 rent；PDA `init` 保證同一錢包只能建立一次。
//! 2026-09-14 定案：**不鑄造 NFT**，初階跑鞋（Lv.1）隨 profile 建立直接贈與，
//! 外觀只由 XP 門檻推導的 `shoe_level` 決定（BR-35）。
//! 不受 pause 影響：建立 profile 不涉及資金流，且 onboarding 不應因暫停發放而中斷。

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::events::PlayerInitialized;
use crate::state::{Config, PlayerProfile};

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    /// 確認程式已初始化；不 mut
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = player,
        space = 8 + PlayerProfile::INIT_SPACE,
        seeds = [PLAYER_SEED, player.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, PlayerProfile>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_player(ctx: Context<InitPlayer>) -> Result<()> {
    let profile = &mut ctx.accounts.profile;
    profile.wallet = ctx.accounts.player.key();
    profile.core_level = PlayerProfile::MIN_LEVEL;
    profile.shoe_level = PlayerProfile::MIN_LEVEL;
    profile.xp = 0;
    profile.last_task_date = 0;
    profile.streak_days = 0;
    profile.max_streak_days = 0;
    profile.claimed_today = 0;
    profile.today_date = 0;
    profile.bump = ctx.bumps.profile;

    emit!(PlayerInitialized { wallet: profile.wallet, profile: profile.key(), shoe_level: profile.shoe_level });
    Ok(())
}
