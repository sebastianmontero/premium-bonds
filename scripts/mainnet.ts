import "./load-env";
import path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { execFileSync } from "child_process";
import {
  createSolanaRpc,
  address,
  Address,
  KeyPairSigner,
  AccountRole,
  getBase58Encoder,
} from "@solana/kit";
import {
  checkRpcHealth,
  loadKeypair,
  loadOrGenerateKeypair,
  resolveDefaultKeypairPath,
  assertSignerBalance,
  sendTx,
  printErrorDetails,
  fetchAccountInfo,
  fetchAccountData,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ATA_PROGRAM_ID,
} from "./utils";
import {
  assertCluster,
  readClusterAddresses,
  writeClusterAddresses,
  syncClusterToActiveEnv,
  ProtocolAccounts,
  MAINNET_DEFAULT_RPC_URL,
  MAINNET_PATHS,
  PROJECT_ROOT,
  PRODUCTION_ENV_PATH,
} from "./cluster-state";
import {
  ensureTicketRegistryAllocated,
  ensureHumaLenderStateOnChain,
  reconcilePoolState,
} from "./account-utils";
import { getProgramDeployStatus, cleanDeployBuffers } from "./deploy-utils";
import {
  PROGRAM_ID,
  findGlobalConfigPda,
  findPrizePoolPda,
  findPoolVaultPda,
  findPoolPstVaultPda,
  findHumaPoolAuthorityPda,
  findAtaAddress,
  createAssociatedTokenIdempotentInstruction,
  parseGlobalConfig,
  parsePrizePool,
  buildInitializeGlobalInstruction,
  buildCreatePoolInstruction,
  buildInitializeHumaLenderInstruction,
  buildNominateAdminInstruction,
  PrizeTierInput,
  SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
} from "../app/lib/bonds-sdk";
import {
  parseMultisigAccount,
  findMultisigVaultPda,
} from "../app/lib/squads-sdk";

// Canonical Mainnet Constants
export const MAINNET_USDC_MINT = address(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const MAINNET_SWITCHBOARD_PID = address(
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv"
);
export const MAINNET_HUMA_PID = address(
  "HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn"
);

export const STATE_DIR = MAINNET_PATHS.stateDir;

export class HumaConfigurationError extends Error {
  constructor(message: string) {
    super(`[Huma Configuration Error] ${message}`);
    this.name = "HumaConfigurationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function printUsage(): void {
  console.log(
    "================================================================="
  );
  console.log(
    "          PREMIUM BONDS MAINNET BOOTSTRAP CLI                    "
  );
  console.log(
    "================================================================="
  );
  console.log("⚠️  WARNING: You are interacting with SOLANA MAINNET-BETA.");
  console.log("   Real SOL and real USDC will be spent.\n");
  console.log("Usage: npm run mainnet <command> [options]");
  console.log("\nCommands:");
  console.log(
    "  status                                Displays on-chain Mainnet state, balances, and authority"
  );
  console.log(
    "  deploy [keypair]                      Compiles contracts with `--features mainnet` and deploys program"
  );
  console.log(
    "  clean-buffers [keypair]               Reclaims rent SOL from aborted deploy buffers"
  );
  console.log(
    "  init [keypair]                        Executes idempotent Day-1 protocol initialization pipeline"
  );
  console.log(
    "  handoff-governance --multisig <pda>   Transfers protocol admin nomination and BPF upgrade authority to Squads Vault"
  );
  console.log(
    "  sync-env [target]                     Synchronizes mainnet on-chain addresses to .env.production"
  );
  console.log("\nOptions:");
  console.log(
    "  --rpc <url>                           Custom Mainnet RPC endpoint"
  );
  console.log(
    "  --keypair, -k <path>                  Fee payer / authority keypair path"
  );
  console.log(
    "  --huma-pool <address>                 Canonical Mainnet Huma Classic Pool address"
  );
  console.log(
    "  --pst-mint <address>                  Canonical Mainnet Huma PST mint address"
  );
  console.log(
    "  --vrf-account <pda>                   Switchboard On-Demand VRF Randomness account PDA"
  );
  console.log(
    "  --multisig <pda>                      Squads V4 Multisig account PDA"
  );
  console.log(
    "  --vault-index <index>                 Squads Vault index (default: 0)"
  );
  console.log(
    "  --priority-fee-micro-lamports <n>     Priority fee per compute unit in micro-lamports"
  );
  console.log(
    "  --force-regenerate, -f                Force regeneration of invalid/conflicting keypairs"
  );
  console.log(
    "  --yes, -y                             Bypass interactive confirmation prompt"
  );
  console.log("  --help, -h                            Show this help menu\n");
}

export interface MainnetCliParsedArgs {
  readonly command: string;
  readonly positionals: string[];
  readonly flags: Record<string, string | boolean>;
}

export function parseMainnetArgs(
  argv: readonly string[]
): MainnetCliParsedArgs {
  const args = argv.slice(2);
  let command = "";
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h" || arg === "help") {
      flags.help = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }

    if (arg === "--force-regenerate" || arg === "-f") {
      flags.forceRegenerate = true;
      continue;
    }

    if (arg.startsWith("--") || arg.startsWith("-")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(arg.startsWith("--") ? 2 : 1, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(arg.startsWith("--") ? 2 : 1);
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
      continue;
    }

    if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
}

export async function confirmMainnetExecution(
  actionName: string,
  details?: Record<string, string | number | undefined>
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(
      "\n================================================================="
    );
    console.log(
      `⚠️  ATTENTION: You are about to execute '${actionName}' on SOLANA MAINNET-BETA.`
    );
    if (details) {
      console.log("Parameters & Accounts:");
      for (const [key, val] of Object.entries(details)) {
        if (val !== undefined) {
          console.log(`  • ${key}: ${val}`);
        }
      }
    }
    console.log(
      "================================================================="
    );
    rl.question("Type 'YES' to confirm and proceed: ", (answer) => {
      rl.close();
      if (answer.trim() === "YES") {
        resolve(true);
      } else {
        console.log("Operation aborted by user.");
        resolve(false);
      }
    });
  });
}

