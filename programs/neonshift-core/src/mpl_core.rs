//! Metaplex Core `CreateV1` 的最小 CPI（無 crate 相依）。
//! mpl-core 0.12 只支援 Anchor 0.31／0.32（solana-program 2.x），與 Anchor 1.2 不相容，
//! 因此依 mpl-core generated 原始碼手動組指令：discriminator 0 + borsh(CreateV1Args)，
//! 可選帳戶以 MPL_CORE_ID 占位（Metaplex 慣例）。升級 Core 版本時需重新核對佈局。

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

const DISCRIMINATOR_CREATE_V1: u8 = 0;
const DATA_STATE_ACCOUNT: u8 = 0;

/// borsh：discriminator u8 | data_state u8 | name String | uri String | plugins Option<Vec<_>> = None
pub fn create_v1_data(name: &str, uri: &str) -> Vec<u8> {
    let mut d = Vec::with_capacity(2 + 4 + name.len() + 4 + uri.len() + 1);
    d.push(DISCRIMINATOR_CREATE_V1);
    d.push(DATA_STATE_ACCOUNT);
    d.extend_from_slice(&(name.len() as u32).to_le_bytes());
    d.extend_from_slice(name.as_bytes());
    d.extend_from_slice(&(uri.len() as u32).to_le_bytes());
    d.extend_from_slice(uri.as_bytes());
    d.push(0); // plugins: None
    d
}

pub struct CreateV1Accounts<'a, 'info> {
    pub mpl_core_program: &'a AccountInfo<'info>,
    /// 新 asset（signer、writable；本專案為 PDA，以 signer_seeds 簽）
    pub asset: &'a AccountInfo<'info>,
    /// 付 rent（signer、writable）；同時作為 authority
    pub payer: &'a AccountInfo<'info>,
    /// 擁有者（readonly）
    pub owner: &'a AccountInfo<'info>,
    /// update authority（readonly，不需簽章）
    pub update_authority: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
}

/// 無 collection、無 plugins 的建立；authority 使用 payer（None → 預設 payer）。
/// `signer_seeds`：asset 為 PDA 時的 seeds（signer 權限會透過 Core 對 system program 的巢狀 CPI 傳遞）。
pub fn create_v1<'info>(accts: CreateV1Accounts<'_, 'info>, name: &str, uri: &str, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    require_keys_eq!(*accts.mpl_core_program.key, MPL_CORE_ID);
    let metas = vec![
        AccountMeta::new(*accts.asset.key, true),
        AccountMeta::new_readonly(MPL_CORE_ID, false), // collection: None
        AccountMeta::new_readonly(MPL_CORE_ID, false), // authority: None（＝payer）
        AccountMeta::new(*accts.payer.key, true),
        AccountMeta::new_readonly(*accts.owner.key, false),
        AccountMeta::new_readonly(*accts.update_authority.key, false),
        AccountMeta::new_readonly(*accts.system_program.key, false),
        AccountMeta::new_readonly(MPL_CORE_ID, false), // log_wrapper: None
    ];
    let ix = Instruction { program_id: MPL_CORE_ID, accounts: metas, data: create_v1_data(name, uri) };
    invoke_signed(
        &ix,
        &[
            accts.asset.clone(),
            accts.mpl_core_program.clone(),
            accts.payer.clone(),
            accts.owner.clone(),
            accts.update_authority.clone(),
            accts.system_program.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_v1_data_layout() {
        let d = create_v1_data("Ab", "u");
        assert_eq!(d, vec![0, 0, 2, 0, 0, 0, b'A', b'b', 1, 0, 0, 0, b'u', 0]);
    }
}
