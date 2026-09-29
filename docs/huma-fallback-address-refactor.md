# Implementation Plan: Eliminate Dummy Fallback Addresses in Huma Integration

## Goal Description

Optional and environment-derived Huma account addresses (such as `HUMA_CONFIG`, `HUMA_POOL_STATE`, `HUMA_LENDER_STATE`, etc.) in [`app/lib/bonds-sdk.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-sdk.ts) currently fall back to dummy public keys (historically `"11111111111111111111111111111111"` or `"DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK"`).

This anti-pattern produces several critical system failures:

1. **Sentinel Value Smells**: Re-inventing `null` by checking `isConfiguredAccountAddress(addr)` (i.e. `addr !== "11111111111111111111111111111111"`).
2. **Account Address Collisions**: When multiple distinct accounts fall back to the same placeholder key (e.g. `TEST_ADDRESSES.USER_2` / `DYw8j...`), accounts collide inside Codama instruction builders. Searches by address match the wrong account (e.g. finding readonly `humaConfig` instead of mutable `humaLenderState`, causing `role: AccountRole.READONLY` instead of `AccountRole.WRITABLE` or triggering Anchor error 2040 `ConstraintDuplicateMutableAccount`).
3. **Phantom RPC Calls**: Background workers and sentinels make outbound RPC requests querying account info for dummy addresses, failing with `ECONNREFUSED` or 404 errors.
4. **Silent Transaction Failures**: Transactions compile and build cleanly with dummy keys, only to fail during simulation or execution on Solana with cryptic errors like `ConstraintSeeds`, `IllegalOwner`, or `AccountNotFound`.
5. **Source of Truth Inversion**: Ambient environment variables previously took precedence over the on-chain `PrizePool.humaPoolState` account, risking cross-pool contamination or immediate reverts in multi-pool deployments.
6. **Inconsistent Interfaces & Duplication**: Competing interfaces (`HumaPoolAddresses`, `HumaStateAddresses`, `ResolvedHumaAddresses`, and untyped `Record<string, string | undefined>` bags) scattered across SDK, CLI scripts, and crank workers.

This plan replaces dummy fallback addresses with:

- Strict `Address | undefined` typing using [`parseOptionalAddress`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-sdk.ts#L140) with lazy evaluation (preventing SSR/hydration crashes at module evaluation time).
- On-chain authoritative precedence: `overrides?.poolState ?? poolHumaPoolState ?? HUMA_POOL_STATE`.
- Value-returning, strongly-typed functional narrowing via `requireHumaAddresses<K>` with compile-time non-null guarantees (`RequiredHumaAddresses<K>`).
- Automatic ATA and PDA derivations for `poolUnderlyingToken` and `humaPoolAuthority` in instruction builders.
- Complete consolidation onto a single canonical `HumaPoolAddresses` interface, eliminating `HumaStateAddresses` and `ResolvedHumaAddresses`.
- Refactoring `buildInitializeHumaLenderInstruction` and `buildWithdrawFeesInstruction` and their caller scripts (`scripts/devnet.ts`, `scripts/pb-cli.ts`).
- First-class error classification in [`app/lib/errors.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/errors.ts) by extending `ErrorCategory` and `ErrorLayer` with `"configuration"`, complete with theme styling and developer actionable steps.
- Graceful skipping in crank workers (`harvest-yield.worker.ts`, `disburse-sentinel.worker.ts`) when Huma accounts are unconfigured.
- Non-colliding test harness addresses with guaranteed uniqueness in `createMockHumaAddresses()`.
- Removal of legacy `.then()` in `app/hooks/useBondsContract.ts`.

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
    PrizePoolAcc[Authoritative On-Chain PrizePool] -->|pool.humaPoolState| Precedence[Precedence Resolver: overrides ?? poolState ?? env]
    Env[Environment .env] -->|parseOptionalAddress| SdkConstants[SDK Constants: Address | undefined]
    Overrides[Caller Overrides: Partial HumaPoolAddresses] --> Precedence
    SdkConstants --> Precedence

    Precedence -->|Canonical Bag| ResolveHuma[resolveHumaAddresses: HumaPoolAddresses]
    ResolveHuma -->|Pass to Validator| RequireFn[requireHumaAddresses: Value-Returning Narrowing]

    RequireFn -->|Validated Non-Null Bag| Validated[RequiredHumaAddresses K: Non-Null Address]
    Validated -->|Automatic Derivation| Derivations[findHumaPoolAuthorityPda + findAtaAddress poolUnderlyingToken]
    Derivations --> CodamaBuilder[Codama Instruction Builder]
    Validated --> CodamaBuilder
    CodamaBuilder -->|Exact, validated accounts| Tx[Solana Transaction]

    RequireFn -->|Missing Required Account| ConfigErr[Error: Missing required Huma account]
    ConfigErr --> ParseErr[app/lib/errors.ts: parseTransactionError]
    ParseErr -->|category: configuration| UserModal[TransactionProgressModal / Alert Card]
