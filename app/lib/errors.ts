import {
  ANCHOR_ERROR__POOL_NOT_ACTIVE,
  ANCHOR_ERROR__INVALID_POOL_STATUS,
  ANCHOR_ERROR__CYCLE_NOT_ENDED,
  ANCHOR_ERROR__INVALID_BOND_QUANTITY,
  ANCHOR_ERROR__REGISTRY_FULL,
  ANCHOR_ERROR__REGISTRY_TOO_SMALL,
  ANCHOR_ERROR__REGISTRY_AT_MAX_SIZE,
  ANCHOR_ERROR__AWAITING_RANDOMNESS_FREEZE,
  ANCHOR_ERROR__UNAUTHORIZED_TICKET,
  ANCHOR_ERROR__ALREADY_CLAIMED,
  ANCHOR_ERROR__MATH_OVERFLOW,
  ANCHOR_ERROR__INVALID_WINNER_INDEX,
  ANCHOR_ERROR__UNAUTHORIZED_CRANK,
  ANCHOR_ERROR__INVALID_PRIZE_TIER_CONFIG,
  ANCHOR_ERROR__PRIZE_TIERS_NOT_CONFIGURED,
  ANCHOR_ERROR__BASIS_POINTS_MUST_EQUAL10000,
  ANCHOR_ERROR__INVALID_DRAW_STATUS,
  ANCHOR_ERROR__INVALID_DRAW_STATE,
  ANCHOR_ERROR__UNAUTHORIZED_ADMIN,
  ANCHOR_ERROR__INVALID_BOND_PRICE,
  ANCHOR_ERROR__INVALID_STAKE_CYCLE_DURATION,
  ANCHOR_ERROR__HUMA_REDEMPTION_NOT_SETTLED,
  ANCHOR_ERROR__INVALID_REDEMPTION_OWNER,
  ANCHOR_ERROR__INSUFFICIENT_FEE_BALANCE,
  ANCHOR_ERROR__NO_WINNINGS_TO_CLAIM,
  ANCHOR_ERROR__INVALID_FEE_CONFIG,
  ANCHOR_ERROR__INVALID_MAX_YIELD_BASIS_POINTS,
  ANCHOR_ERROR__INVALID_PAYOUT_TIMELOCK,
  ANCHOR_ERROR__INVALID_MODE_MINT,
  ANCHOR_ERROR__INVALID_RANDOMNESS_ACCOUNT,
  ANCHOR_ERROR__RANDOMNESS_NOT_RESOLVED,
  ANCHOR_ERROR__STALE_RANDOMNESS_REQUEST,
  ANCHOR_ERROR__RANDOMNESS_NOT_EXPIRED,
  ANCHOR_ERROR__INVALID_USER_ENTRY_HINT,
  ANCHOR_ERROR__INSUFFICIENT_PENDING_TICKETS,
  ANCHOR_ERROR__INSUFFICIENT_ACTIVE_TICKETS,
  ANCHOR_ERROR__POOL_NOT_FROZEN,
  ANCHOR_ERROR__MISSING_SWAPPED_USER_WINNINGS,
  ANCHOR_ERROR__INVALID_FEE_WALLET,
  ANCHOR_ERROR__CANNOT_MODIFY_BOND_PRICE_WITH_ACTIVE_DEPOSITS,
  ANCHOR_ERROR__POOL_PAUSED,
  ANCHOR_ERROR__POOL_CLOSED,
  ANCHOR_ERROR__DRAW_VOIDED,
  ANCHOR_ERROR__DRAW_ALREADY_VOIDED,
  ANCHOR_ERROR__PAYOUTS_ALREADY_STARTED,
  ANCHOR_ERROR__PAYOUT_TIMELOCK_ACTIVE,
  ANCHOR_ERROR__FEES_ALREADY_WITHDRAWN,
  ANCHOR_ERROR__YIELD_VELOCITY_EXCEEDED,
  ANCHOR_ERROR__YIELD_VENUE_INSOLVENT,
  ANCHOR_ERROR__UNAUTHORIZED,
} from "./generated/yield-bonds/src/generated";

export type ErrorCategory =
  | "wallet_cancellation"
  | "insufficient_sol"
  | "insufficient_tokens"
  | "anchor_custom"
  | "anchor_constraint"
  | "blockhash_expired"
  | "network_rpc"
  | "unknown";

/**
 * Structured output of a parsed transaction error.
 */
