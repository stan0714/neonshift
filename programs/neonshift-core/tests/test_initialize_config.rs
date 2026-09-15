//! PG-C-01：Config 帳戶與 `initialize_config`。

mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    common::*,
    neonshift_core::{Config, InitializeConfigParams},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn init_ix(program_data: Pubkey, tokens: &TokenSetup, authority: &Pubkey, params: InitializeConfigParams) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        neonshift_core::id(),
        &neonshift_core::instruction::InitializeConfig { params }.data(),
        neonshift_core::accounts::InitializeConfig {
            authority: *authority,
            config,
            mint: tokens.mint,
            reward_vault: tokens.reward_vault,
            treasury_vault: tokens.treasury_vault,
            program: neonshift_core::id(),
            program_data,
            token_program: spl_token::id(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn initialize_writes_all_fields_and_defaults() {
    let mut env = setup();
    let tokens = setup_tokens(&mut env, TSKR_DECIMALS);
    let admin = Pubkey::new_unique();
    let attestor = Pubkey::new_unique();
    let deployer = env.deployer.insecure_clone();
    let ix = init_ix(env.program_data, &tokens, &deployer.pubkey(), default_params(admin, attestor));
    send(&mut env.svm, &[ix], &deployer, &[]).unwrap();

    let (config_key, bump) = config_pda();
    let cfg: Config = read(&env.svm, &config_key);
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.cluster_id, CLUSTER_LOCALNET);
    assert_eq!(cfg.attestor_pubkey, attestor);
    assert_eq!(cfg.prev_attestor_pubkey, Pubkey::default());
    assert_eq!(cfg.prev_attestor_valid_until, 0);
    assert_eq!(cfg.mint, tokens.mint);
    assert_eq!(cfg.mint_decimals, 6);
    assert_eq!(cfg.reward_vault, tokens.reward_vault);
    assert_eq!(cfg.treasury_vault, tokens.treasury_vault);
    assert_eq!(cfg.daily_cap, 40 * TSKR_UNIT);
    assert_eq!(cfg.base_steps_reward, 10 * TSKR_UNIT);
    assert_eq!(cfg.base_sleep_reward, 5 * TSKR_UNIT);
    assert!(!cfg.streak_enabled);
    assert_eq!(cfg.streak_bonus_bps, 11_000);
    assert_eq!(cfg.burn_bps, 7_000);
    assert_eq!(cfg.core_multiplier_bps, [10_000, 12_000, 15_000, 18_000, 22_000]);
    assert!(!cfg.paused);
    assert_eq!(cfg.bump, bump);
}

#[test]
fn initialize_twice_fails() {
    let mut env = setup();
    let tokens = setup_tokens(&mut env, TSKR_DECIMALS);
    let deployer = env.deployer.insecure_clone();
    let p = default_params(Pubkey::new_unique(), Pubkey::new_unique());
    send(&mut env.svm, &[init_ix(env.program_data, &tokens, &deployer.pubkey(), p.clone())], &deployer, &[]).unwrap();
    // 第二次：PDA 已存在，init 失敗（system program 層級錯誤，非自訂碼）
    let res = send(&mut env.svm, &[init_ix(env.program_data, &tokens, &deployer.pubkey(), p)], &deployer, &[]);
    assert!(res.is_err());
}

#[test]
fn non_upgrade_authority_cannot_initialize() {
    let mut env = setup();
    let tokens = setup_tokens(&mut env, TSKR_DECIMALS);
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let ix = init_ix(env.program_data, &tokens, &stranger.pubkey(), default_params(Pubkey::new_unique(), Pubkey::new_unique()));
    let res = send(&mut env.svm, &[ix], &stranger, &[]);
    assert_eq!(custom_error(&res), Some(6024), "{res:?}");
}

#[test]
fn wrong_mint_decimals_rejected() {
    let mut env = setup();
    let tokens = setup_tokens(&mut env, 9);
    let deployer = env.deployer.insecure_clone();
    let ix = init_ix(env.program_data, &tokens, &deployer.pubkey(), default_params(Pubkey::new_unique(), Pubkey::new_unique()));
    let res = send(&mut env.svm, &[ix], &deployer, &[]);
    assert_eq!(custom_error(&res), Some(6021), "{res:?}");
}

#[test]
fn reward_vault_must_be_owned_by_config_pda_and_match_mint() {
    let mut env = setup();
    let mut tokens = setup_tokens(&mut env, TSKR_DECIMALS);
    let deployer = env.deployer.insecure_clone();
    // owner 不是 Config PDA
    let wrong_owner = create_token_account(&mut env.svm, &deployer, &tokens.mint, &deployer.pubkey());
    let good_vault = tokens.reward_vault;
    tokens.reward_vault = wrong_owner;
    let res = send(&mut env.svm, &[init_ix(env.program_data, &tokens, &deployer.pubkey(), default_params(Pubkey::new_unique(), Pubkey::new_unique()))], &deployer, &[]);
    assert_eq!(custom_error(&res), Some(6021), "{res:?}");

    // mint 不同
    tokens.reward_vault = good_vault;
    let other_mint = create_mint(&mut env.svm, &deployer, &deployer.pubkey(), TSKR_DECIMALS);
    let (config, _) = config_pda();
    tokens.reward_vault = create_token_account(&mut env.svm, &deployer, &other_mint, &config);
    let res = send(&mut env.svm, &[init_ix(env.program_data, &tokens, &deployer.pubkey(), default_params(Pubkey::new_unique(), Pubkey::new_unique()))], &deployer, &[]);
    assert_eq!(custom_error(&res), Some(6021), "{res:?}");
}

#[test]
fn invalid_params_rejected() {
    let mut env = setup();
    let tokens = setup_tokens(&mut env, TSKR_DECIMALS);
    let deployer = env.deployer.insecure_clone();
    let base = || default_params(Pubkey::new_unique(), Pubkey::new_unique());

    let cases: Vec<(&str, InitializeConfigParams)> = vec![
        ("admin 為 default", InitializeConfigParams { admin: Pubkey::default(), ..base() }),
        ("attestor 為 default", InitializeConfigParams { attestor_pubkey: Pubkey::default(), ..base() }),
        ("cluster_id 非法", InitializeConfigParams { cluster_id: 9, ..base() }),
        ("base_steps_reward 為 0", InitializeConfigParams { base_steps_reward: 0, ..base() }),
        ("daily_cap 小於基礎獎勵", InitializeConfigParams { daily_cap: 1, ..base() }),
        ("streak_bonus 低於 1.0x", InitializeConfigParams { streak_bonus_bps: 9_999, ..base() }),
        ("streak_bonus 超過 2.0x", InitializeConfigParams { streak_bonus_bps: 20_001, ..base() }),
        ("burn_bps 超過 100%", InitializeConfigParams { burn_bps: 10_001, ..base() }),
        ("core[0] 不是 1.0x", InitializeConfigParams { core_multiplier_bps: [9_000, 12_000, 15_000, 18_000, 22_000], ..base() }),
        ("core 倍率遞減", InitializeConfigParams { core_multiplier_bps: [10_000, 12_000, 11_000, 18_000, 22_000], ..base() }),
        ("core 倍率超過上限", InitializeConfigParams { core_multiplier_bps: [10_000, 12_000, 15_000, 18_000, 60_000], ..base() }),
        ("升級成本為 0", InitializeConfigParams { core_upgrade_costs: [0, 1, 2, 3], ..base() }),
        ("xp[0] 非 0", InitializeConfigParams { shoe_xp_thresholds: [1, 100, 300, 700, 1500], ..base() }),
        ("xp 門檻未嚴格遞增", InitializeConfigParams { shoe_xp_thresholds: [0, 100, 100, 700, 1500], ..base() }),
    ];
    for (name, p) in cases {
        let res = send(&mut env.svm, &[init_ix(env.program_data, &tokens, &deployer.pubkey(), p)], &deployer, &[]);
        assert_eq!(custom_error(&res), Some(6023), "{name}: {res:?}");
    }
}
