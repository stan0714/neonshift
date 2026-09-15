//! 成就（PB）證明 canonical bytes（PG-R-08；activity-running-gallery 7、SD 13）。
//!
//! 與每日打卡的 164-byte 格式**分開**：不同 domain、不同長度，舊簽章不能在新格式下重新解讀。
//! 鏈上 `claim_achievement` 重建這串 bytes 與 ed25519 指令訊息逐 byte 比對，並另查 eligibility registry。
//!
//! 佈局（總長 194 bytes，固定 offset、無分隔符）：
//! | offset | 長度 | 欄位 |
//! |---|---|---|
//! | 0 | 24 | domain `NEONSHIFT_ACHIEVEMENT_V1` |
//! | 24 | 1 | version |
//! | 25 | 32 | program_id |
//! | 57 | 1 | cluster_id |
//! | 58 | 32 | wallet |
//! | 90 | 32 | achievement_id（伺服器穩定分配，不由 client 自選） |
//! | 122 | 1 | category（1..=6） |
//! | 123 | 1 | verification_class（1 organizer／2 device） |
//! | 124 | 4 | source_revision u32 LE |
//! | 128 | 2 | rules_version u16 LE |
//! | 130 | 32 | metadata_hash（canonical metadata JSON 的 SHA-256） |
//! | 162 | 8 | issued_at i64 LE |
//! | 170 | 8 | expiry i64 LE |
//! | 178 | 16 | nonce |

/// Domain separation 前綴（24 bytes）。
pub const ACHIEVEMENT_DOMAIN: &[u8; 24] = b"NEONSHIFT_ACHIEVEMENT_V1";
/// canonical bytes 總長度。
pub const ACHIEVEMENT_LEN: usize = 194;
/// 目前格式版本。
pub const ACHIEVEMENT_VERSION: u8 = 1;
/// 證明最長有效期（秒）：鑄造需錢包核准與送出交易，給 15 分鐘。
pub const ACHIEVEMENT_MAX_TTL_SECONDS: i64 = 900;

const OFF_DOMAIN: usize = 0;
const OFF_VERSION: usize = 24;
const OFF_PROGRAM_ID: usize = 25;
const OFF_CLUSTER_ID: usize = 57;
const OFF_WALLET: usize = 58;
const OFF_ACHIEVEMENT_ID: usize = 90;
const OFF_CATEGORY: usize = 122;
const OFF_CLASS: usize = 123;
const OFF_SOURCE_REVISION: usize = 124;
const OFF_RULES_VERSION: usize = 128;
const OFF_METADATA_HASH: usize = 130;
const OFF_ISSUED_AT: usize = 162;
const OFF_EXPIRY: usize = 170;
const OFF_NONCE: usize = 178;

/// 成就類別（與後端 pb category 對應）。
pub const CATEGORY_FASTEST_1K: u8 = 1;
/// 最快 5K。
pub const CATEGORY_FASTEST_5K: u8 = 2;
/// 最快 10K。
pub const CATEGORY_FASTEST_10K: u8 = 3;
/// 最快半馬。
pub const CATEGORY_FASTEST_HALF: u8 = 4;
/// 最快全馬。
pub const CATEGORY_FASTEST_MARATHON: u8 = 5;
/// 最遠單次跑步。
pub const CATEGORY_LONGEST_RUN: u8 = 6;
/// 驗證等級：主辦方。
pub const CLASS_ORGANIZER: u8 = 1;
/// 驗證等級：裝置／GPS。
pub const CLASS_DEVICE: u8 = 2;

/// 解析／驗證失敗原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AchievementError {
    /// 長度不是 194。
    BadLength {
        /// 實際長度。
        got: usize,
    },
    /// domain 不符。
    BadDomain,
    /// 版本不支援。
    BadVersion {
        /// 收到的版本。
        got: u8,
    },
    /// category 不在 1..=6。
    BadCategory {
        /// 收到的值。
        got: u8,
    },
    /// verification_class 不是 1／2。
    BadClass {
        /// 收到的值。
        got: u8,
    },
    /// expiry <= issued_at。
    BadTimeWindow,
    /// 有效期超過上限。
    TtlTooLong {
        /// 實際秒數。
        ttl: i64,
    },
}