// ─── Command Handlers ──────────────────────────────────────────────────────────

export async function handleStatus(
  rpcUrl: string,
  customKeypairPath?: string
): Promise<void> {
  console.log(`Connecting to Mainnet RPC: ${rpcUrl}`);
  const rpc = createSolanaRpc(rpcUrl);
  await assertCluster(rpc, "mainnet-beta");

  console.log("\n📊 Solana Mainnet-Beta Protocol Status Dashboard:");
  console.log(
    "-----------------------------------------------------------------"
  );

  // 1. Program & Upgrade Authority Status
  const programAddress = PROGRAM_ID;
  const deployStatus = await getProgramDeployStatus(rpc, programAddress);
  console.log(`Program ID:               ${programAddress}`);
  console.log(
    `Deployment Status:        ${deployStatus.isDeployed ? "DEPLOYED" : "NOT DEPLOYED"}`
  );
  console.log(
    `BPF Upgrade Authority:    ${deployStatus.upgradeAuthority || "None (Immutable)"}`
  );

  // 2. Global Config Status
  const globalConfigPda = await findGlobalConfigPda();
  const globalConfigInfo = await fetchAccountInfo(rpc, globalConfigPda);
  console.log(`\nGlobal Config PDA:        ${globalConfigPda}`);
  if (globalConfigInfo?.value) {
    const rawData = await fetchAccountData(rpc, globalConfigPda);
    if (rawData) {
      try {
        const config = parseGlobalConfig(rawData);
        console.log(`  • Admin Authority:      ${config.admin}`);
        console.log(
          `  • Pending Admin:        ${config.pendingAdmin || "None"}`
        );
        console.log(`  • Guardian:             ${config.guardian || "None"}`);
        console.log(`  • Jobs Account:         ${config.jobsAccount}`);
      } catch (err) {
        console.log(`  • (Failed parsing GlobalConfig data: ${err})`);
      }
    }
  } else {
    console.log("  • Status:               NOT INITIALIZED");
  }

  // 3. Prize Pool 1 Status
  const poolId = 1;
  const poolPda = await findPrizePoolPda(poolId);
  const poolInfo = await fetchAccountInfo(rpc, poolPda);
  console.log(`\nPrize Pool #1 PDA:        ${poolPda}`);
  if (poolInfo?.value) {
    const rawData = await fetchAccountData(rpc, poolPda);
    if (rawData) {
      try {
        const pool = parsePrizePool(rawData);
        console.log(`  • Bond Token Mint:      ${pool.tokenMint}`);
        console.log(`  • PST Mint:             ${pool.pstMint}`);
        console.log(`  • Ticket Registry:      ${pool.ticketRegistry}`);
        console.log(`  • Fee Wallet:           ${pool.feeWallet}`);
        console.log(`  • Huma Pool State:      ${pool.humaPoolState}`);
        console.log(`  • Pool Balance:         ${pool.poolBalance}`);
        console.log(`  • Current Draw Cycle:   ${pool.currentDrawCycleId}`);
        console.log(`  • Is Frozen:            ${pool.isFrozenForDraw}`);
      } catch (err) {
        console.log(`  • (Failed parsing PrizePool data: ${err})`);
      }
    }
  } else {
    console.log("  • Status:               NOT INITIALIZED");
  }

  // 4. Saved Addresses vs On-Chain Status
  const saved = readClusterAddresses("mainnet-beta");
  if (saved?.ticketRegistry) {
    const regInfo = await fetchAccountInfo(rpc, address(saved.ticketRegistry));
    console.log(`\nSaved Ticket Registry:    ${saved.ticketRegistry}`);
    console.log(
      `  • Allocated on-chain:   ${regInfo?.value ? "YES" : "NO"} (${regInfo?.value ? `${regInfo.value.lamports} lamports` : "0"})`
    );
  }

  // 5. Signer Balance
  const keypairPath = resolveDefaultKeypairPath(customKeypairPath, { rpcUrl });
  if (fs.existsSync(keypairPath)) {
    try {
      const signer = await loadKeypair(keypairPath);
      const balRes = await rpc.getBalance(signer.address).send();
      console.log(
        `\nSigner Keypair (${path.basename(keypairPath)}): ${signer.address}`
      );
      console.log(
        `  • Balance:              ${Number(balRes.value) / 1e9} SOL`
      );
    } catch {
      // ignore
    }
  }

  console.log(
    "-----------------------------------------------------------------\n"
  );
}

