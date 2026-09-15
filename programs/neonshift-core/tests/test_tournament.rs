//! PG-C-11／C-12：錦標賽建立、開放、報名、截止（分組／挹注／對帳／取消）與開始。

mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::{program_pack::Pack, system_program}, InstructionData, ToAccountMetas},
    anchor_spl::token::spl_token,
    common::*,
    neonshift_core::{constants::tournament_status as st, instruction as ix, CreateTournamentParams, Tournament, TournamentEntry},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const WEEK: u32 = 2026_38;
const REG_END: i64 = T0 + 3_600;
const STARTS: i64 = T0 + 7_200;
const ENDS: i64 = T0 + 7_200 + 2 * SECONDS_PER_DAY;

struct World {
    env: Env,
    init: Initialized,
}

fn world() -> World {
    let mut env = setup();
    set_time(&mut env.svm, T0);
    let init = initialize(&mut env);
    mint_to(&mut env, &init.tokens.mint, &init.tokens.reward_vault, 1_000_000 * TSKR_UNIT);
    World { env, init }
}

fn tournament_pda(week_id: u32) -> Pubkey {
    Pubkey::find_program_address(&[TOURNAMENT_SEED, &week_id.to_le_bytes()], &neonshift_core::id()).0
}
fn vault_pda(tournament: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", tournament.as_ref()], &neonshift_core::id()).0
}
fn entry_pda(tournament: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ENTRY_SEED, tournament.as_ref(), wallet.as_ref()], &neonshift_core::id()).0
}

fn params() -> CreateTournamentParams {
    CreateTournamentParams {
        week_id: WEEK,
        stake_amount: DEFAULT_STAKE_AMOUNT,
        treasury_injection_cap: 1_000 * TSKR_UNIT,
        min_entrants: 3,
        registration_ends_at: REG_END,
        starts_at: STARTS,
        ends_at: ENDS,
        rules_version: 3,
    }
}

impl World {
    fn admin(&self) -> Keypair {
        self.init.admin.insecure_clone()
    }
    fn create(&mut self, p: CreateTournamentParams) -> litesvm::types::TransactionResult {
        let admin = self.admin();
        let t = tournament_pda(p.week_id);
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::CreateTournament { params: p }.data(),
            neonshift_core::accounts::CreateTournament {
                admin: admin.pubkey(),
                config: config_pda().0,
                tournament: t,
                mint: self.init.tokens.mint,
                vault: vault_pda(&t),
                token_program: spl_token::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn admin_t(&mut self, data: Vec<u8>, signer: &Keypair) -> litesvm::types::TransactionResult {
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &data,
            neonshift_core::accounts::AdminTournament { admin: signer.pubkey(), config: config_pda().0, tournament: tournament_pda(WEEK) }.to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], signer, &[])
    }
    fn open(&mut self) -> litesvm::types::TransactionResult {
        let a = self.admin();
        self.admin_t(ix::OpenTournament {}.data(), &a)
    }
    fn join_with(&mut self, player: &Keypair, token_account: Pubkey) -> litesvm::types::TransactionResult {
        let t = tournament_pda(WEEK);
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::JoinTournament {}.data(),
            neonshift_core::accounts::JoinTournament {
                player: player.pubkey(),
                config: config_pda().0,
                tournament: t,
                entry: entry_pda(&t, &player.pubkey()),
                vault: vault_pda(&t),
                player_token_account: token_account,
                token_program: spl_token::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], player, &[])
    }
    /// 建立有 tSKR 的玩家並報名
    fn funded_player(&mut self, tskr: u64) -> (Keypair, Pubkey) {
        let init = Initialized { admin: self.init.admin.insecure_clone(), attestor: self.init.attestor, tokens: TokenSetup { ..self.init.tokens }, config: self.init.config };
        let p = ready_player(&mut self.env, &init);
        if tskr > 0 {
            mint_to(&mut self.env, &self.init.tokens.mint, &p.accts.player_token_account, tskr);
        }
        (p.key, p.accts.player_token_account)
    }
    fn join_new(&mut self) -> (Keypair, Pubkey) {
        let (k, ata) = self.funded_player(100 * TSKR_UNIT);
        self.join_with(&k, ata).unwrap();
        (k, ata)
    }
    fn lock(&mut self) -> litesvm::types::TransactionResult {
        let admin = self.admin();
        let t = tournament_pda(WEEK);
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::LockTournament {}.data(),
            neonshift_core::accounts::LockTournament {
                admin: admin.pubkey(),
                config: config_pda().0,
                tournament: t,
                vault: vault_pda(&t),
                treasury_vault: self.init.tokens.treasury_vault,
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn start(&mut self, payer: &Keypair) -> litesvm::types::TransactionResult {
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::StartTournament {}.data(),
            neonshift_core::accounts::StartTournament { payer: payer.pubkey(), tournament: tournament_pda(WEEK) }.to_account_metas(None),
        );
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], payer, &[])
    }
    fn t(&self) -> Tournament {
        read(&self.env.svm, &tournament_pda(WEEK))
    }
    fn vault_balance(&self) -> u64 {
        token_balance(&self.env.svm, &vault_pda(&tournament_pda(WEEK)))
    }
    fn fund_treasury(&mut self, amount: u64) {
        let mint = self.init.tokens.mint;
        let tv = self.init.tokens.treasury_vault;
        mint_to(&mut self.env, &mint, &tv, amount);
    }
}