```

---

## Proposed Changes

### 1. Core SDK & Error Handling (`app/lib/bonds-sdk.ts`, `app/lib/errors.ts`)

#### [MODIFY] [`app/lib/bonds-sdk.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-sdk.ts)

- **Replace constant defaults with lazy `parseOptionalAddress`**:
  Update all Huma exported constants to `Address | undefined` with NO dummy string fallbacks:

  ```typescript
  export const HUMA_CONFIG: Address | undefined = parseOptionalAddress(
    process.env.HUMA_CONFIG || process.env.NEXT_PUBLIC_HUMA_CONFIG
  );
  export const HUMA_POOL_CONFIG: Address | undefined = parseOptionalAddress(
    process.env.HUMA_POOL_CONFIG || process.env.NEXT_PUBLIC_HUMA_POOL_CONFIG
  );
  export const HUMA_POOL_STATE: Address | undefined = parseOptionalAddress(
    process.env.HUMA_POOL_STATE || process.env.NEXT_PUBLIC_HUMA_POOL_STATE
  );
  export const HUMA_MODE_CONFIG: Address | undefined = parseOptionalAddress(
    process.env.HUMA_MODE_CONFIG || process.env.NEXT_PUBLIC_HUMA_MODE_CONFIG
  );
  export const HUMA_LENDER_STATE: Address | undefined = parseOptionalAddress(
    process.env.HUMA_LENDER_STATE || process.env.NEXT_PUBLIC_HUMA_LENDER_STATE
  );
  export const HUMA_POOL_UNDERLYING_TOKEN: Address | undefined =
    parseOptionalAddress(
      process.env.HUMA_POOL_UNDERLYING_TOKEN ||
        process.env.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN
    );
  export const HUMA_MODE_MINT: Address | undefined = parseOptionalAddress(
    process.env.HUMA_MODE_MINT ||
      process.env.NEXT_PUBLIC_HUMA_MODE_MINT ||
      process.env.NEXT_PUBLIC_PST_MINT ||
      process.env.PST_MINT
  );
  export const HUMA_POOL_MODE_TOKEN: Address | undefined = parseOptionalAddress(
    process.env.HUMA_POOL_MODE_TOKEN ||
      process.env.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN
  );
  export const HUMA_REDEMPTION_REQUEST: Address | undefined =
    parseOptionalAddress(
      process.env.HUMA_REDEMPTION_REQUEST ||
        process.env.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST
    );
  ```

