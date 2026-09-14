//! NeonShift 鏈上程式（SD 3）。帳戶、指令與錯誤碼依 docs/sd.md 第 3 章逐項由 PG-C-01 起實作。

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf");

#[program]
pub mod neonshift_core {
    use super::*;

    /// 建立 Config PDA（僅可執行一次；只有 upgrade authority 可呼叫）
    pub fn initialize_config(ctx: Context<InitializeConfig>, params: InitializeConfigParams) -> Result<()> {
        instructions::initialize_config::handle_initialize_config(ctx, params)
    }
}