export interface ParsedTransactionError {
  /** True if the user intentionally rejected or cancelled the transaction. */
  isCancellation: boolean;
  /** High-level layer where error originated. */
  layer: "wallet" | "anchor" | "spl" | "system" | "rpc" | "unknown";
  /** Categorized error classification. */
  category: ErrorCategory;
  /** Short human-readable title. */
  title: string;
  /** Human-readable error message or raw error details. */
  message: string;
  /** Numeric or string error code if identified. */
  code?: string | number;
  /** Suggested actionable step for the user. */
  actionableStep?: string;
  /** Extracted transaction/simulation logs if present. */
  logs?: string[];
  /** Original raw error object. */
  rawError?: unknown;
}

/**
 * Anchor custom error codes map for YieldBonds Program (offset 6000 / 0x1770)
 */
export const ANCHOR_CUSTOM_ERRORS: Record<
  number,
  { name: string; message: string; actionable?: string }
> = {
  [ANCHOR_ERROR__POOL_NOT_ACTIVE]: {
    name: "PoolNotActive",
    message: "The prize pool is not currently active.",
    actionable: "Please wait for the administrator to activate this pool.",
  },
  [ANCHOR_ERROR__INVALID_POOL_STATUS]: {
    name: "InvalidPoolStatus",
    message: "Invalid pool status value.",
  },
  [ANCHOR_ERROR__CYCLE_NOT_ENDED]: {
    name: "CycleNotEnded",
    message: "The current stake cycle has not yet ended.",
    actionable: "Please wait until the current draw cycle completes.",
  },
  [ANCHOR_ERROR__INVALID_BOND_QUANTITY]: {
    name: "InvalidBondQuantity",
    message: "Invalid bond quantity specified.",
    actionable: "Please enter a valid ticket quantity greater than zero.",
  },
  [ANCHOR_ERROR__REGISTRY_FULL]: {
    name: "RegistryFull",
    message: "The prize pool ticket registry is at maximum capacity.",
    actionable:
      "Contact pool administrators to resize or reallocate registry storage.",
  },
  [ANCHOR_ERROR__REGISTRY_TOO_SMALL]: {
    name: "RegistryTooSmall",
    message: "The ticket registry account pre-allocation is too small.",
    actionable: "Pre-allocate sufficient byte size for ticket entries.",
  },
  [ANCHOR_ERROR__REGISTRY_AT_MAX_SIZE]: {
    name: "RegistryAtMaxSize",
    message:
      "The ticket registry has reached Solana's 10 MB maximum account size.",
  },
  [ANCHOR_ERROR__AWAITING_RANDOMNESS_FREEZE]: {
    name: "AwaitingRandomnessFreeze",
    message:
      "Withdrawals and deposits are momentarily paused during draw snapshotting.",
    actionable:
      "Please try your request again in a few seconds after the draw snapshot resolves.",
  },
  [ANCHOR_ERROR__UNAUTHORIZED_TICKET]: {
    name: "UnauthorizedTicket",
    message:
      "You are trying to perform an action on tickets that do not belong to your wallet.",
  },
  [ANCHOR_ERROR__ALREADY_CLAIMED]: {
    name: "AlreadyClaimed",
    message: "This prize has already been claimed.",
  },
  [ANCHOR_ERROR__MATH_OVERFLOW]: {
    name: "MathOverflow",
    message: "A numerical overflow occurred during calculations.",
  },
  [ANCHOR_ERROR__INVALID_WINNER_INDEX]: {
    name: "InvalidWinnerIndex",
    message: "Winner index is out of bounds.",
  },
  [ANCHOR_ERROR__UNAUTHORIZED_CRANK]: {
    name: "UnauthorizedCrank",
    message: "Only designated oracle crank bots can execute this operation.",
  },
  [ANCHOR_ERROR__INVALID_PRIZE_TIER_CONFIG]: {
    name: "InvalidPrizeTierConfig",
    message: "Invalid prize tier configuration.",
  },
  [ANCHOR_ERROR__PRIZE_TIERS_NOT_CONFIGURED]: {
    name: "PrizeTiersNotConfigured",
    message: "Prize tiers have not been configured for this pool.",
  },
  [ANCHOR_ERROR__BASIS_POINTS_MUST_EQUAL10000]: {
    name: "BasisPointsMustEqual10000",
    message:
      "Prize tier allocations must total exactly 100% (10,000 basis points).",
  },
  [ANCHOR_ERROR__INVALID_DRAW_STATUS]: {
    name: "InvalidDrawStatus",
    message: "The draw cycle is in an invalid phase for this operation.",
  },
  [ANCHOR_ERROR__INVALID_DRAW_STATE]: {
    name: "InvalidDrawState",
    message: "The draw cycle has an invalid locked ticket count or prize pot.",
  },
  [ANCHOR_ERROR__UNAUTHORIZED_ADMIN]: {
    name: "UnauthorizedAdmin",
    message: "Only the designated pool administrator can perform this action.",
  },
  [ANCHOR_ERROR__INVALID_BOND_PRICE]: {
    name: "InvalidBondPrice",
    message: "Bond price must be greater than 0.",
  },
  [ANCHOR_ERROR__INVALID_STAKE_CYCLE_DURATION]: {
    name: "InvalidStakeCycleDuration",
    message: "Stake cycle duration must be greater than 0 hours.",
  },
  [ANCHOR_ERROR__HUMA_REDEMPTION_NOT_SETTLED]: {
    name: "HumaRedemptionNotSettled",
    message: "Huma Protocol liquidity redemption is still settling on-chain.",
    actionable:
      "Please wait for the settlement window to expire before claiming.",
  },
  [ANCHOR_ERROR__INVALID_REDEMPTION_OWNER]: {
    name: "InvalidRedemptionOwner",
    message: "This pending redemption belongs to a different wallet.",
  },
  [ANCHOR_ERROR__INSUFFICIENT_FEE_BALANCE]: {
    name: "InsufficientFeeBalance",
    message: "Insufficient accrued protocol fee balance for withdrawal.",
  },
  [ANCHOR_ERROR__NO_WINNINGS_TO_CLAIM]: {
    name: "NoWinningsToClaim",
    message: "No unclaimed prize winnings available.",
  },
  [ANCHOR_ERROR__INVALID_FEE_CONFIG]: {
    name: "InvalidFeeConfig",
    message: "Fee basis points must be less than or equal to 100%.",
  },
  [ANCHOR_ERROR__INVALID_MAX_YIELD_BASIS_POINTS]: {
    name: "InvalidMaxYieldBasisPoints",
    message:
      "Maximum yield basis points must be less than or equal to 10,000 (100%).",
    actionable:
      "Configure max yield basis points between 0 (uncapped) and 10,000 (100%).",
  },
  [ANCHOR_ERROR__INVALID_PAYOUT_TIMELOCK]: {
    name: "InvalidPayoutTimelock",
    message: "Payout timelock must not exceed 86,400 seconds (24 hours).",
    actionable: "Set a payout delay buffer between 0 and 86,400 seconds.",
  },
  [ANCHOR_ERROR__INVALID_MODE_MINT]: {
    name: "InvalidModeMint",
    message: "The provided token mint does not match the pool configuration.",
  },
  [ANCHOR_ERROR__INVALID_RANDOMNESS_ACCOUNT]: {
    name: "InvalidRandomnessAccount",
    message:
      "The provided randomness account is invalid or not owned by Switchboard.",
  },
  [ANCHOR_ERROR__RANDOMNESS_NOT_RESOLVED]: {
    name: "RandomnessNotResolved",
    message: "The oracle randomness request has not yet been resolved.",
    actionable:
      "Please wait a moment for Switchboard oracle workers to fulfill the randomness request.",
  },
  [ANCHOR_ERROR__STALE_RANDOMNESS_REQUEST]: {
    name: "StaleRandomnessRequest",
    message: "The randomness request is stale or expired.",
    actionable: "Request a fresh randomness commitment.",
  },
  [ANCHOR_ERROR__RANDOMNESS_NOT_EXPIRED]: {
    name: "RandomnessNotExpired",
    message: "The active randomness commitment has not expired yet.",
  },
  [ANCHOR_ERROR__INVALID_USER_ENTRY_HINT]: {
    name: "InvalidUserEntryHint",
    message: "Invalid registry user entry hint provided.",
  },
  [ANCHOR_ERROR__INSUFFICIENT_PENDING_TICKETS]: {
    name: "InsufficientPendingTickets",
    message: "Insufficient pending tickets available.",
  },
  [ANCHOR_ERROR__INSUFFICIENT_ACTIVE_TICKETS]: {
    name: "InsufficientActiveTickets",
    message:
      "Insufficient active tickets available to complete this redemption.",
  },
  [ANCHOR_ERROR__POOL_NOT_FROZEN]: {
    name: "PoolNotFrozen",
    message: "The prize pool must be frozen for draw snapshotting.",
  },
  [ANCHOR_ERROR__MISSING_SWAPPED_USER_WINNINGS]: {
    name: "MissingSwappedUserWinnings",
    message: "Required user winnings account is missing.",
  },
  [ANCHOR_ERROR__INVALID_FEE_WALLET]: {
    name: "InvalidFeeWallet",
    message: "The provided fee wallet account is invalid.",
  },
  [ANCHOR_ERROR__CANNOT_MODIFY_BOND_PRICE_WITH_ACTIVE_DEPOSITS]: {
    name: "CannotModifyBondPriceWithActiveDeposits",
    message:
      "Cannot modify bond price while pool has active deposits, pending redemptions, or allocated prizes.",
    actionable:
      "Wait until all participants exit the pool and all prizes/redemptions settle, or create a new pool with the desired bond price.",
  },
  [ANCHOR_ERROR__POOL_PAUSED]: {
    name: "PoolPaused",
    message:
      "The prize pool is paused due to an emergency or circuit breaker event.",
    actionable:
      "Please wait for administrators to resolve the issue and unpause the pool.",
  },
  [ANCHOR_ERROR__POOL_CLOSED]: {
    name: "PoolClosed",
    message: "The prize pool is closed permanently.",
    actionable:
      "Deposits and new draws are disabled. You may withdraw and settle any remaining bond principal.",
  },
  [ANCHOR_ERROR__DRAW_VOIDED]: {
    name: "DrawVoided",
    message: "This draw has been voided by the protocol administrator.",
    actionable: "Prizes from voided draws cannot be claimed or reinvested.",
  },
  [ANCHOR_ERROR__DRAW_ALREADY_VOIDED]: {
    name: "DrawAlreadyVoided",
    message: "This draw has already been voided.",
  },
  [ANCHOR_ERROR__PAYOUTS_ALREADY_STARTED]: {
    name: "PayoutsAlreadyStarted",
    message:
      "Winner payouts have already begun processing; draw cannot be voided.",
  },
  [ANCHOR_ERROR__PAYOUT_TIMELOCK_ACTIVE]: {
    name: "PayoutTimelockActive",
    message: "Payout settlement timelock is active.",
    actionable:
      "Please wait for the timelock settlement window to elapse before cranking payouts.",
  },
  [ANCHOR_ERROR__FEES_ALREADY_WITHDRAWN]: {
    name: "FeesAlreadyWithdrawn",
    message:
      "Protocol fees from this cycle were already withdrawn; draw cannot be voided.",
  },
  [ANCHOR_ERROR__YIELD_VELOCITY_EXCEEDED]: {
    name: "YieldVelocityExceeded",
    message:
      "Yield generated in a single cycle exceeded the configured velocity ceiling.",
    actionable:
      "The pool has been paused by the automated circuit breaker for security verification.",
  },
  [ANCHOR_ERROR__YIELD_VENUE_INSOLVENT]: {
    name: "YieldVenueInsolvent",
    message: "Yield venue balance dropped below deposited book value.",
    actionable:
      "The pool has been paused by the automated solvency guard to prevent capital leakage.",
  },
  [ANCHOR_ERROR__UNAUTHORIZED]: {
    name: "Unauthorized",
    message: "Caller is not authorized for this operation.",
  },
};

