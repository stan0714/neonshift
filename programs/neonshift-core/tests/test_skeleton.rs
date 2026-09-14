//! PG-I-06：程式可在 LiteSVM 載入；attestation-core 為共用格式來源。

mod common;

#[test]
fn program_loads() {
    let env = common::setup();
    assert!(env.svm.get_account(&neonshift_core::id()).unwrap().executable);
}

#[test]
fn attestation_core_is_linked_into_program_crate() {
    assert_eq!(attestation_core::ATTESTATION_LEN, 164);
    assert_eq!(neonshift_core::CLUSTER_DEVNET, 1);
}
