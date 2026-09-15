//! PG-C-13～C-16：沒收、開始結算、批次排名、結算、領獎、取消與退款（SD 6.2 資金守恆與 vault 對帳）。

mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::{instruction::AccountMeta, system_program}, InstructionData, ToAccountMetas},
    anchor_spl::token::spl_token,
    common::*,
    neonshift_core::{constants::tournament_status as st, instruction as ix, tournament_math as tm, CreateTournamentParams, ResultItem, Tournament, TournamentEntry},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const WEEK: u32 = 2026_38;
const REG_END: i64 = T0 + 3_600;
const STARTS: i64 = T0 + 7_200;
const ENDS: i64 = STARTS + 2 * SECONDS_PER_DAY;

fn tournament_pda() -> Pubkey {
    Pubkey::find_program_address(&[TOURNAMENT_SEED, &WEEK.to_le_bytes()], &neonshift_core::id()).0
}
fn vault_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"vault", tournament_pda().as_ref()], &neonshift_core::id()).0
}
fn entry_pda(wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ENTRY_SEED, tournament_pda().as_ref(), wallet.as_ref()], &neonshift_core::id()).0
}

struct World {
    env: Env,
    init: Initialized,
    players: Vec<(Keypair, Pubkey)>,
}

/// 建立、開放、n 人報名（每人 100 tSKR）、資助國庫 `injection`、lock、start，並把時間撥到 ends_at
fn running(n: usize, injection: u64) -> World {
    let mut env = setup();
    set_time(&mut env.svm, T0);
    let init = initialize(&mut env);
    let mut w = World { env, init, players: vec![] };
    let admin = w.admin();
    let t = tournament_pda();
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        neonshift_core::id(),
        &ix::CreateTournament {
            params: CreateTournamentParams { week_id: WEEK, stake_amount: DEFAULT_STAKE_AMOUNT, treasury_injection_cap: 1_000 * TSKR_UNIT, min_entrants: 1, registration_ends_at: REG_END, starts_at: STARTS, ends_at: ENDS, rules_version: 3 },
        }
        .data(),
        neonshift_core::accounts::CreateTournament { admin: admin.pubkey(), config: config_pda().0, tournament: t, mint: w.init.tokens.mint, vault: vault_pda(), token_program: spl_token::id(), system_program: system_program::ID }.to_account_metas(None),
    );
    send(&mut w.env.svm, &[ixn], &admin, &[]).unwrap();
    w.admin_call(ix::OpenTournament {}.data()).unwrap();
    for _ in 0..n {
        let init = Initialized { admin: w.init.admin.insecure_clone(), attestor: w.init.attestor, tokens: TokenSetup { ..w.init.tokens }, config: w.init.config };
        let p = ready_player(&mut w.env, &init);
        mint_to(&mut w.env, &w.init.tokens.mint, &p.accts.player_token_account, 100 * TSKR_UNIT);
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::JoinTournament {}.data(),
            neonshift_core::accounts::JoinTournament { player: p.key.pubkey(), config: config_pda().0, tournament: t, entry: entry_pda(&p.key.pubkey()), vault: vault_pda(), player_token_account: p.accts.player_token_account, token_program: spl_token::id(), system_program: system_program::ID }.to_account_metas(None),
        );
        w.env.svm.expire_blockhash();
        send(&mut w.env.svm, &[ixn], &p.key, &[]).unwrap();
        w.players.push((p.key, p.accts.player_token_account));
    }
    if injection > 0 {
        let (mint, tv) = (w.init.tokens.mint, w.init.tokens.treasury_vault);
        mint_to(&mut w.env, &mint, &tv, injection);
    }
    set_time(&mut w.env.svm, REG_END);
    w.lock().unwrap();
    set_time(&mut w.env.svm, STARTS);
    let payer = w.admin();
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &ix::StartTournament {}.data(), neonshift_core::accounts::StartTournament { payer: payer.pubkey(), tournament: t }.to_account_metas(None));
    send(&mut w.env.svm, &[ixn], &payer, &[]).unwrap();
    set_time(&mut w.env.svm, ENDS);
    w
}

