//! LiteSVM 測試共用工具（SD 7）。
#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, program_pack::Pack, system_instruction},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    litesvm::{types::TransactionResult, LiteSVM},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub use neonshift_core::constants::*;
use anchor_lang::prelude::Clock;

pub struct Env {
    pub svm: LiteSVM,
    /// 程式 upgrade authority（模擬部署者）
    pub deployer: Keypair,
    pub program_data: Pubkey,
}

pub fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/neonshift_core.so"));
    svm.add_program(neonshift_core::id(), bytes).unwrap();
    let deployer = Keypair::new();
    svm.airdrop(&deployer.pubkey(), 100_000_000_000).unwrap();
    let program_data = set_upgrade_authority(&mut svm, &deployer.pubkey());
    Env { svm, deployer, program_data }
}

/// LiteSVM 的 add_program 會把 upgrade_authority 設為 None；改寫 ProgramData 標頭以模擬真實部署。
/// bincode 佈局：u32 tag(3) | u64 slot | Option<Pubkey>（u8 + 32）
pub fn set_upgrade_authority(svm: &mut LiteSVM, authority: &Pubkey) -> Pubkey {
    let (program_data, _) = Pubkey::find_program_address(&[neonshift_core::id().as_ref()], &bpf_loader_upgradeable::id());
    let mut acc = svm.get_account(&program_data).expect("programdata account");
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(authority.as_ref());
    svm.set_account(program_data, acc).unwrap();
    program_data
}

pub fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> TransactionResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend(signers.iter().copied().filter(|k| k.pubkey() != payer.pubkey()));
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
    svm.send_transaction(tx)
}

/// 從交易失敗結果取出 Anchor 自訂錯誤碼（6000 起）
pub fn custom_error(res: &TransactionResult) -> Option<u32> {
    let err = res.as_ref().err()?;
    let s = format!("{:?}", err.err);
    // 形如 InstructionError(0, Custom(6023))
    let idx = s.find("Custom(")?;
    let rest = &s[idx + 7..];
    let end = rest.find(')')?;
    rest[..end].parse().ok()
}

pub fn create_mint(svm: &mut LiteSVM, payer: &Keypair, authority: &Pubkey, decimals: u8) -> Pubkey {
    let mint = Keypair::new();
    let space = spl_token::state::Mint::LEN;
    let lamports = svm.minimum_balance_for_rent_exemption(space);
    let ixs = [
        system_instruction::create_account(&payer.pubkey(), &mint.pubkey(), lamports, space as u64, &spl_token::id()),
        spl_token::instruction::initialize_mint2(&spl_token::id(), &mint.pubkey(), authority, None, decimals).unwrap(),
    ];
    send(svm, &ixs, payer, &[&mint]).unwrap();
    mint.pubkey()
}

pub fn create_token_account(svm: &mut LiteSVM, payer: &Keypair, mint: &Pubkey, owner: &Pubkey) -> Pubkey {
    let acc = Keypair::new();
    let space = spl_token::state::Account::LEN;
    let lamports = svm.minimum_balance_for_rent_exemption(space);
    let ixs = [
        system_instruction::create_account(&payer.pubkey(), &acc.pubkey(), lamports, space as u64, &spl_token::id()),
        spl_token::instruction::initialize_account3(&spl_token::id(), &acc.pubkey(), mint, owner).unwrap(),
    ];
    send(svm, &ixs, payer, &[&acc]).unwrap();
    acc.pubkey()
}

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &neonshift_core::id())
}

pub fn read<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).expect("account");
    let mut data: &[u8] = &acc.data;
    T::try_deserialize(&mut data).unwrap()
}

pub fn default_params(admin: Pubkey, attestor: Pubkey) -> neonshift_core::InitializeConfigParams {
    neonshift_core::InitializeConfigParams {
        admin,
        cluster_id: CLUSTER_LOCALNET,
        attestor_pubkey: attestor,
        daily_cap: DEFAULT_DAILY_CAP,
        base_steps_reward: DEFAULT_BASE_STEPS_REWARD,
        base_sleep_reward: DEFAULT_BASE_SLEEP_REWARD,
        streak_enabled: false,
        streak_bonus_bps: DEFAULT_STREAK_BONUS_BPS,
        burn_bps: DEFAULT_BURN_BPS,
        core_multiplier_bps: DEFAULT_CORE_MULTIPLIER_BPS,
        core_upgrade_costs: [50 * TSKR_UNIT, 120 * TSKR_UNIT, 250 * TSKR_UNIT, 500 * TSKR_UNIT],
        shoe_xp_thresholds: DEFAULT_SHOE_XP_THRESHOLDS,
    }
}