/**
 * Anchor internal framework constraint & require/account errors map
 */
export const ANCHOR_FRAMEWORK_ERRORS: Record<
  number,
  { name: string; message: string; actionable?: string }
> = {
  // Constraint Violations (2000-2021)
  2000: {
    name: "ConstraintMut",
    message: "Account mutability constraint check failed.",
    actionable: "Ensure the required account is marked mutable.",
  },
  2001: {
    name: "ConstraintHasOne",
    message: "Account ownership / has_one constraint check failed.",
  },
  2002: {
    name: "ConstraintSigner",
    message: "Required account did not sign transaction.",
    actionable: "Ensure all required signers have signed the transaction.",
  },
  2003: { name: "ConstraintRaw", message: "Raw constraint check failed." },
  2004: {
    name: "ConstraintOwner",
    message: "Account owner constraint check failed.",
  },
  2005: {
    name: "ConstraintRentExempt",
    message: "Account rent exemption check failed.",
  },
  2006: {
    name: "ConstraintSeeds",
    message: "Program Derived Address (PDA) seed mismatch.",
    actionable: "Verify the PDA seeds and bump match the program expectations.",
  },
  2007: {
    name: "ConstraintExecutable",
    message: "Executable constraint check failed.",
  },
  2008: { name: "ConstraintState", message: "State constraint check failed." },
  2009: {
    name: "ConstraintAssociated",
    message: "Associated account constraint check failed.",
  },
  2010: {
    name: "ConstraintAssociatedInit",
    message: "Associated account initialization check failed.",
  },
  2011: {
    name: "ConstraintClose",
    message: "Account close constraint check failed.",
  },
  2012: {
    name: "ConstraintAddress",
    message: "Account address constraint check failed.",
  },
  2013: {
    name: "ConstraintZero",
    message: "Account zero constraint check failed.",
  },
  2014: {
    name: "ConstraintTokenMint",
    message: "Token mint constraint check failed.",
  },
  2015: {
    name: "ConstraintTokenAccount",
    message: "Token account constraint check failed.",
  },
  2016: {
    name: "ConstraintTokenProgram",
    message: "Token program constraint check failed.",
  },
  2017: {
    name: "ConstraintMintMintAuthority",
    message: "Mint authority constraint check failed.",
  },
  2018: {
    name: "ConstraintMintFreezeAuthority",
    message: "Freeze authority constraint check failed.",
  },
  2019: {
    name: "ConstraintMintDecimals",
    message: "Mint decimals constraint check failed.",
  },
  2020: { name: "ConstraintSpace", message: "Space constraint check failed." },
  2021: {
    name: "ConstraintAccountIsHeader",
    message: "Account is header constraint check failed.",
  },

  // Require & Account Errors (3000-3020)
  3000: {
    name: "RequireViolated",
    message: "Require constraint check failed.",
  },
  3001: {
    name: "RequireEqViolated",
    message: "Require eq constraint check failed.",
  },
  3002: {
    name: "RequireKeysEqViolated",
    message: "Require keys eq constraint check failed.",
  },
  3003: {
    name: "RequireNeqViolated",
    message: "Require neq constraint check failed.",
  },
  3004: {
    name: "RequireGtViolated",
    message: "Require gt constraint check failed.",
  },
  3005: {
    name: "RequireGteViolated",
    message: "Require gte constraint check failed (0xbbd).",
  },
  3006: {
    name: "RequireLtViolated",
    message: "Require lt constraint check failed.",
  },
  3007: {
    name: "RequireLteViolated",
    message: "Require lte constraint check failed.",
  },
  3008: {
    name: "AccountDiscriminatorAlreadySet",
    message: "Account discriminator already set.",
  },
  3009: {
    name: "AccountDiscriminatorNotFound",
    message: "Account discriminator not found.",
  },
  3010: {
    name: "AccountDiscriminatorMismatch",
    message: "Account discriminator mismatch.",
  },
  3011: {
    name: "AccountDidNotDeserialize",
    message: "Account deserialization failed.",
  },
  3012: {
    name: "AccountDidNotSerialize",
    message: "Account serialization failed.",
  },
  3013: {
    name: "AccountNotEnoughKeys",
    message: "Not enough account keys provided for instruction (0xbc5).",
    actionable:
      "Ensure all required instruction accounts (including event_authority and program ID) are provided.",
  },
  3014: {
    name: "AccountNotMutable",
    message: "Account is required to be mutable.",
  },
  3015: {
    name: "AccountOwnedByWrongProgram",
    message: "Account owned by wrong program.",
  },
  3016: { name: "InvalidProgramId", message: "Invalid program ID provided." },
  3017: {
    name: "InvalidProgramExecutable",
    message: "Invalid program executable provided.",
  },
  3018: {
    name: "AccountNotSigner",
    message: "Account is required to sign transaction.",
  },
  3019: {
    name: "AccountNotSystemOwned",
    message: "Account is not system owned.",
  },
  3020: {
    name: "AccountNotInitialized",
    message: "Required program account is not initialized.",
    actionable:
      "Ensure the account has been initialized before invoking this instruction.",
  },
};

