import {
  ANCHOR_ERROR__POOL_NOT_ACTIVE,
  ANCHOR_ERROR__INVALID_POOL_STATUS,
  ANCHOR_ERROR__CYCLE_NOT_ENDED,
  ANCHOR_ERROR__INVALID_BOND_QUANTITY,
  ANCHOR_ERROR__REGISTRY_FULL,
  ANCHOR_ERROR__REGISTRY_TOO_SMALL,
  ANCHOR_ERROR__REGISTRY_AT_MAX_SIZE,
  ANCHOR_ERROR__AWAITING_RANDOMNESS_FREEZE,
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
  ANCHOR_ERROR__WINNER_MISMATCH,
  ANCHOR_ERROR__UNSUPPORTED_ACCOUNT_VERSION,
  ANCHOR_ERROR__SAME_RANDOMNESS_ACCOUNT,
  ANCHOR_ERROR__TOO_MANY_WINNERS,
  ANCHOR_ERROR__INVALID_HUMA_POOL_DATA,
  ANCHOR_ERROR__INVALID_REGISTRY_STATE,
  ANCHOR_ERROR__TRANSFER_FEE_NOT_SUPPORTED,
  ANCHOR_ERROR__TRANSFER_HOOK_NOT_SUPPORTED,
  ANCHOR_ERROR__INVALID_TOKEN_MINT,
  ANCHOR_ERROR__NO_PENDING_ADMIN,
  ANCHOR_ERROR__NOT_PENDING_ADMIN,
  ANCHOR_ERROR__INVALID_ADMIN_ADDRESS,
  ANCHOR_ERROR__CANNOT_NOMINATE_SELF,
  ANCHOR_ERROR__INVALID_HUMA_POOL_STATE,
} from "./generated/yield-bonds/src/generated";

export type ErrorLayer =
  | "wallet"
  | "anchor"
  | "squads"
  | "spl"
  | "system"
  | "rpc"
  | "unknown";

export type ErrorCategory =
  | "wallet_cancellation"
  | "insufficient_sol"
  | "insufficient_tokens"
  | "anchor_custom"
  | "anchor_constraint"
  | "squads_multisig"
  | "blockhash_expired"
  | "duplicate_transaction"
  | "network_rpc"
  | "unknown";

export interface ErrorThemeConfig {
  icon: string;
  borderColor: string;
  bgBadgeColor: string;
  titleColor: string;
  accentBorder: string;
  ringBorder: string;
}

export function getErrorCategoryTheme(
  category: ErrorCategory = "unknown"
): ErrorThemeConfig {
  switch (category) {
    case "squads_multisig":
      return {
        icon: "🏛️",
        borderColor: "border-purple-500/30",
        bgBadgeColor: "bg-purple-500/10",
        titleColor: "text-purple-300",
        accentBorder: "border-l-purple-400",
        ringBorder: "border-purple-500/30",
      };
    case "blockhash_expired":
      return {
        icon: "⏱️",
        borderColor: "border-sky-500/30",
        bgBadgeColor: "bg-sky-500/10",
        titleColor: "text-sky-300",
        accentBorder: "border-l-sky-400",
        ringBorder: "border-sky-500/30",
      };
    case "insufficient_sol":
    case "insufficient_tokens":
      return {
        icon: "⛽",
        borderColor: "border-amber-500/30",
        bgBadgeColor: "bg-amber-500/10",
        titleColor: "text-amber-300",
        accentBorder: "border-l-amber-400",
        ringBorder: "border-amber-500/30",
      };
    case "network_rpc":
      return {
        icon: "📡",
        borderColor: "border-amber-500/30",
        bgBadgeColor: "bg-amber-500/10",
        titleColor: "text-amber-300",
        accentBorder: "border-l-amber-400",
        ringBorder: "border-amber-500/30",
      };
    case "duplicate_transaction":
      return {
        icon: "ℹ️",
        borderColor: "border-sky-500/30",
        bgBadgeColor: "bg-sky-500/10",
        titleColor: "text-sky-300",
        accentBorder: "border-l-sky-400",
        ringBorder: "border-sky-500/30",
      };
    case "wallet_cancellation":
      return {
        icon: "✕",
        borderColor: "border-surface-bright/50",
        bgBadgeColor: "bg-surface-variant/20",
        titleColor: "text-on-surface",
        accentBorder: "border-l-surface-variant",
        ringBorder: "border-surface-variant/30",
      };
    default:
      return {
        icon: "⚠️",
        borderColor: "border-error/30",
        bgBadgeColor: "bg-error/10",
        titleColor: "text-red-400",
        accentBorder: "border-l-error",
        ringBorder: "border-error/30",
      };
  }
}

