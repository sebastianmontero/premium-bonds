# Implementation Plan: Eliminate Dummy Fallback Addresses in Huma Integration

## Goal Description

Optional and environment-derived Huma account addresses (such as `HUMA_CONFIG`, `HUMA_POOL_STATE`, `HUMA_LENDER_STATE`, etc.) in [`app/lib/bonds-sdk.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-sdk.ts) currently fall back to dummy public keys (historically `"11111111111111111111111111111111"` or `"DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK"`).

This anti-pattern produces several critical system failures:

1. **Sentinel Value Smells**: Re-inventing `null` by checking `isConfiguredAccountAddress(addr)` (i.e. `addr !== "11111111111111111111111111111111"`).
2. **Account Address Collisions & Anchor 2040 Reverts**: When multiple distinct accounts fall back to the same placeholder key (e.g. `TEST_ADDRESSES.USER_2` / `DYw8j...`) or when `poolPstVault` is accidentally reused as `humaPoolModeToken`, accounts collide inside Codama instruction builders. Searches by address match the wrong account (e.g. finding readonly `humaConfig` instead of mutable `humaLenderState`, causing `role: AccountRole.READONLY` instead of `AccountRole.WRITABLE` or triggering Anchor error 2040 `ConstraintDuplicateMutableAccount`).
3. **Phantom RPC Calls**: Background workers and sentinels make outbound RPC requests querying account info for dummy addresses, failing with `ECONNREFUSED` or 404 errors.
4. **Silent Transaction Failures**: Transactions compile and build cleanly with dummy keys, only to fail during simulation or execution on Solana with cryptic errors like `ConstraintSeeds`, `IllegalOwner`, or `AccountNotFound`.
5. **Source of Truth Inversion & Cross-Pool Contamination**: Ambient environment variables previously took precedence over the on-chain `PrizePool.humaPoolState` account, risking cross-pool contamination or immediate reverts in multi-pool deployments.
6. **Inconsistent Interfaces & Duplication**: Competing interfaces (`HumaPoolAddresses`, `HumaStateAddresses`, `ResolvedHumaAddresses`, and untyped `Record<string, string | undefined>` bags) scattered across SDK, CLI scripts, and crank workers.

This plan replaces dummy fallback addresses with:

- Strict `Address | undefined` typing using [`parseOptionalAddress`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-sdk.ts#L140) with lazy evaluation and strict client-side environment isolation (preventing SSR/hydration crashes at module evaluation time).
- On-chain authoritative precedence: `overrides?.poolState ?? (onChainProvided ? parsedOnChain : parsedOnChain ?? env)`, preventing uninitialized on-chain pools (`1111...1111`) from silently falling back to incorrect `.env` accounts.
- Value-returning, strongly-typed functional narrowing via `requireHumaAddresses<K>` with compile-time non-null guarantees (`RequiredHumaAddresses<K>`) and atomic resolution helper `resolveAndRequireHumaAddresses<K>`.
- Typed error modeling with `HumaConfigurationError` (`code: "CONFIG_MISSING_HUMA_ADDRESSES"`), replacing fragile string scraping in error parsing.
- Clear semantic disambiguation between Huma's pool escrow (`humaPoolModeToken`) and YieldBonds' lender account (`humaLenderModeToken`, which defaults to `poolPstVault`).
- Automatic ATA derivations for **both** `poolUnderlyingToken` and `poolModeToken` (ATAs of `humaPoolAuthority` for `tokenMint` and `modeMint` respectively), eliminating brittle manual parameter requirements.
- Automatic ATA derivation for `userTokenAccount` in `buildBuyBondsInstruction`, eliminating dynamic imports in `app/hooks/useBondsContract.ts`.
- Complete deletion of `isConfiguredAccountAddress`, fully trusting the `parseOptionalAddress` anti-corruption boundary.
- Complete consolidation onto a single canonical `HumaPoolAddresses` interface, eliminating `HumaStateAddresses` and `ResolvedHumaAddresses`.
- Refactoring `buildInitializeHumaLenderInstruction` and `buildWithdrawFeesInstruction` and their caller scripts (`scripts/devnet.ts`, `scripts/pb-cli.ts`).
- First-class error classification in [`app/lib/errors.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/errors.ts) by extending `ErrorCategory` and `ErrorLayer` with `"configuration"`, complete with theme styling and user-friendly, non-leaking modal copy.
- Transaction runner state synchronization in `useTransactionRunner.ts` (`stage = "preparing"` before signing) to prevent UI signing flashes on validation errors.
- Preflight reordering in `harvest-yield.worker.ts` to prevent Switchboard VRF resource leaks on unconfigured pools.
- Non-colliding test harness addresses with guaranteed uniqueness in `createMockHumaAddresses()` and non-sentinel `TEST_ADDRESSES.USER`.

---

## User Review Required

> [!IMPORTANT]
> **No Backwards Compatibility Required**: Per protocol guidelines, backwards compatibility shims are unnecessary. Instruction builders will strictly fail fast if required Huma accounts are missing rather than generating malformed transactions with dummy accounts.
>
> All callers (including test harnesses, crank workers, `scripts/devnet.ts`, and `scripts/pb-cli.ts`) will be migrated to the unified `HumaPoolAddresses` interface.

---

## Architecture & Data Flow