impl World {
    fn admin(&self) -> Keypair {
        self.init.admin.insecure_clone()
    }
    fn admin_call(&mut self, data: Vec<u8>) -> litesvm::types::TransactionResult {
        let admin = self.admin();
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &data, neonshift_core::accounts::AdminSettlement { admin: admin.pubkey(), config: config_pda().0, tournament: tournament_pda() }.to_account_metas(None));
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn lock(&mut self) -> litesvm::types::TransactionResult {
        let admin = self.admin();
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::LockTournament {}.data(),
            neonshift_core::accounts::LockTournament { admin: admin.pubkey(), config: config_pda().0, tournament: tournament_pda(), vault: vault_pda(), treasury_vault: self.init.tokens.treasury_vault, token_program: spl_token::id() }.to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn forfeit(&mut self, wallet: &Pubkey, evidence: [u8; 32], rules_version: u16) -> litesvm::types::TransactionResult {
        let admin = self.admin();
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::ForfeitEntry { evidence_hash: evidence, rules_version }.data(),
            neonshift_core::accounts::ForfeitEntry { admin: admin.pubkey(), config: config_pda().0, tournament: tournament_pda(), entry: entry_pda(wallet) }.to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn begin(&mut self, expected: u32, hash: [u8; 32]) -> litesvm::types::TransactionResult {
        self.admin_call(ix::BeginSettlement { expected_count: expected, results_hash: hash }.data())
    }
    fn submit(&mut self, items: Vec<ResultItem>) -> litesvm::types::TransactionResult {
        let admin = self.admin();
        let mut metas = neonshift_core::accounts::AdminSettlement { admin: admin.pubkey(), config: config_pda().0, tournament: tournament_pda() }.to_account_metas(None);
        for it in &items {
            metas.push(AccountMeta::new(entry_pda(&it.wallet), false));
        }
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &ix::SubmitResultsBatch { items }.data(), metas);
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn settle(&mut self) -> litesvm::types::TransactionResult {
        let admin = self.admin();
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::SettleTournament {}.data(),
            neonshift_core::accounts::SettleTournament { admin: admin.pubkey(), config: config_pda().0, tournament: tournament_pda(), vault: vault_pda(), treasury_vault: self.init.tokens.treasury_vault, token_program: spl_token::id() }.to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn player_call(&mut self, i: usize, data: Vec<u8>) -> litesvm::types::TransactionResult {
        let (key, ata) = (self.players[i].0.insecure_clone(), self.players[i].1);
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &data,
            neonshift_core::accounts::ClaimPrize { player: key.pubkey(), config: config_pda().0, tournament: tournament_pda(), entry: entry_pda(&key.pubkey()), vault: vault_pda(), player_token_account: ata, token_program: spl_token::id() }.to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &key, &[])
    }
    fn claim(&mut self, i: usize) -> litesvm::types::TransactionResult {
        self.player_call(i, ix::ClaimPrize {}.data())
    }
    fn refund(&mut self, i: usize) -> litesvm::types::TransactionResult {
        self.player_call(i, ix::RefundAll {}.data())
    }
    fn cancel(&mut self, signer: &Keypair) -> litesvm::types::TransactionResult {
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::CancelTournament {}.data(),
            neonshift_core::accounts::CancelTournament { signer: signer.pubkey(), config: config_pda().0, tournament: tournament_pda(), vault: vault_pda(), treasury_vault: self.init.tokens.treasury_vault, token_program: spl_token::id() }.to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], signer, &[])
    }
    fn t(&self) -> Tournament {
        read(&self.env.svm, &tournament_pda())
    }
    fn entry(&self, i: usize) -> TournamentEntry {
        read(&self.env.svm, &entry_pda(&self.players[i].0.pubkey()))
    }
    fn vault(&self) -> u64 {
        token_balance(&self.env.svm, &vault_pda())
    }
    fn treasury(&self) -> u64 {
        token_balance(&self.env.svm, &self.init.tokens.treasury_vault)
    }
    fn bal(&self, i: usize) -> u64 {
        token_balance(&self.env.svm, &self.players[i].1)
    }
    /// 依玩家索引順序產生排名 items（rank = 位置 + 1），並算出預期 rolling hash
    fn results(&self, order: &[usize]) -> (Vec<ResultItem>, [u8; 32]) {
        let t = tournament_pda().to_bytes();
        let mut rolling = [0u8; 32];
        let items: Vec<ResultItem> = order
            .iter()
            .enumerate()
            .map(|(i, &p)| {
                let wallet = self.players[p].0.pubkey();
                let it = ResultItem { wallet, final_steps: 50_000 - i as u64 * 1_000, first_reached_at: ENDS - 1_000 + i as i64 };
                rolling = tm::roll(&rolling, &tm::canonical_result(&t, &wallet.to_bytes(), it.final_steps, it.first_reached_at, i as u32 + 1, false));
                it
            })
            .collect();
        (items, rolling)
    }
}

// ---------------------------------------------------------------- happy path

