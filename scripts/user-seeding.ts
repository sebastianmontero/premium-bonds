import "./load-env";
import {
  createSolanaRpc,
  address,
  Address,
  KeyPairSigner,
  Instruction,
  createKeyPairSignerFromBytes,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import {
  sendTx,
  loadKeypair,
  generateKeypairBytes,
  checkRpcHealth,
  createResilientRpc,
  resolveDevnetRpcUrl,
  resolveDefaultKeypairPath,
  parseTokenAmount,
  buildTransferSolInstruction,
  buildMintToInstruction,
  fetchAccountData,
  printErrorDetails,
  MIN_ADMIN_RESERVE_LAMPORTS,
  USDC_DECIMALS,
  SOL_DECIMALS,
  SYSTEM_PROGRAM_ID,
} from "./utils";
import {
  readDevnetAddresses,
  checkActiveEnvIsLocalnet,
  DEVNET_USERS_PATH,
} from "./devnet-state";
import {
  findPrizePoolPda,
  findAtaAddress,
  createAssociatedTokenIdempotentInstruction,
  createSetComputeUnitLimitInstruction,
  buildHarvestYieldAndCommitInstruction,
  parsePrizePool,
  USDC_MINT,
  HUMA_POOL_STATE,
  type HumaPoolAddresses,
} from "../app/lib/bonds-sdk";
import { buildBuyBondsInstruction } from "../app/lib/bonds-instruction-factory";

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_TICKETS_PER_USER = 100;
export const DEFAULT_SOL_PER_USER_LAMPORTS = 50_000_000n; // 0.05 SOL
export const USER_WINNINGS_RENT_LAMPORTS = 2_000_000n; // ~0.002 SOL required for user_winnings init
export const MICRO_USDC_PER_TICKET = 1_000_000n; // 1 USDC per ticket
export const SEEDING_ATOMIC_CU_LIMIT = 400_000;
export const ESTIMATED_ATA_RENT_LAMPORTS = 2_039_280n;
export const ESTIMATED_TX_FEE_LAMPORTS = 10_000n;
export const DEFAULT_SAVE_KEYS_PATH = DEVNET_USERS_PATH;

// ─── Types & Interfaces ──────────────────────────────────────────────────────

export type SeedUserStage =
  | "generating_keypair"
  | "funding"
  | "buying_bonds"
  | "user_completed"
  | "maturing_tickets"
  | "all_completed";

export interface SeedUserProgressEvent {
  readonly current: number; // 1-indexed
  readonly total: number;
  readonly stage: SeedUserStage;
  readonly userAddress?: Address;
  readonly userSecretKeyBytes?: Uint8Array;
  readonly ticketsBought?: number;
  readonly txSignature?: string;
}

export interface SeedingProtocolAccounts {
  readonly usdcMint: Address;
  readonly ticketRegistry: Address;
  readonly humaAddresses: HumaPoolAddresses;
  readonly pstMint?: Address;
  readonly randomnessAccount?: Address;
}

export interface FundInstructionsParams {
  readonly payer: KeyPairSigner;
  readonly recipient: Address;
  readonly mintAuthority?: KeyPairSigner;
  readonly usdcMint: Address;
  readonly microUsdcAmount: bigint;
  readonly transferSolLamports?: bigint;
}

export interface FundInstructionsResult {
  readonly recipientAta: Address;
  readonly instructions: readonly Instruction[];
  readonly signers: readonly [KeyPairSigner, ...KeyPairSigner[]];
}

export interface SeedUserOptions {
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly adminSigner: KeyPairSigner;
  readonly poolId?: number; // default: 1
  readonly userSigner?: KeyPairSigner; // generated if omitted
  readonly userSecretKeyBytes?: Uint8Array; // optional 64-byte array if provided with userSigner
  readonly tickets?: number; // default: 100 (0 for funding-only)
  readonly solLamports?: bigint; // default: 50_000_000n (0.05 SOL)
  readonly usdcAmount?: bigint; // default: BigInt(tickets) * MICRO_USDC_PER_TICKET
  readonly atomic?: boolean; // default: true if tickets > 0
  readonly accounts?: Partial<SeedingProtocolAccounts>;
}

export interface BaseSeededUser {
  readonly userSigner: KeyPairSigner;
  readonly userSecretKeyBytes?: Uint8Array;
  readonly userAddress: Address;
  readonly userUsdcAta: Address;
  readonly ticketsBought: number;
}

export type SeededUser = BaseSeededUser &
  (
    | {
        readonly mode: "atomic";
        readonly txSignature: string;
      }
    | {
        readonly mode: "decoupled";
        readonly fundTxSignature: string;
        readonly buyTxSignature?: string;
      }
  );

export interface SeedUsersOptions {
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly adminSigner: KeyPairSigner;
  readonly count: number;
  readonly poolId?: number; // default: 1
  readonly userSigners?: readonly KeyPairSigner[];
  readonly tickets?: number; // default: 100
  readonly solLamports?: bigint; // default: 50_000_000n
  readonly usdcAmount?: bigint; // default: BigInt(tickets) * MICRO_USDC_PER_TICKET
  readonly atomic?: boolean; // default: true
  readonly matureTickets?: boolean; // default: false
  readonly accounts?: Partial<SeedingProtocolAccounts>;
  readonly onProgress?: (event: SeedUserProgressEvent) => void;
}

export interface SeedUsersResult {
  readonly users: readonly SeededUser[];
  readonly totalTicketsBought: number;
  readonly matureTxSignature?: string;
}

export interface MatureTicketsOptions {
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly adminSigner: KeyPairSigner;
  readonly poolId?: number; // default: 1
  readonly accounts?: Partial<SeedingProtocolAccounts>;
}

export interface SeedUsersCliOptions {
  readonly count: number;
  readonly tickets: number;
  readonly solLamports: bigint;
  readonly usdcAmount?: bigint;
  readonly poolId: number;
  readonly atomic: boolean;
  readonly mature: boolean;
  readonly rpcUrl: string;
  readonly keypairPath?: string;
  readonly saveKeysPath?: string;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Reads cluster timestamp from Solana RPC slot/blockTime with fallback to local clock.
 */
export async function getClusterTimestamp(
  rpc: ReturnType<typeof createSolanaRpc>
): Promise<bigint> {
  try {
    const slot = await rpc.getSlot().send();
    const blockTime = await rpc.getBlockTime(slot).send();
    if (blockTime !== null && blockTime !== undefined) {
      return BigInt(blockTime);
    }
  } catch {
    // Fallback to local clock
  }
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * Builds instructions for idempotently creating recipient ATA, optional native SOL transfer, and minting mock USDC tokens.
 */
export async function buildFundInstructions(
  params: FundInstructionsParams
): Promise<FundInstructionsResult> {
  const mintAuthority = params.mintAuthority ?? params.payer;
  const recipientAta = await findAtaAddress(params.recipient, params.usdcMint);

  const instructions: Instruction[] = [];

  if (params.transferSolLamports && params.transferSolLamports > 0n) {
    instructions.push(
      buildTransferSolInstruction({
        from: params.payer,
        to: params.recipient,
        lamports: params.transferSolLamports,
      })
    );
  }

  const recipientAtaIx = createAssociatedTokenIdempotentInstruction({
    payer: params.payer,
    owner: params.recipient,
    mint: params.usdcMint,
    ata: recipientAta,
  });
  instructions.push(recipientAtaIx);

  if (params.microUsdcAmount > 0n) {
    const mintToIx = buildMintToInstruction({
      mint: params.usdcMint,
      destination: recipientAta,
      authority: mintAuthority,
      amount: params.microUsdcAmount,
    });
    instructions.push(mintToIx);
  }

  const signers: readonly [KeyPairSigner, ...KeyPairSigner[]] =
    params.payer.address === mintAuthority.address
      ? [params.payer]
      : [params.payer, mintAuthority];

  return {
    recipientAta,
    instructions,
    signers,
  };
}

/**
 * Estimates the minimum required admin balance in lamports to seed users and pay fees.
 * Enforces rent guardrails for fresh wallets purchasing tickets.
 */
export function estimateSeedingCostLamports(params: {
  count: number;
  solLamports: bigint;
  tickets?: number;
  atomic?: boolean;
}): bigint {
  const tickets =
    params.tickets !== undefined ? params.tickets : DEFAULT_TICKETS_PER_USER;

  if (tickets > 0 && params.solLamports < USER_WINNINGS_RENT_LAMPORTS) {
    throw new Error(
      `Fresh users purchasing tickets must receive at least ${USER_WINNINGS_RENT_LAMPORTS} lamports (${Number(USER_WINNINGS_RENT_LAMPORTS) / 1e9} SOL) to cover on-chain user_winnings initialization rent debit. Provided: ${params.solLamports} lamports.`
    );
  }

  const txFee =
    params.atomic !== false
      ? ESTIMATED_TX_FEE_LAMPORTS
      : 2n * ESTIMATED_TX_FEE_LAMPORTS;
  const perUserLamports =
    params.solLamports + ESTIMATED_ATA_RENT_LAMPORTS + txFee;
  const totalCost =
    BigInt(params.count) * perUserLamports + MIN_ADMIN_RESERVE_LAMPORTS;
  return totalCost;
}

/**
 * Dynamically resolves protocol accounts from on-chain Prize Pool PDA, local state, or explicit overrides.
 */
export async function resolveSeedingAccounts(
  rpc: ReturnType<typeof createSolanaRpc>,
  poolId: number = 1,
  overrides?: Partial<SeedingProtocolAccounts>
): Promise<SeedingProtocolAccounts> {
  const devnetAddrs = readDevnetAddresses() ?? {};
  let onChainPool: {
    tokenMint?: Address;
    ticketRegistry?: Address;
    humaPoolState?: Address;
  } = {};

  try {
    const poolPda = await findPrizePoolPda(poolId);
    const poolData = await fetchAccountData(rpc, poolPda);
    if (poolData) {
      const parsed = parsePrizePool(poolData);
      onChainPool = {
        tokenMint: address(parsed.tokenMint),
        ticketRegistry: address(parsed.ticketRegistry),
        humaPoolState: address(parsed.humaPoolState),
      };
    }
  } catch {
    // If on-chain fetch fails, fall back to devnetAddrs and defaults
  }

  const usdcMint =
    overrides?.usdcMint ??
    onChainPool.tokenMint ??
    (devnetAddrs.usdcMint ? address(devnetAddrs.usdcMint) : undefined) ??
    USDC_MINT;

  const ticketRegistry =
    overrides?.ticketRegistry ??
    onChainPool.ticketRegistry ??
    (devnetAddrs.ticketRegistry
      ? address(devnetAddrs.ticketRegistry)
      : undefined);

  const humaPoolState =
    overrides?.humaAddresses?.poolState ??
    onChainPool.humaPoolState ??
    (devnetAddrs.humaPoolState
      ? address(devnetAddrs.humaPoolState)
      : undefined) ??
    HUMA_POOL_STATE;

  const pstMint =
    overrides?.pstMint ??
    overrides?.humaAddresses?.modeMint ??
    (devnetAddrs.pstMint ? address(devnetAddrs.pstMint) : undefined);

  const randomnessAccount =
    overrides?.randomnessAccount ??
    (devnetAddrs.randomnessAccount
      ? address(devnetAddrs.randomnessAccount)
      : undefined);

  if (!ticketRegistry) {
    throw new Error(
      `Could not resolve ticketRegistry address for pool ${poolId}. Ensure pool is initialized or provide it in accounts.`
    );
  }

  const humaAddresses: HumaPoolAddresses = {
    poolState: address(humaPoolState),
    lenderState:
      overrides?.humaAddresses?.lenderState ??
      (devnetAddrs.humaLenderState
        ? address(devnetAddrs.humaLenderState)
        : undefined),
    poolUnderlyingToken:
      overrides?.humaAddresses?.poolUnderlyingToken ??
      (devnetAddrs.humaPoolUnderlying
        ? address(devnetAddrs.humaPoolUnderlying)
        : undefined),
    modeMint: pstMint ? address(pstMint) : undefined,
    poolModeToken:
      overrides?.humaAddresses?.poolModeToken ??
      (devnetAddrs.humaPoolModeToken
        ? address(devnetAddrs.humaPoolModeToken)
        : undefined),
    redemptionRequest:
      overrides?.humaAddresses?.redemptionRequest ??
      (devnetAddrs.humaRedemptionRequest
        ? address(devnetAddrs.humaRedemptionRequest)
        : undefined),
  };

  return {
    usdcMint: address(usdcMint),
    ticketRegistry: address(ticketRegistry),
    humaAddresses,
    pstMint: pstMint ? address(pstMint) : undefined,
    randomnessAccount: randomnessAccount
      ? address(randomnessAccount)
      : undefined,
  };
}

/**
 * Appends a generated test user keypair securely to a JSON array file (mode 0o600).
 */
export function appendKeypairToFile(
  filePath: string,
  keyEntry: { address: string; secretKey: number[]; ticketsBought: number }
): void {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  let existing: Array<{
    address: string;
    secretKey: number[];
    ticketsBought: number;
  }> = [];

  if (fs.existsSync(resolvedPath)) {
    try {
      const content = fs.readFileSync(resolvedPath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        existing = parsed;
      }
    } catch {
      existing = [];
    }
  }

  existing.push(keyEntry);

  const tempPath = `${resolvedPath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(existing, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(tempPath, resolvedPath);
  try {
    fs.chmodSync(resolvedPath, 0o600);
  } catch {
    // Ignore chmod errors on systems that don't support it
  }
}

/**
 * Provisions, funds, and optionally buys bonds for a single test user.
 */
export async function seedUser(options: SeedUserOptions): Promise<SeededUser> {
  const poolId = options.poolId ?? 1;
  const tickets =
    options.tickets !== undefined ? options.tickets : DEFAULT_TICKETS_PER_USER;
  const solLamports =
    options.solLamports !== undefined
      ? options.solLamports
      : DEFAULT_SOL_PER_USER_LAMPORTS;
  const usdcAmount =
    options.usdcAmount !== undefined
      ? options.usdcAmount
      : BigInt(tickets) * MICRO_USDC_PER_TICKET;
  const atomic = options.atomic !== undefined ? options.atomic : true;

  if (tickets > 0 && solLamports < USER_WINNINGS_RENT_LAMPORTS) {
    throw new Error(
      `Fresh users purchasing tickets must receive at least ${USER_WINNINGS_RENT_LAMPORTS} lamports (${Number(USER_WINNINGS_RENT_LAMPORTS) / 1e9} SOL) to cover on-chain user_winnings initialization rent debit. Provided: ${solLamports} lamports.`
    );
  }

  let userSigner = options.userSigner;
  let userSecretKeyBytes = options.userSecretKeyBytes;
  if (!userSigner) {
    const rawBytes = generateKeypairBytes();
    userSecretKeyBytes = rawBytes;
    userSigner = await createKeyPairSignerFromBytes(rawBytes);
  }

  const accounts = await resolveSeedingAccounts(
    options.rpc,
    poolId,
    options.accounts
  );
  const userUsdcAta = await findAtaAddress(
    userSigner.address,
    accounts.usdcMint
  );

  if (atomic && tickets > 0) {
    // 1-Tx Atomic Execution Mode
    const instructions: Instruction[] = [
      createSetComputeUnitLimitInstruction(SEEDING_ATOMIC_CU_LIMIT),
    ];

    if (solLamports > 0n) {
      instructions.push(
        buildTransferSolInstruction({
          from: options.adminSigner,
          to: userSigner.address,
          lamports: solLamports,
        })
      );
    }

    const createAtaIx = createAssociatedTokenIdempotentInstruction({
      payer: options.adminSigner.address,
      owner: userSigner.address,
      mint: accounts.usdcMint,
      ata: userUsdcAta,
    });
    instructions.push(createAtaIx);

    if (usdcAmount > 0n) {
      const mintIx = buildMintToInstruction({
        mint: accounts.usdcMint,
        destination: userUsdcAta,
        authority: options.adminSigner,
        amount: usdcAmount,
      });
      instructions.push(mintIx);
    }

    const buyIx = await buildBuyBondsInstruction({
      poolId,
      userAddress: userSigner.address,
      ticketsToBuy: tickets,
      ticketRegistry: accounts.ticketRegistry,
      userTokenAccount: userUsdcAta,
      tokenMint: accounts.usdcMint,
      humaAddresses: accounts.humaAddresses,
    });
    instructions.push(buyIx);

    // Admin is fee payer and user signs the bond purchase
    const txSignature = await sendTx(options.rpc, instructions, [
      options.adminSigner,
      userSigner,
    ]);

    return {
      userSigner,
      userSecretKeyBytes,
      userAddress: userSigner.address,
      userUsdcAta,
      ticketsBought: tickets,
      mode: "atomic",
      txSignature,
    };
  }

  // Decoupled Mode (or funding-only if tickets === 0)
  const fundResult = await buildFundInstructions({
    payer: options.adminSigner,
    recipient: userSigner.address,
    usdcMint: accounts.usdcMint,
    microUsdcAmount: usdcAmount,
    transferSolLamports: solLamports,
  });

  const fundTxSignature = await sendTx(
    options.rpc,
    fundResult.instructions,
    fundResult.signers
  );

  let buyTxSignature: string | undefined;
  if (tickets > 0) {
    const buyIx = await buildBuyBondsInstruction({
      poolId,
      userAddress: userSigner.address,
      ticketsToBuy: tickets,
      ticketRegistry: accounts.ticketRegistry,
      userTokenAccount: userUsdcAta,
      tokenMint: accounts.usdcMint,
      humaAddresses: accounts.humaAddresses,
    });
    buyTxSignature = await sendTx(options.rpc, buyIx, [userSigner]);
  }

  return {
    userSigner,
    userSecretKeyBytes,
    userAddress: userSigner.address,
    userUsdcAta,
    ticketsBought: tickets,
    mode: "decoupled",
    fundTxSignature,
    buyTxSignature,
  };
}

/**
 * Advances the pool draw cycle with 0 simulated yield so pending tickets mature into active tickets.
 */
export async function advanceCycleToMatureTickets(
  options: MatureTicketsOptions
): Promise<string> {
  const poolId = options.poolId ?? 1;
  const poolPda = await findPrizePoolPda(poolId);
  const poolData = await fetchAccountData(options.rpc, poolPda);

  if (!poolData) {
    throw new Error(
      `Cannot mature tickets: Prize Pool #${poolId} account not found at ${poolPda}.`
    );
  }

  const parsedPool = parsePrizePool(poolData);

  if (parsedPool.isFrozenForDraw) {
    throw new Error(
      `Cannot mature tickets: Prize Pool #${poolId} is frozen for draw.`
    );
  }

  if (parsedPool.status !== "Active") {
    throw new Error(
      `Cannot mature tickets: Prize Pool #${poolId} is not active (status: ${parsedPool.status}).`
    );
  }

  const clusterTime = await getClusterTimestamp(options.rpc);
  if (clusterTime < BigInt(parsedPool.currentCycleEndAt)) {
    const remainingSecs = Number(
      BigInt(parsedPool.currentCycleEndAt) - clusterTime
    );
    throw new Error(
      `Cannot mature tickets: Draw cycle #${parsedPool.currentDrawCycleId} has not reached its end time yet. Remaining duration: ${remainingSecs} seconds (Cycle End: ${new Date(
        parsedPool.currentCycleEndAt * 1000
      ).toISOString()}).`
    );
  }

  const accounts = await resolveSeedingAccounts(
    options.rpc,
    poolId,
    options.accounts
  );

  const pstMint = accounts.pstMint ?? accounts.humaAddresses.modeMint;

  if (!pstMint) {
    throw new Error(
      `Cannot mature tickets: pstMint address is missing for pool #${poolId}.`
    );
  }

  if (
    !accounts.randomnessAccount ||
    accounts.randomnessAccount === options.adminSigner.address ||
    accounts.randomnessAccount === parsedPool.feeWallet ||
    accounts.randomnessAccount === SYSTEM_PROGRAM_ID
  ) {
    throw new Error(
      "InvalidRandomnessAccount: Valid Switchboard randomness account is required to advance cycle."
    );
  }

  const advanceIx = await buildHarvestYieldAndCommitInstruction({
    crank: options.adminSigner.address,
    poolId,
    ticketRegistry: accounts.ticketRegistry,
    currentDrawCycleId: parsedPool.currentDrawCycleId,
    pstMint,
    humaPoolState: accounts.humaAddresses.poolState,
    randomnessAccount: accounts.randomnessAccount,
  });

  const txSignature = await sendTx(options.rpc, advanceIx, options.adminSigner);
  return txSignature;
}

/**
 * Seeds multiple test users sequentially, tracking typed progress events.
 */
export async function seedUsers(
  options: SeedUsersOptions
): Promise<SeedUsersResult> {
  if (options.count < 1) {
    throw new Error(
      `Invalid user count: ${options.count}. Must seed at least 1 user.`
    );
  }

  const poolId = options.poolId ?? 1;
  const tickets =
    options.tickets !== undefined ? options.tickets : DEFAULT_TICKETS_PER_USER;
  const solLamports =
    options.solLamports !== undefined
      ? options.solLamports
      : DEFAULT_SOL_PER_USER_LAMPORTS;
  const usdcAmount =
    options.usdcAmount !== undefined
      ? options.usdcAmount
      : BigInt(tickets) * MICRO_USDC_PER_TICKET;
  const atomic = options.atomic !== undefined ? options.atomic : true;

  // Pre-flight check admin fee payer SOL balance
  const estimatedCost = estimateSeedingCostLamports({
    count: options.count,
    solLamports,
    tickets,
    atomic,
  });

  const adminBalRes = await options.rpc
    .getBalance(options.adminSigner.address)
    .send();
  const adminBalance = adminBalRes.value;

  if (adminBalance < estimatedCost) {
    throw new Error(
      `Admin fee payer (${options.adminSigner.address}) has insufficient SOL balance (${Number(adminBalance) / 1e9} SOL).\n` +
        `Required minimum balance: ${Number(estimatedCost) / 1e9} SOL for seeding ${options.count} users.\n` +
        `Please fund it: solana airdrop 2 ${options.adminSigner.address}`
    );
  }

  const resolvedAccounts = await resolveSeedingAccounts(
    options.rpc,
    poolId,
    options.accounts
  );

  const seededUsers: SeededUser[] = [];
  let totalTicketsBought = 0;

  for (let i = 0; i < options.count; i++) {
    const current = i + 1;
    let userSigner = options.userSigners?.[i];
    let userSecretKeyBytes: Uint8Array | undefined;

    if (!userSigner) {
      options.onProgress?.({
        current,
        total: options.count,
        stage: "generating_keypair",
      });
      userSecretKeyBytes = generateKeypairBytes();
      userSigner = await createKeyPairSignerFromBytes(userSecretKeyBytes);
    }

    options.onProgress?.({
      current,
      total: options.count,
      stage: "funding",
      userAddress: userSigner.address,
    });

    const userResult = await seedUser({
      rpc: options.rpc,
      adminSigner: options.adminSigner,
      poolId,
      userSigner,
      userSecretKeyBytes,
      tickets,
      solLamports,
      usdcAmount,
      atomic,
      accounts: resolvedAccounts,
    });

    seededUsers.push(userResult);
    totalTicketsBought += userResult.ticketsBought;

    options.onProgress?.({
      current,
      total: options.count,
      stage: "user_completed",
      userAddress: userResult.userAddress,
      userSecretKeyBytes: userResult.userSecretKeyBytes,
      ticketsBought: userResult.ticketsBought,
      txSignature:
        userResult.mode === "atomic"
          ? userResult.txSignature
          : (userResult.buyTxSignature ?? userResult.fundTxSignature),
    });
  }

  let matureTxSignature: string | undefined;
  if (options.matureTickets) {
    options.onProgress?.({
      current: options.count,
      total: options.count,
      stage: "maturing_tickets",
    });

    matureTxSignature = await advanceCycleToMatureTickets({
      rpc: options.rpc,
      adminSigner: options.adminSigner,
      poolId,
      accounts: resolvedAccounts,
    });
  }

  options.onProgress?.({
    current: options.count,
    total: options.count,
    stage: "all_completed",
  });

  return {
    users: seededUsers,
    totalTicketsBought,
    matureTxSignature,
  };
}

// ─── CLI Argument Parsing & Runner ──────────────────────────────────────────

export function parseSeedUsersCliArgs(args: string[]): SeedUsersCliOptions {
  let count = 1;
  let tickets = DEFAULT_TICKETS_PER_USER;
  let solLamports = DEFAULT_SOL_PER_USER_LAMPORTS;
  let usdcAmount: bigint | undefined;
  let poolId = 1;
  let atomic = true;
  let mature = false;
  let rpcUrl = resolveDevnetRpcUrl();
  let keypairPath: string | undefined;
  let saveKeysPath: string | undefined = DEFAULT_SAVE_KEYS_PATH;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--save-keys=")) {
      const val = arg.slice("--save-keys=".length).trim();
      saveKeysPath =
        val === "false" || val === "none" || val === "off" || val === ""
          ? undefined
          : val;
      continue;
    }
    switch (arg) {
      case "--users":
      case "-u":
      case "--count":
      case "-n": {
        const val = parseInt(args[++i], 10);
        if (isNaN(val) || val <= 0) {
          throw new Error(
            `Invalid --users count: "${args[i]}". Must be an integer >= 1.`
          );
        }
        count = val;
        break;
      }
      case "--tickets":
      case "-t": {
        const val = parseInt(args[++i], 10);
        if (isNaN(val) || val < 0) {
          throw new Error(
            `Invalid --tickets count: "${args[i]}". Must be an integer >= 0.`
          );
        }
        tickets = val;
        break;
      }
      case "--sol":
      case "-s": {
        const valStr = args[++i];
        if (!valStr || isNaN(Number(valStr)) || Number(valStr) < 0) {
          throw new Error(
            `Invalid --sol amount: "${valStr}". Must be a non-negative number.`
          );
        }
        solLamports =
          Number(valStr) === 0 ? 0n : parseTokenAmount(valStr, SOL_DECIMALS);
        break;
      }
      case "--usdc": {
        const valStr = args[++i];
        if (!valStr || isNaN(Number(valStr)) || Number(valStr) < 0) {
          throw new Error(
            `Invalid --usdc amount: "${valStr}". Must be a non-negative number.`
          );
        }
        usdcAmount =
          Number(valStr) === 0 ? 0n : parseTokenAmount(valStr, USDC_DECIMALS);
        break;
      }
      case "--pool":
      case "-p": {
        const val = parseInt(args[++i], 10);
        if (isNaN(val) || val <= 0) {
          throw new Error(
            `Invalid --pool ID: "${args[i]}". Must be an integer >= 1.`
          );
        }
        poolId = val;
        break;
      }
      case "--mature":
      case "-m": {
        mature = true;
        break;
      }
      case "--no-atomic": {
        atomic = false;
        break;
      }
      case "--rpc": {
        rpcUrl = args[++i];
        break;
      }
      case "--admin-key":
      case "--keypair":
      case "-k": {
        keypairPath = args[++i];
        break;
      }
      case "--save-keys": {
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          i++;
          saveKeysPath =
            nextArg === "false" || nextArg === "none" || nextArg === "off"
              ? undefined
              : nextArg;
        } else {
          saveKeysPath = DEFAULT_SAVE_KEYS_PATH;
        }
        break;
      }
      case "--no-save-keys":
      case "--disable-save-keys": {
        saveKeysPath = undefined;
        break;
      }
      case "--help":
      case "-h": {
        printSeedUsersUsage();
        process.exit(0);
      }
      default: {
        if (arg.startsWith("-")) {
          throw new Error(
            `Unknown option: "${arg}". Use --help to view available flags.`
          );
        }
      }
    }
  }

  if (tickets > 0 && solLamports < USER_WINNINGS_RENT_LAMPORTS) {
    throw new Error(
      `Fresh users purchasing tickets must receive at least ${USER_WINNINGS_RENT_LAMPORTS} lamports (${Number(USER_WINNINGS_RENT_LAMPORTS) / 1e9} SOL) to cover on-chain user_winnings initialization rent debit. Provided: ${solLamports} lamports.`
    );
  }

  return {
    count,
    tickets,
    solLamports,
    usdcAmount,
    poolId,
    atomic,
    mature,
    rpcUrl,
    keypairPath,
    saveKeysPath,
  };
}