```mermaid
flowchart TD
    PrizePoolAcc[Authoritative On-Chain PrizePool] -->|pool.humaPoolState| Precedence[Precedence Resolver: overrides ?? onChain ?? env]
    Env[Environment .env] -->|parseOptionalAddress| SdkConstants[Lazy SDK Defaults: Address | undefined]
    Overrides[Caller Overrides: Partial HumaPoolAddresses] --> Precedence
    SdkConstants --> Precedence

    Precedence -->|Canonical Bag| ResolveHuma[resolveHumaAddresses: HumaPoolAddresses]
    ResolveHuma -->|Pass to Validator| RequireFn[requireHumaAddresses: Value-Returning Narrowing]

    RequireFn -->|Validated Non-Null Bag| Validated[RequiredHumaAddresses K: Non-Null Address]
    Validated -->|Automatic Derivation| Derivations[findHumaPoolAuthorityPda + findAtaAddress poolUnderlyingToken + findAtaAddress poolModeToken]
    Derivations --> CodamaBuilder[Codama Instruction Builder]
    Validated --> CodamaBuilder
    CodamaBuilder -->|Exact, non-colliding accounts| Tx[Solana Transaction]

    RequireFn -->|Missing Required Account| ConfigErr[HumaConfigurationError: CONFIG_MISSING_HUMA_ADDRESSES]
    ConfigErr --> ParseErr[app/lib/errors.ts: parseTransactionError]
    ParseErr -->|category: configuration| UserModal[TransactionProgressModal / Alert Card: Yield Venue Unavailable]
```

---

## Proposed Changes

### 1. Core SDK & Error Handling (`app/lib/bonds-sdk.ts`, `app/lib/errors.ts`)

#### [MODIFY] [`app/lib/bonds-sdk.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-sdk.ts)

- **Replace constant defaults with lazy, client-safe getters and `Address | undefined`**:
  Update all Huma exported constants to `Address | undefined` with NO dummy string fallbacks:

  ```typescript
  export function getDefaultHumaAddresses(): HumaPoolAddresses {
    return {
      config: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_CONFIG || process.env.HUMA_CONFIG
      ),
      poolConfig: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_POOL_CONFIG || process.env.HUMA_POOL_CONFIG
      ),
      poolState: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_POOL_STATE || process.env.HUMA_POOL_STATE
      ),
      modeConfig: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_MODE_CONFIG || process.env.HUMA_MODE_CONFIG
      ),
      lenderState: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_LENDER_STATE ||
          process.env.HUMA_LENDER_STATE
      ),
      poolUnderlyingToken: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN ||
          process.env.HUMA_POOL_UNDERLYING_TOKEN
      ),
      modeMint: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_MODE_MINT ||
          process.env.HUMA_MODE_MINT ||
          process.env.NEXT_PUBLIC_PST_MINT ||
          process.env.PST_MINT
      ),
      poolModeToken: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
          process.env.HUMA_POOL_MODE_TOKEN
      ),
      redemptionRequest: parseOptionalAddress(
        process.env.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
          process.env.HUMA_REDEMPTION_REQUEST
      ),
      program:
        parseOptionalAddress(
          process.env.NEXT_PUBLIC_HUMA_PROGRAM_ID || process.env.HUMA_PROGRAM_ID
        ) ?? HUMA_PROGRAM_ID,
    };
  }

  export const HUMA_CONFIG: Address | undefined = parseOptionalAddress(
    process.env.NEXT_PUBLIC_HUMA_CONFIG || process.env.HUMA_CONFIG
  );
  export const HUMA_POOL_CONFIG: Address | undefined = parseOptionalAddress(
    process.env.NEXT_PUBLIC_HUMA_POOL_CONFIG || process.env.HUMA_POOL_CONFIG
  );
  export const HUMA_POOL_STATE: Address | undefined = parseOptionalAddress(
    process.env.NEXT_PUBLIC_HUMA_POOL_STATE || process.env.HUMA_POOL_STATE
  );
  export const HUMA_MODE_CONFIG: Address | undefined = parseOptionalAddress(
    process.env.NEXT_PUBLIC_HUMA_MODE_CONFIG || process.env.HUMA_MODE_CONFIG
  );
  export const HUMA_LENDER_STATE: Address | undefined = parseOptionalAddress(
    process.env.NEXT_PUBLIC_HUMA_LENDER_STATE || process.env.HUMA_LENDER_STATE
  );
  export const HUMA_POOL_UNDERLYING_TOKEN: Address | undefined =
    parseOptionalAddress(
      process.env.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN ||
        process.env.HUMA_POOL_UNDERLYING_TOKEN
    );
  export const HUMA_MODE_MINT: Address | undefined = parseOptionalAddress(
    process.env.NEXT_PUBLIC_HUMA_MODE_MINT ||
      process.env.HUMA_MODE_MINT ||
      process.env.NEXT_PUBLIC_PST_MINT ||
      process.env.PST_MINT
  );
  export const HUMA_POOL_MODE_TOKEN: Address | undefined = parseOptionalAddress(
    process.env.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
      process.env.HUMA_POOL_MODE_TOKEN
  );
  export const HUMA_REDEMPTION_REQUEST: Address | undefined =
    parseOptionalAddress(
      process.env.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
        process.env.HUMA_REDEMPTION_REQUEST
    );
  ```

