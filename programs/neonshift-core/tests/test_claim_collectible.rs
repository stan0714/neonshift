//! PG-C-09：`claim_collectible` — 免費成就 NFT（Metaplex Core CreateV1 CPI）。
//! Metaplex Core 程式以 devnet dump（tests/fixtures/mpl_core.so）載入 LiteSVM。

mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_program, InstructionData, ToAccountMetas},
    common::*,
    neonshift_core::{instruction as ix, mpl_core::MPL_CORE_ID, CollectibleReceipt, PlayerProfile},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const MPL_CORE_SO: &[u8] = include_bytes!("fixtures/mpl_core.so");

struct World {
    env: Env,
    init: Initialized,
    attestor: ed25519_dalek::SigningKey,
    player: Player,
}

fn world() -> World {
    let mut env = setup();
    env.svm.add_program(MPL_CORE_ID, MPL_CORE_SO).unwrap();
    set_time(&mut env.svm, T0);
    let attestor = new_attestor();
    let init = initialize_with(&mut env, attestor_pubkey(&attestor), |_| {});
    mint_to(&mut env, &init.tokens.mint, &init.tokens.reward_vault, 1_000_000 * TSKR_UNIT);
    let player = ready_player(&mut env, &init);
    World { env, init, attestor, player }
}

fn receipt_pda(wallet: &Pubkey, kind: u8) -> Pubkey {
    Pubkey::find_program_address(&[COLLECTIBLE_SEED, wallet.as_ref(), &[kind]], &neonshift_core::id()).0
}

fn asset_pda(wallet: &Pubkey, kind: u8) -> Pubkey {
    Pubkey::find_program_address(&[ASSET_SEED, wallet.as_ref(), &[kind]], &neonshift_core::id()).0
}

impl World {
    fn wallet(&self) -> Pubkey {
        self.player.key.pubkey()
    }
    fn profile(&self) -> PlayerProfile {
        read(&self.env.svm, &player_pda(&self.wallet()).0)
    }
    /// 直接改寫 profile（測試用：模擬達成條件）
    fn patch_profile(&mut self, f: impl FnOnce(&mut PlayerProfile)) {
        use anchor_lang::AccountSerialize;
        let key = player_pda(&self.wallet()).0;
        let mut acc = self.env.svm.get_account(&key).unwrap();
        let mut p: PlayerProfile = read(&self.env.svm, &key);
        f(&mut p);
        let mut data = Vec::new();
        p.try_serialize(&mut data).unwrap();
        acc.data[..data.len()].copy_from_slice(&data);
        self.env.svm.set_account(key, acc).unwrap();
    }
    fn claim(&mut self, kind: u8) -> (litesvm::types::TransactionResult, Pubkey) {
        let wallet = self.wallet();
        let asset = asset_pda(&wallet, kind);
        let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::ClaimCollectible { kind }.data(),
            neonshift_core::accounts::ClaimCollectible {
                player: wallet,
                config: config_pda().0,
                profile: player_pda(&wallet).0,
                receipt: receipt_pda(&wallet, kind),
                asset,
                mpl_core_program: MPL_CORE_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let player = self.player.key.insecure_clone();
        // asset 為 PDA 後同一 kind 的重試交易位元組完全相同；換 blockhash 避免 LiteSVM AlreadyProcessed 去重
        self.env.svm.expire_blockhash();
        (send(&mut self.env.svm, &[ix], &player, &[]), asset)
    }
    fn clock_in_steps(&mut self) {
        let args = valid_args(&self.env.svm, &self.wallet(), 1);
        let ixs = [ed25519_ix(&self.attestor, &canonical(&args)), clock_in_ix(&self.wallet(), &self.player.accts, args)];
        let player = self.player.key.insecure_clone();
        send(&mut self.env.svm, &ixs, &player, &[]).unwrap();
    }
}

/// Metaplex Core AssetV1 佈局：key u8(1=AssetV1) | owner Pubkey | update_authority enum(u8 tag + payload) | name String | uri String
fn assert_asset(svm: &litesvm::LiteSVM, asset: &Pubkey, owner: &Pubkey, update_authority: &Pubkey, name: &str, uri: &str) {
    let acc = svm.get_account(asset).expect("asset account");
    assert_eq!(acc.owner, MPL_CORE_ID);
    let d = &acc.data;
    assert_eq!(d[0], 1, "Key::AssetV1");
    assert_eq!(&d[1..33], owner.as_ref());
    assert_eq!(d[33], 1, "UpdateAuthority::Address");
    assert_eq!(&d[34..66], update_authority.as_ref());
    let name_len = u32::from_le_bytes(d[66..70].try_into().unwrap()) as usize;
    assert_eq!(&d[70..70 + name_len], name.as_bytes());
    let o = 70 + name_len;
    let uri_len = u32::from_le_bytes(d[o..o + 4].try_into().unwrap()) as usize;
    assert_eq!(&d[o + 4..o + 4 + uri_len], uri.as_bytes());
}

#[test]
fn claims_starter_shoe_lv1_for_free_except_rent() {
    let mut w = world();
    let before = w.env.svm.get_balance(&w.wallet()).unwrap();
    let (res, asset) = w.claim(1);
    res.unwrap();
    assert_asset(&w.env.svm, &asset, &w.wallet(), &config_pda().0, "NeonShift Shoe · Origin", "https://neonshift.cc/nft/1.json");
    let r: CollectibleReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), 1));
    assert_eq!(r.wallet, w.wallet());
    assert_eq!(r.kind, 1);
    assert_eq!(r.asset, asset);
    assert_eq!(r.claimed_at, T0);
    // 只付 rent（asset + receipt）＋手續費，遠低於 0.01 SOL；tSKR 餘額不變
    let spent = before - w.env.svm.get_balance(&w.wallet()).unwrap();
    assert!(spent < 10_000_000, "spent {spent}");
    assert_eq!(token_balance(&w.env.svm, &w.player.accts.player_token_account), 0);
}

