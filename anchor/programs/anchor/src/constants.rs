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

#[cfg(feature = "mainnet")]
pub const KAMINO_PROGRAM_ID: Pubkey = solana_program::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

#[cfg(not(feature = "mainnet"))]
// Standard localnet testing ID (update if you deploy Kamino to a different local ID)
pub const KAMINO_PROGRAM_ID: Pubkey = solana_program::pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