// ---------------------------------------------------------------- create

#[test]
fn create_writes_immutable_params_and_pda_vault() {
    let mut w = world();
    w.create(params()).unwrap();
    let t = w.t();
    assert_eq!(t.status, st::DRAFT);
    assert_eq!(t.week_id, WEEK);
    assert_eq!(t.vault, vault_pda(&tournament_pda(WEEK)));
    assert_eq!(t.stake_amount, DEFAULT_STAKE_AMOUNT);
    assert_eq!(t.treasury_injection_cap, 1_000 * TSKR_UNIT);
    assert_eq!((t.prize_a_bps, t.prize_b_bps, t.loser_refund_bps), (6_000, 4_000, 5_000));
    assert_eq!(t.results_rolling_hash, [0u8; 32]);
    assert_eq!(t.created_at, T0);
    // vault owner = Tournament PDA（BR-22）
    let acc = w.env.svm.get_account(&t.vault).unwrap();
    let ta = anchor_spl::token::spl_token::state::Account::unpack(&acc.data).unwrap();
    assert_eq!(ta.owner, tournament_pda(WEEK));
    assert_eq!(ta.mint, w.init.tokens.mint);
}

#[test]
fn create_rejects_bad_params_and_non_admin() {
    let mut w = world();
    let bad = |f: fn(&mut CreateTournamentParams)| {
        let mut p = params();
        f(&mut p);
        p
    };
    for p in [
        bad(|p| p.week_id = 2026_00),
        bad(|p| p.week_id = 2026_54),
        bad(|p| p.week_id = 1999_10),
        bad(|p| p.stake_amount = 0),
        bad(|p| p.treasury_injection_cap = MAX_TREASURY_INJECTION + 1),
        bad(|p| p.min_entrants = 0),
        bad(|p| p.rules_version = 0),
        bad(|p| p.registration_ends_at = T0), // 已截止
        bad(|p| p.starts_at = REG_END - 1),
        bad(|p| p.ends_at = STARTS),
    ] {
        w.env.svm.expire_blockhash();
        assert_eq!(custom_error(&w.create(p)), Some(6031));
    }
    // 非 admin
    let stranger = new_player(&mut w.env.svm);
    let t = tournament_pda(WEEK);
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        neonshift_core::id(),
        &ix::CreateTournament { params: params() }.data(),
        neonshift_core::accounts::CreateTournament {
            admin: stranger.pubkey(),
            config: config_pda().0,
            tournament: t,
            mint: w.init.tokens.mint,
            vault: vault_pda(&t),
            token_program: spl_token::id(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let res = send(&mut w.env.svm, &[ixn], &stranger, &[]);
    assert_eq!(custom_error(&res), Some(6026));
    // 同一週不可重建
    w.create(params()).unwrap();
    w.env.svm.expire_blockhash();
    assert!(w.create(params()).is_err());
}

// ---------------------------------------------------------------- open / join

#[test]
fn open_then_join_transfers_stake_and_creates_entry() {
    let mut w = world();
    w.create(params()).unwrap();
    // 未開放不可報名
    let (p0, ata0) = w.funded_player(100 * TSKR_UNIT);
    assert_eq!(custom_error(&w.join_with(&p0, ata0)), Some(6014));
    w.open().unwrap();
    assert_eq!(w.t().status, st::REGISTRATION);
    // 重複 open
    assert_eq!(custom_error(&w.open()), Some(6014));

    w.join_with(&p0, ata0).unwrap();
    let t = w.t();
    assert_eq!((t.entrant_count, t.total_staked), (1, DEFAULT_STAKE_AMOUNT));
    assert_eq!(w.vault_balance(), DEFAULT_STAKE_AMOUNT);
    assert_eq!(token_balance(&w.env.svm, &ata0), 50 * TSKR_UNIT);
    let e: TournamentEntry = read(&w.env.svm, &entry_pda(&tournament_pda(WEEK), &p0.pubkey()));
    assert_eq!((e.stake, e.rank, e.group, e.forfeited, e.settled, e.joined_at), (DEFAULT_STAKE_AMOUNT, 0, 0, false, false, T0));
    assert_eq!(e.wallet, p0.pubkey());

    // 重複報名：entry PDA 已存在
    assert!(w.join_with(&p0, ata0).is_err());
    // 餘額不足
    let (p1, ata1) = w.funded_player(10 * TSKR_UNIT);
    assert!(w.join_with(&p1, ata1).is_err());
    assert_eq!(w.t().entrant_count, 1);
}

#[test]
fn join_rejected_when_paused_or_after_registration_ends() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    let admin = w.admin();
    send(&mut w.env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: true }.data())], &admin, &[]).unwrap();
    let (p, ata) = w.funded_player(100 * TSKR_UNIT);
    assert_eq!(custom_error(&w.join_with(&p, ata)), Some(6000));
    w.env.svm.expire_blockhash();
    send(&mut w.env.svm, &[admin_ix(&admin.pubkey(), ix::SetPaused { paused: false }.data())], &admin, &[]).unwrap();
    set_time(&mut w.env.svm, REG_END);
    assert_eq!(custom_error(&w.join_with(&p, ata)), Some(6032));
}