#[test]
fn rejects_second_claim_of_same_kind() {
    let mut w = world();
    w.claim(1).0.unwrap();
    let (res, _) = w.claim(1);
    // receipt PDA 已存在：system program 的 AccountAlreadyInUse（custom 0），非 Anchor 自訂碼
    assert!(res.is_err(), "receipt PDA already exists");
    assert_eq!(custom_error(&res), Some(0));
}

#[test]
fn shoe_tiers_require_shoe_level() {
    let mut w = world();
    let (res, _) = w.claim(2);
    assert_eq!(custom_error(&res), Some(6029));
    w.patch_profile(|p| p.shoe_level = 3);
    w.claim(2).0.unwrap();
    w.claim(3).0.unwrap();
    assert_eq!(custom_error(&w.claim(4).0), Some(6029));
}

#[test]
fn first_clock_in_badge_after_first_clock_in() {
    let mut w = world();
    assert_eq!(custom_error(&w.claim(101).0), Some(6029));
    w.clock_in_steps();
    assert!(w.profile().xp > 0);
    let (res, asset) = w.claim(101);
    res.unwrap();
    assert_asset(&w.env.svm, &asset, &w.wallet(), &config_pda().0, "NeonShift Badge · First Clock-In", "https://neonshift.cc/nft/101.json");
}

#[test]
fn streak_badge_uses_max_streak_days() {
    let mut w = world();
    w.patch_profile(|p| {
        p.streak_days = 2;
        p.max_streak_days = 6;
    });
    assert_eq!(custom_error(&w.claim(102).0), Some(6029));
    // 曾達 7 天、現在斷掉也可領
    w.patch_profile(|p| {
        p.streak_days = 1;
        p.max_streak_days = 7;
    });
    let (res, asset) = w.claim(102);
    res.unwrap();
    assert_asset(&w.env.svm, &asset, &w.wallet(), &config_pda().0, "NeonShift Badge · 7-Day Streak", "https://neonshift.cc/nft/102.json");
}

#[test]
fn clock_in_tracks_max_streak_days() {
    let mut w = world();
    w.clock_in_steps();
    assert_eq!(w.profile().max_streak_days, 1);
    set_time(&mut w.env.svm, T0 + SECONDS_PER_DAY);
    w.clock_in_steps();
    assert_eq!(w.profile().max_streak_days, 2);
    // 斷 3 天後 streak 歸 1，max 保持 2
    set_time(&mut w.env.svm, T0 + 5 * SECONDS_PER_DAY);
    w.clock_in_steps();
    let p = w.profile();
    assert_eq!(p.streak_days, 1);
    assert_eq!(p.max_streak_days, 2);
}

#[test]
fn tournament_ranks_not_claimable_before_tournaments_exist() {
    let mut w = world();
    assert_eq!(custom_error(&w.claim(111).0), Some(6029));
    assert_eq!(custom_error(&w.claim(0).0), Some(6030));
    assert_eq!(custom_error(&w.claim(6).0), Some(6030));
    assert_eq!(custom_error(&w.claim(110).0), Some(6030));
    assert_eq!(custom_error(&w.claim(200).0), Some(6030));
}

#[test]
fn blocked_when_paused() {
    let mut w = world();
    let admin = w.init.admin.insecure_clone();
    send(&mut w.env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: true }.data())], &admin, &[]).unwrap();
    assert_eq!(custom_error(&w.claim(1).0), Some(6000));
}

fn claim_metas(wallet: &Pubkey, kind: u8) -> Vec<anchor_lang::solana_program::instruction::AccountMeta> {
    neonshift_core::accounts::ClaimCollectible {
        player: *wallet,
        config: config_pda().0,
        profile: player_pda(wallet).0,
        receipt: receipt_pda(wallet, kind),
        asset: asset_pda(wallet, kind),
        mpl_core_program: MPL_CORE_ID,
        system_program: system_program::ID,
    }
    .to_account_metas(None)
}

fn send_metas(w: &mut World, kind: u8, metas: Vec<anchor_lang::solana_program::instruction::AccountMeta>, extra: &[&Keypair]) -> litesvm::types::TransactionResult {
    let ix = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &ix::ClaimCollectible { kind }.data(), metas);
    let player = w.player.key.insecure_clone();
    send(&mut w.env.svm, &[ix], &player, extra)
}

#[test]
fn rejects_wrong_mpl_core_program() {
    let mut w = world();
    let mut metas = claim_metas(&w.wallet(), 1);
    metas[5].pubkey = system_program::ID;
    assert!(send_metas(&mut w, 1, metas, &[]).is_err());
}

#[test]
fn rejects_non_pda_asset() {
    let mut w = world();
    let rogue = Keypair::new();
    let mut metas = claim_metas(&w.wallet(), 1);
    metas[4].pubkey = rogue.pubkey();
    metas[4].is_signer = true;
    let res = send_metas(&mut w, 1, metas, &[rogue.insecure_clone()].iter().collect::<Vec<_>>());
    assert_eq!(custom_error(&res), Some(2006)); // ConstraintSeeds
}

#[test]
fn asset_address_is_deterministic_per_wallet_and_kind() {
    let mut w = world();
    let (_, a1) = w.claim(1);
    assert_eq!(a1, asset_pda(&w.wallet(), 1));
    assert_ne!(asset_pda(&w.wallet(), 1), asset_pda(&w.wallet(), 2));
}
