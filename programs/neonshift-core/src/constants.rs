//! PDA seeds 與常數（SD 3.1）。

use anchor_lang::prelude::*;

pub const PROGRAM_VERSION: u8 = 1;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const PLAYER_SEED: &[u8] = b"player";
#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";
#[constant]
pub const TOURNAMENT_SEED: &[u8] = b"tournament";
#[constant]
pub const ENTRY_SEED: &[u8] = b"entry";

/// canonical attestation 的環境識別（SD 3.1 Config.cluster_id）；數值以 attestation-core 為準
pub use attestation_core::{CLUSTER_DEVNET, CLUSTER_LOCALNET, TASK_SLEEP, TASK_STEPS};
