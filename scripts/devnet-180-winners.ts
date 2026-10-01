import "./load-env";
import {
  createSolanaRpc,
  address,
  Address,
  AccountRole,
  KeyPairSigner,
  Instruction,
  generateKeyPairSigner,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import {
  checkRpcHealth,
  loadKeypair,
  sendTx,
  createResilientRpc,
  resolveDevnetRpcUrl,
  resolveDefaultKeypairPath,
  buildMintToInstruction,
  buildTransferSolInstruction,
  fetchAccountInfo,
  USDC_DECIMALS,
  printErrorDetails,
} from "./utils";
import {
  readDevnetAddresses,
  DevnetProtocolAccounts,
  assertActiveEnvIsNotLocalnet,
} from "./devnet-state";
import {
  PROGRAM_ID,
  HUMA_PROGRAM_ID,
  findGlobalConfigPda,
  findPrizePoolPda,
  findDrawCyclePda,
  findPayoutRegistryPda,
  findAtaAddress,
  createAssociatedTokenIdempotentInstruction,
  parseGlobalConfig,
  parsePrizePool,
  parseDrawCycle,
  parseTicketRegistry,
  parsePayoutRegistry,
  getPayoutRegistryAccountSize,
  MAX_TOTAL_WINNERS,
  buildUpdateGlobalConfigInstruction,
  buildUpdatePoolConfigInstruction,
  buildSetPrizeTiersInstruction,
  buildUnpausePoolInstruction,
  buildPrepareDrawInstruction,
  buildHarvestYieldAndCommitInstruction,
  buildAtomicRevealAndPickWinnersInstructions,
  buildPackedReinvestWinningsInstructions,
  buildCrankClosePayoutRegistryInstruction,
  createSetComputeUnitLimitInstruction,
  createSetComputeUnitPriceInstruction,
  getSimulateYieldInstructionDataEncoder,
  PrizeTierInput,
} from "../app/lib/bonds-sdk";
import { buildBuyBondsInstruction } from "../app/lib/bonds-instruction-factory";
import { seedUsers } from "./user-seeding";
import {
  createVrfProvider,
  IVrfProvider,
} from "../services/crank/vrf/randomness-provider";

/**
 * Option B: Realistic 4-Tier Pyramid Distribution Rebalanced to 10,000 bps exact.
 * Satisfies the on-chain constraint: sum(numWinners) <= MAX_TOTAL_WINNERS (180)
 * and sum(basisPoints * numWinners) == 10_000 (100.00%).
 */
export const DEVNET_180_PRIZE_TIERS: readonly PrizeTierInput[] = [
  { basisPoints: 1200, numWinners: 1 }, // Tier 1 (Grand Prize): 1 winner @ 12.00% (1,200 bps)
  { basisPoints: 200, numWinners: 9 }, // Tier 2 (Second Prize): 9 winners @ 2.00% each (18.00% total, 1,800 bps)
  { basisPoints: 80, numWinners: 50 }, // Tier 3 (Third Prize): 50 winners @ 0.80% each (40.00% total, 4,000 bps)
  { basisPoints: 25, numWinners: 120 }, // Tier 4 (Consolation): 120 winners @ 0.25% each (30.00% total, 3,000 bps)
];

export const DEVNET_180_TOTAL_WINNERS = 180;
export const DEVNET_180_TOTAL_BPS = 10_000;
export const REINVEST_BATCH_SIZE = 4;
export const REINVEST_BATCH_CU_LIMIT = 400_000;
export const REINVEST_PRIORITY_FEE_MICRO_LAMPORTS = 25_000n;
export const REVEAL_CU_LIMIT = 800_000;
export const PREPARE_DRAW_BATCH_SIZE = 1000;
export const DEFAULT_SIMULATED_YIELD_USDC = 100;
export const MIN_ADMIN_SOL_BALANCE_LAMPORTS = 200_000_000n; // 0.2 SOL

export interface Devnet180TestOptions {
  poolId: number;
  seedUsers: number;
  keepConfig: boolean;
  rpcUrl: string;
  keypairPath?: string;
  yieldAmountUsdc: number;
}

export interface InitialPoolSnapshot {
  jobsAccount: Address;
  payoutTimelockSeconds: number;
  maxYieldBasisPoints: number;
  minYieldThreshold: bigint;
  prizeTiers: PrizeTierInput[];
  isPaused: boolean;
}

/**
 * Validates that a prize tier configuration satisfies total winner and BPS invariants.
 */
export function validateDevnet180PrizeTiers(tiers: readonly PrizeTierInput[]): {
  totalWinners: number;
  totalBasisPoints: number;
} {
  let totalWinners = 0;
  let totalBasisPoints = 0;

  for (const tier of tiers) {
    if (tier.numWinners <= 0) {
      throw new Error(
        `Invalid tier numWinners: ${tier.numWinners}. Must be > 0.`
      );
    }
    if (tier.basisPoints <= 0) {
      throw new Error(
        `Invalid tier basisPoints: ${tier.basisPoints}. Must be > 0.`
      );
    }
    totalWinners += tier.numWinners;
    totalBasisPoints += tier.basisPoints * tier.numWinners;
  }

  if (totalWinners > MAX_TOTAL_WINNERS) {
    throw new Error(
      `Total winners (${totalWinners}) exceeds MAX_TOTAL_WINNERS (${MAX_TOTAL_WINNERS}).`
    );
  }

  if (totalBasisPoints !== DEVNET_180_TOTAL_BPS) {
    throw new Error(
      `Total basis points (${totalBasisPoints}) does not equal 10,000 exact (100.00%).`
    );
  }

  return { totalWinners, totalBasisPoints };
}

/**
 * Prints usage instructions for the 180-winner test runner.
 */
export function printDevnet180Usage(): void {
  console.log("Usage: tsx scripts/devnet-180-winners.ts [options]");
  console.log("Options:");
  console.log("  --pool <id>            Target pool ID (default: 1)");
  console.log(
    "  --seed-users <n>       Seed N new wallets with tickets (default: 0)"
  );
  console.log(
    "  --yield <amount>       Simulated yield amount in USDC (default: 100)"
  );
  console.log(
    "  --keep-config          Retain 180-winner prize tier config without auto-restoring"
  );
  console.log("  --admin-key <path>     Path to admin fee payer keypair");
  console.log("  --rpc <url>            Solana Devnet RPC endpoint URL");
  console.log("  --help, -h             Display this help message");
}

/**
 * Parses CLI arguments for the 180-winner test runner.
 */
export function parseDevnet180Args(args: string[]): Devnet180TestOptions {
  let poolId = 1;
  let seedUsers = 0;
  let keepConfig = false;
  let rpcUrl = resolveDevnetRpcUrl();
  let keypairPath: string | undefined;
  let yieldAmountUsdc = DEFAULT_SIMULATED_YIELD_USDC;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printDevnet180Usage();
      process.exit(0);
    } else if (arg === "--pool" && i + 1 < args.length) {
      poolId = parseInt(args[++i], 10);
      if (isNaN(poolId) || poolId < 1) {
        throw new Error(
          `Invalid pool ID: "${args[i]}". Must be a positive integer.`
        );
      }
    } else if (arg === "--seed-users" && i + 1 < args.length) {
      seedUsers = parseInt(args[++i], 10);
      if (isNaN(seedUsers) || seedUsers < 0) {
        throw new Error(
          `Invalid seed users count: "${args[i]}". Must be >= 0.`
        );
      }
    } else if (arg === "--keep-config") {
      keepConfig = true;
    } else if (arg === "--rpc" && i + 1 < args.length) {
      rpcUrl = args[++i];
    } else if (arg === "--admin-key" && i + 1 < args.length) {
      keypairPath = args[++i];
    } else if (arg === "--yield" && i + 1 < args.length) {
      yieldAmountUsdc = parseFloat(args[++i]);
      if (isNaN(yieldAmountUsdc) || yieldAmountUsdc <= 0) {
        throw new Error(`Invalid yield amount: "${args[i]}". Must be > 0.`);
      }
    }
  }

  return {
    poolId,
    seedUsers,
    keepConfig,
    rpcUrl,
    keypairPath,
    yieldAmountUsdc,
  };
}