/**
 * Helper to test whether an error is a user wallet rejection (code 4001 or cancellation text).
 */
function isWalletCancellation(err: unknown): boolean {
  if (!err) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;

  if (e?.code === 4001 || e?.name === "UserRejectedRequestError") {
    return true;
  }

  const msgParts = [
    typeof e?.message === "string" ? e.message : "",
    typeof e?.cause?.message === "string" ? e.cause.message : "",
    typeof e?.cause === "string" ? e.cause : "",
    String(err),
  ];

  if (e?.transactionPlanResult) {
    try {
      msgParts.push(JSON.stringify(e.transactionPlanResult));
    } catch {
      // Ignored
    }
  }

  const fullText = msgParts.join(" ");
  const isCancelPattern =
    /user (rejected|cancell?ed|declined|denied)|transaction (cancell?ed|rejected)|cancell?ed by user|rejected the request/i;

  return isCancelPattern.test(fullText);
}

/**
 * Extract logs array from error or simulation response if available.
 */
function extractLogs(err: unknown): string[] {
  if (!err) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  if (Array.isArray(e?.logs)) return e.logs;
  if (Array.isArray(e?.context?.logs)) return e.context.logs;
  if (Array.isArray(e?.context?.data?.logs)) return e.context.data.logs;
  if (Array.isArray(e?.simulationResponse?.logs))
    return e.simulationResponse.logs;
  if (Array.isArray(e?.cause?.logs)) return e.cause.logs;
  if (Array.isArray(e?.cause?.context?.logs)) return e.cause.context.logs;

  if (Array.isArray(e?.transactionPlanResult?.results)) {
    for (const res of e.transactionPlanResult.results) {
      if (Array.isArray(res?.logs)) return res.logs;
    }
  }
  return [];
}