export function printSeedUsersUsage(): void {
  console.log("Usage: npm run devnet seed-users [options]");
  console.log("   or: tsx scripts/user-seeding.ts [options]");
  console.log("\nOptions:");
  console.log(
    "  --users, -u <n>        Number of test users to generate and seed (default: 1)"
  );
  console.log(
    "  --tickets, -t <n>      Tickets to buy per user (default: 100, set 0 for funding-only)"
  );
  console.log(
    "  --sol, -s <amount>     Native SOL to airdrop per user (default: 0.05 SOL, min: 0.002 SOL)"
  );
  console.log(
    "  --usdc <amount>        Custom USDC amount to mint per user (default: 1 USDC per ticket)"
  );
  console.log("  --pool, -p <id>        Prize pool ID (default: 1)");
  console.log(
    "  --mature, -m           Advance draw cycle to mature pending tickets into active tickets"
  );
  console.log(
    "  --no-atomic            Execute decoupled multi-tx flow instead of 1-tx atomic bundle"
  );
  console.log(
    "  --save-keys [path]     Save generated keypairs to a JSON file (default: scripts/devnet-state/users.json, mode 0o600)"
  );
  console.log(
    "  --no-save-keys         Disable saving generated keypairs to disk"
  );
  console.log(
    "  --admin-key, -k <path> Path to admin fee payer keypair (default: ~/.config/solana/id.json)"
  );
  console.log("  --rpc <url>            Solana RPC endpoint URL");
  console.log("  --help, -h             Display this help message");
}

