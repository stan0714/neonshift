//! 錯誤碼（SD 3.6）。6000–6022 為定案；6023 起為實作期新增並同步回 SD。

use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Config 停用中")]
    ProgramPaused, // 6000
    #[msg("前置 ed25519 指令缺失或格式錯誤")]
    MissingEd25519Instruction, // 6001
    #[msg("attestor 公鑰不符且不在寬限期")]
    InvalidAttestorKey, // 6002
    #[msg("canonical bytes 不一致")]
    AttestationMismatch, // 6003
    #[msg("program id 或 cluster 不符")]
    WrongProgramOrCluster, // 6004
    #[msg("簽章者非 attestation 指定錢包")]
    WalletMismatch, // 6005
    #[msg("attestation 未到 not_before")]
    AttestationNotYetValid, // 6006
    #[msg("attestation 已過期")]
    AttestationExpired, // 6007
    #[msg("attestation 有效期超過 600 秒")]
    AttestationTtlTooLong, // 6008
    #[msg("此任務已領取")]
    AlreadyClaimed, // 6009
    #[msg("今日額度已用盡")]
    DailyCapReached, // 6010
    #[msg("定點數運算溢位")]
    MathOverflow, // 6011
    #[msg("跑鞋已鑄造")]
    ShoeAlreadyMinted, // 6012
    #[msg("已達最高 Core 等級")]
    MaxCoreLevel, // 6013
    #[msg("賽事狀態不允許此操作")]
    InvalidTournamentState, // 6014
    #[msg("已報名")]
    AlreadyJoined, // 6015
    #[msg("有效參賽人數不足")]
    InsufficientEntrants, // 6016
    #[msg("資金守恆檢查失敗")]
    ConservationViolation, // 6017
    #[msg("沒收未附證據摘要")]
    MissingEvidence, // 6018
    #[msg("task_date 不是鏈上目前 UTC 日序")]
    InvalidTaskDate, // 6019
    #[msg("Core 等級超出 Config 範圍")]
    InvalidCoreLevel, // 6020
    #[msg("mint、owner、vault PDA 或 token program 不符")]
    InvalidTokenAccount, // 6021
    #[msg("排名批次非連續、重複或與 manifest 不符")]
    InvalidResultBatch, // 6022
    #[msg("Config 參數超出允許範圍")]
    InvalidConfigParam, // 6023
    #[msg("簽章者不是程式的 upgrade authority")]
    NotUpgradeAuthority, // 6024
}
