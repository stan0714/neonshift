//! NeonShift attestation canonical bytes。
//!
//! 對應 SD v0.2 第 3.5 節與 SA 的 BR-14、BR-15。
//!
//! 這 164 bytes 是後端簽章與鏈上驗簽的**唯一**共同格式。鏈上程式重建這串
//! bytes 後，與 ed25519 指令內攜帶的訊息逐 byte 比對；只要有一個 byte 不同，
//! 交易就必須失敗（錯誤碼 6003 AttestationMismatch）。
//!
//! # 為什麼是固定長度、無分隔符
//!
//! 變動長度或帶分隔符的編碼會讓同一串 bytes 有多種解讀方式，攻擊者可能
//! 構造出「後端看起來是 A、鏈上解讀成 B」的訊息。固定 offset 排除這種歧義。
//!
//! # 為什麼不含金額
//!
//! 金額由鏈上依 Config 與 PlayerProfile 計算（SD 約束 C-03）。後端只證明
//! 「這個任務在這個規則版本下合格」，不能決定發多少。attestor 私鑰外洩時，
//! 損失上限因此被每日上限與任務唯一性約束住。

#![deny(missing_docs)]

/// Domain separation 前綴。換格式時必須同時換這個字串，
/// 舊簽章才不會在新格式下被重新解讀。
pub const DOMAIN: &[u8; 19] = b"NEONSHIFT_ATTEST_V1";

/// canonical bytes 總長度。
pub const ATTESTATION_LEN: usize = 164;

/// 目前的格式版本。
pub const VERSION: u8 = 1;

/// attestation 最長有效期（秒）。對應 BR-15 與錯誤碼 6008。
pub const MAX_TTL_SECONDS: i64 = 600;

// --- 欄位 offset（SD 3.5 表格）---
const OFF_DOMAIN: usize = 0;
const OFF_VERSION: usize = 19;
const OFF_PROGRAM_ID: usize = 20;
const OFF_CLUSTER_ID: usize = 52;
const OFF_WALLET: usize = 53;
const OFF_TASK_DATE: usize = 85;
const OFF_TASK_TYPE: usize = 89;
const OFF_RULES_VERSION: usize = 90;
const OFF_EVIDENCE_HASH: usize = 92;
const OFF_ISSUED_AT: usize = 124;
const OFF_NOT_BEFORE: usize = 132;
const OFF_EXPIRY: usize = 140;
const OFF_NONCE: usize = 148;

/// 任務種類：步數。
pub const TASK_STEPS: u8 = 1;
/// 任務種類：睡眠。
pub const TASK_SLEEP: u8 = 2;

/// Cluster 識別碼。跨環境重用會在鏈上被擋下（BR-14、錯誤碼 6004）。
pub const CLUSTER_DEVNET: u8 = 1;
/// Cluster 識別碼：本機測試網。
pub const CLUSTER_LOCALNET: u8 = 2;

/// 解析或驗證 canonical bytes 時的失敗原因。
///
/// 變體刻意與鏈上錯誤碼一一對應，方便鏈上程式直接轉換。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttestationError {
    /// 位元組長度不是 164。
    BadLength {
        /// 實際收到的長度。
        got: usize,
    },
    /// domain 前綴不符，可能是別的系統的簽章。
    BadDomain,
    /// 格式版本不是本程式支援的版本。
    BadVersion {
        /// 收到的版本。
        got: u8,
    },
    /// task_type 不是 1 或 2。
    BadTaskType {
        /// 收到的值。
        got: u8,
    },
    /// 時間欄位不滿足 `issued_at <= not_before <= expiry`。
    BadTimeWindow,
    /// 有效期超過 MAX_TTL_SECONDS。對應錯誤碼 6008。
    TtlTooLong {
        /// 實際的有效期秒數。
        ttl: i64,
    },
}

