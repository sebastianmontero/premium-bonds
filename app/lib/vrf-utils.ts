/**
 * Client-side VRF (Verifiable Random Function) derivation utility.
 *
 * Ports the on-chain `derive_random_index` function to TypeScript using
 * Web Crypto SHA-256. This allows the frontend to independently verify
 * winning ticket indices for provable fairness.
 *
 * The derivation is deterministic and uses frozen on-chain parameters:
 * - `randomnessSeed` from `DrawCycle.randomness_seed` (permanent)
 * - `lockedTicketCount` from `DrawCycle.locked_ticket_count` (frozen snapshot)
 *
 * These values don't change after the draw, so the result is always
 * reproducible regardless of the current ticket registry state.
 */

/**
 * Derive a deterministic random ticket index from a seed and contextual inputs.
 * Mirrors the Rust `derive_random_index` function exactly.
 *
 * @param seed - 32-byte randomness seed from DrawCycle
 * @param tierIdx - Prize tier index (0 = grand, 1 = runner-up, etc.)
 * @param winnerSlot - Winner slot within the tier
 * @param cycleId - Draw cycle ID
 * @param ticketCount - Locked ticket count from DrawCycle (frozen snapshot)
 * @returns The winning ticket index (0-based)
 */
export async function deriveRandomIndex(
  seed: Uint8Array,
  tierIdx: number,
  winnerSlot: number,
  cycleId: number,
  ticketCount: number
): Promise<number> {
  if (ticketCount === 0) return 0;

  // Build the input buffer: seed(32) + tier_idx(4 LE) + winner_slot(4 LE) + cycle_id(4 LE)
  const input = new Uint8Array(32 + 4 + 4 + 4);
  input.set(seed, 0);

  const view = new DataView(input.buffer);
  view.setUint32(32, tierIdx, true); // little-endian
  view.setUint32(36, winnerSlot, true);
  view.setUint32(40, cycleId, true);

  // SHA-256 hash (matches solana_program::hash::hashv)
  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  const hashBytes = new Uint8Array(hashBuffer);

  // Take first 8 bytes as little-endian u64
  const hashView = new DataView(hashBytes.buffer);
  const value = hashView.getBigUint64(0, true);

  // Modulo ticket count
  return Number(value % BigInt(ticketCount));
}

/**
 * Format a randomness seed as a hex string for display.
 *
 * @param seed - The 32-byte randomness seed.
 * @returns Hexadecimal string representation of the seed.
 */
export function formatSeedHex(seed: Uint8Array): string {
  return Array.from(seed)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