export async function handleDeploy(
  rpcUrl: string,
  customKeypairPath?: string,
  priorityFeeMicroLamports?: bigint | number,
  skipConfirm: boolean = false
): Promise<void> {
  const rpc = createSolanaRpc(rpcUrl);
  await assertCluster(rpc, "mainnet-beta");

  const payerKeypairPath = resolveDefaultKeypairPath(customKeypairPath, {
    rpcUrl,
  });
  const payerSigner = await loadKeypair(payerKeypairPath);
  const payerAddress = payerSigner.address;

  await assertSignerBalance(rpc, payerAddress, {
    rpcUrl,
    keypairPath: payerKeypairPath,
    minLamports: 100_000_000n, // 0.1 SOL minimum for deployment
  });

  const priorityFee = priorityFeeMicroLamports ?? 50_000n;

  if (!skipConfirm) {
    const confirmed = await confirmMainnetExecution(
      "Deploy / Upgrade Program",
      {
        "Program ID": PROGRAM_ID,
        "Deployer / Upgrade Authority": payerAddress,
        "Keypair Path": payerKeypairPath,
        "Priority Fee (micro-lamports)": priorityFee.toString(),
        "Target RPC": rpcUrl,
      }
    );
    if (!confirmed) return;
  }

  console.log("\n📦 Compiling Solana Program with `--features mainnet`...");
  execFileSync("anchor", ["build", "--", "--features", "mainnet"], {
    cwd: path.resolve(PROJECT_ROOT, "anchor"),
    stdio: "inherit",
    env: { ...process.env, NO_DNA: "1" },
  });

  const soPath = path.resolve(
    PROJECT_ROOT,
    "anchor",
    "target",
    "deploy",
    "anchor.so"
  );
  if (!fs.existsSync(soPath)) {
    throw new Error(`Compiled program binary not found at: ${soPath}`);
  }

  const deployStatus = await getProgramDeployStatus(rpc, PROGRAM_ID);

  if (deployStatus.isDeployed) {
    if (deployStatus.upgradeAuthority === null) {
      throw new Error(
        `Program ${PROGRAM_ID} is immutable and cannot be upgraded.`
      );
    }
    if (deployStatus.upgradeAuthority !== payerAddress) {
      throw new Error(
        `Authority mismatch for ${PROGRAM_ID}!\n` +
          `On-chain Upgrade Authority: ${deployStatus.upgradeAuthority}\n` +
          `Signer Keypair: ${payerAddress}\n` +
          `Please provide the authorized upgrade keypair.`
      );
    }

    console.log(`Program ${PROGRAM_ID} is deployed on Mainnet. Upgrading...`);
    execFileSync(
      "solana",
      [
        "program",
        "deploy",
        soPath,
        "--program-id",
        PROGRAM_ID,
        "--fee-payer",
        payerKeypairPath,
        "--upgrade-authority",
        payerKeypairPath,
        "--url",
        rpcUrl,
        "--with-compute-unit-price",
        priorityFee.toString(),
      ],
      { stdio: "inherit" }
    );
  } else {
    console.log(
      `Program ${PROGRAM_ID} not found on Mainnet. Performing Day-1 initial deployment...`
    );
    const progKeypairPath = path.resolve(
      PROJECT_ROOT,
      "anchor",
      "target",
      "deploy",
      "anchor-keypair.json"
    );

    execFileSync(
      "solana",
      [
        "program",
        "deploy",
        soPath,
        "--program-id",
        progKeypairPath,
        "--fee-payer",
        payerKeypairPath,
        "--upgrade-authority",
        payerKeypairPath,
        "--url",
        rpcUrl,
        "--with-compute-unit-price",
        priorityFee.toString(),
      ],
      { stdio: "inherit" }
    );
  }

  console.log("✓ Mainnet program deployment completed successfully!");
}