- **Consolidate canonical `HumaPoolAddresses` interface**:
  Remove `HumaStateAddresses` and `ResolvedHumaAddresses`. Standardize all fields with explicit separation between Huma pool escrow (`poolModeToken`) and YieldBonds lender account (`lenderModeToken`):

  ```typescript
  export interface HumaPoolAddresses {
    poolState?: Address;
    config?: Address;
    poolConfig?: Address;
    modeConfig?: Address;
    lenderState?: Address;
    poolUnderlyingToken?: Address;
    modeMint?: Address;
    poolModeToken?: Address;
    lenderModeToken?: Address;
    redemptionRequest?: Address;
    program?: Address;
  }
  ```

- **Define Strongly-Typed `HumaConfigurationError`**:

  ```typescript
  export class HumaConfigurationError extends Error {
    readonly code = "CONFIG_MISSING_HUMA_ADDRESSES";
    constructor(
      public readonly missingKeys: readonly string[],
      public readonly operationContext: string
    ) {
      super(
        `Missing required Huma account address(es) for ${operationContext}: [${missingKeys.join(", ")}]. ` +
          `Ensure they are configured in your environment or passed via 'humaAddresses'.`
      );
      this.name = "HumaConfigurationError";
    }
  }
  ```

- **Implement Canonical `resolveHumaAddresses`**:
  Reorder parameters to place `overrides` first (`resolveHumaAddresses(overrides?, poolHumaPoolState?)`). Protect against on-chain pool contamination: if an on-chain pool explicitly has an uninitialized address (`1111...1111`), fail fast instead of falling back to ambient `.env`:

  ```typescript
  export function resolveHumaAddresses(
    overrides?: Partial<HumaPoolAddresses>,
    poolHumaPoolState?: Address | string | null
  ): HumaPoolAddresses {
    const defaults = getDefaultHumaAddresses();
    const parsedOverridePoolState = parseOptionalAddress(overrides?.poolState);
    const parsedOnChain = parseOptionalAddress(poolHumaPoolState);

    // If poolHumaPoolState was provided (e.g. not null/undefined) but parsed to undefined (e.g. "1111...1111"),
    // preserve undefined to prevent silent cross-pool contamination from .env
    const poolState =
      parsedOverridePoolState ??
      (poolHumaPoolState !== undefined && poolHumaPoolState !== null
        ? parsedOnChain
        : (parsedOnChain ?? defaults.poolState));

    return {
      poolState,
      config: parseOptionalAddress(overrides?.config) ?? defaults.config,
      poolConfig:
        parseOptionalAddress(overrides?.poolConfig) ?? defaults.poolConfig,
      modeConfig:
        parseOptionalAddress(overrides?.modeConfig) ?? defaults.modeConfig,
      lenderState:
        parseOptionalAddress(overrides?.lenderState) ?? defaults.lenderState,
      poolUnderlyingToken:
        parseOptionalAddress(overrides?.poolUnderlyingToken) ??
        defaults.poolUnderlyingToken,
      modeMint: parseOptionalAddress(overrides?.modeMint) ?? defaults.modeMint,
      poolModeToken:
        parseOptionalAddress(overrides?.poolModeToken) ??
        defaults.poolModeToken,
      lenderModeToken: parseOptionalAddress(overrides?.lenderModeToken),
      redemptionRequest:
        parseOptionalAddress(overrides?.redemptionRequest) ??
        defaults.redemptionRequest,
      program: parseOptionalAddress(overrides?.program) ?? defaults.program,
    };
  }
  ```

- **Implement Functional Narrowing `requireHumaAddresses<K>` & Atomic Helper**:
  Remove `isConfiguredAccountAddress` sentinel checks. Trust the `parseOptionalAddress` boundary (`if (!val)`). Return an immutable shallow copy:

  ```typescript
  export type RequiredHumaAddresses<K extends keyof HumaPoolAddresses> = Omit<
    HumaPoolAddresses,
    K
  > & {
    readonly [P in K]: Address;
  };

  export function requireHumaAddresses<K extends keyof HumaPoolAddresses>(
    addresses: Partial<HumaPoolAddresses> | undefined,
    requiredKeys: readonly K[],
    operationContext: string
  ): RequiredHumaAddresses<K> {
    const bag = addresses ?? {};
    const missing: K[] = [];
    for (const key of requiredKeys) {
      const val = bag[key];
      if (!val) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new HumaConfigurationError(missing as string[], operationContext);
    }
    return { ...bag } as RequiredHumaAddresses<K>;
  }

  /**
   * Resolves environment/on-chain defaults and validates required keys in one atomic operation,
   * eliminating temporal coupling bugs between resolution and validation.
   */
  export function resolveAndRequireHumaAddresses<
    K extends keyof HumaPoolAddresses,
  >(
    overrides: Partial<HumaPoolAddresses> | undefined,
    requiredKeys: readonly K[],
    operationContext: string,
    poolHumaPoolState?: Address | string | null
  ): RequiredHumaAddresses<K> {
    const resolved = resolveHumaAddresses(overrides, poolHumaPoolState);
    return requireHumaAddresses(resolved, requiredKeys, operationContext);
  }
  ```

- **Graceful RPC methods**:
  - `fetchPendingRedemptionCandidates`:
    ```typescript
    const humaPoolAddr =
      parseOptionalAddress(params.humaPoolState) ?? HUMA_POOL_STATE;
    if (!humaPoolAddr) {
      return [];
    }
    ```
  - `fetchBatchedBondsState`: Only add accounts to `accountMap` if their addresses are defined. If `humaPoolState` is undefined, `result.humaPoolStateData` remains `null`.
  - `fetchTicketRegistryHeader`: Replace `registryAddress === "11111111111111111111111111111111"` with `!parseOptionalAddress(registryAddress)`.