export async function runSeedUsersCli(args: string[]): Promise<void> {
  const opts = parseSeedUsersCliArgs(args);

  const envCheck = checkActiveEnvIsLocalnet();
  if (envCheck.isLocalnet) {
    console.warn(
      "\n⚠️  [ENVIRONMENT WARNING] .env.local is configured for LOCALNET"
    );
    if (envCheck.reason) {
      console.warn(`    Reason: ${envCheck.reason}`);
    }
    console.warn(
      "    You are running a Devnet command against localnet environment variables."
    );
    console.warn(
      "    To synchronize .env.local with Devnet protocol addresses, run:"
    );
    console.warn("      npm run devnet sync-env\n");
  }

  console.log("\n=======================================================");
  console.log("            PREMIUM BONDS: USER SEEDING CLI            ");
  console.log("=======================================================");
  console.log(`Users to Seed:    ${opts.count}`);
  console.log(`Tickets per User: ${opts.tickets} (${opts.tickets} USDC)`);
  console.log(`SOL per User:     ${Number(opts.solLamports) / 1e9} SOL`);
  console.log(`Pool ID:          #${opts.poolId}`);
  console.log(
    `Mode:             ${opts.atomic ? "1-Tx Atomic Batch" : "Decoupled 2-Tx"}`
  );
  console.log(
    `Mature Tickets:   ${opts.mature ? "Yes (harvest & commit)" : "No"}`
  );
  console.log(`RPC Endpoint:     ${opts.rpcUrl}`);
  if (opts.saveKeysPath) {
    console.log(`Save Keys Path:   ${opts.saveKeysPath}`);
  }
  console.log("=======================================================\n");

  const isHealthy = await checkRpcHealth(opts.rpcUrl);
  if (!isHealthy) {
    throw new Error(`RPC node at ${opts.rpcUrl} failed health check.`);
  }

  const keypairPath = resolveDefaultKeypairPath(opts.keypairPath);
  const adminSigner = await loadKeypair(keypairPath);
  const rpc = createResilientRpc(opts.rpcUrl);

  let keysWrittenCount = 0;

  const result = await seedUsers({
    rpc,
    adminSigner,
    count: opts.count,
    poolId: opts.poolId,
    tickets: opts.tickets,
    solLamports: opts.solLamports,
    usdcAmount: opts.usdcAmount,
    atomic: opts.atomic,
    matureTickets: opts.mature,
    onProgress: (event) => {
      switch (event.stage) {
        case "generating_keypair":
          console.log(
            `\n[${event.current}/${event.total}] Generating test keypair...`
          );
          break;
        case "funding":
          console.log(
            `[${event.current}/${event.total}] Provisioning & funding wallet ${event.userAddress}...`
          );
          break;
        case "user_completed": {
          console.log(
            `  ✓ [${event.current}/${event.total}] User ${event.userAddress} seeded! ` +
              `(Tickets: ${event.ticketsBought}, Tx: ${event.txSignature})`
          );
          if (
            opts.saveKeysPath &&
            event.userSecretKeyBytes &&
            event.userAddress
          ) {
            appendKeypairToFile(opts.saveKeysPath, {
              address: event.userAddress,
              secretKey: Array.from(event.userSecretKeyBytes),
              ticketsBought: event.ticketsBought ?? 0,
            });
            keysWrittenCount++;
          }
          break;
        }
        case "maturing_tickets":
          console.log(
            "\n[Maturation] Advancing zero-yield cycle to mature pending tickets..."
          );
          break;
        case "all_completed":
          console.log(
            "\n✓ All user seeding operations completed successfully!"
          );
          break;
      }
    },
  });

  if (opts.saveKeysPath && keysWrittenCount > 0) {
    console.log(`\n✓ Generated keypairs written to: ${opts.saveKeysPath}`);
  }

  // Summary Table
  console.log("\n=======================================================");
  console.log("             USER SEEDING COMPLETE SUMMARY             ");
  console.log("=======================================================");
  console.log(`Total Users Seeded:     ${result.users.length}`);
  console.log(`Total Tickets Bought:   ${result.totalTicketsBought}`);
  console.log(
    `Execution Mode:         ${opts.atomic ? "1-Tx Atomic" : "Decoupled 2-Tx"}`
  );
  console.log(`Pool ID:                #${opts.poolId}`);
  console.log(
    `Matured Tickets:        ${
      result.matureTxSignature
        ? "Yes (Tx: " + result.matureTxSignature + ")"
        : "No"
    }`
  );
  console.log(
    "--------------------------------------------------------------------------------------------------"
  );
  console.log(
    "#   | User Wallet Address                          | USDC ATA Address                             | Tickets"
  );
  console.log(
    "----|----------------------------------------------|----------------------------------------------|--------"
  );
  result.users.forEach((u, i) => {
    console.log(
      `${String(i + 1).padStart(3)} | ${u.userAddress.padEnd(44)} | ${u.userUsdcAta.padEnd(44)} | ${String(u.ticketsBought).padStart(7)}`
    );
  });
  console.log(
    "==================================================================================================\n"
  );
}

if (require.main === module) {
  runSeedUsersCli(process.argv.slice(2)).catch((err) => {
    printErrorDetails(err, "User Seeding CLI");
    process.exit(1);
  });
}
