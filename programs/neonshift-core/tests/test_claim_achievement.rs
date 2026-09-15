//! PG-R-08：`set_achievement_eligibility`（registry）＋`claim_achievement`（194-byte 證明＋registry＋唯一 receipt）。
//! 涵蓋：正常鑄造、證明篡改、registry 未核准／撤銷／revision 不符、過期、重複鑄造、換 achievement_id 可再鑄、簽出後撤銷競態。

mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_program, InstructionData, ToAccountMetas},
    attestation_core::{AchievementProof, ACHIEVEMENT_VERSION, CATEGORY_FASTEST_5K, CLASS_DEVICE},
    common::*,
    neonshift_core::{instruction as ix, mpl_core::MPL_CORE_ID, AchievementArgs, AchievementEligibility, AchievementReceipt, SetEligibilityParams},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const MPL_CORE_SO: &[u8] = include_bytes!("fixtures/mpl_core.so");
const ELIGIBILITY_SEED: &[u8] = b"eligibility";
const ACHIEVEMENT_SEED: &[u8] = b"achievement";
const ACHIEVEMENT_ASSET_SEED: &[u8] = b"aasset";

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
    let player = ready_player(&mut env, &init);
    World { env, init, attestor, player }
}

fn pda(seed: &[u8], wallet: &Pubkey, id: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[seed, wallet.as_ref(), id], &neonshift_core::id()).0
}

impl World {
    fn wallet(&self) -> Pubkey {
        self.player.key.pubkey()
    }
    fn args(&self, id: [u8; 32], source_revision: u32, metadata_hash: [u8; 32]) -> AchievementArgs {
        let now = now(&self.env.svm);
        AchievementArgs { version: ACHIEVEMENT_VERSION, program_id: neonshift_core::id(), cluster_id: CLUSTER_LOCALNET, wallet: self.wallet(), achievement_id: id, category: CATEGORY_FASTEST_5K, verification_class: CLASS_DEVICE, source_revision, rules_version: 1, metadata_hash, issued_at: now - 5, expiry: now + 600, nonce: [7; 16] }
    }
    fn set_eligibility(&mut self, id: [u8; 32], status: u8, source_revision: u32, metadata_hash: [u8; 32]) -> litesvm::types::TransactionResult {
        let wallet = self.wallet();
        let params = SetEligibilityParams { wallet, achievement_id: id, category: CATEGORY_FASTEST_5K, verification_class: CLASS_DEVICE, status, source_revision, metadata_hash };
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::SetAchievementEligibility { params }.data(),
            neonshift_core::accounts::SetAchievementEligibility { admin: self.init.admin.pubkey(), config: config_pda().0, eligibility: pda(ELIGIBILITY_SEED, &wallet, &id), system_program: system_program::ID }.to_account_metas(None),
        );
        let admin = self.init.admin.insecure_clone();
        self.env.svm.expire_blockhash();
        send(&mut self.env.svm, &[ixn], &admin, &[])
    }
    fn claim_with(&mut self, args: AchievementArgs, signed: &[u8]) -> (litesvm::types::TransactionResult, Pubkey) {
        let wallet = self.wallet();
        let asset = pda(ACHIEVEMENT_ASSET_SEED, &wallet, &args.achievement_id);
        let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
            neonshift_core::id(),
            &ix::ClaimAchievement { args }.data(),
            neonshift_core::accounts::ClaimAchievement {
                player: wallet,
                config: config_pda().0,
                eligibility: pda(ELIGIBILITY_SEED, &wallet, &args.achievement_id),
                receipt: pda(ACHIEVEMENT_SEED, &wallet, &args.achievement_id),
                asset,
                mpl_core_program: MPL_CORE_ID,
                instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let player = self.player.key.insecure_clone();
        self.env.svm.expire_blockhash();
        (send(&mut self.env.svm, &[ed25519_ix(&self.attestor, signed), ixn], &player, &[]), asset)
    }
    fn claim(&mut self, args: AchievementArgs) -> (litesvm::types::TransactionResult, Pubkey) {
        let msg = AchievementProof::from(&args).encode();
        self.claim_with(args, &msg)
    }
}