- **Refactor `buildClaimRedemptionInstruction`**:
  Define required keys:

  ```typescript
  export const CLAIM_REDEMPTION_REQUIRED_HUMA_KEYS = [
    "poolState",
    "config",
    "poolConfig",
    "modeConfig",
    "lenderState",
  ] as const;
  ```

  Validate required accounts upfront using atomic resolution (preventing temporal bugs):

  ```typescript
  const huma = resolveAndRequireHumaAddresses(
    params.humaAddresses,
    CLAIM_REDEMPTION_REQUIRED_HUMA_KEYS,
    "ClaimRedemption",
    params.humaAddresses?.poolState
  );
  ```

  Derive `humaPoolAuthority` and `humaPoolUnderlyingToken` safely using guaranteed `huma.poolState` and configurable `huma.program`:

  ```typescript
  const humaPoolAuthority = await findHumaPoolAuthorityPda(
    huma.poolState,
    huma.program
  );
  const humaPoolUnderlyingToken =
    huma.poolUnderlyingToken ??
    (await findAtaAddress(humaPoolAuthority, params.tokenMint, tokenProgram));
  ```

  Remove all fallbacks to `SYSTEM_PROGRAM_ID`.

- **Refactor `findHumaPoolAuthorityPda` to support custom program IDs**:

  ```typescript
  export async function findHumaPoolAuthorityPda(
    poolState: Address | string,
    programId?: Address
  ): Promise<Address> {
    const [authority] = await findProgramDerivedAddress({
      programAddress: programId ?? HUMA_PROGRAM_ID,
      seeds: [
        textEncoder.encode("pool_authority"),
        getAddressEncoder().encode(address(poolState)),
      ],
    });
    return authority;
  }
  ```