/// 建立 mint（6 decimals）、reward vault（owner = Config PDA）與 treasury vault
pub struct TokenSetup {
    pub mint: Pubkey,
    pub reward_vault: Pubkey,
    pub treasury_vault: Pubkey,
}

pub fn setup_tokens(env: &mut Env, decimals: u8) -> TokenSetup {
    let (config, _) = config_pda();
    let deployer = env.deployer.insecure_clone();
    let mint = create_mint(&mut env.svm, &deployer, &deployer.pubkey(), decimals);
    let reward_vault = create_token_account(&mut env.svm, &deployer, &mint, &config);
    let treasury_vault = create_token_account(&mut env.svm, &deployer, &mint, &deployer.pubkey());
    TokenSetup { mint, reward_vault, treasury_vault }
}

/// 目前鏈上時間
pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

/// 把鏈上時間往前撥 `seconds`，並讓 blockhash 失效以免重複交易被去重
pub fn advance_time(svm: &mut LiteSVM, seconds: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp += seconds;
    clock.slot += 1;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();
}

/// 完成 initialize_config，回傳 admin keypair 與 token 帳戶
pub struct Initialized {
    pub admin: Keypair,
    pub attestor: Pubkey,
    pub tokens: TokenSetup,
    pub config: Pubkey,
}

pub fn initialize(env: &mut Env) -> Initialized {
    initialize_with(env, Pubkey::new_unique(), |_| {})
}

pub fn initialize_with(
    env: &mut Env,
    attestor: Pubkey,
    tweak: impl FnOnce(&mut neonshift_core::InitializeConfigParams),
) -> Initialized {
    use anchor_lang::solana_program::system_program;
    let tokens = setup_tokens(env, TSKR_DECIMALS);
    let admin = Keypair::new();
    env.svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (config, _) = config_pda();
    let deployer = env.deployer.insecure_clone();
    let mut params = default_params(admin.pubkey(), attestor);
    tweak(&mut params);
    let ix = Instruction::new_with_bytes(
        neonshift_core::id(),
        &neonshift_core::instruction::InitializeConfig { params }.data(),
        neonshift_core::accounts::InitializeConfig {
            authority: deployer.pubkey(),
            config,
            mint: tokens.mint,
            reward_vault: tokens.reward_vault,
            treasury_vault: tokens.treasury_vault,
            program: neonshift_core::id(),
            program_data: env.program_data,
            token_program: spl_token::id(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &deployer, &[]).unwrap();
    Initialized { admin, attestor, tokens, config }
}

pub fn admin_ix(admin: &Pubkey, data: Vec<u8>) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        neonshift_core::id(),
        &data,
        neonshift_core::accounts::AdminOnly { admin: *admin, config }.to_account_metas(None),
    )
}

pub fn player_pda(wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PLAYER_SEED, wallet.as_ref()], &neonshift_core::id())
}

pub fn init_player_ix(player: &Pubkey) -> Instruction {
    use anchor_lang::solana_program::system_program;
    Instruction::new_with_bytes(
        neonshift_core::id(),
        &neonshift_core::instruction::InitPlayer {}.data(),
        neonshift_core::accounts::InitPlayer {
            player: *player,
            config: config_pda().0,
            profile: player_pda(player).0,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// 建立並資助一個玩家錢包
pub fn new_player(svm: &mut LiteSVM) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), 5_000_000_000).unwrap();
    k
}

// ---------------- clock_in 測試工具（PG-C-04／C-05） ----------------

use ed25519_dalek::{Signer as DalekSigner, SigningKey};
use neonshift_core::AttestationArgs;

/// 把鏈上時間設為指定 unix 秒
pub fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    clock.slot += 1;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();
}

pub fn task_date_of(unix: i64) -> u32 {
    (unix.div_euclid(SECONDS_PER_DAY)) as u32
}

