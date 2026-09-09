//! 產生跨語言測試向量。
//!
//! 用途：後端（TypeScript）與 App（TypeScript）各自實作 canonical bytes 時，
//! 必須讀這份向量驗證自己的輸出與 Rust 完全一致。這是避免「兩邊各寫一套、
//! 上線才發現對不起來」的關鍵做法，對應 PG-B-10 的完成定義。
//!
//! 用法：
//! ```text
//! cargo run --bin gen_vectors > ../../backend/src/lib/attestation-vectors.json
//! ```
//!
//! 輸出為 JSON，不引入 serde，避免這個零相依 crate 為了產生測試資料而長出相依。

use attestation_core::*;

struct Case {
    name: &'static str,
    note: &'static str,
    att: Attestation,
}

fn base() -> Attestation {
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

fn with(f: impl FnOnce(&mut Attestation)) -> Attestation {
    let mut a = base();
    f(&mut a);
    a
}

fn cases() -> Vec<Case> {
    vec![
        Case {
            name: "baseline_steps",
            note: "標準步數任務，所有欄位為可辨識的重複值",
            att: base(),
        },
        Case {
            name: "baseline_sleep",
            note: "睡眠任務，僅 task_type 不同",
            att: with(|a| a.task_type = TASK_SLEEP),
        },
        Case {
            name: "all_zero_fixed_fields",
            note: "定長欄位全為 0，檢查實作未把 0 當成空值略過",
            att: with(|a| {
                a.program_id = [0; 32];
                a.wallet = [0; 32];
                a.evidence_hash = [0; 32];
                a.nonce = [0; 16];
            }),
        },
        Case {
            name: "all_max_fixed_fields",
            note: "定長欄位全為 0xff",
            att: with(|a| {
                a.program_id = [0xff; 32];
                a.wallet = [0xff; 32];
                a.evidence_hash = [0xff; 32];
                a.nonce = [0xff; 16];
            }),
        },
        Case {
            name: "task_date_zero",
            note: "task_date 邊界下限",
            att: with(|a| a.task_date = 0),
        },
        Case {
            name: "task_date_max",
            note: "task_date 為 u32 上限，檢查未被誤當成有號數",
            att: with(|a| a.task_date = u32::MAX),
        },
        Case {
            name: "rules_version_max",
            note: "rules_version 為 u16 上限",
            att: with(|a| a.rules_version = u16::MAX),
        },
        Case {
            name: "timestamps_negative",
            note: "1970 之前的時間，檢查 i64 有號數以補數正確編碼",
            att: with(|a| {
                a.issued_at = -1;
                a.not_before = -1;
                a.expiry = 599;
            }),
        },
        Case {
            name: "ttl_exactly_max",
            note: "有效期正好 600 秒，應通過 validate",
            att: with(|a| a.expiry = a.issued_at + MAX_TTL_SECONDS),
        },
        Case {
            name: "not_before_after_issued_at",
            note: "延後生效，issued_at 與 not_before 不同",
            att: with(|a| {
                a.not_before = a.issued_at + 60;
                a.expiry = a.issued_at + 600;
            }),
        },
        Case {
            name: "cluster_localnet",
            note: "不同 cluster，用於驗證跨環境重放防護（BR-14）",
            att: with(|a| a.cluster_id = CLUSTER_LOCALNET),
        },
        Case {
            name: "distinct_byte_patterns",
            note: "每個定長欄位使用不同 pattern，可從 hex 直接辨識欄位邊界",
            att: with(|a| {
                a.program_id = [0xa1; 32];
                a.wallet = [0xb2; 32];
                a.evidence_hash = [0xc3; 32];
                a.nonce = [0xd4; 16];
                a.task_date = 0x0102_0304;
                a.rules_version = 0x0506;
                a.issued_at = 0x0708_090a_0b0c_0d0e;
                a.not_before = 0x0708_090a_0b0c_0d0e;
                a.expiry = 0x0708_090a_0b0c_0f3e;
            }),
        },
    ]
}

fn main() {
    let cases = cases();

    println!("{{");
    println!("  \"description\": \"NeonShift attestation canonical bytes 跨語言測試向量\",");
    println!("  \"source\": \"programs/attestation-core/src/bin/gen_vectors.rs\",");
    println!("  \"spec\": \"docs/sd.md 3.5\",");
    println!("  \"domain\": \"NEONSHIFT_ATTEST_V1\",");
    println!("  \"length\": {ATTESTATION_LEN},");
    println!("  \"version\": {VERSION},");
    println!("  \"vectors\": [");

    for (i, case) in cases.iter().enumerate() {
        let a = &case.att;
        let encoded = a.encode();

        // 自我檢查：產出的向量必須能被自己 decode 還原，否則不該寫出去。
        let decoded = Attestation::decode(&encoded).expect("generated vector must decode");
        assert_eq!(&decoded, a, "case {} roundtrip 失敗", case.name);

        let comma = if i + 1 == cases.len() { "" } else { "," };
        println!("    {{");
        println!("      \"name\": \"{}\",", case.name);
        println!("      \"note\": \"{}\",", case.note);
        println!("      \"fields\": {{");
        println!("        \"version\": {},", a.version);
        println!("        \"program_id\": \"{}\",", to_hex(&a.program_id));
        println!("        \"cluster_id\": {},", a.cluster_id);
        println!("        \"wallet\": \"{}\",", to_hex(&a.wallet));
        println!("        \"task_date\": {},", a.task_date);
        println!("        \"task_type\": {},", a.task_type);
        println!("        \"rules_version\": {},", a.rules_version);
        println!("        \"evidence_hash\": \"{}\",", to_hex(&a.evidence_hash));
        println!("        \"issued_at\": {},", a.issued_at);
        println!("        \"not_before\": {},", a.not_before);
        println!("        \"expiry\": {},", a.expiry);
        println!("        \"nonce\": \"{}\"", to_hex(&a.nonce));
        println!("      }},");
        println!("      \"expected_hex\": \"{}\",", to_hex(&encoded));
        println!("      \"validate_ok\": {}", a.validate().is_ok());
        println!("    }}{comma}");
    }

    println!("  ]");
    println!("}}");
}
