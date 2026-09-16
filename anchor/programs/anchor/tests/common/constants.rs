use solana_program::pubkey::Pubkey;

// ─── Seed mirrors ────────────────────────────────────────────────────────────

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
pub const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const POOL_PST_SEED: &[u8] = b"pool_pst";
pub const HUMA_POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
pub const PENDING_REDEMPTION_SEED: &[u8] = b"pending_redemption";
pub const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";
pub const PAYOUT_SEED: &[u8] = b"payout";
pub const USER_WINNINGS_SEED: &[u8] = b"user_winnings";

// ─── Trigger Pubkeys ─────────────────────────────────────────────────────────

pub const FAIL_DEPOSIT_PUBKEY: Pubkey = Pubkey::new_from_array([1; 32]);
pub const FAIL_REDEMPTION_PUBKEY: Pubkey = Pubkey::new_from_array([2; 32]);
pub const FAIL_DISBURSE_PUBKEY: Pubkey = Pubkey::new_from_array([3; 32]);
pub const FAIL_ZERO_SHARES_PUBKEY: Pubkey = Pubkey::new_from_array([5; 32]);

// ─── Test Time & Slot Constants ─────────────────────────────────────────────

pub const TEST_GENESIS_TIMESTAMP: i64 = 1_700_000_000;
pub const SECONDS_PER_HOUR: i64 = 3600;
pub const DEFAULT_STAKE_CYCLE_DURATION_HRS: i64 = 24;
pub const DEFAULT_STAKE_CYCLE_DURATION_SECS: i64 =
    DEFAULT_STAKE_CYCLE_DURATION_HRS * SECONDS_PER_HOUR;
pub const TEST_SLOT_OFFSET_RANDOMNESS_EXPIRED: u64 =
    anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

// ─── Discriminators & Tags ──────────────────────────────────────────────────

pub const SWITCHBOARD_RANDOMNESS_DISCRIMINATOR: [u8; 8] = [10, 66, 229, 135, 220, 239, 217, 114];
pub const ANCHOR_EVENT_IX_TAG: [u8; 8] = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d];