#[test]
fn full_settlement_conserves_funds_and_pays_by_rank() {
    let mut w = running(10, 600 * TSKR_UNIT);
    let order: Vec<usize> = (0..10).collect();
    let (items, hash) = w.results(&order);
    // 未 begin 不可提交
    assert_eq!(custom_error(&w.submit(items[..3].to_vec())), Some(6014));
    // 人數承諾錯誤
    assert_eq!(custom_error(&w.begin(9, hash)), Some(6022));
    w.begin(10, hash).unwrap();
    let t = w.t();
    assert_eq!(t.status, st::SETTLING);
    // 10 人：3 得獎退全額 150、7 人退 25×7=175；pool = 500+600-325 = 775
    assert_eq!(t.total_refund, 325 * TSKR_UNIT);
    assert_eq!(t.distributable_pool, 775 * TSKR_UNIT);
    assert_eq!(t.total_refund + t.total_prize + t.treasury_remainder, 1_100 * TSKR_UNIT);

    // 兩批：3 + 7
    w.submit(items[..3].to_vec()).unwrap();
    assert_eq!(w.t().results_submitted, 3);
    // 重複提交同一批 → entry 已排名
    assert_eq!(custom_error(&w.submit(items[..3].to_vec())), Some(6022));
    // 未完成不可 settle
    assert_eq!(custom_error(&w.settle()), Some(6022));
    w.submit(items[3..].to_vec()).unwrap();
    let t = w.t();
    assert_eq!(t.results_submitted, 10);
    assert_eq!(t.results_rolling_hash, hash);
    // 超量提交
    assert_eq!(custom_error(&w.submit(items[..1].to_vec())), Some(6022));

    let before_treasury = w.treasury();
    w.settle().unwrap();
    let t = w.t();
    assert_eq!(t.status, st::SETTLED);
    assert_eq!(w.treasury() - before_treasury, t.treasury_remainder);
    assert_eq!(w.vault(), t.total_refund + t.total_prize);

    // 分組：rank 1 = A、2～3 = B、其餘 0
    assert_eq!((w.entry(0).group, w.entry(1).group, w.entry(2).group, w.entry(3).group), (1, 2, 2, 0));
    assert_eq!(w.entry(9).rank, 10);

    // 逐一領取；領完 vault 歸零
    let (_, pa, pb) = tm::pools(&t, t.total_refund).unwrap();
    for i in 0..10 {
        let before = w.bal(i);
        w.claim(i).unwrap();
        let e = w.entry(i);
        let expected = tm::refund_for(&t, e.rank) + tm::prize_for(&t, 10, pa, pb, e.rank);
        assert_eq!(w.bal(i) - before, expected, "player {i}");
        assert!(e.settled);
        // 重複領取
        assert_eq!(custom_error(&w.claim(i)), Some(6033));
    }
    assert_eq!(w.vault(), 0);
    assert_eq!(w.t().distributed, t.total_refund + t.total_prize);
    // 第 1 名拿回 50 + A 組 60%×775 = 465 → 共 515；最後一名 25
    assert_eq!(w.bal(0), 50 * TSKR_UNIT + 515 * TSKR_UNIT);
    assert_eq!(w.bal(9), 50 * TSKR_UNIT + 25 * TSKR_UNIT);
}

#[test]
fn claim_prize_ignores_pause() {
    let mut w = running(3, 0);
    let (items, hash) = w.results(&[0, 1, 2]);
    w.begin(3, hash).unwrap();
    w.submit(items).unwrap();
    w.settle().unwrap();
    let admin = w.admin();
    send(&mut w.env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: true }.data())], &admin, &[]).unwrap();
    w.claim(0).unwrap();
}

// ---------------------------------------------------------------- forfeit

#[test]
fn forfeit_requires_window_evidence_and_rules_version() {
    let mut w = running(10, 0);
    let wallet = w.players[9].0.pubkey();
    set_time(&mut w.env.svm, ENDS - 1);
    assert_eq!(custom_error(&w.forfeit(&wallet, [7; 32], 3)), Some(6032));
    set_time(&mut w.env.svm, ENDS);
    assert_eq!(custom_error(&w.forfeit(&wallet, [0; 32], 3)), Some(6018));
    assert_eq!(custom_error(&w.forfeit(&wallet, [7; 32], 2)), Some(6036));
    w.forfeit(&wallet, [7; 32], 3).unwrap();
    assert_eq!(custom_error(&w.forfeit(&wallet, [7; 32], 3)), Some(6034));
    let e = w.entry(9);
    assert!(e.forfeited);
    assert_eq!(e.evidence_hash, [7; 32]);
    assert_eq!(w.t().forfeited_count, 1);
    // 非 admin
    let stranger = new_player(&mut w.env.svm);
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        neonshift_core::id(),
        &ix::ForfeitEntry { evidence_hash: [1; 32], rules_version: 3 }.data(),
        neonshift_core::accounts::ForfeitEntry { admin: stranger.pubkey(), config: config_pda().0, tournament: tournament_pda(), entry: entry_pda(&w.players[8].0.pubkey()) }.to_account_metas(None),
    );
    assert_eq!(custom_error(&send(&mut w.env.svm, &[ixn], &stranger, &[])), Some(6026));
}

