//! canonical bytes 的格式與竄改偵測測試。
//!
//! 對應 PG-C-04 的完成定義。這一層只驗證「格式」與「竄改是否改變位元組」；
//! 錯誤碼 6001 至 6008 的指令層測試在 Anchor 程式的測試裡（PG-C-18）。

use attestation_core::*;

/// 產生一份固定的測試用 attestation。
///
/// 欄位刻意用可辨識的重複值，這樣在 hex dump 裡一眼就能看出哪一段是哪個欄位。
fn sample() -> Attestation {
    Attestation {
        version: VERSION,
        program_id: [0x11; 32],
        cluster_id: CLUSTER_DEVNET,
        wallet: [0x22; 32],
        task_date: 20_706,
        task_type: TASK_STEPS,
        rules_version: 3,
        evidence_hash: [0x33; 32],
        issued_at: 1_789_000_000,
        not_before: 1_789_000_000,
        expiry: 1_789_000_600,
        nonce: [0x44; 16],
    }
}

#[test]
fn encoded_length_is_exactly_164() {
    assert_eq!(sample().encode().len(), ATTESTATION_LEN);
    assert_eq!(ATTESTATION_LEN, 164);
}

#[test]
fn field_offsets_match_sd_3_5() {
    let bytes = sample().encode();

    // 每個 offset 都對照 SD 3.5 的表格，寫死在測試裡。
    // 如果有人改了 lib.rs 的 offset 常數，這裡會立刻失敗。
    assert_eq!(&bytes[0..19], b"NEONSHIFT_ATTEST_V1", "domain");
    assert_eq!(bytes[19], 1, "version");
    assert_eq!(&bytes[20..52], &[0x11; 32], "program_id");
    assert_eq!(bytes[52], 1, "cluster_id");
    assert_eq!(&bytes[53..85], &[0x22; 32], "wallet");
    assert_eq!(&bytes[85..89], &20_706u32.to_le_bytes(), "task_date");
    assert_eq!(bytes[89], 1, "task_type");
    assert_eq!(&bytes[90..92], &3u16.to_le_bytes(), "rules_version");
    assert_eq!(&bytes[92..124], &[0x33; 32], "evidence_hash");
    assert_eq!(&bytes[124..132], &1_789_000_000i64.to_le_bytes(), "issued_at");
    assert_eq!(&bytes[132..140], &1_789_000_000i64.to_le_bytes(), "not_before");
    assert_eq!(&bytes[140..148], &1_789_000_600i64.to_le_bytes(), "expiry");
    assert_eq!(&bytes[148..164], &[0x44; 16], "nonce");
}

#[test]
fn roundtrip_is_lossless() {
    let a = sample();
    let decoded = Attestation::decode(&a.encode()).expect("decode should succeed");
    assert_eq!(a, decoded);
}

#[test]
fn encoding_is_deterministic() {
    // 同樣的輸入必須產生同樣的 bytes，否則後端與鏈上重建的結果會對不起來。
    assert_eq!(sample().encode(), sample().encode());
}

#[test]
fn every_single_byte_flip_changes_the_encoding() {
    // 這是本 crate 最重要的一條測試。
    // 如果有任何一個 byte 翻轉後 decode 仍然還原出相同欄位，
    // 代表該 byte 沒有真正參與編碼，攻擊者就能在不影響簽章驗證的情況下改動它。
    let original = sample();
    let base = original.encode();

    for i in 0..ATTESTATION_LEN {
        let mut tampered = base;
        tampered[i] ^= 0xff;

        assert_ne!(tampered, base, "byte {i} 翻轉後位元組未改變");

        // decode 要嘛失敗（結構性欄位），要嘛還原出不同的內容（資料欄位）。
        // 兩者都可以，唯獨不能「解出跟原本一樣的東西」。
        if let Ok(decoded) = Attestation::decode(&tampered) {
            assert_ne!(
                decoded, original,
                "byte {i} 翻轉後仍解出相同 attestation，該 byte 未被涵蓋"
            );
        }
    }
}