- **Refactor `buildInitializeHumaLenderInstruction`**:
  Disambiguate `humaLenderModeToken` (YieldBonds' lender account, defaulting to `poolPstVault`) from Huma's pool escrow (`humaPoolModeToken`):

  ```typescript
  export const INITIALIZE_HUMA_LENDER_REQUIRED_KEYS = [
    "poolState",
    "config",
    "poolConfig",
    "modeConfig",
    "modeMint",
    "lenderState",
  ] as const;

  export async function buildInitializeHumaLenderInstruction(params: {
    admin: TransactionSigner;
    poolId: number;
    humaAddresses?: Partial<HumaPoolAddresses>;
  }) {
    const pool = await findPrizePoolPda(params.poolId);
    const poolPstVault = await findPoolPstVaultPda(params.poolId);
    const huma = resolveAndRequireHumaAddresses(
      params.humaAddresses,
      INITIALIZE_HUMA_LENDER_REQUIRED_KEYS,
      "InitializeHumaLender"
    );
    const humaLenderModeToken = huma.lenderModeToken ?? poolPstVault;

    return getInitializeHumaLenderInstructionAsync({
      admin: params.admin,
      humaProgram: huma.program ?? HUMA_PROGRAM_ID,
      pool,
      poolPstVault,
      humaConfig: huma.config,
      humaPoolConfig: huma.poolConfig,
      humaPoolState: huma.poolState,
      humaModeConfig: huma.modeConfig,
      humaModeMint: huma.modeMint,
      humaLenderState: huma.lenderState,
      humaLenderModeToken,
      pstTokenProgram: TOKEN_PROGRAM_ID,
    });
  }
  ```

- **Refactor `buildWithdrawFeesInstruction` & Eliminate Fatal Anchor 2040 Collision**:
  Never fall back to `poolPstVault` for `humaPoolModeToken`. Instead, auto-derive `humaPoolModeToken` as the ATA of `humaPoolAuthority` for `modeMint`:

  ```typescript
  export const WITHDRAW_FEES_REQUIRED_HUMA_KEYS = [
    "poolState",
    "config",
    "poolConfig",
    "modeConfig",
    "modeMint",
    "redemptionRequest",
    "lenderState",
  ] as const;

  export async function buildWithdrawFeesInstruction(params: {
    admin: Address | TransactionSigner;
    poolId: number;
    amount: bigint | number;
    tokenMint: Address;
    feeWallet: Address;
    nextRedemptionId: bigint | number;
    humaAddresses?: Partial<HumaPoolAddresses>;
  }) {
    const pool = await findPrizePoolPda(params.poolId);
    const poolPstVault = await findPoolPstVaultPda(params.poolId);
    const pendingRedemption = await findPendingRedemptionPda(
      params.poolId,
      params.nextRedemptionId
    );
    const huma = resolveAndRequireHumaAddresses(
      params.humaAddresses,
      WITHDRAW_FEES_REQUIRED_HUMA_KEYS,
      "WithdrawFees"
    );
    const humaPoolAuthority = await findHumaPoolAuthorityPda(
      huma.poolState,
      huma.program
    );
    const humaPoolModeToken =
      huma.poolModeToken ??
      (await findAtaAddress(
        humaPoolAuthority,
        huma.modeMint,
        TOKEN_PROGRAM_ID
      ));

    return getWithdrawFeesInstructionAsync({
      admin: params.admin as TransactionSigner,
      pool,
      poolPstVault,
      pendingRedemption,
      humaConfig: huma.config,
      humaPoolConfig: huma.poolConfig,
      humaPoolState: huma.poolState,
      humaModeConfig: huma.modeConfig,
      humaModeMint: huma.modeMint,
      humaRedemptionRequest: huma.redemptionRequest,
      humaLenderState: huma.lenderState,
      humaPoolAuthority,
      humaPoolModeToken,
      pstTokenProgram: TOKEN_PROGRAM_ID,
      amount: params.amount,
      tokenMint: params.tokenMint,
      feeWallet: params.feeWallet,
    });
  }
  ```

- **Completely Delete `isConfiguredAccountAddress`**:
  Delete `isConfiguredAccountAddress` entirely. Sanitization is performed strictly at the ingress boundary in `parseOptionalAddress` (mapping empty strings and `"11111111111111111111111111111111"` to `undefined`). Inside typed domain logic, optional addresses are checked via standard truthiness (`if (!val)`).

---

#### [MODIFY] [`app/lib/errors.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/errors.ts)

- **Extend Type Definitions**:

  ```typescript
  export type ErrorLayer =
    | "wallet"
    | "anchor"
    | "squads"
    | "spl"
    | "system"
    | "rpc"
    | "configuration"
    | "unknown";

  export type ErrorCategory =
    | "wallet_cancellation"
    | "insufficient_sol"
    | "insufficient_tokens"
    | "spl_token"
    | "anchor_custom"
    | "anchor_constraint"
    | "squads_multisig"
    | "blockhash_expired"
    | "duplicate_transaction"
    | "network_rpc"
    | "configuration"
    | "unknown";
  ```

- **Add Theme Styling in `getErrorCategoryTheme`**:

  ```typescript
  case "configuration":
    return {
      icon: "⚙️",
      borderColor: "border-amber-500/30",
      bgBadgeColor: "bg-amber-500/10",
      titleColor: "text-amber-300",
      accentBorder: "border-s-amber-400",
      ringBorder: "border-amber-500/30",
    };
  ```

- **Add Branch in `parseTransactionError` with Clean Modal Copy and Machine-Readable Code**:
  Prevent leaking developer-only parameters to users. Store technical details in `logs` and provide user-friendly copy:

  ```typescript
  if (
    err instanceof HumaConfigurationError ||
    (err as Record<string, unknown>)?.code ===
      "CONFIG_MISSING_HUMA_ADDRESSES" ||
    combinedSearchText.includes("missing required huma account address")
  ) {
    return {
      isCancellation: false,
      layer: "configuration",
      category: "configuration",
      title: "Yield Venue Unavailable",
      message:
        "This prize pool's yield venue configuration is incomplete on this network. Deposits and withdrawals are momentarily paused.",
      code: "CONFIG_MISSING_HUMA_ADDRESSES",
      actionableStep:
        "Please select an active pool or switch network clusters.",
      logs: [rawMsg],
      rawError: err,
    };
  }
  ```

---

### 2. Instruction Factory (`app/lib/bonds-instruction-factory.ts`)

#### [MODIFY] [`app/lib/bonds-instruction-factory.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-instruction-factory.ts)

- **Delete Duplicate Resolution Logic**:
  Delete `ResolvedHumaAddresses` interface and `resolveHumaAddresses()` implementation from `bonds-instruction-factory.ts`. Import canonical `resolveHumaAddresses`, `requireHumaAddresses`, `resolveAndRequireHumaAddresses`, and `HumaPoolAddresses` directly from `bonds-sdk.ts`.

- **Define required keys constants (Auto-deriving both `poolUnderlyingToken` and `poolModeToken`)**:

  ```typescript
  export const BUY_BONDS_REQUIRED_HUMA_KEYS = [
    "poolState",
    "config",
    "poolConfig",
    "modeConfig",
    "modeMint",
  ] as const;

  export const SELL_BONDS_REQUIRED_HUMA_KEYS = [
    "poolState",
    "config",
    "poolConfig",
    "modeConfig",
    "modeMint",
    "redemptionRequest",
    "lenderState",
  ] as const;

  export const CLAIM_NON_REINVESTED_REQUIRED_HUMA_KEYS = [
    "poolState",
    "config",
    "poolConfig",
    "modeConfig",
    "modeMint",
    "redemptionRequest",
    "lenderState",
  ] as const;
  ```

- **Make `userTokenAccount` Optional in `BuyBondsFactoryParams` & Auto-Derive**:

  ```typescript
  export interface BuyBondsFactoryParams {
    poolId: PoolId;
    userAddress: Address;
    ticketsToBuy: number;
    ticketRegistry: Address;
    userTokenAccount?: Address;
    tokenMint?: Address;
    humaAddresses?: Partial<HumaPoolAddresses>;
  }
  ```

- **Per-Instruction Validation & Safe Derivations**:
  - **`buildBuyBondsInstruction`**:
    1. Validate required accounts via `resolveAndRequireHumaAddresses`:
       ```typescript
       const tokenMint = params.tokenMint ?? USDC_MINT;
       const userTokenAccount =
         params.userTokenAccount ??
         (await findAtaAddress(
           params.userAddress,
           tokenMint,
           TOKEN_PROGRAM_ID
         ));
       const huma = resolveAndRequireHumaAddresses(
         params.humaAddresses,
         BUY_BONDS_REQUIRED_HUMA_KEYS,
         "BuyBonds"
       );
       ```
    2. Safely derive `humaPoolAuthority` with custom program ID support:
       ```typescript
       const humaPoolAuthority = await findHumaPoolAuthorityPda(
         huma.poolState,
         huma.program
       );
       ```
    3. Deterministically derive `humaPoolUnderlyingToken`:
       ```typescript
       const humaPoolUnderlyingToken =
         huma.poolUnderlyingToken ??
         (await findAtaAddress(humaPoolAuthority, tokenMint, TOKEN_PROGRAM_ID));
       ```
  - **`buildSellBondsInstruction`**:
    1. Validate required accounts with on-chain pool state precedence:
       ```typescript
       const huma = resolveAndRequireHumaAddresses(
         params.humaAddresses,
         SELL_BONDS_REQUIRED_HUMA_KEYS,
         "SellBonds",
         poolInfo.humaPoolState ? address(poolInfo.humaPoolState) : undefined
       );
       ```
    2. Safely derive `humaPoolAuthority` and auto-derive `humaPoolModeToken`:
       ```typescript
       const humaPoolAuthority = await findHumaPoolAuthorityPda(
         huma.poolState,
         huma.program
       );
       const humaPoolModeToken =
         huma.poolModeToken ??
         (await findAtaAddress(
           humaPoolAuthority,
           huma.modeMint,
           TOKEN_PROGRAM_ID
         ));
       ```
  - **`buildClaimNonReinvestedWinningsInstruction`**:
    1. Validate required accounts:
       ```typescript
       const huma = resolveAndRequireHumaAddresses(
         params.humaAddresses,
         CLAIM_NON_REINVESTED_REQUIRED_HUMA_KEYS,
         "ClaimNonReinvestedWinnings"
       );
       ```
    2. Safely derive `humaPoolAuthority` and auto-derive `humaPoolModeToken`:
       ```typescript
       const humaPoolAuthority = await findHumaPoolAuthorityPda(
         huma.poolState,
         huma.program
       );
       const humaPoolModeToken =
         huma.poolModeToken ??
         (await findAtaAddress(
           humaPoolAuthority,
           huma.modeMint,
           TOKEN_PROGRAM_ID
         ));
       ```
  - **`buildClaimRedemptionInstructions`**:
    Pass merged `humaAddresses` resolved via `resolveHumaAddresses` into `sdkBuildClaimRedemptionInstructions` (which executes `resolveAndRequireHumaAddresses`).

---

### 3. Frontend Hooks (`app/hooks`)

#### [MODIFY] [`app/hooks/useBondsContract.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/hooks/useBondsContract.ts)

- **Eliminate Dynamic Import & Manual ATA Derivation in `buyBonds`**:
  Because `buildBuyBondsInstruction` now derives `userTokenAccount` automatically, completely remove the dynamic `import()`:

  ```typescript
  // In buyBonds:
  const ix = await buildBuyBondsInstruction({
    poolId,
    userAddress: address(userAddress),
    ticketsToBuy,
    ticketRegistry: address(pool.ticketRegistry),
    humaAddresses: pool.humaPoolState
      ? { poolState: address(pool.humaPoolState) }
      : undefined,
  });
  ```

- **Pass Pool State in `sellBonds`**:
  ```typescript
  // In sellBonds:
  const ix = await buildSellBondsInstruction({
    rpc,
    poolId,
    userAddress: address(userAddress),
    activeToSell,
    pendingToSell,
    userRegistryIndex: userTickets.entryIndex,
    currentUserTotalTickets: userTickets.totalTickets,
    humaAddresses: pool.humaPoolState
      ? { poolState: address(pool.humaPoolState) }
      : undefined,
  });
  ```

#### [MODIFY] [`app/hooks/useTransactionRunner.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/hooks/useTransactionRunner.ts)

- **Synchronize Lifecycle Stage to Prevent "Signing..." UI Flash**:
  Set stage to `"preparing"` during client instruction building and account resolution:

  ```typescript
  setStage("preparing");
  setError(null);
  setTxSignature(null);

  try {
    const capturedSig = await txFn();
  ```

---

### 4. Crank Workers (`services/crank`)

#### [MODIFY] [`services/crank/config.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/services/crank/config.ts)

- **Eliminate Duplicated `parseOptionalAddress`**:
  Delete the duplicate implementation of `parseOptionalAddress` in `services/crank/config.ts` and import it directly from `app/lib/bonds-sdk.ts`.

#### [MODIFY] [`services/crank/workers/disburse-sentinel.worker.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/services/crank/workers/disburse-sentinel.worker.ts)

- **Delete Dead Method & Use Canonical `resolveHumaAddresses`**:
  Delete the obsolete private `resolveHumaAddresses` method (which previously fell back to `SYSTEM_PROGRAM_ID`). Use the canonical export:

  ```typescript
  const humaAddresses = resolveHumaAddresses(
    {
      lenderState:
        context.config?.poolHumaLenderStates?.[snapshot.poolId] ??
        context.config?.humaLenderState,
      config: context.config?.humaConfig,
      poolConfig: context.config?.humaPoolConfig,
      modeConfig: context.config?.humaModeConfig,
      poolUnderlyingToken: context.config?.humaPoolUnderlyingToken,
    },
    snapshot.pool.humaPoolState
  );
  ```

- Evaluate checks cleanly via truthiness (without sentinel checks):
  ```typescript
  if (!humaAddresses.poolState) {
    return {
      shouldExecute: false,
      reason: `Huma pool state is not configured for Pool #${snapshot.poolId}; auto-disburse skipped`,
    };
  }
  if (!humaAddresses.lenderState) {
    return {
      shouldExecute: false,
      reason: `Huma lender state is not configured for Pool #${snapshot.poolId} (HUMA_LENDER_STATE unset); auto-disburse skipped`,
    };
  }
  ```

#### [MODIFY] [`services/crank/workers/harvest-yield.worker.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/services/crank/workers/harvest-yield.worker.ts)