/**
 * Structured output of a parsed transaction error.
 */
export interface ParsedTransactionError {
  /** True if the user intentionally rejected or cancelled the transaction. */
  isCancellation: boolean;
  /** High-level layer where error originated. */
  layer: ErrorLayer;
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
      "Transactions, prize claims, and withdrawals are momentarily paused during draw snapshotting.",
    actionable:
      "Please try your request again in a few moments after the draw snapshot resolves.",
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
    message:
      "Yield venue valuation is insufficient to cover total protocol liabilities (deposited principal, unwithdrawn fees, and prize allocations).",
    actionable:
      "Deposits, withdrawals, and fee claims are temporarily protected until venue solvency reaches parity.",
  },
  [ANCHOR_ERROR__UNAUTHORIZED]: {
    name: "Unauthorized",
    message: "Caller is not authorized for this operation.",
  },
  [ANCHOR_ERROR__WINNER_MISMATCH]: {
    name: "WinnerMismatch",
    message: "Winner account does not match the payout registry entry.",
    actionable:
      "Ensure you are targeting the correct winner address when executing payout or reinvestment cranks.",
  },
  [ANCHOR_ERROR__UNSUPPORTED_ACCOUNT_VERSION]: {
    name: "UnsupportedAccountVersion",
    message: "Account schema version is invalid or unsupported.",
    actionable:
      "Please refresh your client or upgrade your dApp interface to match the current smart contract schema.",
  },
  [ANCHOR_ERROR__SAME_RANDOMNESS_ACCOUNT]: {
    name: "SameRandomnessAccount",
    message: "Cannot rebind to the same randomness account.",
    actionable:
      "Provide a different Switchboard randomness account that was freshly initialized.",
  },
  [ANCHOR_ERROR__TOO_MANY_WINNERS]: {
    name: "TooManyWinners",
    message: "Configured winner count exceeds payout registry capacity.",
    actionable:
      "Adjust prize tiers so the total number of winners does not exceed 50.",
  },
  [ANCHOR_ERROR__INVALID_HUMA_POOL_DATA]: {
    name: "InvalidHumaPoolData",
    message: "Huma pool account data is truncated or malformed.",
    actionable:
      "Verify the Huma Protocol liquidity pool state and configuration accounts.",
  },
  [ANCHOR_ERROR__INVALID_REGISTRY_STATE]: {
    name: "InvalidRegistryState",
    message: "Ticket registry buffer layout or alignment is invalid.",
    actionable:
      "Ensure ticket registry account data has sufficient byte capacity and valid memory layout.",
  },
  [ANCHOR_ERROR__TRANSFER_FEE_NOT_SUPPORTED]: {
    name: "TransferFeeNotSupported",
    message:
      "Token mint contains unsupported Token-2022 transfer fee extension.",
    actionable:
      "Select or initialize a token mint without transfer fee extensions.",
  },
  [ANCHOR_ERROR__TRANSFER_HOOK_NOT_SUPPORTED]: {
    name: "TransferHookNotSupported",
    message:
      "Token mint contains unsupported Token-2022 transfer hook extension.",
    actionable:
      "Select or initialize a token mint without transfer hook extensions.",
  },
  [ANCHOR_ERROR__INVALID_TOKEN_MINT]: {
    name: "InvalidTokenMint",
    message:
      "Token mint account data is malformed or configures unauthorized permanent delegate/close extensions.",
    actionable:
      "Ensure the token mint does not configure permanent delegate or close authority extensions.",
  },
  [ANCHOR_ERROR__NO_PENDING_ADMIN]: {
    name: "NoPendingAdmin",
    message: "No pending administrator nomination is currently active.",
    actionable:
      "Nominate a pending admin using nominate-admin before attempting acceptance.",
  },
  [ANCHOR_ERROR__NOT_PENDING_ADMIN]: {
    name: "NotPendingAdmin",
    message: "Caller is not the nominated pending administrator.",
    actionable:
      "Sign the accept-admin transaction with the designated pending admin keypair.",
  },
  [ANCHOR_ERROR__INVALID_ADMIN_ADDRESS]: {
    name: "InvalidAdminAddress",
    message: "Administrator address cannot be the default zero address.",
    actionable: "Provide a valid, non-default Solana public key address.",
  },
  [ANCHOR_ERROR__CANNOT_NOMINATE_SELF]: {
    name: "CannotNominateSelf",
    message:
      "Current administrator cannot nominate themselves as pending admin.",
    actionable:
      "Nominate a distinct administrator public key to initiate role transfer.",
  },
  [ANCHOR_ERROR__INVALID_HUMA_POOL_STATE]: {
    name: "InvalidHumaPoolState",
    message:
      "Provided Huma pool state account is invalid, uninitialized, or does not match the pool configuration.",
    actionable:
      "Ensure the Huma pool state account exists, is owned by the Huma program, and matches the pool configuration.",
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

  // Require Errors (2500-2506)
  2500: {
    name: "RequireViolated",
    message: "Require constraint check failed.",
  },
  2501: {
    name: "RequireEqViolated",
    message: "Require eq constraint check failed.",
  },
  2502: {
    name: "RequireKeysEqViolated",
    message: "Require keys eq constraint check failed.",
  },
  2503: {
    name: "RequireNeqViolated",
    message: "Require neq constraint check failed.",
  },
  2504: {
    name: "RequireKeysNeqViolated",
    message: "Require keys neq constraint check failed.",
  },
  2505: {
    name: "RequireGtViolated",
    message: "Require gt constraint check failed.",
  },
  2506: {
    name: "RequireGteViolated",
    message: "Require gte constraint check failed.",
  },

  // Account Errors (3000-3017)
  3000: {
    name: "AccountDiscriminatorAlreadySet",
    message: "Account discriminator already set.",
  },
  3001: {
    name: "AccountDiscriminatorNotFound",
    message: "Account discriminator not found.",
  },
  3002: {
    name: "AccountDiscriminatorMismatch",
    message: "Account discriminator mismatch.",
  },
  3003: {
    name: "AccountDidNotDeserialize",
    message: "Account deserialization failed.",
  },
  3004: {
    name: "AccountDidNotSerialize",
    message: "Account serialization failed.",
  },
  3005: {
    name: "AccountNotEnoughKeys",
    message: "Not enough account keys provided for instruction.",
    actionable:
      "Ensure all required instruction accounts (including event_authority and program ID) are provided.",
  },
  3006: {
    name: "AccountNotMutable",
    message: "Account is required to be mutable.",
  },
  3007: {
    name: "AccountOwnedByWrongProgram",
    message: "Account owned by wrong program.",
  },
  3008: {
    name: "InvalidProgramId",
    message: "Invalid program ID provided.",
  },
  3009: {
    name: "InvalidProgramExecutable",
    message: "Invalid program executable provided.",
  },
  3010: {
    name: "AccountNotSigner",
    message: "Account is required to sign transaction.",
  },
  3011: {
    name: "AccountNotSystemOwned",
    message: "Account is not system owned.",
  },
  3012: {
    name: "AccountNotInitialized",
    message: "Required program account is not initialized.",
    actionable:
      "Ensure the account has been initialized before invoking this instruction.",
  },
  3013: {
    name: "AccountNotProgramData",
    message: "Account is not a program data account.",
  },
  3014: {
    name: "AccountNotAssociatedTokenAccount",
    message: "Account is not an associated token account.",
  },
  3015: {
    name: "AccountSysvarMismatch",
    message: "Account sysvar mismatch.",
  },
  3016: {
    name: "AccountReallocExceedsLimit",
    message: "Account realloc exceeds 10KB limit per instruction.",
  },
  3017: {
    name: "AccountDuplicateReallocs",
    message: "Account duplicate reallocs detected.",
  },
};

