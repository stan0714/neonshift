//! `set_achievement_eligibility`／`claim_achievement`（PG-R-08，activity-running-gallery 7、SD 13／15）。
//!
//! - registry：admin 以 `init_if_needed` 寫入 approved／revoked、source_revision、metadata_hash；鑄造必查最新狀態。
//! - claim：緊鄰前一道 ed25519 指令的 194-byte `NEONSHIFT_ACHIEVEMENT_V1` 訊息由 attestor 簽章；
//!   重建 canonical bytes 逐 byte 比對、時效、wallet、program／cluster，再與 registry 的 revision／metadata_hash 對照，
//!   `AchievementReceipt` PDA `init` 保證每個 achievement_id 只鑄一次，CPI Metaplex Core 鑄到玩家錢包（玩家付 rent）。
//! - 與 `claim_collectible`（固定 kind／每錢包一次）分開，不可把 PB 當 kind 傳入舊指令。

use anchor_lang::prelude::*;
use attestation_core::{AchievementProof, ACHIEVEMENT_LEN, CATEGORY_MAX};

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
    require!((1..=CATEGORY_MAX).contains(&params.category) && (1..=2).contains(&params.verification_class), ErrorCode::InvalidCollectibleKind);
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

/// 鏈上名稱與 metadata URI。
///
/// URI 一律是 `{BASE_URI}{achievement_id}.json`——**每一枚都有自己的 metadata**，
/// 所以主題、年份、規則／美術版本這類會逐屆變動的東西放在鏈下那份 JSON，不需要為它們
/// 各開一個 category（PG-SEASON-04 的決定；見 attestation_core::CATEGORY_SEASONAL）。
///
/// 名稱依系列分前綴：PB 用 `NeonShift PB · …`，其餘系列用自己的名字。
/// **2026-09-27 修正**：原本只列 1..=5，其餘（含 7..=13 的里程碑與活動留念章）全部落到
/// `_ => "Longest Run"`，也就是首次 5K 的收藏會被命名成「NeonShift PB · Longest Run」。
/// 名稱寫進鏈上、之後改不了，所以這是必須修的錯誤標示，不只是文案問題。
/// 已鑄造的資產保留當時的名稱（鏈上不可改），這裡只影響之後鑄造的。
pub fn achievement_metadata(category: u8, verification_class: u8, achievement_id: &[u8; 32]) -> (String, String) {
    let cls = if verification_class == 1 { "Official" } else { "Device" };
    let name = match category {
        1 => format!("NeonShift PB · Fastest 1K ({cls})"),
        2 => format!("NeonShift PB · Fastest 5K ({cls})"),
        3 => format!("NeonShift PB · Fastest 10K ({cls})"),
        4 => format!("NeonShift PB · Fastest Half Marathon ({cls})"),
        5 => format!("NeonShift PB · Fastest Marathon ({cls})"),
        6 => format!("NeonShift PB · Longest Run ({cls})"),
        7 => format!("NeonShift First · 5K ({cls})"),
        8 => format!("NeonShift First · 10K ({cls})"),
        9 => format!("NeonShift First · Half Marathon ({cls})"),
        10 => format!("NeonShift First · Marathon ({cls})"),
        11 => format!("NeonShift First · Race Finish ({cls})"),
        12 => format!("NeonShift Event · Check-In ({cls})"),
        13 => format!("NeonShift Event · Finish ({cls})"),
        // 節日收藏：整個系列同一個名稱，主題與年份在鏈下 metadata（PG-SEASON-04）
        _ => format!("NeonShift Seasonal Footprints ({cls})"),
    };
    let mut hex = String::with_capacity(64);
    for b in achievement_id {
        hex.push_str(&format!("{b:02x}"));
    }
    (name, format!("{ACHIEVEMENT_BASE_URI}{hex}.json"))
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
