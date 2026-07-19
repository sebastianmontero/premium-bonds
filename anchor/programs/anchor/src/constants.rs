use anchor_lang::prelude::*;

#[constant]
pub const SEED: &str = "anchor";

/// Account discriminator prefix size in bytes.
pub const DISCRIMINATOR: usize = 8;

/// PDA seed prefix for the GlobalConfig account.
pub const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
/// PDA seed prefix for the PrizePool account.
pub const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
/// PDA seed prefix for the pool vault account.
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
/// PDA seed prefix for the pool's $PST token vault account.
pub const POOL_PST_SEED: &[u8] = b"pool_pst";
/// PDA seed prefix for the DrawCycle account.
pub const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";
/// PDA seed prefix for the PayoutRegistry account.
pub const PAYOUT_SEED: &[u8] = b"payout";
/// PDA seed prefix for the PendingRedemption account.
pub const PENDING_REDEMPTION_SEED: &[u8] = b"pending_redemption";

/// Maximum number of prize tiers per pool.
pub const MAX_PRIZE_TIERS: usize = 10;
/// Maximum number of total winners per draw.
pub const MAX_TOTAL_WINNERS: usize = 50;

/// Registry grows 10,080 bytes (210 user entry slots) per `resize_registry` crank call.
pub const REGISTRY_REALLOC_STEP: usize = 10_080;
/// Solana's hard account size cap.
pub const REGISTRY_MAX_SIZE: usize = 10_485_760;
/// Minimum account size the client must pre-allocate when calling create_pool.
/// 36 byte header + 4096 initial user entries * 48 bytes.
pub const REGISTRY_INITIAL_SIZE: usize = 196_644;

/// Huma Finance Program ID on mainnet.
#[cfg(feature = "mainnet")]
pub const HUMA_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn");

/// Huma Finance Program ID on localnet / devnet.
#[cfg(not(feature = "mainnet"))]
pub const HUMA_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj");
