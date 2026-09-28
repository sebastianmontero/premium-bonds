/**
 * Canonical protocol & daemon constants for the Crank service.
 * Aligns 1:1 with anchor/programs/anchor/src/constants.rs.
 */

/// Maximum allowable slot freshness window before VRF randomness expires (1,000 slots ~ 400s).
export const VRF_FRESHNESS_WINDOW_SLOTS = 1000n;

/// Maximum allowable slot lag between Switchboard commit and contract execution (64 slots ~ 25.6s).
export const VRF_COMMIT_FRESHNESS_WINDOW_SLOTS = 64n;

/// Estimated Solana slot duration in milliseconds.
export const ESTIMATED_SLOT_DURATION_MS = 400;

/// Minimum backoff duration in milliseconds for daemon tasks.
export const MIN_CRANK_BACKOFF_MS = 1000;

/// Default retry delay when waiting for transient RPC propagation.
export const RPC_PROPAGATION_RETRY_MS = 3000;

/// Maximum transient retries before entering backoff for mismatch.
export const MAX_RPC_MISMATCH_RETRIES = 2;

/// Helper to check whether VRF randomness has expired on-chain.
export function isRandomnessExpired(
  committedSlot: bigint,
  currentSlot: bigint
): boolean {
  return currentSlot - committedSlot > VRF_FRESHNESS_WINDOW_SLOTS;
}
