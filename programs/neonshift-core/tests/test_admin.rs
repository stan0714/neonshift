//! PG-C-02：`set_paused`、`update_config`（BR-24）、`rotate_attestor`。

mod common;

use {
    anchor_lang::{prelude::Pubkey, InstructionData},
    common::*,
    neonshift_core::{instruction as ix, Config, UpdateConfigParams},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn cfg(env: &Env) -> Config {
    read(&env.svm, &config_pda().0)
}

#[test]
fn only_admin_can_call_admin_instructions() {
    let mut env = setup();
    let _init = initialize(&mut env);
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    for data in [
        ix::SetPaused { paused: true }.data(),
        ix::UpdateConfig { params: UpdateConfigParams { burn_bps: Some(5000), ..Default::default() } }.data(),
        ix::RotateAttestor { new_attestor: Pubkey::new_unique(), grace_seconds: 0 }.data(),
    ] {
        let res = send(&mut env.svm, &[admin_ix(&stranger.pubkey(), data)], &stranger, &[]);
        assert_eq!(custom_error(&res), Some(6026), "{res:?}");
    }
}

#[test]
fn pause_records_timestamp_and_unpause_keeps_it() {
    let mut env = setup();
    let init = initialize(&mut env);
    let t0 = now(&env.svm);
    send(&mut env.svm, &[admin_ix(&init.admin.pubkey(), ix::SetPaused { paused: true }.data())], &init.admin, &[]).unwrap();
    let c = cfg(&env);
    assert!(c.paused);
    assert_eq!(c.paused_at, t0);

    advance_time(&mut env.svm, 30);
    // 重複 pause 不會重設 paused_at（避免拉長 BR-24 等待）
    send(&mut env.svm, &[admin_ix(&init.admin.pubkey(), ix::SetPaused { paused: true }.data())], &init.admin, &[]).unwrap();
    assert_eq!(cfg(&env).paused_at, t0);

    advance_time(&mut env.svm, 1);
    send(&mut env.svm, &[admin_ix(&init.admin.pubkey(), ix::SetPaused { paused: false }.data())], &init.admin, &[]).unwrap();
    assert!(!cfg(&env).paused);
}

#[test]
fn reward_params_require_pause_for_600s() {
    let mut env = setup();
    let init = initialize(&mut env);
    let admin = init.admin.insecure_clone();
    let change = || ix::UpdateConfig { params: UpdateConfigParams { daily_cap: Some(50 * TSKR_UNIT), ..Default::default() } }.data();

    // 未 pause
    let res = send(&mut env.svm, &[admin_ix(&admin.pubkey(), change())], &admin, &[]);
    assert_eq!(custom_error(&res), Some(6025), "{res:?}");

    // pause 後未滿 600 秒
    send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: true }.data())], &admin, &[]).unwrap();
    advance_time(&mut env.svm, 599);
    let res = send(&mut env.svm, &[admin_ix(&admin.pubkey(), change())], &admin, &[]);
    assert_eq!(custom_error(&res), Some(6025), "{res:?}");

    // 滿 600 秒
    advance_time(&mut env.svm, 1);
    send(&mut env.svm, &[admin_ix(&admin.pubkey(), change())], &admin, &[]).unwrap();
    assert_eq!(cfg(&env).daily_cap, 50 * TSKR_UNIT);

    // streak／倍率也屬受控欄位：恢復後再改應被拒
    send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: false }.data())], &admin, &[]).unwrap();
    for params in [
        UpdateConfigParams { streak_enabled: Some(true), ..Default::default() },
        UpdateConfigParams { core_multiplier_bps: Some([10_000, 13_000, 15_000, 18_000, 22_000]), ..Default::default() },
        UpdateConfigParams { base_sleep_reward: Some(6 * TSKR_UNIT), ..Default::default() },
    ] {
        let res = send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::UpdateConfig { params }.data())], &admin, &[]);
        assert_eq!(custom_error(&res), Some(6025), "{res:?}");
    }
}