/**
 * SPL Token Program & Token-2022 Error Codes Map (0x0 - 0x1e)
 */
export const SPL_TOKEN_ERRORS: Record<
  number,
  { name: string; message: string; actionable?: string }
> = {
  0: {
    name: "AlreadyInUse",
    message: "Token account is already initialized or in use.",
  },
  1: {
    name: "InvalidState",
    message: "Token account or mint is in an invalid state.",
  },
  2: {
    name: "UninitializedState",
    message: "Token account is not initialized.",
  },
  3: {
    name: "InsufficientFunds",
    message: "Insufficient token balance to complete this transfer.",
    actionable: "Deposit additional tokens or lower the transaction amount.",
  },
  4: {
    name: "MintMismatch",
    message: "Provided token mint does not match the token account.",
    actionable: "Ensure your wallet is using the correct token mint.",
  },
  5: {
    name: "UninitializedMint",
    message: "Token mint account is not initialized.",
  },
  23: {
    name: "Overflow",
    message: "Token calculation overflow occurred.",
  },
};

export interface ErrorTraversalResult {
  messages: string[];
  logs: string[];
  codes: (number | string)[];
  planErrorMessage: string | null;
}

/**
 * Traverses an error graph recursively with cycle protection and bounded depth
 * to extract messages, simulation logs, error codes, and plan errors.
 */
