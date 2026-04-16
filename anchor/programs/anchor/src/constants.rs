use anchor_lang::prelude::*;

#[constant]
pub const SEED: &str = "anchor";

pub const DISCRIMINATOR: usize = 8;

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
pub const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const POOL_KTOKENS_SEED: &[u8] = b"pool_ktokens";
pub const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";
pub const PAYOUT_SEED: &[u8] = b"payout";

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
pub const KAMINO_PROGRAM_ID: Pubkey = solana_program::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

#[cfg(not(feature = "mainnet"))]
// Standard localnet testing ID (update if you deploy Kamino to a different local ID)
pub const KAMINO_PROGRAM_ID: Pubkey = solana_program::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

/// Solana instructions sysvar — required by Kamino as a flash-loan guard.
/// Fixed well-known address: Sysvar1nstructions1111111111111111111111111
pub const INSTRUCTIONS_SYSVAR_ID: Pubkey =
    solana_program::pubkey!("Sysvar1nstructions1111111111111111111111111");