#[test]
fn join_rejects_wrong_mint_or_foreign_token_account() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    let (p, _) = w.funded_player(100 * TSKR_UNIT);
    let deployer = w.env.deployer.insecure_clone();
    let other_mint = create_mint(&mut w.env.svm, &deployer, &deployer.pubkey(), TSKR_DECIMALS);
    let other_ata = create_token_account(&mut w.env.svm, &deployer, &other_mint, &p.pubkey());
    assert_eq!(custom_error(&w.join_with(&p, other_ata)), Some(6021));
    let stranger_ata = create_token_account(&mut w.env.svm, &deployer, &w.init.tokens.mint, &Pubkey::new_unique());
    assert_eq!(custom_error(&w.join_with(&p, stranger_ata)), Some(6021));
}

// ---------------------------------------------------------------- lock

#[test]
fn lock_fixes_groups_injects_treasury_and_reconciles_vault() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    for _ in 0..10 {
        w.join_new();
    }
    w.fund_treasury(600 * TSKR_UNIT); // 少於上限 1,000 → 挹注 600
    // 未到截止不可 lock
    assert_eq!(custom_error(&w.lock()), Some(6032));
    set_time(&mut w.env.svm, REG_END);
    w.lock().unwrap();
    let t = w.t();
    assert_eq!(t.status, st::LOCKED);
    assert_eq!(t.valid_entrant_count, 10);
    assert_eq!((t.group_a_size, t.group_b_size), (1, 2)); // BR-18：winners 3、A 1、B 2
    assert_eq!(t.treasury_injection, 600 * TSKR_UNIT);
    assert_eq!(t.total_staked, 10 * DEFAULT_STAKE_AMOUNT);
    assert_eq!(w.vault_balance(), 10 * DEFAULT_STAKE_AMOUNT + 600 * TSKR_UNIT);
    assert_eq!(token_balance(&w.env.svm, &w.init.tokens.treasury_vault), 0);
    // lock 後不可再報名、不可重複 lock
    let (p, ata) = w.funded_player(100 * TSKR_UNIT);
    assert_eq!(custom_error(&w.join_with(&p, ata)), Some(6014));
    assert_eq!(custom_error(&w.lock()), Some(6014));
}

#[test]
fn lock_caps_injection_at_creation_cap() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    for _ in 0..3 {
        w.join_new();
    }
    w.fund_treasury(5_000 * TSKR_UNIT);
    set_time(&mut w.env.svm, REG_END);
    w.lock().unwrap();
    let t = w.t();
    assert_eq!(t.treasury_injection, 1_000 * TSKR_UNIT);
    assert_eq!(token_balance(&w.env.svm, &w.init.tokens.treasury_vault), 4_000 * TSKR_UNIT);
    assert_eq!((t.group_a_size, t.group_b_size), (1, 0)); // n=3：winners 1、A 1、B 0
}