export function traverseErrorGraph(
  root: unknown,
  maxDepth = 6,
  seen = new Set<object>()
): ErrorTraversalResult {
  const result: ErrorTraversalResult = {
    messages: [],
    logs: [],
    codes: [],
    planErrorMessage: null,
  };

  const visit = (node: unknown, depth: number) => {
    if (!node || depth > maxDepth) return;
    if (typeof node === "string") {
      result.messages.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);

    const o = node as Record<string, unknown>;
    if (typeof o.message === "string") result.messages.push(o.message);
    if (typeof o.name === "string") result.messages.push(o.name);
    if (typeof o.code === "number" || typeof o.code === "string") {
      result.codes.push(o.code);
    }
    if (o.Custom !== undefined) {
      result.codes.push(o.Custom as number | string);
    }
    if (o.custom !== undefined) {
      result.codes.push(o.custom as number | string);
    }
    if (o.InstructionError !== undefined) {
      visit(o.InstructionError, depth + 1);
    }
    if (Array.isArray(o.logs)) {
      for (const l of o.logs) {
        if (typeof l === "string") result.logs.push(l);
      }
    }
    if (o.context && typeof o.context === "object") {
      const ctx = o.context as Record<string, unknown>;
      if (Array.isArray(ctx.logs)) {
        for (const l of ctx.logs) {
          if (typeof l === "string") result.logs.push(l);
        }
      }
      if (ctx.code !== undefined) {
        result.codes.push(ctx.code as number | string);
      }
      if (ctx.__code !== undefined) {
        result.codes.push(ctx.__code as number | string);
      }
    }
    if (o.data && typeof o.data === "object") {
      const data = o.data as Record<string, unknown>;
      if (Array.isArray(data.logs)) {
        for (const l of data.logs) {
          if (typeof l === "string") result.logs.push(l);
        }
      }
      if (typeof data.err === "string") {
        result.messages.push(data.err);
      }
      if (data.err && typeof data.err === "object") {
        visit(data.err, depth + 1);
      }
    }
    if (o.simulationResponse && typeof o.simulationResponse === "object") {
      const sim = o.simulationResponse as Record<string, unknown>;
      if (Array.isArray(sim.logs)) {
        for (const l of sim.logs) {
          if (typeof l === "string") result.logs.push(l);
        }
      }
    }
    if (o.transactionPlanResult && !result.planErrorMessage) {
      const plan = o.transactionPlanResult as Record<string, unknown>;
      const results = plan.results as
        | Array<Record<string, unknown>>
        | undefined;
      const err = plan.error ?? results?.[0]?.error;
      if (typeof err === "string") {
        result.planErrorMessage = err;
      } else if (err && typeof err === "object") {
        const errRecord = err as Record<string, unknown>;
        result.planErrorMessage =
          typeof errRecord.message === "string"
            ? errRecord.message
            : JSON.stringify(err);
      }
    }

    if (o.cause) visit(o.cause, depth + 1);
    if (o.error) visit(o.error, depth + 1);
    if (o.context) visit(o.context, depth + 1);
    if (o.transactionPlanResult) visit(o.transactionPlanResult, depth + 1);
    if (Array.isArray(o.results)) {
      for (const r of o.results) visit(r, depth + 1);
    }
  };

  visit(root, 0);
  return result;
}

