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
    /// PG-V-02：任何 payer（deployer）結算
    fn settle(&mut self, max: u8) -> litesvm::types::TransactionResult {
        let payer = self.env.deployer.insecure_clone();
        let wallet = self.wallet();
        send(&mut self.env.svm, &[settle_epochs_ix(&payer.pubkey(), &wallet, max)], &payer, &[])
    }
    fn migrate(&mut self) -> litesvm::types::TransactionResult {
        let payer = self.env.deployer.insecure_clone();
        let wallet = self.wallet();
        send(&mut self.env.svm, &[migrate_player_ix(&payer.pubkey(), &wallet)], &payer, &[])
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
fn level_changes_only_at_epoch_settlement_and_multiplier_applies_after() {
    // PG-V-02：XP 立即累積，但 Active level 只在期末結算切換；期內倍率固定
    let mut w = world_with(|p| p.shoe_xp_thresholds = [0, 100, 150, 250, 400]);
    let a = w.args(TASK_STEPS);
    w.clock_in(a).unwrap(); // xp 100（舊規則會立刻 Lv2）
    let p = w.profile();
    assert_eq!((p.xp, p.shoe_level, p.core_level, p.highest_level), (100, 1, 1, 1));
    assert_eq!((p.epoch_points, p.epoch_bitmap, p.last_settled_epoch), (100, 0b1, 0));
    let s = w.args(TASK_SLEEP);
    w.clock_in(s).unwrap(); // 同日睡眠：仍 Lv1 1.0x → 5；點數 150、活躍日仍 1
    let r: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), s.task_date, TASK_SLEEP));
    assert_eq!(r.amount, 5 * TSKR_UNIT);
    assert_eq!((w.profile().epoch_points, w.profile().epoch_bitmap), (150, 0b1));
    // 第 2 日步數 → 250 點／2 活躍日（Lv2 門檻 200／2）
    advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    assert_eq!((w.profile().epoch_points, w.profile().epoch_bitmap, w.profile().core_level), (250, 0b11, 1));
    // 第 8 日（新期）打卡：先結算第 0 期 → XP 250 上限 Lv4、成績 250／2 只撐 Lv2 → Lv2；本筆以 Lv2 1.2x 計算並計入第 1 期
    advance_time(&mut w.env.svm, 6 * SECONDS_PER_DAY);
    let a8 = w.args(TASK_STEPS);
    w.clock_in(a8).unwrap();
    let r: ClaimReceipt = read(&w.env.svm, &receipt_pda(&w.wallet(), a8.task_date, TASK_STEPS));
    assert_eq!(r.amount, 12 * TSKR_UNIT, "結算後的 Active level 倍率");
    let p = w.profile();
    assert_eq!((p.core_level, p.shoe_level, p.highest_level, p.last_settled_epoch, p.epoch_points, p.epoch_bitmap), (2, 2, 2, 1, 100, 0b1));
}

