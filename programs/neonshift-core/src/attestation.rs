//! Attestation 驗證（PG-C-04，SD 3.3 步驟 2～7、3.5）。
//!
//! 整套重放防護建立在這裡：錯了不會報錯，只會靜默失效。因此每一步都對應一個明確錯誤碼，
//! 且 canonical bytes 只由 `attestation-core` 產生，鏈上與後端共用同一份實作。

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sdk_ids::ed25519_program;
use attestation_core::{Attestation, ATTESTATION_LEN, MAX_TTL_SECONDS};

use crate::error::ErrorCode;
use crate::state::Config;

/// Ed25519 program 指令資料佈局（solana-ed25519-program）：
/// `[num_signatures: u8][padding: u8][offsets: 7 × u16 LE = 14 bytes][data...]`
const HEADER_LEN: usize = 2;
const OFFSETS_LEN: usize = 14;
const SIG_LEN: usize = 64;
const PUBKEY_LEN: usize = 32;
/// offsets 中的 instruction index 為此值時代表「本指令」
const SELF_INDEX: u16 = u16::MAX;

/// clock_in 參數：與 canonical bytes 一一對應的欄位（不含金額，SD 3.5）。
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct AttestationArgs {
    pub version: u8,
    pub program_id: Pubkey,
    pub cluster_id: u8,
    pub wallet: Pubkey,
    pub task_date: u32,
    pub task_type: u8,
    pub rules_version: u16,
    pub evidence_hash: [u8; 32],
    pub issued_at: i64,
    pub not_before: i64,
    pub expiry: i64,
    pub nonce: [u8; 16],
}

impl From<&AttestationArgs> for Attestation {
    fn from(a: &AttestationArgs) -> Self {
        Attestation {
            version: a.version,
            program_id: a.program_id.to_bytes(),
            cluster_id: a.cluster_id,
            wallet: a.wallet.to_bytes(),
            task_date: a.task_date,
            task_type: a.task_type,
            rules_version: a.rules_version,
            evidence_hash: a.evidence_hash,
            issued_at: a.issued_at,
            not_before: a.not_before,
            expiry: a.expiry,
            nonce: a.nonce,
        }
    }
}

/// 從 ed25519 指令資料取出唯一一組簽章的公鑰與 164-byte 訊息。
///
/// `ed25519_ix_index` 是該 ed25519 指令在交易中的 index；offsets 內的 instruction index
/// 必須等於它或 `u16::MAX`（同義為本指令），否則視為指向其他指令（6001）。
pub fn parse_ed25519_instruction(data: &[u8], ed25519_ix_index: u16) -> Result<([u8; PUBKEY_LEN], [u8; ATTESTATION_LEN])> {
    let err = || error!(ErrorCode::MissingEd25519Instruction);
    if data.len() < HEADER_LEN + OFFSETS_LEN {
        return Err(err());
    }
    // 僅允許一組簽章
    if data[0] != 1 {
        return Err(err());
    }
    let u16_at = |i: usize| u16::from_le_bytes([data[HEADER_LEN + i * 2], data[HEADER_LEN + i * 2 + 1]]);
    let signature_offset = u16_at(0) as usize;
    let signature_ix = u16_at(1);
    let pubkey_offset = u16_at(2) as usize;
    let pubkey_ix = u16_at(3);
    let message_offset = u16_at(4) as usize;
    let message_size = u16_at(5) as usize;
    let message_ix = u16_at(6);

    // 三段都必須指向 ed25519 指令自身
    let is_self = |ix: u16| ix == SELF_INDEX || ix == ed25519_ix_index;
    if !(is_self(signature_ix) && is_self(pubkey_ix) && is_self(message_ix)) {
        return Err(err());
    }
    // 長度固定為 canonical bytes
    if message_size != ATTESTATION_LEN {
        return Err(err());
    }
    // 邊界檢查（checked 避免 u16 → usize 加法後越界）
    let in_bounds = |off: usize, len: usize| off.checked_add(len).is_some_and(|end| end <= data.len());
    if !(in_bounds(signature_offset, SIG_LEN) && in_bounds(pubkey_offset, PUBKEY_LEN) && in_bounds(message_offset, ATTESTATION_LEN)) {
        return Err(err());
    }
    // 三段不得落在 header／offsets 區
    if signature_offset < HEADER_LEN + OFFSETS_LEN || pubkey_offset < HEADER_LEN + OFFSETS_LEN || message_offset < HEADER_LEN + OFFSETS_LEN {
        return Err(err());
    }

    let mut pubkey = [0u8; PUBKEY_LEN];
    pubkey.copy_from_slice(&data[pubkey_offset..pubkey_offset + PUBKEY_LEN]);
    let mut message = [0u8; ATTESTATION_LEN];
    message.copy_from_slice(&data[message_offset..message_offset + ATTESTATION_LEN]);
    Ok((pubkey, message))
}