/// 產生 attestor 金鑰（後端 signer 的模擬）；以 Solana Keypair 的隨機 seed 建立 dalek 金鑰
pub fn new_attestor() -> SigningKey {
    let seed: [u8; 32] = Keypair::new().to_bytes()[..32].try_into().unwrap();
    SigningKey::from_bytes(&seed)
}

pub fn attestor_pubkey(k: &SigningKey) -> Pubkey {
    Pubkey::new_from_array(k.verifying_key().to_bytes())
}

/// 以鏈上目前時間為基準的合法 attestation 參數
pub fn valid_args(svm: &LiteSVM, wallet: &Pubkey, task_type: u8) -> AttestationArgs {
    let now = now(svm);
    AttestationArgs {
        version: attestation_core::VERSION,
        program_id: neonshift_core::id(),
        cluster_id: CLUSTER_LOCALNET,
        wallet: *wallet,
        task_date: task_date_of(now),
        task_type,
        rules_version: 3,
        evidence_hash: [0x33; 32],
        issued_at: now - 5,
        not_before: now - 5,
        expiry: now + 300,
        nonce: {
            let k = Keypair::new().to_bytes();
            let mut n = [0u8; 16];
            n.copy_from_slice(&k[..16]);
            n
        },
    }
}

pub fn canonical(args: &AttestationArgs) -> [u8; 164] {
    attestation_core::Attestation::from(args).encode()
}

/// 標準 ed25519 驗簽指令（與後端／App 的組法一致）
pub fn ed25519_ix(attestor: &SigningKey, message: &[u8]) -> Instruction {
    let sig = attestor.sign(message).to_bytes();
    solana_ed25519_program::new_ed25519_instruction_with_signature(message, &sig, &attestor.verifying_key().to_bytes())
}

pub fn receipt_pda(wallet: &Pubkey, task_date: u32, task_type: u8) -> Pubkey {
    Pubkey::find_program_address(
        &[CLAIM_SEED, wallet.as_ref(), &task_date.to_le_bytes(), &[task_type]],
        &neonshift_core::id(),
    )
    .0
}

pub struct ClockInAccounts {
    pub reward_vault: Pubkey,
    pub mint: Pubkey,
    pub player_token_account: Pubkey,
}

pub fn clock_in_ix(player: &Pubkey, accts: &ClockInAccounts, args: AttestationArgs) -> Instruction {
    use anchor_lang::solana_program::system_program;
    Instruction::new_with_bytes(
        neonshift_core::id(),
        &neonshift_core::instruction::ClockIn { args }.data(),
        neonshift_core::accounts::ClockIn {
            player: *player,
            config: config_pda().0,
            profile: player_pda(player).0,
            receipt: receipt_pda(player, args.task_date, args.task_type),
            mint: accts.mint,
            reward_vault: accts.reward_vault,
            player_token_account: accts.player_token_account,
            token_program: spl_token::id(),
            system_program: system_program::ID,
            instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
        }
        .to_account_metas(None),
    )
}

/// mint 到指定 token account（deployer 為 mint authority）
pub fn mint_to(env: &mut Env, mint: &Pubkey, to: &Pubkey, amount: u64) {
    let deployer = env.deployer.insecure_clone();
    let ix = spl_token::instruction::mint_to(&spl_token::id(), mint, to, &deployer.pubkey(), &[], amount).unwrap();
    send(&mut env.svm, &[ix], &deployer, &[]).unwrap();
}

pub fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let acc = svm.get_account(account).unwrap();
    spl_token::state::Account::unpack(&acc.data).unwrap().amount
}

/// 一次完成：玩家 init（跑鞋隨之贈與）、token 帳戶
pub struct Player {
    pub key: Keypair,
    pub accts: ClockInAccounts,
}

pub fn ready_player(env: &mut Env, init: &Initialized) -> Player {
    let key = new_player(&mut env.svm);
    send(&mut env.svm, &[init_player_ix(&key.pubkey())], &key, &[]).unwrap();
    let deployer = env.deployer.insecure_clone();
    let player_token_account = create_token_account(&mut env.svm, &deployer, &init.tokens.mint, &key.pubkey());
    Player {
        key,
        accts: ClockInAccounts { reward_vault: init.tokens.reward_vault, mint: init.tokens.mint, player_token_account },
    }
}

pub const T0: i64 = 1_789_000_000; // 2026-09-14 前後