#[test]
fn absence_demotes_one_level_per_epoch_and_settle_is_bounded_and_idempotent() {
    // 用低門檻讓 XP 上限不擋：第 0 期 3 日雙任務（450 點／3 日）→ Lv3；接著缺席 4 期
    let mut w = world_with(|p| p.shoe_xp_thresholds = [0, 100, 150, 250, 400]);
    for _ in 0..3 {
        w.clock_in(w.args(TASK_STEPS)).unwrap();
        w.clock_in(w.args(TASK_SLEEP)).unwrap();
        advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    }
    assert_eq!((w.profile().epoch_points, w.profile().epoch_bitmap.count_ones()), (450, 3));
    // 跳到第 5 期開頭（缺席第 1～4 期）：任何 payer 可結算；max 2 → 只結算 2 期
    advance_time(&mut w.env.svm, (7 * 5 - 3) * SECONDS_PER_DAY);
    w.settle(2).unwrap();
    let p = w.profile();
    assert_eq!((p.last_settled_epoch, p.core_level, p.highest_level), (2, 2, 3), "第 0 期升 Lv3；第 1 期缺席降 Lv2");
    // 其餘 3 期：每期最多降一階 → Lv1；highest 不變；XP 不扣
    w.settle(64).unwrap();
    let p = w.profile();
    assert_eq!((p.last_settled_epoch, p.core_level, p.shoe_level, p.highest_level, p.xp), (5, 1, 1, 3, 450));
    // 冪等：已追平再結算不改變（換 blockhash 避免同筆交易去重）
    w.env.svm.expire_blockhash();
    w.settle(64).unwrap();
    assert_eq!(w.profile().last_settled_epoch, 5);
    // 回歸：第 5 期 2 日雙任務（300／2）→ 第 6 期打卡結算後恢復 Lv2（XP 上限允許，不逐階等待亦不自動回 Lv3）
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    w.clock_in(w.args(TASK_SLEEP)).unwrap();
    advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    w.clock_in(w.args(TASK_SLEEP)).unwrap();
    advance_time(&mut w.env.svm, 6 * SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    let p = w.profile();
    assert_eq!((p.last_settled_epoch, p.core_level, p.highest_level), (6, 2, 3));
}

#[test]
fn far_behind_requires_explicit_settlement_6041_then_clock_in_succeeds() {
    let mut w = world();
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    // 缺席 12 期：clock_in 只能順帶結算 8 期 → 6041
    advance_time(&mut w.env.svm, 12 * 7 * SECONDS_PER_DAY);
    let res = w.clock_in(w.args(TASK_STEPS));
    assert_eq!(custom_error(&res), Some(6041));
    assert_eq!(w.profile().last_settled_epoch, 0, "失敗交易不寫入");
    w.settle(64).unwrap();
    assert_eq!(w.profile().last_settled_epoch, 12);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    assert_eq!((w.profile().epoch_points, w.profile().core_level), (100, 1));
}

#[test]
fn migrate_player_upgrades_v1_layout_keeps_levels_and_starts_new_epoch() {
    let mut w = world_with(|p| p.shoe_xp_thresholds = [0, 100, 150, 250, 400]);
    // 先到 Lv2（第 0 期 250／2 → 第 1 期結算）
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    w.clock_in(w.args(TASK_SLEEP)).unwrap();
    advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    advance_time(&mut w.env.svm, 6 * SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    let before = w.profile();
    assert_eq!(before.core_level, 2);
    // 模擬舊版帳戶（63 bytes）：clock_in 無法反序列化 → 失敗；migrate 後恢復
    let wallet = w.wallet();
    downgrade_profile_to_v1(&mut w.env.svm, &wallet);
    advance_time(&mut w.env.svm, 3 * SECONDS_PER_DAY);
    assert!(w.clock_in(w.args(TASK_SLEEP)).is_err());
    let payer_key = w.env.deployer.pubkey();
    let payer_before = w.env.svm.get_balance(&payer_key).unwrap();
    w.migrate().unwrap();
    assert!(w.env.svm.get_balance(&payer_key).unwrap() < payer_before, "payer 付 rent 差額");
    let p = w.profile();
    assert_eq!((p.core_level, p.shoe_level, p.highest_level, p.xp, p.streak_days), (2, 2, 2, before.xp, before.streak_days));
    assert_eq!((p.epoch_anchor, p.last_settled_epoch, p.epoch_points, p.epoch_bitmap, p.maintenance_rules_version), (task_date_of(now(&w.env.svm)), 0, 0, 0, 1));
    // 再遷移 → 6042；遷移後打卡正常並計入新期
    w.env.svm.expire_blockhash();
    let res = w.migrate();
    assert_eq!(custom_error(&res), Some(6042));
    w.clock_in(w.args(TASK_SLEEP)).unwrap();
    assert_eq!((w.profile().epoch_points, w.profile().epoch_bitmap), (50, 0b1));
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

// ---------------------------------------------------------------- PG-V-05 incident freeze

#[test]
fn incident_freeze_blocks_demotion_and_promotion_only_for_overlapping_epochs_and_window_is_validated() {
    let mut w = world_with(|p| p.shoe_xp_thresholds = [0, 100, 150, 250, 400]);
    // 第 0 期 3 日雙任務 → 第 1 期打卡結算升 Lv3
    for _ in 0..3 {
        w.clock_in(w.args(TASK_STEPS)).unwrap();
        w.clock_in(w.args(TASK_SLEEP)).unwrap();
        advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    }
    advance_time(&mut w.env.svm, 4 * SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    assert_eq!(w.profile().core_level, 3);
    // admin 於第 1 期內設定凍結：涵蓋第 1、2 期（14 天）；非 admin 拒絕；視窗檢查 6044
    let admin = w.init.admin.insecure_clone();
    w.env.svm.airdrop(&admin.pubkey(), 1_000_000_000).unwrap();
    let t = now(&w.env.svm);
    let intruder = new_player(&mut w.env.svm);
    let res = send(&mut w.env.svm, &[set_freeze_ix(&intruder.pubkey(), t, t + 14 * SECONDS_PER_DAY, [1; 32])], &intruder, &[]);
    assert!(res.is_err());
    assert_eq!(custom_error(&send(&mut w.env.svm, &[set_freeze_ix(&admin.pubkey(), t, t - 1, [1; 32])], &admin, &[])), Some(6044));
    assert_eq!(custom_error(&send(&mut w.env.svm, &[set_freeze_ix(&admin.pubkey(), t, t + 29 * SECONDS_PER_DAY, [1; 32])], &admin, &[])), Some(6044));
    assert_eq!(custom_error(&send(&mut w.env.svm, &[set_freeze_ix(&admin.pubkey(), t - 8 * SECONDS_PER_DAY, t, [1; 32])], &admin, &[])), Some(6044));
    let epoch1_start = (w.profile().epoch_anchor as i64 + 7) * SECONDS_PER_DAY;
    send(&mut w.env.svm, &[set_freeze_ix(&admin.pubkey(), epoch1_start, epoch1_start + 14 * SECONDS_PER_DAY, [7; 32])], &admin, &[]).unwrap();
    FREEZE_PRESENT.with(|f| f.set(true));
    // 缺席到第 4 期：第 1、2 期凍結（不降），第 3 期缺席 → 降 Lv2
    advance_time(&mut w.env.svm, 3 * 7 * SECONDS_PER_DAY);
    w.settle(64).unwrap();
    let p = w.profile();
    assert_eq!((p.last_settled_epoch, p.core_level, p.highest_level), (4, 2, 3));
    // 凍結期也不升：清除凍結後重設一個涵蓋第 4 期的視窗，第 4 期全勤仍維持 Lv2
    let t4 = now(&w.env.svm);
    w.env.svm.expire_blockhash();
    send(&mut w.env.svm, &[set_freeze_ix(&admin.pubkey(), t4, t4 + 7 * SECONDS_PER_DAY, [8; 32])], &admin, &[]).unwrap();
    for _ in 0..7 {
        w.clock_in(w.args(TASK_STEPS)).unwrap();
        w.clock_in(w.args(TASK_SLEEP)).unwrap();
        advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    }
    w.clock_in(w.args(TASK_STEPS)).unwrap(); // 第 5 期打卡 → 結算第 4 期（凍結）
    assert_eq!((w.profile().last_settled_epoch, w.profile().core_level), (5, 2));
    // 清除（0,0）後第 5 期全勤（1050／7、XP 充足）→ 第 6 期結算跨階升 Lv5
    w.env.svm.expire_blockhash();
    send(&mut w.env.svm, &[set_freeze_ix(&admin.pubkey(), 0, 0, [0; 32])], &admin, &[]).unwrap();
    for _ in 0..6 {
        advance_time(&mut w.env.svm, SECONDS_PER_DAY);
        w.clock_in(w.args(TASK_STEPS)).unwrap();
        w.clock_in(w.args(TASK_SLEEP)).unwrap();
    }
    advance_time(&mut w.env.svm, SECONDS_PER_DAY);
    w.clock_in(w.args(TASK_STEPS)).unwrap();
    assert_eq!((w.profile().last_settled_epoch, w.profile().core_level, w.profile().highest_level), (6, 5, 5));
    // 傳錯的 freeze 帳戶（非 PDA）→ seeds 約束拒絕
    FREEZE_PRESENT.with(|f| f.set(false));
    let mut ix = settle_epochs_ix(&admin.pubkey(), &w.wallet(), 64);
    ix.accounts[3].pubkey = config_pda().0;
    w.env.svm.expire_blockhash();
    assert!(send(&mut w.env.svm, &[ix], &admin, &[]).is_err());
}
