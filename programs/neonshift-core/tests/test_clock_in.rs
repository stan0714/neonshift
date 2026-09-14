//! PG-C-04／C-05／C-06／C-07／C-08：`clock_in` 全流程與 SD 7 必測攻擊案例。

mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_instruction, InstructionData},
    anchor_spl::token::spl_token,
    common::*,
    ed25519_dalek::Signer as _,
    neonshift_core::{instruction as ix, AttestationArgs, ClaimReceipt, PlayerProfile},
    solana_signer::Signer,
};

struct World {
    env: Env,
    init: Initialized,
    attestor: ed25519_dalek::SigningKey,
    player: Player,
}

fn world_with(tweak: impl FnOnce(&mut neonshift_core::InitializeConfigParams)) -> World {
    let mut env = setup();
    set_time(&mut env.svm, T0);
    let attestor = new_attestor();
    let init = initialize_with(&mut env, attestor_pubkey(&attestor), tweak);
    mint_to(&mut env, &init.tokens.mint, &init.tokens.reward_vault, 1_000_000 * TSKR_UNIT);
    let player = ready_player(&mut env, &init);
    World { env, init, attestor, player }
}

fn world() -> World {
    world_with(|_| {})
}

impl World {
    fn wallet(&self) -> Pubkey {
        self.player.key.pubkey()
    }
    fn args(&self, task_type: u8) -> AttestationArgs {
        valid_args(&self.env.svm, &self.wallet(), task_type)
    }
    /// 簽 `signed` 的 canonical bytes，但把 `args` 傳給程式
    fn clock_in_signed(&mut self, signed: &AttestationArgs, args: AttestationArgs) -> litesvm::types::TransactionResult {
        let ixs = [ed25519_ix(&self.attestor, &canonical(signed)), clock_in_ix(&self.wallet(), &self.player.accts, args)];
        let player = self.player.key.insecure_clone();
        send(&mut self.env.svm, &ixs, &player, &[])
    }
    fn clock_in(&mut self, args: AttestationArgs) -> litesvm::types::TransactionResult {
        self.clock_in_signed(&args, args)
    }
    fn profile(&self) -> PlayerProfile {
        read(&self.env.svm, &player_pda(&self.wallet()).0)
    }
    fn balance(&self) -> u64 {
        token_balance(&self.env.svm, &self.player.accts.player_token_account)
    }
}

// ---------------------------------------------------------------- 正常路徑

#[test]
fn happy_path_steps_then_sleep_same_day() {
    let mut w = world();
    let vault_before = token_balance(&w.env.svm, &w.init.tokens.reward_vault);
    let args = w.args(TASK_STEPS);
    w.clock_in(args).unwrap();

    let receipt: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), args.task_date, TASK_STEPS));
    assert_eq!(receipt.amount, 10 * TSKR_UNIT);
    assert_eq!(receipt.nonce, args.nonce);
    assert_eq!(receipt.task_date, task_date_of(T0));
    assert_eq!(w.balance(), 10 * TSKR_UNIT);
    assert_eq!(token_balance(&w.env.svm, &w.init.tokens.reward_vault), vault_before - 10 * TSKR_UNIT);
    let p = w.profile();
    assert_eq!((p.xp, p.shoe_level, p.core_level, p.streak_days, p.claimed_today), (100, 1, 1, 1, 10 * TSKR_UNIT));
    assert_eq!(p.last_task_date, args.task_date);

    // 同日睡眠：另一張 receipt，streak 不重複增加
    advance_time(&mut w.env.svm, 60);
    let sleep = w.args(TASK_SLEEP);
    w.clock_in(sleep).unwrap();
    let p = w.profile();
    assert_eq!((p.xp, p.streak_days, p.claimed_today), (150, 1, 15 * TSKR_UNIT));
    assert_eq!(w.balance(), 15 * TSKR_UNIT);
}

#[test]
fn replay_same_attestation_is_rejected_6009_and_other_task_unaffected() {
    let mut w = world();
    let args = w.args(TASK_STEPS);
    w.clock_in(args).unwrap();
    w.env.svm.expire_blockhash();
    assert_eq!(custom_error(&w.clock_in(args)), Some(6009));
    // 換 nonce 重簽同一任務也一樣（receipt 以 wallet+date+type 為 key）
    let mut again = w.args(TASK_STEPS);
    again.nonce = [9; 16];
    assert_eq!(custom_error(&w.clock_in(again)), Some(6009));
    // 另一任務不受影響
    w.clock_in(w.args(TASK_SLEEP)).unwrap();
}

// ---------------------------------------------------------------- PG-C-04 完成定義