#[test]
fn forfeited_stake_stays_in_pool_and_cannot_claim() {
    let mut w = running(10, 0);
    let cheater = w.players[9].0.pubkey();
    w.forfeit(&cheater, [9; 32], 3).unwrap();
    // begin 後不可再沒收
    let order: Vec<usize> = (0..9).collect();
    let (items, hash) = w.results(&order);
    w.begin(9, hash).unwrap();
    assert_eq!(custom_error(&w.forfeit(&w.players[8].0.pubkey(), [9; 32], 3)), Some(6014));
    // 排名批次含沒收者 → 拒絕
    let mut bad = items.clone();
    bad[8] = ResultItem { wallet: cheater, final_steps: 1, first_reached_at: ENDS };
    assert_eq!(custom_error(&w.submit(bad)), Some(6034));
    w.submit(items).unwrap();
    w.settle().unwrap();
    let t = w.t();
    // 9 人排名、得獎組仍為 lock 時固定的 (1, 2)：退款 150 + 6×25 = 300；沒收者 50 留在池中
    assert_eq!(t.total_refund, 300 * TSKR_UNIT);
    assert_eq!(t.distributable_pool, 200 * TSKR_UNIT);
    assert_eq!(custom_error(&w.claim(9)), Some(6034));
    for i in 0..9 {
        w.claim(i).unwrap();
    }
    assert_eq!(w.vault(), 0);
}

#[test]
fn all_forfeited_settles_with_zero_results_everything_to_treasury() {
    let mut w = running(2, 100 * TSKR_UNIT);
    for i in 0..2 {
        let wl = w.players[i].0.pubkey();
        w.forfeit(&wl, [1; 32], 3).unwrap();
    }
    w.begin(0, [0; 32]).unwrap();
    let t = w.t();
    assert_eq!((t.total_refund, t.total_prize, t.treasury_remainder), (0, 0, 200 * TSKR_UNIT));
    let before = w.treasury();
    w.settle().unwrap();
    assert_eq!(w.treasury() - before, 200 * TSKR_UNIT);
    assert_eq!(w.vault(), 0);
}

// ---------------------------------------------------------------- hash／batch 攻擊案例

#[test]
fn settle_rejects_wrong_commitment_and_reordered_batches() {
    let mut w = running(4, 0);
    let (items, hash) = w.results(&[0, 1, 2, 3]);
    // 承諾另一個順序的 hash，但提交時偷換順序
    let (_, other_hash) = w.results(&[3, 2, 1, 0]);
    w.begin(4, other_hash).unwrap();
    w.submit(items.clone()).unwrap();
    assert_eq!(custom_error(&w.settle()), Some(6035));
    // 承諾正確者：批次中 wallet 與 entry 帳戶不符 → 拒絕
    let mut w2 = running(4, 0);
    w2.begin(4, hash).unwrap();
    let admin = w2.admin();
    let mut metas = neonshift_core::accounts::AdminSettlement { admin: admin.pubkey(), config: config_pda().0, tournament: tournament_pda() }.to_account_metas(None);
    metas.push(AccountMeta::new(entry_pda(&w2.players[1].0.pubkey()), false)); // items[0] 是 player 0
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &ix::SubmitResultsBatch { items: items[..1].to_vec() }.data(), metas);
    assert_eq!(custom_error(&send(&mut w2.env.svm, &[ixn], &admin, &[])), Some(6022));
    // 帳戶數與 items 數不符
    let metas = neonshift_core::accounts::AdminSettlement { admin: admin.pubkey(), config: config_pda().0, tournament: tournament_pda() }.to_account_metas(None);
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &ix::SubmitResultsBatch { items: items[..1].to_vec() }.data(), metas);
    w2.env.svm.expire_blockhash();
    assert_eq!(custom_error(&send(&mut w2.env.svm, &[ixn], &admin, &[])), Some(6022));
}