impl core::fmt::Display for AchievementError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::BadLength { got } => write!(f, "expected {ACHIEVEMENT_LEN} bytes, got {got}"),
            Self::BadDomain => write!(f, "achievement domain mismatch"),
            Self::BadVersion { got } => write!(f, "unsupported achievement version {got}"),
            Self::BadCategory { got } => write!(f, "invalid category {got}"),
            Self::BadClass { got } => write!(f, "invalid verification class {got}"),
            Self::BadTimeWindow => write!(f, "require issued_at < expiry"),
            Self::TtlTooLong { ttl } => write!(f, "ttl {ttl}s exceeds {ACHIEVEMENT_MAX_TTL_SECONDS}s"),
        }
    }
}

/// 一份成就證明的欄位。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AchievementProof {
    /// 格式版本。
    pub version: u8,
    /// 綁定的程式。
    pub program_id: [u8; 32],
    /// 綁定的 cluster。
    pub cluster_id: u8,
    /// 達成者錢包。
    pub wallet: [u8; 32],
    /// 伺服器分配的穩定 achievement id。
    pub achievement_id: [u8; 32],
    /// 類別。
    pub category: u8,
    /// 驗證等級。
    pub verification_class: u8,
    /// 來源 revision（成績或 session 修正後不同）。
    pub source_revision: u32,
    /// PB 規則版本。
    pub rules_version: u16,
    /// canonical metadata 的 SHA-256。
    pub metadata_hash: [u8; 32],
    /// 簽發時間。
    pub issued_at: i64,
    /// 到期時間。
    pub expiry: i64,
    /// 單次隨機值。
    pub nonce: [u8; 16],
}

impl AchievementProof {
    /// 排列 194 bytes（不驗證）。
    pub fn encode(&self) -> [u8; ACHIEVEMENT_LEN] {
        let mut out = [0u8; ACHIEVEMENT_LEN];
        out[OFF_DOMAIN..OFF_DOMAIN + 24].copy_from_slice(ACHIEVEMENT_DOMAIN);
        out[OFF_VERSION] = self.version;
        out[OFF_PROGRAM_ID..OFF_PROGRAM_ID + 32].copy_from_slice(&self.program_id);
        out[OFF_CLUSTER_ID] = self.cluster_id;
        out[OFF_WALLET..OFF_WALLET + 32].copy_from_slice(&self.wallet);
        out[OFF_ACHIEVEMENT_ID..OFF_ACHIEVEMENT_ID + 32].copy_from_slice(&self.achievement_id);
        out[OFF_CATEGORY] = self.category;
        out[OFF_CLASS] = self.verification_class;
        out[OFF_SOURCE_REVISION..OFF_SOURCE_REVISION + 4].copy_from_slice(&self.source_revision.to_le_bytes());
        out[OFF_RULES_VERSION..OFF_RULES_VERSION + 2].copy_from_slice(&self.rules_version.to_le_bytes());
        out[OFF_METADATA_HASH..OFF_METADATA_HASH + 32].copy_from_slice(&self.metadata_hash);
        out[OFF_ISSUED_AT..OFF_ISSUED_AT + 8].copy_from_slice(&self.issued_at.to_le_bytes());
        out[OFF_EXPIRY..OFF_EXPIRY + 8].copy_from_slice(&self.expiry.to_le_bytes());
        out[OFF_NONCE..OFF_NONCE + 16].copy_from_slice(&self.nonce);
        out
    }

