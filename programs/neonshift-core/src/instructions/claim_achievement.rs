//! `set_achievement_eligibility`／`claim_achievement`（PG-R-08，activity-running-gallery 7、SD 13／15）。
//!
//! - registry：admin 以 `init_if_needed` 寫入 approved／revoked、source_revision、metadata_hash；鑄造必查最新狀態。
//! - claim：緊鄰前一道 ed25519 指令的 194-byte `NEONSHIFT_ACHIEVEMENT_V1` 訊息由 attestor 簽章；
//!   重建 canonical bytes 逐 byte 比對、時效、wallet、program／cluster，再與 registry 的 revision／metadata_hash 對照，
//!   `AchievementReceipt` PDA `init` 保證每個 achievement_id 只鑄一次，CPI Metaplex Core 鑄到玩家錢包（玩家付 rent）。
//! - 與 `claim_collectible`（固定 kind／每錢包一次）分開，不可把 PB 當 kind 傳入舊指令。

use anchor_lang::prelude::*;
use attestation_core::{AchievementProof, ACHIEVEMENT_LEN};

use crate::attestation::load_signed_message;
use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::{AchievementClaimed, AchievementEligibilitySet};
use crate::mpl_core::{create_v1, CreateV1Accounts, MPL_CORE_ID};
use crate::state::{AchievementEligibility, AchievementReceipt, Config};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetEligibilityParams {
    pub wallet: Pubkey,
    pub achievement_id: [u8; 32],
    pub category: u8,
    pub verification_class: u8,
    pub status: u8,
    pub source_revision: u32,
    pub metadata_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(params: SetEligibilityParams)]
pub struct SetAchievementEligibility<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ ErrorCode::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + AchievementEligibility::INIT_SPACE,
        seeds = [ELIGIBILITY_SEED, params.wallet.as_ref(), &params.achievement_id],
        bump,
    )]
    pub eligibility: Account<'info, AchievementEligibility>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_achievement_eligibility(ctx: Context<SetAchievementEligibility>, params: SetEligibilityParams) -> Result<()> {
    require!(params.status == ELIGIBILITY_APPROVED || params.status == ELIGIBILITY_REVOKED, ErrorCode::AchievementNotApproved);
    require!((1..=6).contains(&params.category) && (1..=2).contains(&params.verification_class), ErrorCode::InvalidCollectibleKind);
    let e = &mut ctx.accounts.eligibility;
    e.wallet = params.wallet;
    e.achievement_id = params.achievement_id;
    e.category = params.category;
    e.verification_class = params.verification_class;
    e.status = params.status;
    e.source_revision = params.source_revision;
    e.metadata_hash = params.metadata_hash;
    e.updated_at = Clock::get()?.unix_timestamp;
    e.bump = ctx.bumps.eligibility;
    emit!(AchievementEligibilitySet { wallet: params.wallet, achievement_id: params.achievement_id, status: params.status, source_revision: params.source_revision });
    Ok(())
}

/// claim 參數：與 194-byte canonical bytes 一一對應
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct AchievementArgs {
    pub version: u8,
    pub program_id: Pubkey,
    pub cluster_id: u8,
    pub wallet: Pubkey,
    pub achievement_id: [u8; 32],
    pub category: u8,
    pub verification_class: u8,
    pub source_revision: u32,
    pub rules_version: u16,
    pub metadata_hash: [u8; 32],
    pub issued_at: i64,
    pub expiry: i64,
    pub nonce: [u8; 16],
}

impl From<&AchievementArgs> for AchievementProof {
    fn from(a: &AchievementArgs) -> Self {
        AchievementProof { version: a.version, program_id: a.program_id.to_bytes(), cluster_id: a.cluster_id, wallet: a.wallet.to_bytes(), achievement_id: a.achievement_id, category: a.category, verification_class: a.verification_class, source_revision: a.source_revision, rules_version: a.rules_version, metadata_hash: a.metadata_hash, issued_at: a.issued_at, expiry: a.expiry, nonce: a.nonce }
    }
}