- **Prevent VRF Resource Leak by Preflighting Before Randomness Allocation**:
  Evaluate account configuration _before_ invoking `this.vrfProvider.prepareHarvestRandomness`, preventing orphaned VRF randomness accounts:

  ```typescript
  const huma = resolveHumaAddresses(
    { modeMint: this.config?.pstMint },
    snapshot.pool.humaPoolState
  );

  const pstMint = huma.modeMint;
  const humaPoolState = huma.poolState;

  if (!pstMint || !humaPoolState) {
    return {
      shouldExecute: false,
      reason: `Harvest skipped: PST mint or Huma pool state unconfigured for Pool #${snapshot.poolId}`,
    };
  }

  // Preflight passed; now safely allocate Switchboard VRF randomness
  const vrf = await this.vrfProvider.prepareHarvestRandomness({
    poolId: snapshot.poolId,
    cycleId: snapshot.currentCycleId,
  });
  ```

---

### 5. CLI & Devnet Scripts (`scripts/devnet.ts`, `scripts/pb-cli.ts`)

#### [MODIFY] [`scripts/devnet.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/devnet.ts)

- Update line 903 calling `buildInitializeHumaLenderInstruction`:
  Disambiguate `lenderModeToken` from `poolModeToken`:
  ```typescript
  const initHumaLenderIx = await buildInitializeHumaLenderInstruction({
    admin: adminSigner,
    poolId,
    humaAddresses: {
      program: mockHumaProgramId,
      config: mockHumaProgramId,
      poolConfig: mockHumaProgramId,
      poolState: humaPoolStateSigner.address,
      modeConfig: mockHumaProgramId,
      modeMint: pstMintAddress,
      lenderState: humaLenderStateSigner.address,
      lenderModeToken: poolPstVaultAddress,
    },
  });
  ```