    /// 從 bytes 還原並檢查 domain／版本／類別。
    pub fn decode(bytes: &[u8]) -> Result<Self, AchievementError> {
        if bytes.len() != ACHIEVEMENT_LEN {
            return Err(AchievementError::BadLength { got: bytes.len() });
        }
        if &bytes[OFF_DOMAIN..OFF_DOMAIN + 24] != ACHIEVEMENT_DOMAIN {
            return Err(AchievementError::BadDomain);
        }
        let version = bytes[OFF_VERSION];
        if version != ACHIEVEMENT_VERSION {
            return Err(AchievementError::BadVersion { got: version });
        }
        let arr32 = |off: usize| {
            let mut a = [0u8; 32];
            a.copy_from_slice(&bytes[off..off + 32]);
            a
        };
        let i64_at = |off: usize| {
            let mut a = [0u8; 8];
            a.copy_from_slice(&bytes[off..off + 8]);
            i64::from_le_bytes(a)
        };
        let category = bytes[OFF_CATEGORY];
        if !(CATEGORY_FASTEST_1K..=CATEGORY_LONGEST_RUN).contains(&category) {
            return Err(AchievementError::BadCategory { got: category });
        }
        let verification_class = bytes[OFF_CLASS];
        if verification_class != CLASS_ORGANIZER && verification_class != CLASS_DEVICE {
            return Err(AchievementError::BadClass { got: verification_class });
        }
        let mut nonce = [0u8; 16];
        nonce.copy_from_slice(&bytes[OFF_NONCE..OFF_NONCE + 16]);
        Ok(Self {
            version,
            program_id: arr32(OFF_PROGRAM_ID),
            cluster_id: bytes[OFF_CLUSTER_ID],
            wallet: arr32(OFF_WALLET),
            achievement_id: arr32(OFF_ACHIEVEMENT_ID),
            category,
            verification_class,
            source_revision: u32::from_le_bytes([bytes[OFF_SOURCE_REVISION], bytes[OFF_SOURCE_REVISION + 1], bytes[OFF_SOURCE_REVISION + 2], bytes[OFF_SOURCE_REVISION + 3]]),
            rules_version: u16::from_le_bytes([bytes[OFF_RULES_VERSION], bytes[OFF_RULES_VERSION + 1]]),
            metadata_hash: arr32(OFF_METADATA_HASH),
            issued_at: i64_at(OFF_ISSUED_AT),
            expiry: i64_at(OFF_EXPIRY),
            nonce,
        })
    }

    /// 時間自洽：issued_at < expiry 且 ttl ≤ 上限。
    pub fn validate(&self) -> Result<(), AchievementError> {
        if self.expiry <= self.issued_at {
            return Err(AchievementError::BadTimeWindow);
        }
        let ttl = self.expiry - self.issued_at;
        if ttl > ACHIEVEMENT_MAX_TTL_SECONDS {
            return Err(AchievementError::TtlTooLong { ttl });
        }
        Ok(())
    }

    /// 在 `now` 是否有效。
    pub fn is_valid_at(&self, now: i64) -> bool {
        now >= self.issued_at && now < self.expiry
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> AchievementProof {
        AchievementProof { version: 1, program_id: [0x11; 32], cluster_id: 1, wallet: [0x22; 32], achievement_id: [0x55; 32], category: CATEGORY_FASTEST_5K, verification_class: CLASS_DEVICE, source_revision: 2, rules_version: 1, metadata_hash: [0x66; 32], issued_at: 1_789_000_000, expiry: 1_789_000_900, nonce: [0x44; 16] }
    }

    #[test]
    fn roundtrip_and_length() {
        let b = base().encode();
        assert_eq!(b.len(), ACHIEVEMENT_LEN);
        assert_eq!(&b[..24], ACHIEVEMENT_DOMAIN);
        assert_eq!(AchievementProof::decode(&b).unwrap(), base());
        assert!(base().validate().is_ok());
    }

    #[test]
    fn rejects_bad_inputs() {
        assert_eq!(AchievementProof::decode(&[0u8; 10]).unwrap_err(), AchievementError::BadLength { got: 10 });
        let mut b = base().encode();
        b[0] ^= 1;
        assert_eq!(AchievementProof::decode(&b).unwrap_err(), AchievementError::BadDomain);
        let mut c = base();
        c.category = 9;
        assert_eq!(AchievementProof::decode(&c.encode()).unwrap_err(), AchievementError::BadCategory { got: 9 });
        let mut t = base();
        t.expiry = t.issued_at + 901;
        assert_eq!(t.validate().unwrap_err(), AchievementError::TtlTooLong { ttl: 901 });
        // 與 164-byte 打卡格式不可互相解讀
        assert!(crate::Attestation::decode(&base().encode()).is_err());
    }
}