export async function handleCleanBuffers(
  rpcUrl: string,
  customKeypairPath?: string,
  skipConfirm: boolean = false
): Promise<void> {
  const rpc = createSolanaRpc(rpcUrl);
  await assertCluster(rpc, "mainnet-beta");

  const payerKeypairPath = resolveDefaultKeypairPath(customKeypairPath, {
    rpcUrl,
  });

  if (!skipConfirm) {
    const confirmed = await confirmMainnetExecution("Reclaim Buffer Rent SOL", {
      "Fee Payer / Authority": payerKeypairPath,
      "Target RPC": rpcUrl,
    });
    if (!confirmed) return;
  }

  cleanDeployBuffers(rpcUrl, payerKeypairPath);
}

export interface MainnetInitOptions {
  readonly rpcUrl: string;
  readonly customKeypairPath?: string;
  readonly forceRegenerate?: boolean;
  readonly explicitHumaPool?: string;
  readonly explicitPstMint?: string;
  readonly explicitVrfAccount?: string;
  readonly skipConfirm?: boolean;
}

export async function handleInit(options: MainnetInitOptions): Promise<void> {
  const { rpcUrl, customKeypairPath, forceRegenerate, skipConfirm } = options;
  const rpc = createSolanaRpc(rpcUrl);
  await assertCluster(rpc, "mainnet-beta");

  const isHealthy = await checkRpcHealth(rpcUrl);
  if (!isHealthy) {
    throw new Error(`Mainnet RPC health check failed at: ${rpcUrl}`);
  }

  const keypairPath = resolveDefaultKeypairPath(customKeypairPath, { rpcUrl });
  const adminSigner = await loadKeypair(keypairPath);
  const adminAddress = adminSigner.address;

  await assertSignerBalance(rpc, adminAddress, {
    rpcUrl,
    keypairPath,
    minLamports: 2_000_000_000n, // ~2.0 SOL for TicketRegistry rent & pool setup
  });

  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  // 1. Resolve & Validate Canonical Huma Pool State on Mainnet
  const rawHumaPool =
    options.explicitHumaPool ||
    process.env.HUMA_MAINNET_POOL ||
    readClusterAddresses("mainnet-beta")?.humaPoolState;

  if (
    !rawHumaPool ||
    rawHumaPool === "11111111111111111111111111111111" ||
    rawHumaPool.trim() === ""
  ) {
    throw new HumaConfigurationError(
      "Missing canonical Mainnet Huma Classic Pool address. Please pass '--huma-pool <address>' or configure HUMA_MAINNET_POOL in environment."
    );
  }

  const humaPoolAddress = address(rawHumaPool);
  const humaPoolInfo = await fetchAccountInfo(rpc, humaPoolAddress);
  if (!humaPoolInfo?.value) {
    throw new HumaConfigurationError(
      `Huma Classic Pool account (${humaPoolAddress}) was not found on Mainnet RPC.`
    );
  }
  if (humaPoolInfo.value.owner !== MAINNET_HUMA_PID) {
    throw new HumaConfigurationError(
      `Huma Classic Pool account (${humaPoolAddress}) is owned by '${humaPoolInfo.value.owner}', expected canonical Mainnet Huma PID '${MAINNET_HUMA_PID}'.`
    );
  }

  // 2. Validate Switchboard On-Demand VRF Account on Mainnet
  const rawVrfAccount =
    options.explicitVrfAccount ||
    process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT ||
    readClusterAddresses("mainnet-beta")?.randomnessAccount;

  if (!rawVrfAccount) {
    throw new Error(
      "Missing Switchboard On-Demand VRF Randomness account. Please pass '--vrf-account <pda>' or configure NEXT_PUBLIC_RANDOMNESS_ACCOUNT."
    );
  }

  const vrfAccountAddress = address(rawVrfAccount);
  const vrfInfo = await fetchAccountInfo(rpc, vrfAccountAddress);
  if (!vrfInfo?.value) {
    throw new Error(
      `Switchboard VRF account (${vrfAccountAddress}) not found on Mainnet RPC.`
    );
  }
  if (vrfInfo.value.owner !== MAINNET_SWITCHBOARD_PID) {
    throw new Error(
      `Switchboard VRF account (${vrfAccountAddress}) is owned by '${vrfInfo.value.owner}', expected canonical Mainnet Switchboard PID '${MAINNET_SWITCHBOARD_PID}'.`
    );
  }
  const vrfData = await fetchAccountData(rpc, vrfAccountAddress);
  if (!vrfData || vrfData.length < 408) {
    throw new Error(
      `Switchboard VRF account data size (${vrfData?.length ?? 0} bytes) is less than required 408 bytes.`
    );
  }

  // 3. Resolve & Validate Huma PST Mint on Mainnet
  const rawPstMint =
    options.explicitPstMint ||
    process.env.HUMA_MAINNET_PST_MINT ||
    readClusterAddresses("mainnet-beta")?.pstMint;

  let pstMintAddress: Address;
  if (
    rawPstMint &&
    rawPstMint.trim() !== "" &&
    rawPstMint !== "11111111111111111111111111111111"
  ) {
    pstMintAddress = address(rawPstMint.trim());
    const pstMintInfo = await fetchAccountInfo(rpc, pstMintAddress);
    if (!pstMintInfo?.value) {
      throw new Error(
        `Huma PST mint account (${pstMintAddress}) was not found on Mainnet RPC.`
      );
    }
    if (pstMintInfo.value.owner !== String(TOKEN_PROGRAM_ID)) {
      throw new Error(
        `Huma PST mint account (${pstMintAddress}) is owned by '${pstMintInfo.value.owner}', expected SPL Token program '${TOKEN_PROGRAM_ID}'.`
      );
    }
    console.log(`Using canonical on-chain PST Mint: ${pstMintAddress}`);
  } else {
    const pstKeyPath = path.resolve(STATE_DIR, "pst-mint.json");
    const pstMintSigner = await loadOrGenerateKeypair(pstKeyPath, {
      overwriteIfInvalid: true,
      label: "Mainnet PST Mint",
    });
    pstMintAddress = pstMintSigner.address;
    console.log(`Using local PST Mint keypair: ${pstMintAddress}`);
  }

  // 4. Confirmation
  if (!skipConfirm) {
    const confirmed = await confirmMainnetExecution(
      "Day-1 Protocol Initialization",
      {
        "Admin / Fee Payer": adminAddress,
        "Keypair Path": keypairPath,
        "Canonical USDC Mint": MAINNET_USDC_MINT,
        "Mainnet Huma PID": MAINNET_HUMA_PID,
        "Huma Pool State": humaPoolAddress,
        "Huma PST Mint": pstMintAddress,
        "Switchboard VRF Account": vrfAccountAddress,
        "Target RPC": rpcUrl,
      }
    );
    if (!confirmed) return;
  }

  // 5. Derive PDAs & Setup Accounts
  const poolAuthority = await findHumaPoolAuthorityPda(humaPoolAddress);
  console.log(`Derived Huma Pool Authority: ${poolAuthority}`);

  // Canonical Mainnet USDC
  const usdcMintAddress = MAINNET_USDC_MINT;

  // ATAs
  const humaPoolUnderlying = await findAtaAddress(
    poolAuthority,
    usdcMintAddress
  );
  const humaPoolModeToken = await findAtaAddress(poolAuthority, pstMintAddress);
  const feeWallet = await findAtaAddress(adminAddress, usdcMintAddress);

  console.log("Creating ATAs idempotently on Mainnet...");
  const underlyingAtaIx = createAssociatedTokenIdempotentInstruction({
    payer: adminSigner,
    owner: poolAuthority,
    mint: usdcMintAddress,
    ata: address(humaPoolUnderlying),
  });
  const modeAtaIx = createAssociatedTokenIdempotentInstruction({
    payer: adminSigner,
    owner: poolAuthority,
    mint: pstMintAddress,
    ata: address(humaPoolModeToken),
  });
  const feeWalletAtaIx = createAssociatedTokenIdempotentInstruction({
    payer: adminSigner,
    owner: address(adminAddress),
    mint: usdcMintAddress,
    ata: address(feeWallet),
  });

  await sendTx(rpc, [underlyingAtaIx, modeAtaIx, feeWalletAtaIx], adminSigner, {
    priorityFeeMicroLamports: 50_000n,
  });

  // 5. Allocate Huma Lender State
  const humaLenderStateKeyPath = path.resolve(
    STATE_DIR,
    "huma-lender-state-key.json"
  );
  const humaLenderStateSigner = await loadOrGenerateKeypair(
    humaLenderStateKeyPath,
    { overwriteIfInvalid: true, label: "Huma Lender State" }
  );

  await ensureHumaLenderStateOnChain({
    rpc,
    payer: adminSigner,
    lenderStateSigner: humaLenderStateSigner,
    humaProgramId: MAINNET_HUMA_PID,
  });

  // 6. Allocate Ticket Registry Safely (Zero Rent Burning)
  const poolId = 1;
  const poolAddress = await findPrizePoolPda(poolId);
  const poolInfo = await fetchAccountInfo(rpc, poolAddress);

  const ticketRegistryKeyPath = path.resolve(
    STATE_DIR,
    "ticket-registry-key.json"
  );
  const { ticketRegistryAddress } = await ensureTicketRegistryAllocated({
    rpc,
    payer: adminSigner,
    ticketRegistryKeyPath,
    anchorProgramId: PROGRAM_ID,
    poolExistsOnChain: !!poolInfo?.value,
    forceRegenerate,
  });

  // 7. Initialize Global Config
  const globalConfigAddress = await findGlobalConfigPda();
  const globalConfigInfo = await fetchAccountInfo(rpc, globalConfigAddress);
  if (!globalConfigInfo?.value) {
    console.log("Initializing Mainnet GlobalConfig...");
    const initGlobalIx = await buildInitializeGlobalInstruction({
      authority: adminSigner,
      admin: address(adminAddress),
      jobsAccount: address(adminAddress),
    });
    await sendTx(rpc, initGlobalIx, adminSigner, {
      priorityFeeMicroLamports: 50_000n,
    });
    console.log("✓ GlobalConfig initialized on Mainnet.");
  } else {
    console.log("GlobalConfig already initialized on-chain.");
  }

  // 8. Initialize Prize Pool 1
  const poolPstVaultAddress = await findPoolPstVaultPda(poolId);

  if (!poolInfo?.value) {
    console.log("Creating Prize Pool 1 on Mainnet...");
    const prizeTiers: PrizeTierInput[] = [
      { basisPoints: 5000, numWinners: 1 }, // 50%
      { basisPoints: 1500, numWinners: 2 }, // 30% (15% each)
      { basisPoints: 400, numWinners: 5 }, // 20% (4% each)
    ];

    const createPoolIx = await buildCreatePoolInstruction({
      admin: adminSigner,
      poolId,
      bondPrice: 1_000_000n, // 1 USDC
      stakeCycleDurationHrs: 24n, // 24 hours
      feeBasisPoints: 100, // 1%
      minYieldThreshold: 0n,
      maxYieldBasisPoints: 0,
      payoutTimelockSeconds: 300,
      prizeTiers,
      tokenMint: usdcMintAddress,
      pstMint: pstMintAddress,
      ticketRegistry: ticketRegistryAddress,
      feeWallet: address(feeWallet),
      humaPoolState: humaPoolAddress,
    });
    await sendTx(rpc, createPoolIx, adminSigner, {
      priorityFeeMicroLamports: 50_000n,
    });

    console.log("Initializing Huma lender account on YieldBonds program...");
    const initHumaLenderIx = await buildInitializeHumaLenderInstruction({
      admin: adminSigner,
      poolId,
      humaAddresses: {
        program: MAINNET_HUMA_PID,
        config: MAINNET_HUMA_PID,
        poolConfig: MAINNET_HUMA_PID,
        poolState: humaPoolAddress,
        modeConfig: MAINNET_HUMA_PID,
        modeMint: pstMintAddress,
        lenderState: humaLenderStateSigner.address,
        lenderModeToken: poolPstVaultAddress,
      },
    });
    await sendTx(rpc, initHumaLenderIx, adminSigner, {
      priorityFeeMicroLamports: 50_000n,
    });
    console.log("✓ Prize Pool #1 and Huma Lender link initialized.");
  } else {
    console.log("Prize Pool 1 already created on-chain. Reconciling...");
    const rawData = await fetchAccountData(rpc, poolAddress);
    if (rawData) {
      const onChainPool = parsePrizePool(rawData);
      const reconciliation = reconcilePoolState(
        {
          tokenMint: onChainPool.tokenMint,
          ticketRegistry: onChainPool.ticketRegistry,
          feeWallet: onChainPool.feeWallet,
        },
        {
          tokenMint: usdcMintAddress,
          ticketRegistry: ticketRegistryAddress,
          feeWallet: address(feeWallet),
        }
      );
      if (!reconciliation.isMatch) {
        console.warn("⚠️  On-chain pool reconciliation warnings:");
        for (const mismatch of reconciliation.mismatches) {
          console.warn(`    • ${mismatch}`);
        }
      }
    }
  }

  // 9. Persist Addresses & Sync Environment
  const mainnetAccounts: ProtocolAccounts = {
    programId: PROGRAM_ID,
    humaProgramId: MAINNET_HUMA_PID,
    adminAddress,
    usdcMint: usdcMintAddress,
    pstMint: pstMintAddress,
    ticketRegistry: ticketRegistryAddress,
    feeWallet: address(feeWallet),
    humaPoolState: humaPoolAddress,
    humaLenderState: humaLenderStateSigner.address,
    humaPoolUnderlying,
    humaPoolModeToken,
    humaRedemptionRequest: "",
    randomnessAccount: vrfAccountAddress,
  };

  writeClusterAddresses("mainnet-beta", mainnetAccounts);
  syncClusterToActiveEnv("mainnet-beta", PRODUCTION_ENV_PATH);

  console.log("\n✓ Day-1 Mainnet Bootstrap Pipeline completed successfully!");
}