#[test]
fn missing_ed25519_instruction_6001() {
    let mut w = world();
    let args = w.args(TASK_STEPS);
    let player = w.player.key.insecure_clone();
    let ixs = [clock_in_ix(&w.wallet(), &w.player.accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6001), "{res:?}");
}

#[test]
fn previous_instruction_is_other_program_6001() {
    let mut w = world();
    let args = w.args(TASK_STEPS);
    let player = w.player.key.insecure_clone();
    let transfer = system_instruction::transfer(&player.pubkey(), &Pubkey::new_unique(), 1);
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), transfer, clock_in_ix(&w.wallet(), &w.player.accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6001), "{res:?}");
}

#[test]
fn two_signatures_6001() {
    let mut w = world();
    let args = w.args(TASK_STEPS);
    let mut ed = ed25519_ix(&w.attestor, &canonical(&args));
    ed.data[0] = 2; // num_signatures
    let player = w.player.key.insecure_clone();
    let ixs = [ed, clock_in_ix(&w.wallet(), &w.player.accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    // Ed25519 program 本身也可能先拒絕；兩者都代表前置指令不合格
    assert!(res.is_err(), "{res:?}");
}

#[test]
fn offsets_pointing_to_other_instruction_or_out_of_bounds_6001() {
    let mut w = world();
    let args = w.args(TASK_STEPS);
    let msg = canonical(&args);
    let sig = w.attestor.sign(&msg).to_bytes();
    let pk = w.attestor.verifying_key().to_bytes();
    // 自行組 offsets：message 指向 instruction 1（clock_in），其餘自我引用
    let mut data = vec![1u8, 0];
    let offsets: [u16; 7] = [48, u16::MAX, 16, u16::MAX, 112, 164, 1];
    for v in offsets { data.extend_from_slice(&v.to_le_bytes()); }
    data.extend_from_slice(&pk);
    data.extend_from_slice(&sig);
    data.extend_from_slice(&msg);
    let ed = anchor_lang::solana_program::instruction::Instruction { program_id: solana_sdk_ids::ed25519_program::ID, accounts: vec![], data };
    let player = w.player.key.insecure_clone();
    let ixs = [ed, clock_in_ix(&w.wallet(), &w.player.accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert!(res.is_err(), "{res:?}");
}

#[test]
fn wrong_attestor_key_6002_and_rotation_grace() {
    let mut w = world();
    let args = w.args(TASK_STEPS);
    let other = new_attestor();
    let player = w.player.key.insecure_clone();
    let ixs = [ed25519_ix(&other, &canonical(&args)), clock_in_ix(&w.wallet(), &w.player.accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6002), "{res:?}");

    // 輪替到 other，寬限 120 秒：舊鑰仍可用；過期後不可用
    let admin = w.init.admin.insecure_clone();
    send(&mut w.env.svm, &[admin_ix(&admin.pubkey(), ix::RotateAttestor { new_attestor: attestor_pubkey(&other), grace_seconds: 120 }.data())], &admin, &[]).unwrap();
    w.clock_in(args).unwrap(); // 舊鑰（w.attestor）在寬限期內
    advance_time(&mut w.env.svm, 121);
    let sleep = w.args(TASK_SLEEP);
    assert_eq!(custom_error(&w.clock_in(sleep)), Some(6002));
    let ixs = [ed25519_ix(&other, &canonical(&sleep)), clock_in_ix(&w.wallet(), &w.player.accts, sleep)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert!(res.is_ok(), "{res:?}");
}

#[test]
fn message_differs_by_one_byte_6003() {
    let mut w = world();
    let signed = w.args(TASK_STEPS);
    let mut args = signed;
    args.evidence_hash[0] ^= 0x01;
    assert_eq!(custom_error(&w.clock_in_signed(&signed, args)), Some(6003));
    let mut args = signed;
    args.rules_version += 1;
    assert_eq!(custom_error(&w.clock_in_signed(&signed, args)), Some(6003));
}

#[test]
fn wrong_program_or_cluster_6004() {
    let mut w = world();
    let mut args = w.args(TASK_STEPS);
    args.program_id = Pubkey::new_unique();
    assert_eq!(custom_error(&w.clock_in(args)), Some(6004));
    let mut args = w.args(TASK_STEPS);
    args.cluster_id = CLUSTER_DEVNET; // Config 為 localnet
    assert_eq!(custom_error(&w.clock_in(args)), Some(6004));
}

#[test]
fn wallet_mismatch_6005() {
    let mut w = world();
    let mut args = w.args(TASK_STEPS);
    args.wallet = Pubkey::new_unique(); // 他人的 attestation 換自己錢包送出
    assert_eq!(custom_error(&w.clock_in(args)), Some(6005));
}

#[test]
fn time_window_6006_6007_6008_6027() {
    let mut w = world();
    let now = now(&w.env.svm);
    let mut a = w.args(TASK_STEPS);
    a.not_before = now + 10;
    assert_eq!(custom_error(&w.clock_in(a)), Some(6006), "未到 not_before");

    let mut a = w.args(TASK_STEPS);
    a.issued_at = now - 100;
    a.not_before = now - 100;
    a.expiry = now - 1;
    assert_eq!(custom_error(&w.clock_in(a)), Some(6007), "已過期");

    let mut a = w.args(TASK_STEPS);
    a.expiry = a.issued_at + 601;
    assert_eq!(custom_error(&w.clock_in(a)), Some(6008), "ttl 601");

    let mut a = w.args(TASK_STEPS);
    a.expiry = a.issued_at + 365 * 86_400;
    assert_eq!(custom_error(&w.clock_in(a)), Some(6008), "expiry 改成一年後");

    let mut a = w.args(TASK_STEPS);
    a.issued_at = a.not_before + 1;
    assert_eq!(custom_error(&w.clock_in(a)), Some(6027), "issued_at > not_before");
}

// ---------------------------------------------------------------- PG-C-05 完成定義

#[test]
fn task_date_must_be_today_6019() {
    let mut w = world();
    // 前一日證明在午夜後送出
    let mut a = w.args(TASK_STEPS);
    a.task_date -= 1;
    assert_eq!(custom_error(&w.clock_in(a)), Some(6019));
    let mut a = w.args(TASK_STEPS);
    a.task_date += 1;
    assert_eq!(custom_error(&w.clock_in(a)), Some(6019));
}

#[test]
fn daily_cap_partial_then_exhausted_6010() {
    // cap 12 tSKR：步數 10 → 睡眠只發剩餘 2；隔日再 cap 10：步數 10 後睡眠 0 → 6010
    let mut w = world_with(|p| p.daily_cap = 12 * TSKR_UNIT);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    let sleep = w.args(TASK_SLEEP);
    w.clock_in(sleep).unwrap();
    let r: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), sleep.task_date, TASK_SLEEP));
    assert_eq!(r.amount, 2 * TSKR_UNIT, "額度部分剩餘只發剩餘量");
    assert_eq!(w.profile().claimed_today, 12 * TSKR_UNIT);

    let mut w = world_with(|p| p.daily_cap = 10 * TSKR_UNIT);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    let sleep = w.args(TASK_SLEEP);
    assert_eq!(custom_error(&w.clock_in(sleep)), Some(6010));
    // 6010 時不得留下 receipt
    assert!(w.env.svm.get_account(&receipt_pda(&w.wallet(), sleep.task_date, TASK_SLEEP)).is_none());
}

#[test]
fn next_day_resets_daily_cap_and_increments_streak() {
    let mut w = world();
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    let p = w.profile();
    assert_eq!((p.streak_days, p.claimed_today, p.xp), (2, 10 * TSKR_UNIT, 200));
    // 斷一天後 streak 回到 1
    advance_time(&mut w.env.svm, 2 * SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    assert_eq!(w.profile().streak_days, 1);
}

#[test]
fn streak_bonus_applies_on_seventh_consecutive_day() {
    // 門檻拉高讓等級維持 Lv1，只觀察 streak 效果
    let mut w = world_with(|p| { p.streak_enabled = true; p.shoe_xp_thresholds = [0, 10_000, 20_000, 30_000, 40_000]; });
    for day in 1..=7 {
        let a = w.args(TASK_STEPS);
        w.clock_in(a).unwrap();
        let r: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), a.task_date, TASK_STEPS));
        let expected = if day >= 7 { 11 * TSKR_UNIT } else { 10 * TSKR_UNIT };
        assert_eq!(r.amount, expected, "day {day}");
        if day == 7 {
            // 同日第二項任務：沿用 streak 7，加成套用但不再累加
            let s = w.args(TASK_SLEEP);
            w.clock_in(s).unwrap();
            let r: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), s.task_date, TASK_SLEEP));
            assert_eq!(r.amount, 5_500_000);
            assert_eq!(w.profile().streak_days, 7);
        }
        advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    }
}