/// SD 3.3 步驟 2～7。成功時回傳已解碼的 attestation。
///
/// `instructions_sysvar` 必須是 `Sysvar1nstructions1111111111111111111111111`（呼叫端以 address 約束）。
pub fn verify_attestation(
    instructions_sysvar: &AccountInfo,
    config: &Config,
    signer: &Pubkey,
    args: &AttestationArgs,
    now: i64,
) -> Result<Attestation> {
    // 2. 緊鄰的前一道指令必須是 Ed25519 program，且格式正確
    let current = load_current_index_checked(instructions_sysvar)?;
    if current == 0 {
        return Err(error!(ErrorCode::MissingEd25519Instruction));
    }
    let prev_index = current - 1;
    let prev = load_instruction_at_checked(prev_index as usize, instructions_sysvar)?;
    if prev.program_id != ed25519_program::id() {
        return Err(error!(ErrorCode::MissingEd25519Instruction));
    }
    let (signer_key, message) = parse_ed25519_instruction(&prev.data, prev_index)?;

    // 3. 公鑰等於目前 attestor，或在寬限期內的舊 attestor
    if !config.attestor_accepts(&Pubkey::new_from_array(signer_key), now) {
        return Err(error!(ErrorCode::InvalidAttestorKey));
    }

    // 4. 訊息 bytes 與本指令參數重建的 canonical bytes 完全一致
    let expected = Attestation::from(args);
    if message != expected.encode() {
        return Err(error!(ErrorCode::AttestationMismatch));
    }
    // 結構檢查（domain／version／task_type）；bytes 相同所以 decode 必成功，但仍走正式路徑
    let att = Attestation::decode(&message).map_err(|_| error!(ErrorCode::AttestationMismatch))?;

    // 5. program_id 與 cluster_id 綁定（BR-14）
    if att.program_id != crate::ID.to_bytes() || att.cluster_id != config.cluster_id {
        return Err(error!(ErrorCode::WrongProgramOrCluster));
    }
    // 6. wallet 等於簽章者
    if att.wallet != signer.to_bytes() {
        return Err(error!(ErrorCode::WalletMismatch));
    }
    // 7. issued_at <= not_before <= now <= expiry，且 expiry - issued_at <= 600
    if att.issued_at > att.not_before || att.not_before > att.expiry {
        return Err(error!(ErrorCode::InvalidAttestationWindow));
    }
    let ttl = att.expiry.checked_sub(att.issued_at).ok_or(ErrorCode::MathOverflow)?;
    if ttl > MAX_TTL_SECONDS {
        return Err(error!(ErrorCode::AttestationTtlTooLong));
    }
    if now < att.not_before {
        return Err(error!(ErrorCode::AttestationNotYetValid));
    }
    if now > att.expiry {
        return Err(error!(ErrorCode::AttestationExpired));
    }
    Ok(att)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(num_sigs: u8, sig_off: u16, sig_ix: u16, pk_off: u16, pk_ix: u16, msg_off: u16, msg_size: u16, msg_ix: u16, tail: usize) -> Vec<u8> {
        let mut d = vec![num_sigs, 0];
        for v in [sig_off, sig_ix, pk_off, pk_ix, msg_off, msg_size, msg_ix] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend(std::iter::repeat_n(0xabu8, tail));
        d
    }

    /// 與 solana-ed25519-program 建構器相同的標準佈局：pubkey@16、sig@48、msg@112
    fn standard() -> Vec<u8> {
        let mut d = build(1, 48, SELF_INDEX, 16, SELF_INDEX, 112, 164, SELF_INDEX, 32 + 64 + 164);
        d[16..48].copy_from_slice(&[0x11; 32]);
        d[112..112 + 164].copy_from_slice(&[0x22; 164]);
        d
    }

    #[test]
    fn parses_standard_layout() {
        let (pk, msg) = parse_ed25519_instruction(&standard(), 0).unwrap();
        assert_eq!(pk, [0x11; 32]);
        assert_eq!(msg, [0x22; 164]);
    }

    #[test]
    fn accepts_explicit_self_index() {
        let d = build(1, 48, 3, 16, 3, 112, 164, 3, 32 + 64 + 164);
        assert!(parse_ed25519_instruction(&d, 3).is_ok());
        assert!(parse_ed25519_instruction(&d, 2).is_err(), "指向其他 instruction");
    }

    #[test]
    fn rejects_two_signatures() {
        let mut d = standard();
        d[0] = 2;
        assert!(parse_ed25519_instruction(&d, 0).is_err());
    }

    #[test]
    fn rejects_zero_signatures_and_short_data() {
        let mut d = standard();
        d[0] = 0;
        assert!(parse_ed25519_instruction(&d, 0).is_err());
        assert!(parse_ed25519_instruction(&[1, 0, 0], 0).is_err());
    }

    #[test]
    fn rejects_wrong_message_size() {
        for size in [0u16, 163, 165, u16::MAX] {
            let d = build(1, 48, SELF_INDEX, 16, SELF_INDEX, 112, size, SELF_INDEX, 32 + 64 + 200);
            assert!(parse_ed25519_instruction(&d, 0).is_err(), "size {size}");
        }
    }

    #[test]
    fn rejects_out_of_bounds_offsets() {
        // message 越界一個 byte
        let d = build(1, 48, SELF_INDEX, 16, SELF_INDEX, 113, 164, SELF_INDEX, 32 + 64 + 164);
        assert!(parse_ed25519_instruction(&d, 0).is_err());
        // 極大 offset（checked_add 不得 panic）
        let d = build(1, u16::MAX, SELF_INDEX, 16, SELF_INDEX, 112, 164, SELF_INDEX, 32 + 64 + 164);
        assert!(parse_ed25519_instruction(&d, 0).is_err());
        // offset 指進 header
        let d = build(1, 48, SELF_INDEX, 0, SELF_INDEX, 112, 164, SELF_INDEX, 32 + 64 + 164);
        assert!(parse_ed25519_instruction(&d, 0).is_err());
    }

    #[test]
    fn rejects_offsets_pointing_to_other_instruction() {
        for i in 0..3 {
            let ixs: [u16; 3] = std::array::from_fn(|k| if k == i { 1 } else { SELF_INDEX });
            let d = build(1, 48, ixs[0], 16, ixs[1], 112, 164, ixs[2], 32 + 64 + 164);
            assert!(parse_ed25519_instruction(&d, 0).is_err(), "segment {i}");
        }
    }
}