export interface HandoffGovernanceOptions {
  readonly rpcUrl: string;
  readonly multisigAddressStr: string;
  readonly vaultIndex?: number;
  readonly customKeypairPath?: string;
  readonly skipConfirm?: boolean;
}

export async function handleHandoffGovernance(
  options: HandoffGovernanceOptions
): Promise<void> {
  const { rpcUrl, multisigAddressStr, customKeypairPath, skipConfirm } =
    options;
  const vaultIndex = options.vaultIndex ?? 0;

  const rpc = createSolanaRpc(rpcUrl);
  await assertCluster(rpc, "mainnet-beta");

  const multisigPda = address(multisigAddressStr);
  const multisigData = await fetchAccountData(rpc, multisigPda);
  if (!multisigData) {
    throw new Error(
      `Squads V4 Multisig account (${multisigPda}) not found on Mainnet RPC.`
    );
  }

  const multisig = parseMultisigAccount(multisigData, multisigPda);
  if (multisig.members.length < 1 || multisig.threshold < 1) {
    throw new Error(
      `Invalid Squads Multisig: threshold (${multisig.threshold}) and members (${multisig.members.length}) must be >= 1.`
    );
  }
  if (multisig.threshold > multisig.members.length) {
    throw new Error(
      `Invalid Squads Multisig: threshold (${multisig.threshold}) exceeds member count (${multisig.members.length}).`
    );
  }

  const vaultPda = await findMultisigVaultPda(multisigPda, vaultIndex);

  const payerKeypairPath = resolveDefaultKeypairPath(customKeypairPath, {
    rpcUrl,
  });
  const adminSigner = await loadKeypair(payerKeypairPath);
  const adminAddress = adminSigner.address;

  if (!skipConfirm) {
    const confirmed = await confirmMainnetExecution(
      "Handoff Protocol Governance & BPF Authority to Squads Multisig",
      {
        "Multisig PDA": multisigPda,
        "Multisig Threshold": `${multisig.threshold} / ${multisig.members.length}`,
        "Derived Vault PDA (Index 0)": vaultPda,
        "Current Admin Signer": adminAddress,
        "Target Program": PROGRAM_ID,
      }
    );
    if (!confirmed) return;
  }

  console.log("\n🔐 Executing Governance Handoff Step 1: Admin Nomination...");
  const nominateIx = await buildNominateAdminInstruction({
    admin: adminSigner,
    pendingAdmin: vaultPda,
  });
  await sendTx(rpc, nominateIx, adminSigner, {
    priorityFeeMicroLamports: 50_000n,
  });
  console.log(`✓ Admin authority nominated to Squads Vault PDA: ${vaultPda}`);

  console.log(
    "\n🔐 Executing Governance Handoff Step 2: Transfer BPF Upgrade Authority..."
  );
  execFileSync(
    "solana",
    [
      "program",
      "set-upgrade-authority",
      PROGRAM_ID,
      "--new-upgrade-authority",
      vaultPda,
      "--keypair",
      payerKeypairPath,
      "--url",
      rpcUrl,
    ],
    { stdio: "inherit" }
  );
  console.log(
    `✓ BPF Loader Upgrade Authority transferred to Squads Vault: ${vaultPda}`
  );

  // Record squadsMultisig into mainnet state
  const existing = readClusterAddresses("mainnet-beta") || {};
  writeClusterAddresses("mainnet-beta", {
    ...existing,
    squadsMultisig: multisigPda,
  } as ProtocolAccounts);

  console.log(
    "\n================================================================="
  );
  console.log("🎉 Governance Handoff Step 1 Completed!");
  console.log(
    "================================================================="
  );
  console.log(
    "Next step: Propose and execute 'accept-admin' through the Squads Multisig:"
  );
  console.log(
    `  npm run pb-cli accept-admin -- --propose --multisig ${multisigPda} --vault-index ${vaultIndex}\n`
  );
}