#[test]
fn approves_then_mints_once_with_unique_receipt() {
    let mut w = world();
    let id = [0x55; 32];
    let meta = [0x66; 32];
    w.set_eligibility(id, 1, 2, meta).unwrap();
    let e: AchievementEligibility = read(&w.env.svm, &pda(ELIGIBILITY_SEED, &w.wallet(), &id));
    assert_eq!((e.status, e.source_revision, e.metadata_hash), (1, 2, meta));

    let args = w.args(id, 2, meta);
    let (res, asset) = w.claim(args);
    res.unwrap();
    let r: AchievementReceipt = read(&w.env.svm, &pda(ACHIEVEMENT_SEED, &w.wallet(), &id));
    assert_eq!((r.wallet, r.achievement_id, r.category, r.source_revision, r.asset), (w.wallet(), id, CATEGORY_FASTEST_5K, 2, asset));
    let acc = w.env.svm.get_account(&asset).unwrap();
    assert_eq!(acc.owner, MPL_CORE_ID);
    let d = &acc.data;
    let name_len = u32::from_le_bytes(d[66..70].try_into().unwrap()) as usize;
    assert_eq!(&d[70..70 + name_len], b"NeonShift PB \xc2\xb7 Fastest 5K (Device)");
    let o = 70 + name_len;
    let uri_len = u32::from_le_bytes(d[o..o + 4].try_into().unwrap()) as usize;
    assert_eq!(&d[o + 4..o + 4 + uri_len], format!("https://api.neonshift.cc/v1/nft/achievements/{}.json", "55".repeat(32)).as_bytes());

    // 重複鑄造（新 nonce 的新證明）→ receipt 已存在（system program 錯誤，非 custom）
    let mut again = w.args(id, 2, meta);
    again.nonce = [8; 16];
    assert!(w.claim(again).0.is_err());
    // 不同 achievement_id 可再鑄（每次有效破紀錄新 ID）
    let id2 = [0x57; 32];
    w.set_eligibility(id2, 1, 1, meta).unwrap();
    w.claim(w.args(id2, 1, meta)).0.unwrap();
}

#[test]
fn rejects_tampered_proof_unapproved_registry_revision_mismatch_and_expiry() {
    let mut w = world();
    let id = [0x55; 32];
    let meta = [0x66; 32];
    // registry 尚未建立 → 帳戶不存在（Anchor 錯誤）
    assert!(w.claim(w.args(id, 2, meta)).0.is_err());
    // 撤銷狀態 → 6038
    w.set_eligibility(id, 2, 2, meta).unwrap();
    assert_eq!(custom_error(&w.claim(w.args(id, 2, meta)).0), Some(6038));
    // 核准 revision 3，但證明是 revision 2（簽出後資料被修正）→ 6039
    w.set_eligibility(id, 1, 3, meta).unwrap();
    assert_eq!(custom_error(&w.claim(w.args(id, 2, meta)).0), Some(6039));
    // metadata_hash 不符 → 6039
    assert_eq!(custom_error(&w.claim(w.args(id, 3, [0x77; 32])).0), Some(6039));
    // 篡改：簽的是 revision 3 訊息，但指令參數改成 revision 4 → 6037
    let signed = AchievementProof::from(&w.args(id, 3, meta)).encode();
    let mut tampered = w.args(id, 3, meta);
    tampered.source_revision = 4;
    assert_eq!(custom_error(&w.claim_with(tampered, &signed).0), Some(6037));
    // 非 attestor 簽章 → 6002（InvalidAttestorKey）
    let rogue = new_attestor();
    let ok_args = w.args(id, 3, meta);
    let msg = AchievementProof::from(&ok_args).encode();
    let wallet = w.wallet();
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        neonshift_core::id(),
        &ix::ClaimAchievement { args: ok_args }.data(),
        neonshift_core::accounts::ClaimAchievement { player: wallet, config: config_pda().0, eligibility: pda(ELIGIBILITY_SEED, &wallet, &id), receipt: pda(ACHIEVEMENT_SEED, &wallet, &id), asset: pda(ACHIEVEMENT_ASSET_SEED, &wallet, &id), mpl_core_program: MPL_CORE_ID, instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID, system_program: system_program::ID }.to_account_metas(None),
    );
    let player = w.player.key.insecure_clone();
    w.env.svm.expire_blockhash();
    let res = send(&mut w.env.svm, &[ed25519_ix(&rogue, &msg), ixn], &player, &[]);
    assert_eq!(custom_error(&res), Some(6002));
    // 過期：時間快轉 → 6040
    let expired = w.args(id, 3, meta);
    advance_time(&mut w.env.svm, 700);
    assert_eq!(custom_error(&w.claim(expired).0), Some(6040));
    // 仍可用新證明鑄造
    w.claim(w.args(id, 3, meta)).0.unwrap();
    // 鑄造後撤銷 registry：鏈上歷史不刪，receipt 仍在，只是狀態 revoked
    w.set_eligibility(id, 2, 3, meta).unwrap();
    let e: AchievementEligibility = read(&w.env.svm, &pda(ELIGIBILITY_SEED, &w.wallet(), &id));
    assert_eq!(e.status, 2);
    let _: AchievementReceipt = read(&w.env.svm, &pda(ACHIEVEMENT_SEED, &w.wallet(), &id));
}

#[test]
fn only_admin_can_set_eligibility() {
    let mut w = world();
    let id = [0x59; 32];
    let stranger = Keypair::new();
    w.env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let params = SetEligibilityParams { wallet: w.wallet(), achievement_id: id, category: 2, verification_class: 2, status: 1, source_revision: 1, metadata_hash: [1; 32] };
    let ixn = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        neonshift_core::id(),
        &ix::SetAchievementEligibility { params }.data(),
        neonshift_core::accounts::SetAchievementEligibility { admin: stranger.pubkey(), config: config_pda().0, eligibility: pda(ELIGIBILITY_SEED, &w.wallet(), &id), system_program: system_program::ID }.to_account_metas(None),
    );
    let res = send(&mut w.env.svm, &[ixn], &stranger, &[]);
    assert!(res.is_err());
}
