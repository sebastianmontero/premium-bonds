/**
 * Canonical protocol & daemon constants for the Crank service.
 * Aligns 1:1 with anchor/programs/anchor/src/constants.rs.
 */

/// Maximum allowable slot freshness window before VRF randomness expires (1,000 slots ~ 400s).
export const VRF_FRESHNESS_WINDOW_SLOTS = 1000n;

/// Maximum allowable slot lag between Switchboard commit and contract execution (64 slots ~ 25.6s).
export const VRF_COMMIT_FRESHNESS_WINDOW_SLOTS = 64n;

/// Maximum number of automated randomness rebind attempts before escalating to admin.
export const MAX_CRANK_REBINDS = 2;

/// Estimated Solana slot duration in milliseconds.
export const ESTIMATED_SLOT_DURATION_MS = 400;

/// Minimum backoff duration in milliseconds for daemon tasks.
export const MIN_CRANK_BACKOFF_MS = 1000;

/// Default retry delay when waiting for transient RPC propagation.
export const RPC_PROPAGATION_RETRY_MS = 3000;

/// Maximum transient retries before entering backoff for mismatch.
export const MAX_RPC_MISMATCH_RETRIES = 2;

/// Quarantine probe interval when an on-chain circuit breaker halt is encountered.
export const CIRCUIT_BREAKER_HALT_QUARANTINE_MS = 60_000;

/// Base cooldown duration in milliseconds for venue liquidity deficits (6066).
export const VENUE_LIQUIDITY_BASE_COOLDOWN_MS = 30_000;

/// Maximum backoff cooldown ceiling for venue liquidity deficits (10 minutes).
export const VENUE_LIQUIDITY_MAX_COOLDOWN_MS = 600_000;

/// Threshold duration of continuous deficit before emitting stalled warning alert (15 minutes).
export const VENUE_LIQUIDITY_ALERT_STALLED_MS = 900_000;

/// Candidate-level quarantine duration (5 minutes) before re-attempting a deficient candidate.
export const REDEMPTION_CANDIDATE_QUARANTINE_MS = 300_000;

/// Helper to check whether VRF randomness has expired on-chain.
export function isRandomnessExpired(
  committedSlot: bigint,
  currentSlot: bigint
): boolean {
  return currentSlot - committedSlot > VRF_FRESHNESS_WINDOW_SLOTS;
}