impl core::fmt::Display for AttestationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::BadLength { got } => write!(f, "expected {ATTESTATION_LEN} bytes, got {got}"),
            Self::BadDomain => write!(f, "domain separator mismatch"),
            Self::BadVersion { got } => write!(f, "unsupported version {got}"),
            Self::BadTaskType { got } => write!(f, "invalid task type {got}"),
            Self::BadTimeWindow => write!(f, "require issued_at <= not_before <= expiry"),
            Self::TtlTooLong { ttl } => write!(f, "ttl {ttl}s exceeds {MAX_TTL_SECONDS}s"),
        }
    }
}

/// 一份 attestation 的欄位。
///
/// 使用 `encode` 產生要簽章的 bytes，使用 `decode` 從收到的 bytes 還原。
/// 兩個方向都必須是無損的，`roundtrip` 測試保證這點。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Attestation {
    /// 格式版本。
    pub version: u8,
    /// 綁定的鏈上程式位址。
    pub program_id: [u8; 32],
    /// 綁定的 cluster。
    pub cluster_id: u8,
    /// 領取者錢包公鑰。
    pub wallet: [u8; 32],
    /// UTC 日序，`floor(unix_seconds / 86400)`。
    pub task_date: u32,
    /// 任務種類，`TASK_STEPS` 或 `TASK_SLEEP`。
    pub task_type: u8,
    /// 判定時使用的規則版本。
    pub rules_version: u16,
    /// 判定輸入的 SHA-256 摘要。
    pub evidence_hash: [u8; 32],
    /// 簽發時間（unix 秒）。
    pub issued_at: i64,
    /// 生效時間（unix 秒）。
    pub not_before: i64,
    /// 到期時間（unix 秒）。
    pub expiry: i64,
    /// 單次隨機值，用於重放偵測與稽核關聯。
    pub nonce: [u8; 16],
}

impl Attestation {
    /// 產生要簽章的 164 bytes。
    ///
    /// 這個函式**不做驗證**，只負責排列位元組。呼叫端在簽章前應先呼叫
    /// [`Attestation::validate`]，否則可能簽出一份鏈上必定拒絕的 attestation。
    pub fn encode(&self) -> [u8; ATTESTATION_LEN] {
        let mut out = [0u8; ATTESTATION_LEN];

        out[OFF_DOMAIN..OFF_DOMAIN + 19].copy_from_slice(DOMAIN);
        out[OFF_VERSION] = self.version;
        out[OFF_PROGRAM_ID..OFF_PROGRAM_ID + 32].copy_from_slice(&self.program_id);
        out[OFF_CLUSTER_ID] = self.cluster_id;
        out[OFF_WALLET..OFF_WALLET + 32].copy_from_slice(&self.wallet);
        out[OFF_TASK_DATE..OFF_TASK_DATE + 4].copy_from_slice(&self.task_date.to_le_bytes());
        out[OFF_TASK_TYPE] = self.task_type;
        out[OFF_RULES_VERSION..OFF_RULES_VERSION + 2]
            .copy_from_slice(&self.rules_version.to_le_bytes());
        out[OFF_EVIDENCE_HASH..OFF_EVIDENCE_HASH + 32].copy_from_slice(&self.evidence_hash);
        out[OFF_ISSUED_AT..OFF_ISSUED_AT + 8].copy_from_slice(&self.issued_at.to_le_bytes());
        out[OFF_NOT_BEFORE..OFF_NOT_BEFORE + 8].copy_from_slice(&self.not_before.to_le_bytes());
        out[OFF_EXPIRY..OFF_EXPIRY + 8].copy_from_slice(&self.expiry.to_le_bytes());
        out[OFF_NONCE..OFF_NONCE + 16].copy_from_slice(&self.nonce);

        out
    }

