//! PG-I-06：程式可在 LiteSVM 載入並執行。之後各指令測試依 SD 7 放在本目錄。

use {
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn load_program(svm: &mut LiteSVM) {
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/neonshift_core.so"));
    svm.add_program(neonshift_core::id(), bytes).unwrap();
}

#[test]
fn program_loads_and_ping_succeeds() {
    let mut svm = LiteSVM::new();
    load_program(&mut svm);
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        neonshift_core::id(),
        &neonshift_core::instruction::Ping {}.data(),
        neonshift_core::accounts::Ping { payer: payer.pubkey() }.to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "{res:?}");
}

#[test]
fn attestation_core_is_linked_into_program_crate() {
    // 鏈上程式必須使用與後端相同的 canonical 格式定義
    assert_eq!(attestation_core::ATTESTATION_LEN, 164);
    assert_eq!(neonshift_core::CLUSTER_DEVNET, 1);
}