- **Consolidate canonical `HumaPoolAddresses` interface**:
  Remove `HumaStateAddresses` and `ResolvedHumaAddresses`. Standardize all fields:

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
    redemptionRequest?: Address;
    program?: Address;
  }
  ```

- **Implement Canonical `resolveHumaAddresses`**:

  ```typescript
  export function resolveHumaAddresses(
    poolHumaPoolState?: Address | string | null,
    overrides?: Partial<HumaPoolAddresses>
  ): HumaPoolAddresses {
    return {
      poolState:
        overrides?.poolState ??
        parseOptionalAddress(poolHumaPoolState) ??
        HUMA_POOL_STATE,
      config: overrides?.config ?? HUMA_CONFIG,
      poolConfig: overrides?.poolConfig ?? HUMA_POOL_CONFIG,
      modeConfig: overrides?.modeConfig ?? HUMA_MODE_CONFIG,
      lenderState: overrides?.lenderState ?? HUMA_LENDER_STATE,
      poolUnderlyingToken:
        overrides?.poolUnderlyingToken ?? HUMA_POOL_UNDERLYING_TOKEN,
      modeMint: overrides?.modeMint ?? HUMA_MODE_MINT,
      poolModeToken: overrides?.poolModeToken ?? HUMA_POOL_MODE_TOKEN,
      redemptionRequest:
        overrides?.redemptionRequest ?? HUMA_REDEMPTION_REQUEST,
      program: overrides?.program ?? HUMA_PROGRAM_ID,
    };
  }
  ```

- **Implement Functional Narrowing `requireHumaAddresses<K>`**:

  ```typescript
  export type RequiredHumaAddresses<K extends keyof HumaPoolAddresses> =
    HumaPoolAddresses & {
      readonly [P in K]: Address;
    };

  export function requireHumaAddresses<K extends keyof HumaPoolAddresses>(
    addresses: HumaPoolAddresses,
    requiredKeys: readonly K[],
    operationContext: string
  ): RequiredHumaAddresses<K> {
    const missing: K[] = [];
    for (const key of requiredKeys) {
      const val = addresses[key];
      if (!val || !isConfiguredAccountAddress(val)) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing required Huma account address(es) for ${operationContext}: [${missing.join(", ")}]. ` +
        `Ensure they are configured in your environment or passed via 'humaAddresses'.
      );
    }
    return addresses as RequiredHumaAddresses<K>;
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

  Validate required accounts upfront:

  ```typescript
  const huma = requireHumaAddresses(
    params.humaAddresses,
    CLAIM_REDEMPTION_REQUIRED_HUMA_KEYS,
    "ClaimRedemption"
  );
  ```

  Derive `humaPoolAuthority` and `humaPoolUnderlyingToken` safely using guaranteed `huma.poolState`:

  ```typescript
  const humaPoolAuthority = await findHumaPoolAuthorityPda(huma.poolState);
  const humaPoolUnderlyingToken =
    huma.poolUnderlyingToken ??
    (await findAtaAddress(humaPoolAuthority, params.tokenMint, tokenProgram));
  ```

  Remove all fallbacks to `SYSTEM_PROGRAM_ID`.

- **Refactor `buildInitializeHumaLenderInstruction`**:

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
    const rawHuma = resolveHumaAddresses(null, params.humaAddresses);
    const huma = requireHumaAddresses(
      rawHuma,
      INITIALIZE_HUMA_LENDER_REQUIRED_KEYS,
      "InitializeHumaLender"
    );
    const humaLenderModeToken = huma.poolModeToken ?? poolPstVault;

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

- **Refactor `buildWithdrawFeesInstruction`**:

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
    const rawHuma = resolveHumaAddresses(null, params.humaAddresses);
    const huma = requireHumaAddresses(
      rawHuma,
      WITHDRAW_FEES_REQUIRED_HUMA_KEYS,
      "WithdrawFees"
    );
    const humaPoolAuthority = await findHumaPoolAuthorityPda(huma.poolState);
    const humaPoolModeToken = huma.poolModeToken ?? poolPstVault;

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

- **Delete `isConfiguredAccountAddress`**:
  Retain only for validation inside `requireHumaAddresses` and `parseOptionalAddress`. Remove all sentinel comparisons across instruction builders.

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

- **Add Early Branch in `parseTransactionError`**:
  ```typescript
  if (
    rawMsg.includes("Missing required Huma account address") ||
    rawMsg.includes("[HumaAddressError]")
  ) {
    return {
      isCancellation: false,
      layer: "configuration",
      category: "configuration",
      title: "Configuration Incomplete",
      message:
        "Protocol pool configuration is incomplete on this network. Please verify cluster settings or contact protocol support.",
      actionableStep: rawMsg,
      rawError: err,
    };
  }
  ```

---

### 2. Instruction Factory (`app/lib/bonds-instruction-factory.ts`)

#### [MODIFY] [`app/lib/bonds-instruction-factory.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/bonds-instruction-factory.ts)

- **Delete Duplicate Resolution Logic**:
  Delete `ResolvedHumaAddresses` interface and `resolveHumaAddresses()` implementation from `bonds-instruction-factory.ts`. Import canonical `resolveHumaAddresses`, `requireHumaAddresses`, and `HumaPoolAddresses` directly from `bonds-sdk.ts`.