#### [MODIFY] [`scripts/pb-cli.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/pb-cli.ts)

- Update lines 3091–3096 (`initialize-huma-lender`) and lines 3446–3455 (`withdraw-fees`):
  Map disk/env addresses into structured `HumaPoolAddresses`:
  ```typescript
  const humaAddresses: Partial<HumaPoolAddresses> = {
    poolState: parseOptionalAddress(
      poolState.humaPoolState || stateAddresses.humaPoolState
    ),
    config: parseOptionalAddress(
      stateAddresses.humaConfig ||
        stateAddresses.HUMA_CONFIG ||
        stateAddresses.NEXT_PUBLIC_HUMA_CONFIG
    ),
    poolConfig: parseOptionalAddress(
      stateAddresses.humaPoolConfig ||
        stateAddresses.HUMA_POOL_CONFIG ||
        stateAddresses.NEXT_PUBLIC_HUMA_POOL_CONFIG
    ),
    modeConfig: parseOptionalAddress(
      stateAddresses.humaModeConfig ||
        stateAddresses.HUMA_MODE_CONFIG ||
        stateAddresses.NEXT_PUBLIC_HUMA_MODE_CONFIG
    ),
    modeMint: parseOptionalAddress(
      stateAddresses.pstMint ||
        stateAddresses.HUMA_MODE_MINT ||
        stateAddresses.NEXT_PUBLIC_HUMA_MODE_MINT
    ),
    lenderState: parseOptionalAddress(
      stateAddresses.humaLenderState ||
        stateAddresses.HUMA_LENDER_STATE ||
        stateAddresses.NEXT_PUBLIC_HUMA_LENDER_STATE
    ),
    redemptionRequest: parseOptionalAddress(
      stateAddresses.humaRedemptionRequest ||
        stateAddresses.HUMA_REDEMPTION_REQUEST
    ),
    poolModeToken: parseOptionalAddress(
      stateAddresses.humaPoolModeToken || stateAddresses.HUMA_POOL_MODE_TOKEN
    ),
    lenderModeToken: parseOptionalAddress(
      stateAddresses.humaLenderModeToken ||
        stateAddresses.HUMA_LENDER_MODE_TOKEN
    ),
  };
  ```
  Pass `humaAddresses` into `buildInitializeHumaLenderInstruction` and `buildWithdrawFeesInstruction`.

---

### 6. Test Harnesses & Unit Tests

#### [MODIFY] [`app/lib/test-harness/addresses.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/test-harness/addresses.ts)