/**
 * Helper to test whether an error is a user wallet rejection (code 4001 or cancellation text).
 */
export function isWalletCancellation(err: unknown): boolean {
  if (!err) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;

  if (
    e?.code === 4001 ||
    e?.cause?.code === 4001 ||
    e?.error?.code === 4001 ||
    e?.name === "UserRejectedRequestError"
  ) {
    return true;
  }

  const traversal = traverseErrorGraph(err);
  if (traversal.codes.includes(4001) || traversal.codes.includes("4001")) {
    return true;
  }

  const msgParts = [
    typeof e?.message === "string" ? e.message : "",
    typeof e?.cause?.message === "string" ? e.cause.message : "",
    typeof e?.cause === "string" ? e.cause : "",
    ...traversal.messages,
    String(err),
  ];

  const fullText = msgParts.join(" ");
  const isCancelPattern =
    /user (rejected|cancell?ed|declined|denied)|transaction (cancell?ed|rejected)|cancell?ed by user|rejected the request/i;

  return isCancelPattern.test(fullText);
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

  // 1. Direct object inspection (e.g. err.context?.code, err.cause?.context?.code, err.code, err.Custom)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errObj = input as any;
  const directCode =
    errObj?.context?.code ??
    errObj?.cause?.context?.code ??
    errObj?.code ??
    errObj?.Custom ??
    errObj?.custom ??
    errObj?.InstructionError?.[1]?.Custom ??
    errObj?.InstructionError?.[1]?.custom ??
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

  let text = "";
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = JSON.stringify(input) + " " + String(input);
    } catch {
      text = String(input);
    }
  }

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

// ─── Squads V4 Multisig Program Errors ───────────────────────────────────────

export const SQUADS_PROGRAM_ADDRESS =
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";

export const SQUADS_CUSTOM_ERRORS: Record<
  number,
  { name: string; message: string; actionable?: string }