#[test]
fn begin_settlement_requires_ends_at_and_running() {
    let mut w = running(3, 0);
    set_time(&mut w.env.svm, ENDS - 1);
    assert_eq!(custom_error(&w.begin(3, [0; 32])), Some(6032));
    set_time(&mut w.env.svm, ENDS);
    w.begin(3, [0; 32]).unwrap();
    assert_eq!(custom_error(&w.begin(3, [0; 32])), Some(6014));
}

// ---------------------------------------------------------------- cancel／refund

#[test]
fn admin_cancel_returns_injection_and_forfeits_then_players_refund() {
    let mut w = running(4, 300 * TSKR_UNIT);
    let cheater = w.players[3].0.pubkey();
    w.forfeit(&cheater, [5; 32], 3).unwrap();
    let admin = w.admin();
    let before = w.treasury();
    w.cancel(&admin).unwrap();
    let t = w.t();
    assert_eq!(t.status, st::CANCELLED);
    // 歸庫 = 挹注 300 + 沒收 50
    assert_eq!(w.treasury() - before, 350 * TSKR_UNIT);
    assert_eq!(t.total_refund, 150 * TSKR_UNIT);
    assert_eq!(w.vault(), 150 * TSKR_UNIT);
    for i in 0..3 {
        let b = w.bal(i);
        w.refund(i).unwrap();
        assert_eq!(w.bal(i) - b, DEFAULT_STAKE_AMOUNT);
        assert_eq!(custom_error(&w.refund(i)), Some(6033));
    }
    assert_eq!(custom_error(&w.refund(3)), Some(6034));
    assert_eq!(w.vault(), 0);
    // Cancelled 不可 claim_prize
    assert_eq!(custom_error(&w.claim(0)), Some(6014));
}

#[test]
fn anyone_can_cancel_after_settlement_deadline() {
    let mut w = running(3, 0);
    let stranger = new_player(&mut w.env.svm);
    assert_eq!(custom_error(&w.cancel(&stranger)), Some(6032));
    set_time(&mut w.env.svm, ENDS + SETTLEMENT_DEADLINE_SECONDS);
    w.cancel(&stranger).unwrap();
    assert_eq!(w.t().status, st::CANCELLED);
    w.refund(0).unwrap();
    // Settled 後不可取消
    let mut w2 = running(2, 0);
    let (items, hash) = w2.results(&[0, 1]);
    w2.begin(2, hash).unwrap();
    w2.submit(items).unwrap();
    w2.settle().unwrap();
    let admin = w2.admin();
    assert_eq!(custom_error(&w2.cancel(&admin)), Some(6014));
}

#[test]
fn cancel_during_registration_refunds_everyone() {
    let mut env = setup();
    set_time(&mut env.svm, T0);
    let init = initialize(&mut env);
    let mut w = World { env, init, players: vec![] };
    let admin = w.admin();
    let t = tournament_pda();
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        neonshift_core::id(),
        &ix::CreateTournament { params: CreateTournamentParams { week_id: WEEK, stake_amount: DEFAULT_STAKE_AMOUNT, treasury_injection_cap: 0, min_entrants: 1, registration_ends_at: REG_END, starts_at: STARTS, ends_at: ENDS, rules_version: 3 } }.data(),
        neonshift_core::accounts::CreateTournament { admin: admin.pubkey(), config: config_pda().0, tournament: t, mint: w.init.tokens.mint, vault: vault_pda(), token_program: spl_token::id(), system_program: system_program::ID }.to_account_metas(None),
    );
    send(&mut w.env.svm, &[ixn], &admin, &[]).unwrap();
    w.admin_call(ix::OpenTournament {}.data()).unwrap();
    let init = Initialized { admin: w.init.admin.insecure_clone(), attestor: w.init.attestor, tokens: TokenSetup { ..w.init.tokens }, config: w.init.config };
    let p = ready_player(&mut w.env, &init);
    mint_to(&mut w.env, &w.init.tokens.mint, &p.accts.player_token_account, 100 * TSKR_UNIT);
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        neonshift_core::id(),
        &ix::JoinTournament {}.data(),
        neonshift_core::accounts::JoinTournament { player: p.key.pubkey(), config: config_pda().0, tournament: t, entry: entry_pda(&p.key.pubkey()), vault: vault_pda(), player_token_account: p.accts.player_token_account, token_program: spl_token::id(), system_program: system_program::ID }.to_account_metas(None),
    );
    send(&mut w.env.svm, &[ixn], &p.key, &[]).unwrap();
    w.players.push((p.key, p.accts.player_token_account));
    w.cancel(&admin).unwrap();
    assert_eq!(w.t().valid_entrant_count, 1);
    w.refund(0).unwrap();
    assert_eq!(w.bal(0), 100 * TSKR_UNIT);
}
