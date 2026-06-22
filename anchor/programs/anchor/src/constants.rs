use anchor_lang::prelude::*;

#[constant]
pub const SEED: &str = "anchor";

pub const DISCRIMINATOR: usize = 8;

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
pub const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const POOL_PST_SEED: &[u8] = b"pool_pst";
pub const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";
pub const PAYOUT_SEED: &[u8] = b"payout";
pub const PENDING_REDEMPTION_SEED: &[u8] = b"pending_redemption";

pub const MAX_PRIZE_TIERS: usize = 10;
pub const MAX_TOTAL_WINNERS: usize = 50;

/// Registry grows 10 KB (~320 ticket slots) per `resize_registry` crank call.
pub const REGISTRY_REALLOC_STEP: usize = 10_240;
/// Solana's hard account size cap.
pub const REGISTRY_MAX_SIZE: usize = 10_485_760;
/// Minimum account size the client must pre-allocate when calling create_pool.
/// 128 KB = 4,095 initial ticket slots, ~0.89 SOL rent.
pub const REGISTRY_INITIAL_SIZE: usize = 131_072;

#[cfg(feature = "mainnet")]
pub const HUMA_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn");

#[cfg(not(feature = "mainnet"))]
pub const HUMA_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj");