> = {
  6000: {
    name: "Unauthorized",
    message: "Signer is not an authorized member of this multisig.",
    actionable:
      "Ensure your connected keypair matches an active multisig member.",
  },
  6001: {
    name: "InvalidThreshold",
    message: "Multisig threshold cannot exceed active member count.",
    actionable: "Verify multisig configuration.",
  },
  6002: {
    name: "NotEnoughSigners",
    message: "Transaction does not have enough signatures to execute.",
    actionable: "Collect required member approvals before execution.",
  },
  6003: {
    name: "InvalidTransactionMessage",
    message: "The compiled vault transaction message failed deserialization.",
    actionable:
      "Check the instruction format and account encoding inside the vault transaction.",
  },
  6004: {
    name: "StaleTransactionIndex",
    message:
      "Transaction index is stale due to a multisig configuration change.",
    actionable: "Re-create the proposal with the updated transaction index.",
  },
  6005: {
    name: "InvalidAccount",
    message: "An invalid account was passed to the Squads instruction.",
  },
  6006: {
    name: "StaleProposal",
    message: "Proposal has expired or references a stale transaction index.",
    actionable:
      "Re-create the proposal with the latest multisig transaction index.",
  },
  6007: {
    name: "ProposalAlreadyExecuted",
    message: "This proposal has already been executed on-chain.",
  },
  6008: {
    name: "ProposalNotApproved",
    message: "Proposal has not reached the required approval threshold.",
    actionable:
      "Collect required member approvals before attempting execution.",
  },
  6009: {
    name: "TimeLockExceeded",
    message: "Multisig timelock has not elapsed yet.",
    actionable: "Wait for the timelock duration to elapse before executing.",
  },
  6010: {
    name: "MissingAccount",
    message: "A required account is missing from remaining_accounts.",
    actionable:
      "Ensure all accounts in the vault transaction message are passed in remaining_accounts.",
  },
  6011: {
    name: "ProtectedAccount",
    message: "Attempted to modify a protected system or multisig account.",
  },
};

/**
 * Matches Squads V4 Multisig Program errors from error objects or logs.
 */