/**
 * Flexible helper to match Anchor custom or framework errors from structured error objects,
 * numeric codes, hex codes, or error log text.
 */
export function matchAnchorError(input: unknown): {
  code: number;
  info: { name: string; message: string; actionable?: string };
  isFramework?: boolean;
} | null {
  if (!input) return null;

  // 1. Direct object inspection (e.g. err.context?.code, err.cause?.context?.code, err.code)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errObj = input as any;
  const directCode =
    errObj?.context?.code ??
    errObj?.cause?.context?.code ??
    errObj?.code ??
    (typeof input === "number" ? input : null);

  if (typeof directCode === "number") {
    if (ANCHOR_CUSTOM_ERRORS[directCode]) {
      return {
        code: directCode,
        info: ANCHOR_CUSTOM_ERRORS[directCode],
        isFramework: false,
      };
    }
    if (ANCHOR_FRAMEWORK_ERRORS[directCode]) {
      return {
        code: directCode,
        info: ANCHOR_FRAMEWORK_ERRORS[directCode],
        isFramework: true,
      };
    }
  }

  const text = typeof input === "string" ? input : String(input);

  // 2. Hex or decimal error pattern matching in string/logs
  const match =
    text.match(/"Custom"\s*:\s*(\d+)/i) ||
    text.match(/Custom\s*:\s*(\d+)/i) ||
    text.match(
      /(?:Custom error|code|InstructionError):\s*(0x[0-9a-fA-F]+|\d+)/i
    ) ||
    text.match(/custom program error:\s*(0x[0-9a-fA-F]+|\d+)/i);

  if (match) {
    const val = match[1];
    const decCode = val.startsWith("0x")
      ? parseInt(val, 16)
      : parseInt(val, 10);
    if (ANCHOR_CUSTOM_ERRORS[decCode]) {
      return {
        code: decCode,
        info: ANCHOR_CUSTOM_ERRORS[decCode],
        isFramework: false,
      };
    }
    if (ANCHOR_FRAMEWORK_ERRORS[decCode]) {
      return {
        code: decCode,
        info: ANCHOR_FRAMEWORK_ERRORS[decCode],
        isFramework: true,
      };
    }
  }

  // 3. Name or error string matching
  for (const [codeStr, info] of Object.entries(ANCHOR_CUSTOM_ERRORS)) {
    const code = Number(codeStr);
    const hexCode = `0x${code.toString(16)}`;
    if (
      text.includes(info.name) ||
      text.includes(`Error Number: ${code}`) ||
      text.includes(`custom program error: ${hexCode}`) ||
      text.includes(`Custom error: ${code}`) ||
      text.includes(`Custom error: ${hexCode}`)
    ) {
      return { code, info, isFramework: false };
    }
  }

  for (const [codeStr, info] of Object.entries(ANCHOR_FRAMEWORK_ERRORS)) {
    const code = Number(codeStr);
    const hexCode = `0x${code.toString(16)}`;
    if (
      text.includes(info.name) ||
      text.includes(`Error Number: ${code}`) ||
      text.includes(`custom program error: ${hexCode}`) ||
      text.includes(`Custom error: ${code}`) ||
      text.includes(`Custom error: ${hexCode}`)
    ) {
      return { code, info, isFramework: true };
    }
  }

  return null;
}