export async function handleSyncEnv(targetFileArg?: string): Promise<void> {
  const targetFile = targetFileArg || ".env.production";
  console.log(`Synchronizing Mainnet configuration to ${targetFile}...`);
  syncClusterToActiveEnv(
    "mainnet-beta",
    path.resolve(PROJECT_ROOT, targetFile)
  );
  console.log(
    `✓ Successfully synchronized Mainnet configuration to ${targetFile}`
  );
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const parsed = parseMainnetArgs(process.argv);

  if (parsed.flags.help || !parsed.command) {
    printUsage();
    process.exit(0);
  }

  const rpcUrl =
    (parsed.flags.rpc as string) ||
    process.env.MAINNET_RPC_URL ||
    MAINNET_DEFAULT_RPC_URL;
  const customKeypair =
    (parsed.flags.keypair as string) ||
    (parsed.flags.k as string) ||
    (parsed.positionals[0]?.endsWith(".json")
      ? parsed.positionals[0]
      : undefined);
  const skipConfirm = Boolean(parsed.flags.yes);
  const forceRegenerate = Boolean(parsed.flags.forceRegenerate);

  switch (parsed.command) {
    case "status":
      await handleStatus(rpcUrl, customKeypair);
      break;

    case "deploy": {
      const priorityFee = parsed.flags["priority-fee-micro-lamports"]
        ? BigInt(parsed.flags["priority-fee-micro-lamports"] as string)
        : undefined;
      await handleDeploy(rpcUrl, customKeypair, priorityFee, skipConfirm);
      break;
    }

    case "clean-buffers":
      await handleCleanBuffers(rpcUrl, customKeypair, skipConfirm);
      break;

    case "init":
      await handleInit({
        rpcUrl,
        customKeypairPath: customKeypair,
        forceRegenerate,
        explicitHumaPool: parsed.flags["huma-pool"] as string | undefined,
        explicitPstMint: parsed.flags["pst-mint"] as string | undefined,
        explicitVrfAccount: parsed.flags["vrf-account"] as string | undefined,
        skipConfirm,
      });
      break;

    case "handoff-governance": {
      const multisig = parsed.flags.multisig as string | undefined;
      if (!multisig) {
        throw new Error(
          "Missing required '--multisig <pda>' parameter for governance handoff."
        );
      }
      const vaultIndex = parsed.flags["vault-index"]
        ? parseInt(parsed.flags["vault-index"] as string, 10)
        : 0;
      await handleHandoffGovernance({
        rpcUrl,
        multisigAddressStr: multisig,
        vaultIndex,
        customKeypairPath: customKeypair,
        skipConfirm,
      });
      break;
    }

    case "sync-env":
      await handleSyncEnv(parsed.positionals[0]);
      break;

    default:
      console.error(`Unknown command: ${parsed.command}\n`);
      printUsage();
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    printErrorDetails(err, "Mainnet CLI Error");
    process.exit(1);
  });
}