- **Define required keys constants**:

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
    "poolModeToken",
  ] as const;

  export const CLAIM_NON_REINVESTED_REQUIRED_HUMA_KEYS = [
    "poolState",
    "config",
    "poolConfig",
    "modeConfig",
    "modeMint",
    "redemptionRequest",
    "lenderState",
    "poolModeToken",
  ] as const;
  ```

- **Per-Instruction Validation & Safe Derivations**:
  - **`buildBuyBondsInstruction`**:
    1. Validate required accounts _first_:
       ```typescript
       const rawHuma = resolveHumaAddresses(null, params.humaAddresses);
       const huma = requireHumaAddresses(
         rawHuma,
         BUY_BONDS_REQUIRED_HUMA_KEYS,
         "BuyBonds"
       );
       ```
    2. Safely derive `humaPoolAuthority`:
       ```typescript
       const humaPoolAuthority = await findHumaPoolAuthorityPda(huma.poolState);
       ```
    3. Deterministically derive `humaPoolUnderlyingToken`:
       ```typescript
       const humaPoolUnderlyingToken =
         huma.poolUnderlyingToken ??
         (await findAtaAddress(
           humaPoolAuthority,
           params.tokenMint ?? USDC_MINT,
           TOKEN_PROGRAM_ID
         ));
       ```
  - **`buildSellBondsInstruction`**:
    1. Validate required accounts with on-chain pool state precedence:
       ```typescript
       const rawHuma = resolveHumaAddresses(
         poolInfo.humaPoolState ? address(poolInfo.humaPoolState) : undefined,
         params.humaAddresses
       );
       const huma = requireHumaAddresses(
         rawHuma,
         SELL_BONDS_REQUIRED_HUMA_KEYS,
         "SellBonds"
       );
       ```
    2. Safely derive `humaPoolAuthority`:
       ```typescript
       const humaPoolAuthority = await findHumaPoolAuthorityPda(huma.poolState);
       ```
  - **`buildClaimNonReinvestedWinningsInstruction`**:
    1. Validate required accounts:
       ```typescript
       const rawHuma = resolveHumaAddresses(null, params.humaAddresses);
       const huma = requireHumaAddresses(
         rawHuma,
         CLAIM_NON_REINVESTED_REQUIRED_HUMA_KEYS,
         "ClaimNonReinvestedWinnings"
       );
       ```
    2. Safely derive `humaPoolAuthority`:
       ```typescript
       const humaPoolAuthority = await findHumaPoolAuthorityPda(huma.poolState);
       ```
  - **`buildClaimRedemptionInstructions`**:
    Pass merged `humaAddresses` resolved via `resolveHumaAddresses` into `sdkBuildClaimRedemptionInstructions` (which executes `requireHumaAddresses`).

---

### 3. Frontend Hooks (`app/hooks`)

#### [MODIFY] [`app/hooks/useBondsContract.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/hooks/useBondsContract.ts)

- Replace legacy `.then()` at lines 112–114 with standard `async/await` import:
  ```typescript
  const { findAtaAddress, USDC_MINT } = await import("../lib/bonds-sdk");
  const userAta = await findAtaAddress(userAddress, USDC_MINT);
  ```

---

### 4. Crank Workers (`services/crank`)

#### [MODIFY] [`services/crank/workers/disburse-sentinel.worker.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/services/crank/workers/disburse-sentinel.worker.ts)

- Use canonical `resolveHumaAddresses`:
  ```typescript
  const humaAddresses = resolveHumaAddresses(snapshot.pool.humaPoolState, {
    lenderState:
      context.config?.poolHumaLenderStates?.[snapshot.poolId] ??
      context.config?.humaLenderState,
    config: context.config?.humaConfig,
    poolConfig: context.config?.humaPoolConfig,
    modeConfig: context.config?.humaModeConfig,
    poolUnderlyingToken: context.config?.humaPoolUnderlyingToken,
  });
  ```
- Evaluate checks cleanly via truthiness and `isConfiguredAccountAddress`:
  ```typescript
  if (
    !humaAddresses.poolState ||
    !isConfiguredAccountAddress(humaAddresses.poolState)
  ) {
    return {
      shouldExecute: false,
      reason: `Huma pool state is not configured for Pool #${snapshot.poolId}; auto-disburse skipped`,
    };
  }
  if (
    !humaAddresses.lenderState ||
    !isConfiguredAccountAddress(humaAddresses.lenderState)
  ) {
    return {
      shouldExecute: false,
      reason: `Huma lender state is not configured for Pool #${snapshot.poolId} (HUMA_LENDER_STATE unset); auto-disburse skipped`,
    };
  }
  ```

#### [MODIFY] [`services/crank/workers/harvest-yield.worker.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/services/crank/workers/harvest-yield.worker.ts)