#[derive(Accounts)]
#[instruction(args: AchievementArgs)]
pub struct ClaimAchievement<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [ELIGIBILITY_SEED, player.key().as_ref(), &args.achievement_id],
        bump = eligibility.bump,
        constraint = eligibility.wallet == player.key() @ ErrorCode::WalletMismatch,
    )]
    pub eligibility: Account<'info, AchievementEligibility>,

    #[account(
        init,
        payer = player,
        space = 8 + AchievementReceipt::INIT_SPACE,
        seeds = [ACHIEVEMENT_SEED, player.key().as_ref(), &args.achievement_id],
        bump,
    )]
    pub receipt: Account<'info, AchievementReceipt>,

    /// CHECK: 新 asset PDA（尚未存在），由 Metaplex Core 建立
    #[account(mut, seeds = [ACHIEVEMENT_ASSET_SEED, player.key().as_ref(), &args.achievement_id], bump)]
    pub asset: UncheckedAccount<'info>,

    /// CHECK: Metaplex Core program
    #[account(address = MPL_CORE_ID @ ErrorCode::InvalidTokenAccount)]
    pub mpl_core_program: UncheckedAccount<'info>,

    /// CHECK: Instructions sysvar（address 約束）
    #[account(address = solana_sdk_ids::sysvar::instructions::ID @ ErrorCode::MissingEd25519Instruction)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn achievement_metadata(category: u8, verification_class: u8, achievement_id: &[u8; 32]) -> (String, String) {
    let cat = match category {
        1 => "Fastest 1K",
        2 => "Fastest 5K",
        3 => "Fastest 10K",
        4 => "Fastest Half Marathon",
        5 => "Fastest Marathon",
        _ => "Longest Run",
    };
    let cls = if verification_class == 1 { "Official" } else { "Device" };
    let mut hex = String::with_capacity(64);
    for b in achievement_id {
        hex.push_str(&format!("{b:02x}"));
    }
    (format!("NeonShift PB · {cat} ({cls})"), format!("{ACHIEVEMENT_BASE_URI}{hex}.json"))
}

pub fn handle_claim_achievement(ctx: Context<ClaimAchievement>, args: AchievementArgs) -> Result<()> {
    ctx.accounts.config.require_active()?;
    let now = Clock::get()?.unix_timestamp;
    // 1. 簽章訊息（attestor 公鑰、含寬限期）
    let message = load_signed_message(&ctx.accounts.instructions_sysvar.to_account_info(), &ctx.accounts.config, now, ACHIEVEMENT_LEN)?;
    // 2. canonical bytes 逐 byte 比對
    let expected = AchievementProof::from(&args);
    require!(message.as_slice() == expected.encode(), ErrorCode::AchievementProofMismatch);
    let proof = AchievementProof::decode(&message).map_err(|_| error!(ErrorCode::AchievementProofMismatch))?;
    // 3. program／cluster／wallet 綁定
    require!(proof.program_id == crate::ID.to_bytes() && proof.cluster_id == ctx.accounts.config.cluster_id, ErrorCode::WrongProgramOrCluster);
    require!(proof.wallet == ctx.accounts.player.key().to_bytes(), ErrorCode::WalletMismatch);
    // 4. 時效
    proof.validate().map_err(|_| error!(ErrorCode::AchievementProofExpired))?;
    require!(proof.is_valid_at(now), ErrorCode::AchievementProofExpired);
    // 5. registry：approved 且 revision／metadata_hash／category／class 一致（處理「簽出後被修正」競態）
    let e = &ctx.accounts.eligibility;
    require!(e.status == ELIGIBILITY_APPROVED, ErrorCode::AchievementNotApproved);
    require!(e.source_revision == proof.source_revision && e.metadata_hash == proof.metadata_hash && e.category == proof.category && e.verification_class == proof.verification_class, ErrorCode::AchievementRegistryMismatch);

    // 6. 鑄造（asset PDA、玩家付 rent）
    let (name, uri) = achievement_metadata(proof.category, proof.verification_class, &proof.achievement_id);
    let player_key = ctx.accounts.player.key();
    let asset_seeds: &[&[u8]] = &[ACHIEVEMENT_ASSET_SEED, player_key.as_ref(), &proof.achievement_id, &[ctx.bumps.asset]];
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
        &[asset_seeds],
    )?;

    let r = &mut ctx.accounts.receipt;
    r.wallet = player_key;
    r.achievement_id = proof.achievement_id;
    r.category = proof.category;
    r.verification_class = proof.verification_class;
    r.source_revision = proof.source_revision;
    r.asset = ctx.accounts.asset.key();
    r.claimed_at = now;
    r.bump = ctx.bumps.receipt;
    emit!(AchievementClaimed { wallet: player_key, achievement_id: proof.achievement_id, category: proof.category, verification_class: proof.verification_class, source_revision: proof.source_revision, asset: r.asset });
    Ok(())
}