#[test]
fn non_reward_params_update_immediately_and_are_validated() {
    let mut env = setup();
    let init = initialize(&mut env);
    let admin = init.admin.insecure_clone();

    let params = UpdateConfigParams {
        burn_bps: Some(6_000),
        core_upgrade_costs: Some([1, 2, 3, 4]),
        shoe_xp_thresholds: Some([0, 10, 20, 30, 40]),
        ..Default::default()
    };
    send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::UpdateConfig { params }.data())], &admin, &[]).unwrap();
    let c = cfg(&env);
    assert_eq!(c.burn_bps, 6_000);
    assert_eq!(c.core_upgrade_costs, [1, 2, 3, 4]);
    assert_eq!(c.shoe_xp_thresholds, [0, 10, 20, 30, 40]);

    // 非法值整筆拒絕，且其他欄位不變
    let params = UpdateConfigParams { burn_bps: Some(10_001), core_upgrade_costs: Some([9, 9, 9, 9]), ..Default::default() };
    let res = send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::UpdateConfig { params }.data())], &admin, &[]);
    assert_eq!(custom_error(&res), Some(6023), "{res:?}");
    assert_eq!(cfg(&env).core_upgrade_costs, [1, 2, 3, 4]);
}

#[test]
fn admin_can_be_transferred() {
    let mut env = setup();
    let init = initialize(&mut env);
    let old = init.admin.insecure_clone();
    let new_admin = Keypair::new();
    env.svm.airdrop(&new_admin.pubkey(), 1_000_000_000).unwrap();

    let params = UpdateConfigParams { admin: Some(new_admin.pubkey()), ..Default::default() };
    send(&mut env.svm, &[admin_ix(&old.pubkey(), ix::UpdateConfig { params }.data())], &old, &[]).unwrap();
    assert_eq!(cfg(&env).admin, new_admin.pubkey());

    let res = send(&mut env.svm, &[admin_ix(&old.pubkey(), ix::SetPaused { paused: true }.data())], &old, &[]);
    assert_eq!(custom_error(&res), Some(6026));
    send(&mut env.svm, &[admin_ix(&new_admin.pubkey(), ix::SetPaused { paused: true }.data())], &new_admin, &[]).unwrap();

    // admin 不可設為 default
    let params = UpdateConfigParams { admin: Some(Pubkey::default()), ..Default::default() };
    let res = send(&mut env.svm, &[admin_ix(&new_admin.pubkey(), ix::UpdateConfig { params }.data())], &new_admin, &[]);
    assert_eq!(custom_error(&res), Some(6023));
}

#[test]
fn rotate_attestor_with_grace_and_immediate() {
    let mut env = setup();
    let init = initialize(&mut env);
    let admin = init.admin.insecure_clone();
    let old = init.attestor;
    let new1 = Pubkey::new_unique();

    // 計畫輪替：300 秒寬限
    let t0 = now(&env.svm);
    send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::RotateAttestor { new_attestor: new1, grace_seconds: 300 }.data())], &admin, &[]).unwrap();
    let c = cfg(&env);
    assert_eq!(c.attestor_pubkey, new1);
    assert_eq!(c.attestor_valid_from, t0);
    assert_eq!(c.prev_attestor_pubkey, old);
    assert_eq!(c.prev_attestor_valid_until, t0 + 300);
    assert!(c.attestor_accepts(&new1, t0));
    assert!(c.attestor_accepts(&old, t0 + 299));
    assert!(!c.attestor_accepts(&old, t0 + 300));
    assert!(!c.attestor_accepts(&Pubkey::new_unique(), t0));

    // 外洩處置：grace 0 立即失效
    advance_time(&mut env.svm, 10);
    let new2 = Pubkey::new_unique();
    send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::RotateAttestor { new_attestor: new2, grace_seconds: 0 }.data())], &admin, &[]).unwrap();
    let c = cfg(&env);
    assert_eq!(c.attestor_pubkey, new2);
    assert_eq!(c.prev_attestor_pubkey, Pubkey::default());
    assert!(!c.attestor_accepts(&new1, now(&env.svm)));
    assert!(!c.attestor_accepts(&old, now(&env.svm)));

    // 非法參數
    for (k, g) in [(Pubkey::default(), 0), (new2, 0), (Pubkey::new_unique(), 601), (Pubkey::new_unique(), -1)] {
        advance_time(&mut env.svm, 1);
        let res = send(&mut env.svm, &[admin_ix(&admin.pubkey(), ix::RotateAttestor { new_attestor: k, grace_seconds: g }.data())], &admin, &[]);
        assert_eq!(custom_error(&res), Some(6023), "{res:?}");
    }
}
