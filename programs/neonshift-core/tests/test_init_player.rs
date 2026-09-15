//! PG-C-03：PlayerProfile 與 `init_player`。

mod common;

use {
    anchor_lang::{prelude::Pubkey, InstructionData},
    common::*,
    neonshift_core::{instruction as ix, PlayerProfile},
    solana_signer::Signer,
};

#[test]
fn init_player_creates_profile_and_grants_starter_shoe() {
    let mut env = setup();
    let _ = initialize(&mut env);
    let player = new_player(&mut env.svm);
    send(&mut env.svm, &[init_player_ix(&player.pubkey())], &player, &[]).unwrap();

    let (key, bump) = player_pda(&player.pubkey());
    let p: PlayerProfile = read(&env.svm, &key);
    assert_eq!(p.wallet, player.pubkey());
    assert_eq!((p.core_level, p.shoe_level), (1, 1));
    assert_eq!((p.xp, p.last_task_date, p.streak_days, p.claimed_today, p.today_date), (0, 0, 0, 0, 0));
    assert_eq!(p.bump, bump);
}

#[test]
fn init_player_twice_fails_and_other_wallet_unaffected() {
    let mut env = setup();
    let _ = initialize(&mut env);
    let a = new_player(&mut env.svm);
    let b = new_player(&mut env.svm);
    send(&mut env.svm, &[init_player_ix(&a.pubkey())], &a, &[]).unwrap();
    env.svm.expire_blockhash();
    assert!(send(&mut env.svm, &[init_player_ix(&a.pubkey())], &a, &[]).is_err());
    send(&mut env.svm, &[init_player_ix(&b.pubkey())], &b, &[]).unwrap();
}

#[test]
fn cannot_init_profile_for_someone_else() {
    let mut env = setup();
    let _ = initialize(&mut env);
    let attacker = new_player(&mut env.svm);
    let victim = Pubkey::new_unique();
    // profile PDA 以 victim 推導，但簽章者是 attacker → seeds 不符
    let mut ix = init_player_ix(&victim);
    ix.accounts[0].pubkey = attacker.pubkey();
    let res = send(&mut env.svm, &[ix], &attacker, &[]);
    assert!(res.is_err());
}

#[test]
fn init_player_requires_initialized_config() {
    let mut env = setup();
    let player = new_player(&mut env.svm);
    let res = send(&mut env.svm, &[init_player_ix(&player.pubkey())], &player, &[]);
    assert!(res.is_err());
}

#[test]
fn init_player_allowed_while_paused() {
    let mut env = setup();
    let init = initialize(&mut env);
    send(&mut env.svm, &[admin_ix(&init.admin.pubkey(), ix::SetPaused { paused: true }.data())], &init.admin, &[]).unwrap();
    let player = new_player(&mut env.svm);
    send(&mut env.svm, &[init_player_ix(&player.pubkey())], &player, &[]).unwrap();
}