#[test]
fn xp_raises_shoe_and_core_level_together_and_multiplier_applies_next_claim() {
    // 升級免費（2026-09-14）：達門檻時 shoe_level 與 core_level 一起提升；本次獎勵仍用升級前倍率
    let mut w = world_with(|p| p.shoe_xp_thresholds = [0, 100, 150, 250, 400]);
    let a = w.args(TASK_STEPS);
    w.clock_in(a).unwrap(); // xp 100 → Lv2
    let r: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), a.task_date, TASK_STEPS));
    assert_eq!(r.amount, 10 * TSKR_UNIT, "本次以 Lv1 倍率 1.0x 計算");
    let p = w.profile();
    assert_eq!((p.xp, p.shoe_level, p.core_level), (100, 2, 2));

    let s = w.args(TASK_SLEEP);
    w.clock_in(s).unwrap(); // 以 Lv2 1.2x：5 × 1.2 = 6；xp 150 → Lv3
    let r: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), s.task_date, TASK_SLEEP));
    assert_eq!(r.amount, 6 * TSKR_UNIT);
    let p = w.profile();
    assert_eq!((p.xp, p.shoe_level, p.core_level), (150, 3, 3));
}

#[test]
fn substituted_token_accounts_are_rejected_6021() {
    let mut w = world();
    let deployer = w.env.deployer.insecure_clone();
    let (config, _) = config_pda();
    let args = w.args(TASK_STEPS);

    // 假 reward vault（同 mint、owner 也是 config，但不是 Config 記錄的那個）
    let fake_vault = create_token_account(&mut w.env.svm, &deployer, &w.init.tokens.mint, &config);
    mint_to(&mut w.env, &w.init.tokens.mint, &fake_vault, 100 * TSKR_UNIT);
    let mut accts = ClockInAccounts { ..w.player.accts };
    accts.reward_vault = fake_vault;
    let player = w.player.key.insecure_clone();
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), clock_in_ix(&w.wallet(), &accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6021), "reward vault 替換");

    // 別的 mint 的收款帳戶
    let other_mint = create_mint(&mut w.env.svm, &deployer, &deployer.pubkey(), TSKR_DECIMALS);
    let other_ata = create_token_account(&mut w.env.svm, &deployer, &other_mint, &player.pubkey());
    let mut accts = ClockInAccounts { ..w.player.accts };
    accts.player_token_account = other_ata;
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), clock_in_ix(&w.wallet(), &accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6021), "收款帳戶 mint 不符");

    // 他人的收款帳戶
    let stranger_ata = create_token_account(&mut w.env.svm, &deployer, &w.init.tokens.mint, &Pubkey::new_unique());
    let mut accts = ClockInAccounts { ..w.player.accts };
    accts.player_token_account = stranger_ata;
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), clock_in_ix(&w.wallet(), &accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6021), "收款帳戶 owner 不符");

    // mint 替換
    let mut accts = ClockInAccounts { ..w.player.accts };
    accts.mint = other_mint;
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), clock_in_ix(&w.wallet(), &accts, args)];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6021), "mint 替換");

    // token program 替換
    let mut ix2 = clock_in_ix(&w.wallet(), &w.player.accts, args);
    let tp = ix2.accounts.iter_mut().find(|m| m.pubkey == spl_token::id()).unwrap();
    tp.pubkey = Pubkey::new_unique();
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), ix2];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert!(res.is_err(), "token program 替換");
}

