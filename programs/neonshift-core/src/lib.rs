//! NeonShift 鏈上程式骨架（PG-I-06）。
//! 帳戶、指令與錯誤碼依 docs/sd.md 第 3 章逐項由 PG-C-01 起實作。

use anchor_lang::prelude::*;

pub mod constants;

pub use constants::*;

declare_id!("5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf");

#[program]
pub mod neonshift_core {
    use super::*;

    /// 骨架確認指令：僅驗證程式可載入並執行；PG-C-01 起由 `initialize_config` 等正式指令取代。
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("neonshift_core v{}", PROGRAM_VERSION);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub payer: Signer<'info>,
}