/**
 * Helper to recursively extract underlying error messages from `@solana/kit` transactionPlanResult objects.
 */
function extractPlanErrorMessage(err: unknown): string | null {
  if (!err) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const target =
    e?.transactionPlanResult?.error ??
    e?.transactionPlanResult?.results?.[0]?.error;

  if (target) {
    if (typeof target === "string") return target;
    if (typeof target === "object" && target !== null) {
      const obj = target as Record<string, unknown>;
      return typeof obj.message === "string"
        ? obj.message
        : JSON.stringify(target);
    }
  }
  if (e?.cause) {
    return extractPlanErrorMessage(e.cause);
  }
  return null;
}

/**
 * Sanitizes raw error strings to remove developer deprecation warnings,
 * internal object instructions, ANSI color codes, stack traces, and raw RPC endpoint URLs.
 */
export function sanitizeErrorMessage(rawMsg: string): string {
  if (!rawMsg) return "An unexpected error occurred.";

  let clean = String(rawMsg);

  // 1. Remove ANSI escape sequences & raw RPC endpoint URLs / IP addresses
  clean = clean.replace(/\u001b\[[0-9;]*m/g, "");
  clean = clean.replace(/https?:\/\/[^\s]+/gi, "[RPC Endpoint]");

  // 2. Remove SDK deprecation notes & property inspection hints
  clean = clean.replace(
    /Note that the `?cause`? property is deprecated,.*$/i,
    ""
  );
  clean = clean.replace(
    /See the `?transactionPlanResult`? attribute for more details\.?/i,
    ""
  );
  clean = clean.replace(
    /The provided transaction plan failed to execute\.?/i,
    ""
  );

  // 3. Strip RPC simulation wrappers, log prefixes & stack traces
  clean = clean.replace(
    /^(?:\w{3}\s+\d{2}\s+[\d:.]+\s+)?(?:ERROR|Error|[A-Z_]+)?\s*Transaction simulation failed:\s*/i,
    ""
  );
  clean = clean.replace(/^Error processing Instruction \d+:\s*/i, "");
  clean = clean.replace(/\s*at\s+.*:\d+:\d+.*/g, "");

  clean = clean.trim();

  // 4. Fallback if empty after stripping
  if (!clean) {
    return "Transaction execution failed. Please try again.";
  }

  // 5. Truncate long technical blobs (> 160 chars)
  if (clean.length > 160) {
    return `${clean.slice(0, 157)}...`;
  }

  return clean;
}

/**
 * Helper to parse transaction errors from `@solana/kit`, wallet-standard adapters,
 * Anchor, and System program, identifying user cancellations gracefully and formatting
 * error messages according to the Solana error handling skill playbook.
 *
 * @param err - The raw error object caught from a transaction sending process.
 * @returns A structured `ParsedTransactionError` object.
 */
function extractAllErrorText(err: unknown): string {
  if (!err) return "";
  const parts: string[] = [];

  const visit = (obj: unknown, depth = 0) => {
    if (!obj || depth > 6) return;
    if (typeof obj === "string") {
      parts.push(obj);
      return;
    }
    if (typeof obj === "object" && obj !== null) {
      const o = obj as Record<string, unknown>;
      if (typeof o.message === "string") parts.push(o.message);
      if (typeof o.name === "string") parts.push(o.name);
      if (typeof o.code === "string" || typeof o.code === "number") {
        parts.push(String(o.code));
      }
      if (o.cause) visit(o.cause, depth + 1);
      if (o.error) visit(o.error, depth + 1);
      if (o.context) visit(o.context, depth + 1);
      if (o.transactionPlanResult) visit(o.transactionPlanResult, depth + 1);
      if (Array.isArray(o.results)) {
        for (const res of o.results) visit(res, depth + 1);
      }
      if (Array.isArray(o.logs)) {
        for (const log of o.logs) {
          if (typeof log === "string") parts.push(log);
        }
      }
    }
  };

  visit(err);
  try {
    parts.push(String(err));
  } catch {
    // Ignored
  }

  return parts.filter(Boolean).join(" ");
}

function isGenericBoilerplate(msg: string): boolean {
  if (!msg) return true;
  const lower = msg.toLowerCase().trim();
  return (
    lower === "transaction execution failed" ||
    lower === "transaction execution failed." ||
    lower === "the provided transaction plan failed to execute" ||
    lower === "the provided transaction plan failed to execute." ||
    lower === "transaction failed" ||
    lower === "transaction failed." ||
    lower === "an error occurred" ||
    lower === "unknown error"
  );
}

export function parseTransactionError(err: unknown): ParsedTransactionError {
  if (!err) {
    return {
      isCancellation: false,
      layer: "unknown",
      category: "unknown",
      title: "Unexpected Error",
      message: "An unknown error occurred.",
      rawError: err,
    };
  }

  // 1. Check for User Wallet Rejection (Code 4001)
  if (isWalletCancellation(err)) {
    return {
      isCancellation: true,
      layer: "wallet",
      category: "wallet_cancellation",
      title: "Transaction Cancelled",
      message: "You cancelled the transaction request in your wallet.",
      code: 4001,
      rawError: err,
    };
  }

  const logs = extractLogs(err);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorObj = err as any;
  const rawMsg = errorObj.message || errorObj.cause?.message || String(err);
  const innerPlanErr = extractPlanErrorMessage(err);
  const allExtractedText = extractAllErrorText(err);
  const combinedSearchText = [rawMsg, innerPlanErr, allExtractedText, ...logs]
    .filter(Boolean)
    .join(" ");

  // 2. Check for Anchor Custom / Framework Errors in error object, message, inner errors, or logs
  const anchorMatch =
    matchAnchorError(err) || matchAnchorError(combinedSearchText);
  if (anchorMatch) {
    const isFramework = anchorMatch.isFramework;
    return {
      isCancellation: false,
      layer: "anchor",
      category: isFramework ? "anchor_constraint" : "anchor_custom",
      title: isFramework
        ? `Constraint Error: ${anchorMatch.info.name}`
        : `Program Error: ${anchorMatch.info.name}`,
      message: anchorMatch.info.message,
      code: anchorMatch.code,
      actionableStep:
        anchorMatch.info.actionable || "Check input values and try again.",
      logs,
      rawError: err,
    };
  }

  // 3. Scan logs/messages for System Program Insufficient Funds
  for (const log of [rawMsg, ...logs]) {
    if (
      log.includes("custom program error: 0x1") ||
      log.includes("Insufficient funds") ||
      log.includes("insufficient lamports") ||
      log.includes("insufficient funds for fee")
    ) {
      return {
        isCancellation: false,
        layer: "system",
        category: "insufficient_sol",
        title: "Insufficient SOL",
        message:
          "Your wallet balance is too low to cover network gas fees or account rent.",
        code: "0x1",
        actionableStep: "Add SOL to your wallet to pay for transaction fees.",
        logs,
        rawError: err,
      };
    }
  }

  // 4. RPC Rate Limit (429) & Network Disconnections
  if (
    rawMsg.includes("429") ||
    rawMsg.toLowerCase().includes("too many requests")
  ) {
    return {
      isCancellation: false,
      layer: "rpc",
      category: "network_rpc",
      title: "Network Busy",
      message:
        "Solana RPC rate limit reached. Please wait a moment before retrying.",
      code: "429",
      actionableStep: "Wait a few seconds and click retry.",
      logs,
      rawError: err,
    };
  }

  if (
    rawMsg.toLowerCase().includes("failed to fetch") ||
    rawMsg.toLowerCase().includes("networkerror") ||
    rawMsg.toLowerCase().includes("fetch failed")
  ) {
    return {
      isCancellation: false,
      layer: "rpc",
      category: "network_rpc",
      title: "Connection Error",
      message: "Unable to reach the Solana network cluster.",
      code: "FETCH_FAILED",
      actionableStep: "Check your internet connection or try again shortly.",
      logs,
      rawError: err,
    };
  }

  // 5. Strict Check for Blockhash / Blockheight Expiration
  const isExpiredBlockhash =
    /blockhash (not found|expired|invalid)|blockheightexceeded|block height exceeded|transaction expired|was not confirmed|timed out/i.test(
      combinedSearchText.toLowerCase()
    );

  if (isExpiredBlockhash) {
    return {
      isCancellation: false,
      layer: "rpc",
      category: "blockhash_expired",
      title: "Transaction Expired",
      message:
        "Approval took too long or the network was busy, causing the transaction blockhash to expire.",
      code: "EXPIRED_BLOCKHASH",
      actionableStep:
        "Please try again and approve the prompt in your wallet promptly.",
      logs,
      rawError: err,
    };
  }

  // 6. Fallback for general errors (using sanitizeErrorMessage)
  let displayMsg = innerPlanErr || rawMsg;
  if (isGenericBoilerplate(displayMsg)) {
    if (
      errorObj?.cause?.message &&
      !isGenericBoilerplate(String(errorObj.cause.message))
    ) {
      displayMsg = String(errorObj.cause.message);
    }
  }
  const sanitized = sanitizeErrorMessage(displayMsg);
  return {
    isCancellation: false,
    layer: "unknown",
    category: "unknown",
    title: "Transaction Failed",
    message: sanitized,
    logs,
    rawError: err,
  };
}

/**
 * Builds a block explorer link for a transaction signature.
 */
export function getExplorerUrl(
  signature: string,
  cluster: "devnet" | "mainnet-beta" | "testnet" | "localnet" = "devnet",
  provider: "solscan" | "solana-explorer" = "solscan"
): string {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  if (provider === "solscan") {
    return `https://solscan.io/tx/${signature}${clusterParam}`;
  }
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
}

/**
 * Builds a block explorer link for an account / wallet address.
 */
export function getAccountExplorerUrl(
  address: string,
  cluster: "devnet" | "mainnet-beta" | "testnet" | "localnet" = "devnet",
  provider: "solscan" | "solana-explorer" = "solscan"
): string {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  if (provider === "solscan") {
    return `https://solscan.io/account/${address}${clusterParam}`;
  }
  return `https://explorer.solana.com/address/${address}${clusterParam}`;
}

/**
 * Helper to truncate an 88-character Solana signature for display.
 */
export function truncateSignature(signature: string): string {
  if (!signature) return "";
  if (signature.length <= 12) return signature;
  return `${signature.slice(0, 4)}...${signature.slice(-4)}`;
}

/**
 * Helper to truncate a base58 Solana public key address for display.
 */
export function truncateAddress(address: string): string {
  if (!address) return "";
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