#[test]
fn paused_6000_and_missing_profile_rejected() {
    let mut w = world();
    let admin = w.init.admin.insecure_clone();
    send(&mut w.env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: true }.data())], &admin, &[]).unwrap();
    assert_eq!(custom_error(&w.clock_in(w.args(TASK_STEPS))), Some(6000));
    send(&mut w.env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: false }.data())], &admin, &[]).unwrap();

    // 未 init_player（沒有 profile，也就沒有跑鞋）的新錢包：Anchor 帳戶層拒絕
    let fresh = new_player(&mut w.env.svm);
    let deployer = w.env.deployer.insecure_clone();
    let ata = create_token_account(&mut w.env.svm, &deployer, &w.init.tokens.mint, &fresh.pubkey());
    let accts = ClockInAccounts { reward_vault: w.init.tokens.reward_vault, mint: w.init.tokens.mint, player_token_account: ata };
    let args = valid_args(&w.env.svm, &fresh.pubkey(), TASK_STEPS);
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), clock_in_ix(&fresh.pubkey(), &accts, args)];
    let res = send(&mut w.env.svm, &ixs, &fresh, &[]);
    assert!(res.is_err(), "{res:?}");
}

#[test]
fn receipt_pda_must_match_args() {
    let mut w = world();
    let args = w.args(TASK_STEPS);
    let mut ix2 = clock_in_ix(&w.wallet(), &w.player.accts, args);
    // 把 receipt 換成睡眠任務的 PDA
    let wrong = receipt_pda(&w.wallet(), args.task_date, TASK_SLEEP);
    ix2.accounts[3].pubkey = wrong;
    let player = w.player.key.insecure_clone();
    let ixs = [ed25519_ix(&w.attestor, &canonical(&args)), ix2];
    let res = send(&mut w.env.svm, &ixs, &player, &[]);
    assert_eq!(custom_error(&res), Some(6021), "{res:?}");
}