/**
 * Captures an on-chain snapshot of the initial pool and global configuration.
 */
export async function snapshotPoolConfiguration(
  rpc: ReturnType<typeof createSolanaRpc>,
  poolId: number
): Promise<InitialPoolSnapshot> {
  const globalConfigPda = await findGlobalConfigPda();
  const globalInfo = await fetchAccountInfo(rpc, globalConfigPda);
  if (!globalInfo?.value) {
    throw new Error(
      `GlobalConfig account at ${globalConfigPda} not found on-chain.`
    );
  }
  const globalConfig = parseGlobalConfig(
    Buffer.from(globalInfo.value.data[0], "base64")
  );

  const poolPda = await findPrizePoolPda(poolId);
  const poolInfo = await fetchAccountInfo(rpc, poolPda);
  if (!poolInfo?.value) {
    throw new Error(`PrizePool #${poolId} at ${poolPda} not found on-chain.`);
  }
  const poolState = parsePrizePool(
    Buffer.from(poolInfo.value.data[0], "base64")
  );

  const prizeTiers: PrizeTierInput[] = poolState.prizeTiers.map((t) => ({
    numWinners: t.numWinners,
    basisPoints: t.basisPoints,
  }));

  return {
    jobsAccount: address(globalConfig.jobsAccount),
    payoutTimelockSeconds: poolState.payoutTimelockSeconds,
    maxYieldBasisPoints: poolState.maxYieldBasisPoints,
    minYieldThreshold: poolState.minYieldThreshold,
    prizeTiers,
    isPaused: poolState.isPaused,
  };
}

