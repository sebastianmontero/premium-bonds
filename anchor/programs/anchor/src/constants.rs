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

/// Minimum allowable duration for a single stake/yield cycle in hours (1 hour).
pub const MIN_STAKE_CYCLE_DURATION_HRS: i64 = 1;
/// Maximum allowable duration for a single stake/yield cycle in hours (8,760 hours = 365 days).
pub const MAX_STAKE_CYCLE_DURATION_HRS: i64 = 8760;

/// Maximum number of prize tiers per pool.
pub const MAX_PRIZE_TIERS: usize = 10;
/// Maximum number of total winners per draw.
pub const MAX_TOTAL_WINNERS: usize = 50;

/// Maximum allowable basis points (100.00%).
pub const MAX_BASIS_POINTS: u16 = 10_000;

/// Default timelock delay (in seconds) before winner payouts can be cranked (5 minutes).
pub const DEFAULT_PAYOUT_TIMELOCK_SECONDS: u32 = 300;
/// Maximum allowable timelock delay before winner payouts can be cranked (24 hours = 86,400 seconds).
pub const MAX_PAYOUT_TIMELOCK_SECONDS: u32 = 86_400;
/// Maximum allowable deficit (in token base units / lamports) tolerated as rounding dust during solvency checks.
pub const SOLVENCY_DUST_TOLERANCE: u64 = 1_000;

/// Registry grows 10,240 bytes (160 user entry slots) per `resize_registry` call.
pub const REGISTRY_REALLOC_STEP: usize = 10_240;
/// Solana's hard account size cap.
pub const REGISTRY_MAX_SIZE: usize = 10_485_760;
/// Minimum account size the client must pre-allocate when calling create_pool.
/// 104 byte header + 4096 initial user entries * 64 bytes.
pub const REGISTRY_INITIAL_SIZE: usize = 262_248;

/// Huma Finance Program ID on mainnet.
#[cfg(feature = "mainnet")]
pub const HUMA_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn");

/// Huma Finance Program ID on localnet / devnet.
#[cfg(not(feature = "mainnet"))]
pub const HUMA_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw");