export function matchSquadsError(
  rawLogs: string[] | string | number | unknown
): {
  code: number;
  info: { name: string; message: string; actionable?: string };
} | null {
  if (rawLogs === undefined || rawLogs === null) return null;
  if (typeof rawLogs === "number") {
    if (SQUADS_CUSTOM_ERRORS[rawLogs]) {
      return { code: rawLogs, info: SQUADS_CUSTOM_ERRORS[rawLogs] };
    }
    return null;
  }
  const text = Array.isArray(rawLogs)
    ? rawLogs.join("\n")
    : typeof rawLogs === "string"
      ? rawLogs
      : String(rawLogs);

  // 1. Explicit regex match for Squads program frame
  const squadsFailedMatch = text.match(
    new RegExp(
      `Program ${SQUADS_PROGRAM_ADDRESS} failed: custom program error: (0x[0-9a-fA-F]+|\\d+)`
    )
  );
  if (squadsFailedMatch) {
    const val = squadsFailedMatch[1];
    const decCode = val.startsWith("0x")
      ? parseInt(val, 16)
      : parseInt(val, 10);
    if (SQUADS_CUSTOM_ERRORS[decCode]) {
      return { code: decCode, info: SQUADS_CUSTOM_ERRORS[decCode] };
    }
  }

  // 2. Scan named errors if Squads is in log frames
  if (text.includes(SQUADS_PROGRAM_ADDRESS)) {
    for (const [codeStr, info] of Object.entries(SQUADS_CUSTOM_ERRORS)) {
      const code = Number(codeStr);
      const hexCode = `0x${code.toString(16)}`;
      if (
        text.includes(info.name) ||
        text.includes(`custom program error: ${hexCode}`) ||
        text.includes(`Custom error: ${code}`) ||
        text.includes(`Custom error: ${hexCode}`)
      ) {
        return { code, info };
      }
    }
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

export function isParsedTransactionError(
  err: unknown
): err is ParsedTransactionError {
  if (!err || typeof err !== "object") return false;
  const candidate = err as Record<string, unknown>;
  return (
    typeof candidate.isCancellation === "boolean" &&
    typeof candidate.layer === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.message === "string"
  );
}

/**
 * Custom Error subclass wrapping structured transaction error details.
 * Preserves Error prototype, stack traces, and cause chaining.
 */
export class TransactionError extends Error {
  public readonly parsed: ParsedTransactionError;
  public readonly rawError?: unknown;

  constructor(parsed: ParsedTransactionError, rawError?: unknown) {
    super(parsed.message || parsed.title || "Transaction execution failed.", {
      cause: rawError,
    });
    this.name = "TransactionError";
    this.parsed = parsed;
    this.rawError = rawError;
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}

export function parseTransactionError(
  err: unknown,
  explicitLogs?: string[],
  fallbackMessage?: string
): ParsedTransactionError {
  if (err instanceof TransactionError && !explicitLogs?.length) {
    return err.parsed;
  }
  if (isParsedTransactionError(err) && !explicitLogs?.length) {
    return err;
  }
  if (!err && !explicitLogs?.length) {
    return {
      isCancellation: false,
      layer: "unknown",
      category: "unknown",
      title: "Unexpected Error",
      message: fallbackMessage || "An unknown error occurred.",
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

  const traversal = traverseErrorGraph(err);
  const logs = [...traversal.logs, ...(explicitLogs || [])];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorObj = (err || {}) as any;
  const rawMsg =
    errorObj.message || errorObj.cause?.message || (err ? String(err) : "");
  const innerPlanErr = traversal.planErrorMessage;
  const combinedSearchText = [
    rawMsg,
    innerPlanErr,
    ...traversal.messages,
    ...logs,
  ]
    .filter(Boolean)
    .join(" ");

  // 2. Check for Squads V4 and Anchor Custom / Framework Errors
  const squadsMatch =
    matchSquadsError(err) || matchSquadsError(combinedSearchText);
  let anchorMatch =
    matchAnchorError(err) || matchAnchorError(combinedSearchText);
  if (!anchorMatch) {
    for (const code of traversal.codes) {
      const matched = matchAnchorError(code);
      if (matched) {
        anchorMatch = matched;
        break;
      }
    }
  }

  // If Squads error is matched without an inner Anchor failure, prioritize Squads
  if (squadsMatch) {
    const isInnerAnchorFailure = anchorMatch !== null;

    if (!isInnerAnchorFailure) {
      return {
        isCancellation: false,
        layer: "squads",
        category: "squads_multisig",
        title: `Multisig Error: ${squadsMatch.info.name}`,
        message: squadsMatch.info.message,
        code: squadsMatch.code,
        actionableStep:
          squadsMatch.info.actionable ||
          "Verify multisig proposal, approvals, and member status.",
        logs,
        rawError: err,
      };
    }
  }

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

  // 3b. Check for SPL Token Program Errors (0x0 - 0x1e)
  for (const [codeStr, info] of Object.entries(SPL_TOKEN_ERRORS)) {
    const code = Number(codeStr);
    const hexCode = `0x${code.toString(16)}`;
    if (
      combinedSearchText.includes(
        `Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: ${hexCode}`
      ) ||
      combinedSearchText.includes(
        `Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: ${hexCode}`
      ) ||
      (combinedSearchText.includes(`custom program error: ${hexCode}`) &&
        (combinedSearchText.includes("Token") ||
          combinedSearchText.includes("transfer"))) ||
      combinedSearchText.includes(
        `InstructionError: [1, {"Custom":${code}}]`
      ) ||
      combinedSearchText.includes(
        `InstructionError: [0, {"Custom":${code}}]`
      ) ||
      (code === 3 &&
        (combinedSearchText
          .toLowerCase()
          .includes("insufficient token balance") ||
          combinedSearchText
            .toLowerCase()
            .includes("insufficient funds for transfer")))
    ) {
      return {
        isCancellation: false,
        layer: "spl",
        category: code === 3 ? "insufficient_tokens" : "anchor_custom",
        title: `Token Error: ${info.name}`,
        message: info.message,
        code,
        actionableStep:
          info.actionable || "Check token balance and account state.",
        logs,
        rawError: err,
      };
    }
  }

  // 4. RPC Rate Limit (429) & Network Disconnections
  if (
    rawMsg.includes("429") ||
    rawMsg.toLowerCase().includes("too many requests") ||
    traversal.codes.includes(429) ||
    traversal.codes.includes("429")
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
    rawMsg.toLowerCase().includes("fetch failed") ||
    combinedSearchText.toLowerCase().includes("fetch failed")
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

  // 4b. Compute Unit (CU) Budget Exhaustion
  const isCuExhausted =
    /exceeded maximum number of instructions allowed|program failed to complete: exceeded compute units|computebudgetexceeded|consumed \d+ of \d+ compute units/i.test(
      combinedSearchText
    );
  if (isCuExhausted) {
    return {
      isCancellation: false,
      layer: "rpc",
      category: "network_rpc",
      title: "Compute Budget Exceeded",
      message:
        "Transaction execution ran out of compute units before completing.",
      code: "COMPUTE_BUDGET_EXCEEDED",
      actionableStep:
        "Retry the transaction with higher priority fees or a larger compute budget.",
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
      title: "Request Timed Out",
      message:
        "Wallet approval took longer than expected and the transaction expired, or the network was busy.",
      code: "EXPIRED_BLOCKHASH",
      actionableStep:
        "Click retry to send a fresh transaction and approve the prompt in your wallet.",
      logs,
      rawError: err,
    };
  }

  // 6. Duplicate Transaction / Solana RPC -32002
  const isDuplicateTx =
    errorObj?.data?.err === "AlreadyProcessed" ||
    errorObj?.cause?.data?.err === "AlreadyProcessed" ||
    /already been processed|alreadyprocessed|this transaction has already been processed|cannot destructure property 'err' of 'data'/i.test(
      combinedSearchText
    );

  if (isDuplicateTx) {
    return {
      isCancellation: false,
      layer: "rpc",
      category: "duplicate_transaction",
      title: "Transaction Already Processed",
      message:
        "This transaction was already submitted and processed by the network.",
      code: -32002,
      actionableStep:
        "If retrying, create a fresh transaction with a new blockhash.",
      logs,
      rawError: err,
    };
  }

  // 7. Wallet Internal / Simulation Preflight (-32603) Fallback
  const isWalletRpcSimulationError =
    traversal.codes.includes(-32603) ||
    traversal.codes.includes("-32603") ||
    /unexpected error/i.test(rawMsg);

  if (isWalletRpcSimulationError) {
    const isWalletLayer =
      errorObj?.name === "WalletSendTransactionError" ||
      /unexpected error/i.test(rawMsg) ||
      /wallet/i.test(errorObj?.name || "");
    return {
      isCancellation: false,
      layer: isWalletLayer ? "wallet" : "rpc",
      category: "network_rpc",
      title: "Wallet Simulation or Network Error",
      message:
        "The wallet encountered an internal error while simulating or signing the transaction.",
      code: -32603,
      actionableStep:
        "Check that your wallet is unlocked, connected to the correct network (e.g. Localnet / Devnet), and has sufficient funds to simulate the transaction.",
      logs,
      rawError: err,
    };
  }

  // 8. Solana RPC -32002 Simulation Failure Fallback (when not duplicate and no Anchor match)
  const isRpcSimulationFailed =
    traversal.codes.includes(-32002) ||
    traversal.codes.includes("-32002") ||
    /transaction simulation failed/i.test(combinedSearchText);

  if (isRpcSimulationFailed) {
    return {
      isCancellation: false,
      layer: "rpc",
      category: "network_rpc",
      title: "Transaction Simulation Failed",
      message:
        sanitizeErrorMessage(innerPlanErr || rawMsg) ||
        "The transaction failed during network simulation.",
      code: -32002,
      actionableStep:
        "Check account balances, verify input parameters, and try again.",
      logs,
      rawError: err,
    };
  }

  // 9. Fallback for general errors (using sanitizeErrorMessage)
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