- Extract addresses safely without falling back to `SYSTEM_PROGRAM_ID`:

  ```typescript
  const pstMint =
    this.config?.pstMint ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_MODE_MINT) ||
    parseOptionalAddress(process.env.HUMA_MODE_MINT);

  const humaPoolState =
    parseOptionalAddress(snapshot.pool.humaPoolState) ||
    this.config?.humaPoolState ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_POOL_STATE) ||
    parseOptionalAddress(process.env.HUMA_POOL_STATE);

  if (!pstMint || !humaPoolState) {
    return {
      shouldExecute: false,
      reason: `Harvest skipped: PST mint or Huma pool state unconfigured for Pool #${snapshot.poolId}`,
    };
  }
  ```

---

### 5. CLI & Devnet Scripts (`scripts/devnet.ts`, `scripts/pb-cli.ts`)

#### [MODIFY] [`scripts/devnet.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/devnet.ts)

- Update line 903 calling `buildInitializeHumaLenderInstruction`:
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
      poolModeToken: poolPstVaultAddress,
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
  };
  ```
  Pass `humaAddresses` into `buildInitializeHumaLenderInstruction` and `buildWithdrawFeesInstruction`.

---

### 6. Test Harnesses & Unit Tests

#### [MODIFY] [`app/lib/test-harness/addresses.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/test-harness/addresses.ts)

- Define distinct, non-overlapping mock addresses for each Huma account:

  ```typescript
  export const MOCK_HUMA_ADDRESSES = {
    poolState: address("D4fBgrqd2DjjYgmTFZT2EboVbXjjaM8VZEaEHYrQ8DtM"),
    config: address("8VA7RjU8fwqdYrN4j9T1xigJaDr9wvGCuRtz4V3P9mDt"),
    poolConfig: address("GzyGmodpbkSH4BD1qHYaawkq1ndNP3nEBPGcYxvVJgZq"),
    modeConfig: address("J9SJBMYruro9LwED8y54egBz1vuivG89sNSjb3FhS9Zy"),
    lenderState: address("mmb7zaCqYWJPr1z8BBfJAdnKLedAAwSYpc11LWqZWHC"),
    poolUnderlyingToken: address("C8bpcC3E5LQxsgzsKwDADpXpYPS8qy4bpZGdKMBAAXq"),
    modeMint: address("5R2YdvMLdpq59PKDBLF1mQARqfe2hkdraqSLtaKeg72F"),
    poolModeToken: address("6We37vc76UiQ91rfDxSUhFUmgbMbkwLT8NEpTYNN3RX"),
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
  Set `humaPoolState: MOCK_HUMA_ADDRESSES.poolState` instead of `MOCK_PUBKEY` (`TEST_ADDRESSES.USER` / `"11111111111111111111111111111111"`).

#### [MODIFY] [`app/lib/__tests__/bonds-instruction-factory.test.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/app/lib/__tests__/bonds-instruction-factory.test.ts)

- Update tests to supply `humaAddresses: createMockHumaAddresses()`.
- Add negative tests asserting:
  - Omitting each required key throws an actionable error naming the missing key.
  - Passing `"11111111111111111111111111111111"` is rejected by `requireHumaAddresses`.
  - Automatic ATA derivation for `poolUnderlyingToken` succeeds and matches `findAtaAddress(humaPoolAuthority, tokenMint)`.

#### [MODIFY] [`services/crank/__tests__/workers.test.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/services/crank/__tests__/workers.test.ts)

- Update `createMockContext` to supply valid, non-colliding mock addresses.
- Verify `HarvestYieldWorker` and `DisburseSentinelWorker` skip gracefully when `humaPoolState` or `lenderState` is missing.

#### [MODIFY] [`scripts/error-mapping.test.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/error-mapping.test.ts)

- Add unit test verifying that `parseTransactionError` maps missing Huma configuration errors to:
  - `category: "configuration"`
  - `layer: "configuration"`
  - `title: "Configuration Incomplete"`
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

- Verify that module import of `app/lib/bonds-sdk.ts` in an environment without `.env.local` does NOT throw unhandled exceptions.
- Verify that missing Huma configuration errors clearly specify the missing account name, operation context, and user-facing explanation in UI logs.