/**
 * Restores original pool & global configuration from a snapshot.
 */
export async function restorePoolConfiguration(
  rpc: ReturnType<typeof createSolanaRpc>,
  adminSigner: KeyPairSigner,
  poolId: number,
  snapshot: InitialPoolSnapshot
): Promise<void> {
  console.log("\n[Teardown] Restoring original Devnet Pool configuration...");

  try {
    // 1. Restore global jobs account if changed
    const updateJobsIx = await buildUpdateGlobalConfigInstruction({
      admin: adminSigner,
      newJobsAccount: snapshot.jobsAccount,
    });
    await sendTx(rpc, updateJobsIx, adminSigner);
    console.log(`  ✓ Restored jobs_account to: ${snapshot.jobsAccount}`);
  } catch (err) {
    console.warn(
      `  ⚠️ Failed restoring jobs_account: ${(err as Error).message}`
    );
  }

  try {
    // 2. Restore pool config (timelock, velocity spike guard, min yield threshold)
    const updateConfigIx = await buildUpdatePoolConfigInstruction({
      admin: adminSigner,
      poolId,
      newPayoutTimelockSeconds: snapshot.payoutTimelockSeconds,
      newMaxYieldBasisPoints: snapshot.maxYieldBasisPoints,
      newMinYieldThreshold: snapshot.minYieldThreshold,
    });
    await sendTx(rpc, updateConfigIx, adminSigner);
    console.log(
      `  ✓ Restored pool config: timelock=${snapshot.payoutTimelockSeconds}s, max_yield_bps=${snapshot.maxYieldBasisPoints}, min_yield=${snapshot.minYieldThreshold}`
    );
  } catch (err) {
    console.warn(
      `  ⚠️ Failed restoring pool config: ${(err as Error).message}`
    );
  }

  try {
    // 3. Restore original prize tiers
    if (snapshot.prizeTiers.length > 0) {
      const setTiersIx = await buildSetPrizeTiersInstruction({
        admin: adminSigner,
        poolId,
        tiers: snapshot.prizeTiers,
      });
      await sendTx(rpc, setTiersIx, adminSigner);
      console.log(
        `  ✓ Restored ${snapshot.prizeTiers.length} original prize tier(s).`
      );
    }
  } catch (err) {
    console.warn(
      `  ⚠️ Failed restoring prize tiers: ${(err as Error).message}`
    );
  }

  console.log("[Teardown] State restoration finished.\n");
}

/**
 * Main turnkey orchestrator for executing and verifying a 180-winner draw cycle on devnet.
 */