- Define distinct, non-overlapping mock addresses for each Huma account, and replace `TEST_ADDRESSES.USER` with a dedicated Ed25519 mock address to prevent mock prize pools from failing `parseOptionalAddress` checks:

  ```typescript
  export const TEST_ADDRESSES = {
    USER: address("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK"),
    USER_2: address("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"),
    MINT: USDC_MINT,
    ATA_PROGRAM: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    ADMIN: address("SysvarRent111111111111111111111111111111111"),
    HUMA_POOL: address("HumaPoo111111111111111111111111111111111111"),
  } as const;

  export const MOCK_HUMA_ADDRESSES = {
    poolState: address("D4fBgrqd2DjjYgmTFZT2EboVbXjjaM8VZEaEHYrQ8DtM"),
    config: address("8VA7RjU8fwqdYrN4j9T1xigJaDr9wvGCuRtz4V3P9mDt"),
    poolConfig: address("GzyGmodpbkSH4BD1qHYaawkq1ndNP3nEBPGcYxvVJgZq"),
    modeConfig: address("J9SJBMYruro9LwED8y54egBz1vuivG89sNSjb3FhS9Zy"),
    lenderState: address("mmb7zaCqYWJPr1z8BBfJAdnKLedAAwSYpc11LWqZWHC"),
    poolUnderlyingToken: address("C8bpcC3E5LQxsgzsKwDADpXpYPS8qy4bpZGdKMBAAXq"),
    modeMint: address("5R2YdvMLdpq59PKDBLF1mQARqfe2hkdraqSLtaKeg72F"),
    poolModeToken: address("6We37vc76UiQ91rfDxSUhFUmgbMbkwLT8NEpTYNN3RX"),
    lenderModeToken: address("8XFkP4b18T8R4zGvT8dY1Q6jMh2k3pP5qV9sA7bC3eD1"),
    redemptionRequest: address("Bw5wpTV4evkbxFA78LQkX6Bpxsr3Y5gXEDaJmQzqJ1qQ"),
    program: address("Bm9d3LeMLsbkM8Xf9NvZ9d4xPnQfLuX62LLeyfAtrijJ"),
  } as const;

  export function createMockHumaAddresses(
    overrides?: Partial<HumaPoolAddresses>
  ): HumaPoolAddresses {
    const result = { ...MOCK_HUMA_ADDRESSES, ...overrides };
    const values = Object.values(result).filter(Boolean);
    if (new Set(values).size !== values.length) {
      throw new Error(
        "Test harness invariant violation: Mock Huma addresses must be strictly unique to prevent account collisions."
      );
    }
    return result;
  }
  ```

#### [MODIFY] [`app/lib/test-harness/account-builders.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/test-harness/account-builders.ts)

- Update `buildMockPrizePool` and `buildMockPrizePoolArgs`:
  Set `humaPoolState: MOCK_HUMA_ADDRESSES.poolState` instead of System Program ID.

#### [MODIFY] [`app/lib/__tests__/bonds-instruction-factory.test.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/__tests__/bonds-instruction-factory.test.ts)

- Update tests to supply `humaAddresses: createMockHumaAddresses()`.
- Add tests verifying:
  - `buildBuyBondsInstruction` auto-derives `userTokenAccount` when omitted.
  - `buildWithdrawFeesInstruction` auto-derives `humaPoolModeToken` distinct from `poolPstVault` (Anchor 2040 collision test).
  - Omitting each required key throws `HumaConfigurationError` with `code: "CONFIG_MISSING_HUMA_ADDRESSES"`.
  - Passing `"11111111111111111111111111111111"` is rejected by `requireHumaAddresses`.
  - Automatic ATA derivation for both `poolUnderlyingToken` and `poolModeToken` succeeds and matches `findAtaAddress`.

#### [MODIFY] [`services/crank/__tests__/workers.test.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/services/crank/__tests__/workers.test.ts)

- Update `createMockContext` to supply valid, non-colliding mock addresses.
- Verify `HarvestYieldWorker` skips before VRF preparation and `DisburseSentinelWorker` skips gracefully when `humaPoolState` or `lenderState` is missing.

#### [MODIFY] [`scripts/error-mapping.test.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/error-mapping.test.ts)

- Add unit test verifying that `parseTransactionError` maps `HumaConfigurationError` to:
  - `category: "configuration"`
  - `layer: "configuration"`
  - `title: "Yield Venue Unavailable"`
  - `code: "CONFIG_MISSING_HUMA_ADDRESSES"`
  - Non-leaking user-friendly `actionableStep`.
  - Valid theme from `getErrorCategoryTheme("configuration")`.

---

## Verification Plan

### Automated Tests

1. **Targeted Crank Worker Tests**:
   ```bash
   npx tsx --test services/crank/__tests__/workers.test.ts
   ```
2. **Instruction Factory Unit Tests**:
   ```bash
   npx tsx --test app/lib/__tests__/bonds-instruction-factory.test.ts
   ```
3. **Error Mapping Unit Tests**:
   ```bash
   npm run test:errors
   ```
4. **TypeScript Strict Typecheck**:
   ```bash
   npx tsc --noEmit
   ```
5. **Code Style & Lint**:
   ```bash
   npm run lint
   npm run format:check
   ```
6. **Full Test Suite**:
   ```bash
   npm test
   ```

### Manual Verification

- Verify that module import of `app/lib/bonds-sdk.ts` in an environment without `.env.local` does NOT throw unhandled exceptions or trigger React SSR hydration warnings.
- Verify that missing Huma configuration errors display the "Yield Venue Unavailable" alert card in the UI without leaking developer parameters into end-user modal copy.
- Verify that `buildWithdrawFeesInstruction` generates distinct `poolPstVault` and `humaPoolModeToken` accounts.