    /// 從收到的 bytes 還原欄位。
    ///
    /// 只檢查結構正確性（長度、domain、版本、task_type），不檢查時間，
    /// 因為鏈上要用自己的 clock 判斷時效，不能相信訊息裡的宣稱。
    pub fn decode(bytes: &[u8]) -> Result<Self, AttestationError> {
        if bytes.len() != ATTESTATION_LEN {
            return Err(AttestationError::BadLength { got: bytes.len() });
        }
        if &bytes[OFF_DOMAIN..OFF_DOMAIN + 19] != DOMAIN.as_slice() {
            return Err(AttestationError::BadDomain);
        }
        let version = bytes[OFF_VERSION];
        if version != VERSION {
            return Err(AttestationError::BadVersion { got: version });
        }
        let task_type = bytes[OFF_TASK_TYPE];
        if task_type != TASK_STEPS && task_type != TASK_SLEEP {
            return Err(AttestationError::BadTaskType { got: task_type });
        }

        Ok(Self {
            version,
            program_id: take32(bytes, OFF_PROGRAM_ID),
            cluster_id: bytes[OFF_CLUSTER_ID],
            wallet: take32(bytes, OFF_WALLET),
            task_date: u32::from_le_bytes(take4(bytes, OFF_TASK_DATE)),
            task_type,
            rules_version: u16::from_le_bytes(take2(bytes, OFF_RULES_VERSION)),
            evidence_hash: take32(bytes, OFF_EVIDENCE_HASH),
            issued_at: i64::from_le_bytes(take8(bytes, OFF_ISSUED_AT)),
            not_before: i64::from_le_bytes(take8(bytes, OFF_NOT_BEFORE)),
            expiry: i64::from_le_bytes(take8(bytes, OFF_EXPIRY)),
            nonce: take16(bytes, OFF_NONCE),
        })
    }

    /// 檢查時間欄位是否自洽：`issued_at <= not_before <= expiry`（SD 3.3 步驟 7）。
    /// 後端簽章前必須通過這關。
    ///
    /// 這不取代鏈上驗證。鏈上還要用自己的 clock 檢查 now 落在
    /// `[not_before, expiry]` 之間（錯誤碼 6006、6007）。
    pub fn validate(&self) -> Result<(), AttestationError> {
        if self.issued_at > self.not_before || self.not_before > self.expiry {
            return Err(AttestationError::BadTimeWindow);
        }
        let ttl = self.expiry.saturating_sub(self.issued_at);
        if ttl > MAX_TTL_SECONDS {
            return Err(AttestationError::TtlTooLong { ttl });
        }
        Ok(())
    }

    /// 依鏈上 clock 判斷此刻是否在有效期內。
    pub fn is_valid_at(&self, now: i64) -> bool {
        now >= self.not_before && now <= self.expiry
    }
}

// --- 取位元組的小工具。用固定長度陣列避免 slice 長度錯誤。---

fn take2(b: &[u8], off: usize) -> [u8; 2] {
    let mut o = [0u8; 2];
    o.copy_from_slice(&b[off..off + 2]);
    o
}
fn take4(b: &[u8], off: usize) -> [u8; 4] {
    let mut o = [0u8; 4];
    o.copy_from_slice(&b[off..off + 4]);
    o
}
fn take8(b: &[u8], off: usize) -> [u8; 8] {
    let mut o = [0u8; 8];
    o.copy_from_slice(&b[off..off + 8]);
    o
}
fn take16(b: &[u8], off: usize) -> [u8; 16] {
    let mut o = [0u8; 16];
    o.copy_from_slice(&b[off..off + 16]);
    o
}
fn take32(b: &[u8], off: usize) -> [u8; 32] {
    let mut o = [0u8; 32];
    o.copy_from_slice(&b[off..off + 32]);
    o
}

/// 把 bytes 轉成小寫十六進位字串。測試向量與除錯用。
pub fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

/// 從十六進位字串還原 bytes。測試向量讀取用。
pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    for pair in b.chunks(2) {
        let hi = hex_val(pair[0])?;
        let lo = hex_val(pair[1])?;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}