export async function runDevnet180WinnerTest(
  rawArgs: string[] = []
): Promise<void> {
  const options = parseDevnet180Args(rawArgs);

  assertActiveEnvIsNotLocalnet();

  console.log("=".repeat(80));
  console.log(
    "  🏆 PRE-PRODUCTION DEVNET 180-WINNER TURNKEY VERIFICATION SUITE"
  );
  console.log("=".repeat(80));
  console.log(`Target Pool ID:         #${options.poolId}`);
  console.log(
    `Execution Mode:         ${options.seedUsers > 0 ? `Multi-User Seeding (${options.seedUsers} wallets)` : "Fast Mode (Existing mature tickets)"}`
  );
  console.log(`Simulated Yield:        ${options.yieldAmountUsdc} USDC`);
  console.log(
    `Auto-Restore Config:    ${!options.keepConfig ? "YES (Guaranteed Teardown)" : "NO (--keep-config)"}`
  );
  console.log(`RPC Endpoint:           ${options.rpcUrl}`);
  console.log("=".repeat(80));

  // Security Mainnet Check
  if (
    options.rpcUrl.includes("mainnet") ||
    options.rpcUrl.includes("api.mainnet-beta")
  ) {
    throw new Error(
      "❌ CRITICAL SECURITY ERROR: Devnet 180-winner test runner is strictly prohibited on Mainnet-Beta."
    );
  }

  // 1. Verify RPC and Environment
  console.log("\n[Step 0/9] Checking RPC Health & Loading Credentials...");
  await checkRpcHealth(options.rpcUrl);

  const accounts = readDevnetAddresses();
  if (!accounts || !accounts.adminAddress || !accounts.humaPoolState) {
    throw new Error(
      "Devnet accounts not configured in scripts/devnet-state/addresses.json. Please run 'npm run devnet init' first."
    );
  }

  const keypairPath = resolveDefaultKeypairPath(options.keypairPath);
  const adminSigner = await loadKeypair(keypairPath);
  const rpc = createResilientRpc(options.rpcUrl);

  console.log(`Admin Wallet:           ${adminSigner.address}`);
  const balanceRes = await rpc.getBalance(adminSigner.address).send();
  const adminBalanceLamports = balanceRes.value;
  const adminBalanceSol = Number(adminBalanceLamports) / 1e9;
  console.log(`Admin SOL Balance:      ${adminBalanceSol.toFixed(4)} SOL`);

  if (adminBalanceLamports < MIN_ADMIN_SOL_BALANCE_LAMPORTS) {
    throw new Error(
      `Insufficient Admin SOL balance (${adminBalanceSol} SOL). At least 0.2 SOL is required for 45-batch reinvestment and account allocations.`
    );
  }

  // Validate Prize Tiers Invariant
  validateDevnet180PrizeTiers(DEVNET_180_PRIZE_TIERS);
  const expectedPayoutSize = getPayoutRegistryAccountSize(
    DEVNET_180_TOTAL_WINNERS
  );
  console.log(
    `Verified 180-Winner Tiers. Expected PayoutRegistry size: ${expectedPayoutSize} bytes.`
  );

  // 2. Snapshot Initial State
  console.log("\n[Step 1/9] Snapshotting Current Devnet Configuration...");
  let snapshot: InitialPoolSnapshot | null = null;
  try {
    snapshot = await snapshotPoolConfiguration(rpc, options.poolId);
    console.log(
      `✓ Snapshotted initial pool config (timelock=${snapshot.payoutTimelockSeconds}s, max_yield_bps=${snapshot.maxYieldBasisPoints}, jobs_account=${snapshot.jobsAccount})`
    );
  } catch (err) {
    console.warn(`Could not snapshot configuration: ${(err as Error).message}`);
  }

  try {
    // 3. Pre-flight & Ephemeral Pool Configuration
    console.log(
      "\n[Step 2/9] Configuring Ephemeral Pool State for 180-Winner Draw..."
    );

    // 3a. Unpause if paused
    if (snapshot?.isPaused) {
      console.log("Pool is currently paused. Sending unpause transaction...");
      const unpauseIx = await buildUnpausePoolInstruction({
        admin: adminSigner,
        poolId: options.poolId,
      });
      await sendTx(rpc, unpauseIx, adminSigner);
      console.log("✓ Pool unpaused.");
    }

    // 3b. Ensure jobs_account is admin
    if (snapshot?.jobsAccount !== adminSigner.address) {
      console.log(`Updating jobs_account to admin (${adminSigner.address})...`);
      const updateJobsIx = await buildUpdateGlobalConfigInstruction({
        admin: adminSigner,
        newJobsAccount: address(adminSigner.address),
      });
      await sendTx(rpc, updateJobsIx, adminSigner);
      console.log("✓ Updated jobs_account to admin.");
    }

    // 3c. Update pool config: bypass timelock (0s), uncapped yield velocity (0 bps), min_yield (1 USDC)
    console.log(
      "Applying ephemeral config: timelock=0s, max_yield_bps=0 (uncapped), min_yield=1 USDC..."
    );
    const updatePoolIx = await buildUpdatePoolConfigInstruction({
      admin: adminSigner,
      poolId: options.poolId,
      newPayoutTimelockSeconds: 0,
      newMaxYieldBasisPoints: 0,
      newMinYieldThreshold: 1_000_000n, // 1 USDC
    });
    await sendTx(rpc, updatePoolIx, adminSigner);
    console.log("✓ Applied ephemeral pool parameters.");

    // 3d. Set Prize Tiers to 180 Winners (Option B)
    console.log(
      "Configuring 180-Winner Prize Tiers (Option B Pyramid: 1:1200, 9:200, 50:80, 120:25)..."
    );
    const setTiersIx = await buildSetPrizeTiersInstruction({
      admin: adminSigner,
      poolId: options.poolId,
      tiers: [...DEVNET_180_PRIZE_TIERS],
    });
    await sendTx(rpc, setTiersIx, adminSigner);
    console.log("✓ 180-Winner prize tiers set successfully on-chain.");

    // 4. Multi-User Seeding Mode (if requested)
    if (options.seedUsers > 0) {
      console.log(
        `\n[Step 3/9] Seeding ${options.seedUsers} Fresh Test Users and Maturing Tickets...`
      );
      await seedUsers({
        rpc,
        adminSigner,
        count: options.seedUsers,
        poolId: options.poolId,
        matureTickets: true,
        onProgress: ({ current, total, userAddress, stage }) => {
          if (stage === "generating_keypair" || stage === "funding") {
            console.log(
              `  • Provisioning Test User ${current}/${total}: ${userAddress}`
            );
          } else if (stage === "user_completed") {
            console.log(`    ✓ Bought 100 bonds for ${userAddress}`);
          }
        },
      });
    } else {
      console.log(
        "\n[Step 3/9] Fast Mode: Utilizing existing mature tickets (1,103+ tickets across registered wallets)."
      );
    }

    // 5. Simulate Yield & Harvest Yield
    console.log(
      `\n[Step 4/9] Simulating ${options.yieldAmountUsdc} USDC Yield and Committing Draw Cycle...`
    );
    const yieldAmountMicroUsdc = BigInt(
      Math.round(options.yieldAmountUsdc * 10 ** USDC_DECIMALS)
    );

    // 5a. Simulate yield in Mock Huma pool
    const yieldIx = {
      programAddress: address(accounts.humaProgramId),
      accounts: [
        {
          address: address(accounts.humaPoolState),
          role: AccountRole.WRITABLE,
        },
        {
          address: address(accounts.adminAddress),
          role: AccountRole.WRITABLE_SIGNER,
          signer: adminSigner,
        },
      ],
      data: getSimulateYieldInstructionDataEncoder().encode({
        yieldAmount: yieldAmountMicroUsdc,
      }),
    };
    await sendTx(rpc, yieldIx, adminSigner);
    console.log(`✓ Injected ${options.yieldAmountUsdc} USDC simulated yield.`);

    // 5b. Fetch current pool state to get active drawCycleId
    const poolPda = await findPrizePoolPda(options.poolId);
    const poolAcc = await fetchAccountInfo(rpc, poolPda);
    if (!poolAcc?.value) throw new Error("Pool account not found.");
    const poolState = parsePrizePool(
      Buffer.from(poolAcc.value.data[0], "base64")
    );
    const activeCycleId = poolState.currentDrawCycleId;

    console.log(`Targeting Draw Cycle ID: #${activeCycleId}`);

    // 5c. Prepare VRF Randomness & Commit
    const vrfProvider: IVrfProvider = createVrfProvider(options.rpcUrl, {
      signer: adminSigner,
    });
    const randomnessAccount = address(
      accounts.randomnessAccount || accounts.adminAddress
    );

    console.log(
      `Committing Switchboard VRF Randomness account: ${randomnessAccount}...`
    );
    const vrfBinding = await vrfProvider.prepareCommit({
      poolId: options.poolId,
      randomnessAccount,
      signer: adminSigner,
    });

    const harvestIx = await buildHarvestYieldAndCommitInstruction({
      crank: adminSigner.address,
      poolId: options.poolId,
      ticketRegistry: address(accounts.ticketRegistry),
      currentDrawCycleId: activeCycleId,
      pstMint: address(accounts.pstMint),
      humaPoolState: address(accounts.humaPoolState),
      randomnessAccount: address(vrfBinding.randomnessAccount),
    });

    const commitAndHarvestIxs = [...vrfBinding.instructions, harvestIx];
    const signersList = vrfBinding.signers
      ? [adminSigner, ...vrfBinding.signers]
      : [adminSigner];
    await sendTx(rpc, commitAndHarvestIxs, signersList);
    console.log(
      `✓ Draw cycle #${activeCycleId} committed and frozen (Status: AwaitingRandomness).`
    );

    // 6. Draw Preparation (Merge Registry)
    console.log("\n[Step 5/9] Checking Ticket Registry Preparation State...");
    const regAcc = await fetchAccountInfo(
      rpc,
      address(accounts.ticketRegistry)
    );
    if (!regAcc?.value) throw new Error("Ticket registry account not found.");
    let regState = parseTicketRegistry(
      Buffer.from(regAcc.value.data[0], "base64")
    );

    console.log(
      `Registry state: prepared ${regState.drawPreparedUpTo}/${regState.userCount} users.`
    );
    while (regState.drawPreparedUpTo < regState.userCount) {
      console.log(
        `Preparing batch from ${regState.drawPreparedUpTo} to ${Math.min(regState.drawPreparedUpTo + PREPARE_DRAW_BATCH_SIZE, regState.userCount)}...`
      );
      const prepIx = await buildPrepareDrawInstruction({
        crank: adminSigner.address,
        poolId: options.poolId,
        currentDrawCycleId: activeCycleId,
        ticketRegistry: address(accounts.ticketRegistry),
        batchSize: PREPARE_DRAW_BATCH_SIZE,
      });
      await sendTx(rpc, prepIx, adminSigner);

      const updatedReg = await fetchAccountInfo(
        rpc,
        address(accounts.ticketRegistry)
      );
      regState = parseTicketRegistry(
        Buffer.from(updatedReg!.value!.data[0], "base64")
      );
      console.log(
        `Progress: prepared ${regState.drawPreparedUpTo}/${regState.userCount} users.`
      );
    }
    console.log("✓ Draw preparation completed.");

    // 7. Switchboard VRF Resolution & Atomic Reveal (800,000 CU)
    console.log(
      "\n[Step 6/9] Resolving Switchboard VRF & Executing Atomic Reveal (800,000 CU)..."
    );

    const drawCyclePda = await findDrawCyclePda(options.poolId, activeCycleId);
    const drawCycleAcc = await fetchAccountInfo(rpc, drawCyclePda);
    if (!drawCycleAcc?.value) throw new Error("Draw cycle account not found.");
    const drawCycleState = parseDrawCycle(
      Buffer.from(drawCycleAcc.value.data[0], "base64")
    );

    console.log(`Committed VRF Seed Slot: ${drawCycleState.vrfSeedSlot}`);

    // Poll for Switchboard oracle reveal signature
    let revealReady = false;
    let revealIxData: Instruction | null = null;
    const maxRevealAttempts = 20;

    for (let attempt = 1; attempt <= maxRevealAttempts; attempt++) {
      const slotRes = await rpc.getSlot().send();
      const currentSlot = slotRes;

      const revealResult = await vrfProvider.prepareReveal({
        randomnessAccount: address(drawCycleState.randomnessAccount),
        committedSeedSlot: drawCycleState.vrfSeedSlot,
        currentSlot: BigInt(currentSlot),
      });

      if (revealResult.status === "ready") {
        console.log(
          `✓ Switchboard Oracle SGX proof resolved on attempt ${attempt}.`
        );
        revealIxData = revealResult.revealInstruction;
        revealReady = true;
        break;
      } else if (revealResult.status === "pending_oracle") {
        console.log(
          `Waiting for Switchboard Oracle proof (attempt ${attempt}/${maxRevealAttempts}): ${revealResult.reason}`
        );
        await new Promise((r) =>
          setTimeout(r, revealResult.retryAfterMs || 2500)
        );
      } else {
        throw new Error(
          `VRF Reveal failed with status '${revealResult.status}': ${revealResult.reason}`
        );
      }
    }

    if (!revealReady || !revealIxData) {
      throw new Error(
        "Switchboard VRF resolution timed out after maximum attempts."
      );
    }

    const atomicRevealIxs = await buildAtomicRevealAndPickWinnersInstructions({
      crank: adminSigner,
      poolId: options.poolId,
      currentDrawCycleId: activeCycleId,
      ticketRegistry: address(accounts.ticketRegistry),
      randomnessAccount: address(drawCycleState.randomnessAccount),
      switchboardRevealInstruction: revealIxData,
    });

    const cuLimitIx = createSetComputeUnitLimitInstruction(REVEAL_CU_LIMIT);
    await sendTx(rpc, [cuLimitIx, ...atomicRevealIxs], adminSigner);
    console.log("✓ Atomic Reveal & Winner Selection executed successfully!");

    // 8. Assertions on Payout Registry
    console.log(
      "\n[Step 7/9] Verifying 180-Winner PayoutRegistry Allocations & Invariants..."
    );
    const payoutPda = await findPayoutRegistryPda(
      options.poolId,
      activeCycleId
    );
    const payoutAcc = await fetchAccountInfo(rpc, payoutPda);
    if (!payoutAcc?.value)
      throw new Error("PayoutRegistry PDA not found after reveal.");

    const payoutBytes = Buffer.from(payoutAcc.value.data[0], "base64");
    const actualByteSize = payoutBytes.length;

    console.log(
      `  • PayoutRegistry Account Size: ${actualByteSize} bytes (Expected: ${expectedPayoutSize} B)`
    );
    if (actualByteSize !== expectedPayoutSize) {
      throw new Error(
        `PayoutRegistry byte size mismatch! Expected ${expectedPayoutSize} bytes, got ${actualByteSize} bytes.`
      );
    }

    const payoutState = parsePayoutRegistry(payoutBytes);
    console.log(
      `  • Winners Recorded:           ${payoutState.winnersCount} (Expected: ${DEVNET_180_TOTAL_WINNERS})`
    );
    if (payoutState.winnersCount !== DEVNET_180_TOTAL_WINNERS) {
      throw new Error(
        `Winners count mismatch! Expected ${DEVNET_180_TOTAL_WINNERS}, got ${payoutState.winnersCount}.`
      );
    }

    console.log(
      `  • Total Prizes Distributed:   ${payoutState.totalDistributed} micro-USDC`
    );
    console.log(
      `  • Remainder Dust:             ${payoutState.dust} micro-USDC`
    );
    console.log(
      `  • Prize Pot:                  ${drawCycleState.prizePot} micro-USDC`
    );

    const accountedSum = payoutState.totalDistributed + payoutState.dust;
    if (accountedSum !== drawCycleState.prizePot) {
      throw new Error(
        `Financial Invariant Violation! totalDistributed (${payoutState.totalDistributed}) + dust (${payoutState.dust}) = ${accountedSum} !== prizePot (${drawCycleState.prizePot})`
      );
    }
    console.log(
      "  ✓ Dust conservation invariant verified: total_distributed + dust == prize_pot"
    );

    // 9. Batched Winner Reinvestment (45 Transactions)
    console.log(
      `\n[Step 8/9] Executing Batched Reinvestment (45 Batches of ${REINVEST_BATCH_SIZE} winners, 25k Priority Fee)...`
    );

    const winnersList = payoutState.winners.slice(0, payoutState.winnersCount);
    const totalBatches = Math.ceil(winnersList.length / REINVEST_BATCH_SIZE);
    let successfulBatches = 0;

    for (let i = 0; i < winnersList.length; i += REINVEST_BATCH_SIZE) {
      const batchIndex = Math.floor(i / REINVEST_BATCH_SIZE) + 1;
      const batchWinners = winnersList
        .slice(i, i + REINVEST_BATCH_SIZE)
        .map((w, offset) => ({
          winner: address(w.winner),
          winnerIndex: i + offset,
        }));

      console.log(
        `  • Submitting Batch ${batchIndex}/${totalBatches} (Winners [${batchWinners.map((b) => `#${b.winnerIndex}`).join(", ")}])...`
      );

      const priorityFeeIx = createSetComputeUnitPriceInstruction(
        REINVEST_PRIORITY_FEE_MICRO_LAMPORTS
      );
      const cuIx = createSetComputeUnitLimitInstruction(
        REINVEST_BATCH_CU_LIMIT
      );
      const reinvestIxs = await buildPackedReinvestWinningsInstructions({
        crank: adminSigner.address,
        poolId: options.poolId,
        cycleId: activeCycleId,
        winners: batchWinners,
        ticketRegistry: address(accounts.ticketRegistry),
      });

      // Submit with retries
      let batchSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await sendTx(rpc, [priorityFeeIx, cuIx, ...reinvestIxs], adminSigner);
          batchSuccess = true;
          successfulBatches++;
          break;
        } catch (err) {
          console.warn(
            `    ⚠️ Batch ${batchIndex} attempt ${attempt} failed: ${(err as Error).message}. Retrying...`
          );
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }

      if (!batchSuccess) {
        throw new Error(
          `Batch ${batchIndex}/${totalBatches} failed after 3 attempts.`
        );
      }
    }

    console.log(
      `✓ All ${successfulBatches}/${totalBatches} reinvestment batches confirmed!`
    );

    // Verify 180 payouts completed on-chain
    const payoutAccPost = await fetchAccountInfo(rpc, payoutPda);
    const payoutStatePost = parsePayoutRegistry(
      Buffer.from(payoutAccPost!.value!.data[0], "base64")
    );
    console.log(
      `  • On-Chain Payouts Completed: ${payoutStatePost.payoutsCompleted}/${DEVNET_180_TOTAL_WINNERS}`
    );
    if (payoutStatePost.payoutsCompleted !== DEVNET_180_TOTAL_WINNERS) {
      throw new Error(
        `Payouts completed mismatch! Expected ${DEVNET_180_TOTAL_WINNERS}, got ${payoutStatePost.payoutsCompleted}.`
      );
    }

    // 10. Crank Close Payout Registry & Rent Reclamation
    console.log(
      "\n[Step 9/9] Closing PayoutRegistry & Reclaiming 100% Rent Lamports..."
    );
    const preCloseBalance = (await rpc.getBalance(adminSigner.address).send())
      .value;

    const closeIx = await buildCrankClosePayoutRegistryInstruction({
      crank: adminSigner,
      poolId: options.poolId,
      cycleId: activeCycleId,
    });
    await sendTx(rpc, closeIx, adminSigner);

    const postCloseAcc = await fetchAccountInfo(rpc, payoutPda);
    if (postCloseAcc?.value !== null) {
      throw new Error(
        `PayoutRegistry at ${payoutPda} was not cleanly closed on-chain!`
      );
    }

    const postCloseBalance = (await rpc.getBalance(adminSigner.address).send())
      .value;
    const netRecoveredLamports = postCloseBalance - preCloseBalance;
    console.log(
      `✓ PayoutRegistry PDA closed. Net SOL change: +${Number(netRecoveredLamports) / 1e9} SOL (Rent fully reimbursed).`
    );

    console.log("\n" + "=".repeat(80));
    console.log(
      "  🎉 180-WINNER DEVNET DRAW CYCLE FULLY VERIFIED & COMPLETED SUCCESSFULLY!"
    );
    console.log("=".repeat(80));
  } finally {
    // Teardown: Restore Initial Devnet Configuration unless --keep-config
    if (!options.keepConfig && snapshot) {
      await restorePoolConfiguration(
        rpc,
        adminSigner,
        options.poolId,
        snapshot
      );
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  runDevnet180WinnerTest(args).catch((err) => {
    printErrorDetails(err, "Devnet 180-Winner Suite");
    process.exit(1);
  });
}
