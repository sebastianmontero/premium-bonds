/**
 * Centralized Solana Fee Domain & Protocol Constants
 */

/** Base Solana transaction execution fee for 1 signature (5,000 lamports = 0.000005 SOL) */
export const SOLANA_BASE_SIGNATURE_FEE_SOL = 0.000005;

/** Rent exemption cost for UserWinnings PDA (138 bytes = 1,851,360 lamports = 0.00185136 SOL) */
export const USER_WINNINGS_RENT_EXEMPTION_SOL = 0.00185136;

/** Data space for UserWinnings PDA (8 byte discriminator + 130 byte INIT_SPACE) */
export const USER_WINNINGS_SPACE_BYTES = 138;

export interface FeeEstimateResult {
  networkFeeSol: number;
  storageFeeSol: number;
  totalSolFee: number;
}

/**
 * Calculates estimated SOL fees for an action based on whether account storage (rent) is required.
 *
 * @param options - Configuration options for fee calculation.
 * @returns Object containing network execution fee, storage fee, and total SOL fee.
 */
export function calculateEstimatedSolFee(
  options: {
    isFirstDeposit?: boolean;
    customNetworkFeeSol?: number;
  } = {}
): FeeEstimateResult {
  const networkFeeSol =
    options.customNetworkFeeSol ?? SOLANA_BASE_SIGNATURE_FEE_SOL;
  const storageFeeSol = options.isFirstDeposit
    ? USER_WINNINGS_RENT_EXEMPTION_SOL
    : 0;

  return {
    networkFeeSol,
    storageFeeSol,
    totalSolFee: networkFeeSol + storageFeeSol,
  };
}