#[test]
fn lock_cancels_when_below_min_entrants_without_injection() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    w.join_new();
    w.join_new();
    w.fund_treasury(1_000 * TSKR_UNIT);
    set_time(&mut w.env.svm, REG_END);
    w.lock().unwrap();
    let t = w.t();
    assert_eq!(t.status, st::CANCELLED);
    assert_eq!(t.valid_entrant_count, 2);
    assert_eq!(t.treasury_injection, 0);
    assert_eq!(token_balance(&w.env.svm, &w.init.tokens.treasury_vault), 1_000 * TSKR_UNIT);
    assert_eq!(w.vault_balance(), 2 * DEFAULT_STAKE_AMOUNT);
    // Cancelled 不可 start
    let payer = new_player(&mut w.env.svm);
    assert_eq!(custom_error(&w.start(&payer)), Some(6014));
}

#[test]
fn lock_detects_vault_balance_mismatch() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    for _ in 0..3 {
        w.join_new();
    }
    // 有人直接往 vault 多打 1 tSKR → 帳面與實際不符
    let vault = vault_pda(&tournament_pda(WEEK));
    let mint = w.init.tokens.mint;
    mint_to(&mut w.env, &mint, &vault, TSKR_UNIT);
    set_time(&mut w.env.svm, REG_END);
    assert_eq!(custom_error(&w.lock()), Some(6017));
}

#[test]
fn lock_requires_admin_and_config_treasury() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    for _ in 0..3 {
        w.join_new();
    }
    set_time(&mut w.env.svm, REG_END);
    let stranger = new_player(&mut w.env.svm);
    let t = tournament_pda(WEEK);
    let deployer = w.env.deployer.insecure_clone();
    let fake_treasury = create_token_account(&mut w.env.svm, &deployer, &w.init.tokens.mint, &stranger.pubkey());
    let metas = neonshift_core::accounts::LockTournament {
        admin: stranger.pubkey(),
        config: config_pda().0,
        tournament: t,
        vault: vault_pda(&t),
        treasury_vault: w.init.tokens.treasury_vault,
        token_program: spl_token::id(),
    }
    .to_account_metas(None);
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &ix::LockTournament {}.data(), metas);
    assert_eq!(custom_error(&send(&mut w.env.svm, &[ixn], &stranger, &[])), Some(6026));
    let admin = w.admin();
    let mut metas = neonshift_core::accounts::LockTournament {
        admin: admin.pubkey(),
        config: config_pda().0,
        tournament: t,
        vault: vault_pda(&t),
        treasury_vault: fake_treasury,
        token_program: spl_token::id(),
    }
    .to_account_metas(None);
    metas[4].pubkey = fake_treasury;
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(neonshift_core::id(), &ix::LockTournament {}.data(), metas);
    assert_eq!(custom_error(&send(&mut w.env.svm, &[ixn], &admin, &[])), Some(6021));
}

// ---------------------------------------------------------------- start

#[test]
fn start_by_anyone_after_starts_at() {
    let mut w = world();
    w.create(params()).unwrap();
    w.open().unwrap();
    for _ in 0..3 {
        w.join_new();
    }
    let payer = new_player(&mut w.env.svm);
    // Registration 狀態不可 start
    assert_eq!(custom_error(&w.start(&payer)), Some(6014));
    set_time(&mut w.env.svm, REG_END);
    w.lock().unwrap();
    // 未到 starts_at
    assert_eq!(custom_error(&w.start(&payer)), Some(6032));
    set_time(&mut w.env.svm, STARTS);
    w.start(&payer).unwrap();
    assert_eq!(w.t().status, st::RUNNING);
    // 規則不變、不可重複 start
    let t = w.t();
    assert_eq!((t.group_a_size, t.group_b_size, t.stake_amount), (1, 0, DEFAULT_STAKE_AMOUNT));
    assert_eq!(custom_error(&w.start(&payer)), Some(6014));
}

#[test]
fn group_sizes_follow_br18() {
    // (n) → (A, B)：winners = max(1, ceil(30%))，A = max(1, ceil(10%))
    for (n, a, b) in [(1, 1, 0), (3, 1, 0), (4, 1, 1), (10, 1, 2), (11, 2, 2), (20, 2, 4), (33, 4, 6), (100, 10, 20)] {
        assert_eq!(Tournament::group_sizes(n), (a, b), "n={n}");
    }
}