#[test]
fn rejects_wrong_length() {
    let bytes = sample().encode();
    assert_eq!(
        Attestation::decode(&bytes[..163]),
        Err(AttestationError::BadLength { got: 163 })
    );

    let mut long = bytes.to_vec();
    long.push(0);
    assert_eq!(
        Attestation::decode(&long),
        Err(AttestationError::BadLength { got: 165 })
    );
}

#[test]
fn rejects_wrong_domain() {
    let mut bytes = sample().encode();
    bytes[0] = b'X';
    assert_eq!(Attestation::decode(&bytes), Err(AttestationError::BadDomain));
}

#[test]
fn rejects_unknown_version() {
    let mut bytes = sample().encode();
    bytes[19] = 2;
    assert_eq!(
        Attestation::decode(&bytes),
        Err(AttestationError::BadVersion { got: 2 })
    );
}

#[test]
fn rejects_invalid_task_type() {
    for bad in [0u8, 3, 255] {
        let mut bytes = sample().encode();
        bytes[89] = bad;
        assert_eq!(
            Attestation::decode(&bytes),
            Err(AttestationError::BadTaskType { got: bad }),
            "task_type {bad} 應被拒絕"
        );
    }
}

#[test]
fn accepts_both_task_types() {
    for good in [TASK_STEPS, TASK_SLEEP] {
        let mut a = sample();
        a.task_type = good;
        assert!(Attestation::decode(&a.encode()).is_ok());
    }
}

#[test]
fn validate_rejects_ttl_over_600_seconds() {
    let mut a = sample();
    a.expiry = a.issued_at + MAX_TTL_SECONDS + 1;
    assert_eq!(
        a.validate(),
        Err(AttestationError::TtlTooLong {
            ttl: MAX_TTL_SECONDS + 1
        })
    );
}

#[test]
fn validate_accepts_ttl_exactly_600_seconds() {
    let mut a = sample();
    a.expiry = a.issued_at + MAX_TTL_SECONDS;
    assert_eq!(a.validate(), Ok(()));
}

#[test]
fn validate_rejects_inverted_time_window() {
    let mut a = sample();
    a.not_before = a.expiry + 1;
    assert_eq!(a.validate(), Err(AttestationError::BadTimeWindow));

    let mut b = sample();
    b.issued_at = b.expiry + 1;
    assert_eq!(b.validate(), Err(AttestationError::BadTimeWindow));
}

#[test]
fn is_valid_at_covers_boundaries() {
    let a = sample();
    assert!(!a.is_valid_at(a.not_before - 1), "早於 not_before 應無效");
    assert!(a.is_valid_at(a.not_before), "not_before 當下應有效");
    assert!(a.is_valid_at(a.expiry), "expiry 當下應有效");
    assert!(!a.is_valid_at(a.expiry + 1), "晚於 expiry 應無效");
}

#[test]
fn different_wallets_produce_different_bytes() {
    // BR-14：他人的 attestation 換成自己的 wallet 後，bytes 必然不同，
    // 簽章驗證因此失敗。
    let a = sample();
    let mut b = sample();
    b.wallet = [0x99; 32];
    assert_ne!(a.encode(), b.encode());
}

#[test]
fn different_program_or_cluster_produce_different_bytes() {
    // BR-14：跨環境重用。
    let a = sample();

    let mut other_program = sample();
    other_program.program_id = [0xaa; 32];
    assert_ne!(a.encode(), other_program.encode());

    let mut other_cluster = sample();
    other_cluster.cluster_id = CLUSTER_LOCALNET;
    assert_ne!(a.encode(), other_cluster.encode());
}

#[test]
fn hex_helpers_roundtrip() {
    let bytes = sample().encode();
    let hex = to_hex(&bytes);
    assert_eq!(hex.len(), ATTESTATION_LEN * 2);
    assert_eq!(from_hex(&hex).unwrap(), bytes.to_vec());
    assert!(from_hex("abc").is_none(), "奇數長度應失敗");
    assert!(from_hex("zz").is_none(), "非十六進位字元應失敗");
}
