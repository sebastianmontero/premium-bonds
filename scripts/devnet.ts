import {
  createSolanaRpc,
  address,
  Address,
  AccountRole,
  KeyPairSigner,
  Instruction,
  getBase58Decoder,
  getBase58Encoder,
} from "@solana/kit";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  checkRpcHealth,
  loadKeypair,
  loadOrGenerateKeypair,
  generateAndSaveKeypair,
  sendTx,
  upsertEnvFile,
  readEnvFile,
  createResilientRpc,
  resolveDevnetRpcUrl,
  printErrorDetails,
  ensureTokenMintOnChain,
  buildMintToInstruction,
  fetchAccountInfo,
  fetchAccountData,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ATA_PROGRAM_ID,
  USDC_DECIMALS,
  SOL_DECIMALS,
  DEFAULT_TARGET_SOL_LAMPORTS,
  MIN_ADMIN_RESERVE_LAMPORTS,
  MIN_TRANSFER_THRESHOLD_LAMPORTS,
  DEVNET_FAUCET_URLS,
  DEFAULT_DEVNET_AIRDROP_SOL,
  MIN_ADMIN_FEE_PAYER_LAMPORTS,
  RECIPIENT_AIRDROP_THRESHOLD_LAMPORTS,
  resolveDefaultKeypairPath,
  parseTokenAmount,
  buildTransferSolInstruction,
} from "./utils";
import {
  DevnetProtocolAccounts,
  writeDevnetAddresses,
  readDevnetAddresses,
  syncDevnetToActiveEnv,
  PROJECT_ROOT,
  LOCAL_ENV_PATH,
  DEVNET_ENV_PATH,
} from "./devnet-state";
import { provisionDevnetRandomnessAccount } from "./create-switchboard-randomness";

function loadDevnetAccounts(): DevnetProtocolAccounts {
  const accounts = readDevnetAddresses();
  if (!accounts || !accounts.adminAddress || !accounts.humaPoolState) {
    throw new Error(
      "Devnet accounts not configured. Please run 'npm run devnet init' or 'npm run devnet sync-env'."
    );
  }
  return accounts as DevnetProtocolAccounts;
}
import {
  CANONICAL_KEYPAIRS,
  ProgramKeypairConfig,
  resolveProgramKeypairPath,
  syncKeypairs,
} from "./sync-keys";
import {
  PROGRAM_ID,
  HUMA_PROGRAM_ID,
  findProgramDataPda,
  decodeAccountBase64Data,
  findGlobalConfigPda,
  findPrizePoolPda,
  findPoolVaultPda,
  findPoolPstVaultPda,
  findHumaPoolAuthorityPda,
  findAtaAddress,
  createAssociatedTokenIdempotentInstruction,
  parsePrizePool,
  buildInitializeGlobalInstruction,
  buildCreatePoolInstruction,
  buildInitializeHumaLenderInstruction,
  getSimulateYieldInstructionDataEncoder,
  getSettleRequestsInstructionDataEncoder,
  getInitializeMockPoolStateInstructionDataEncoder,
  getCreateLenderAccountsV2InstructionDataEncoder,
  PrizeTierInput,
} from "../app/lib/bonds-sdk";

export interface ProgramDeployConfig extends ProgramKeypairConfig {
  readonly soPath: string;
}

const DEVNET_PROGRAM_CONFIGS: readonly ProgramDeployConfig[] = [
  {
    name: "mock_huma",
    filename: "mock_huma-keypair.json",
    expectedAddress: HUMA_PROGRAM_ID,
    envVar: "DEVNET_MOCK_HUMA_KEYPAIR",
    soPath: path.resolve(
      __dirname,
      "..",
      "anchor",
      "target",
      "deploy",
      "mock_huma.so"
    ),
  },
  {
    name: "mock_kamino",
    filename: "mock_kamino-keypair.json",
    expectedAddress: address("GVkUHNohGv2AqewpZnciXhjwt3diSsLuDAKp1Q1bH1GA"),
    envVar: "DEVNET_MOCK_KAMINO_KEYPAIR",
    soPath: path.resolve(
      __dirname,
      "..",
      "anchor",
      "target",
      "deploy",
      "mock_kamino.so"
    ),
  },
  {
    name: "anchor",
    filename: "anchor-keypair.json",
    expectedAddress: PROGRAM_ID,
    envVar: "DEVNET_ANCHOR_KEYPAIR",
    soPath: path.resolve(
      __dirname,
      "..",
      "anchor",
      "target",
      "deploy",
      "anchor.so"
    ),
  },
];

function generateRandomAddress(): string {
  const keyPair = crypto.generateKeyPairSync("ed25519");
  const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
  const publicKeyBytes = spki.subarray(12, 44);
  return getBase58Decoder().decode(publicKeyBytes);
}

// Constants
const DEVNET_RPC_URL = resolveDevnetRpcUrl();
const DEPLOY_COMPUTE_UNIT_PRICE =
  process.env.DEPLOY_COMPUTE_UNIT_PRICE || "1000";
const STATE_DIR = path.resolve(__dirname, "devnet-state");
export const DEFAULT_HUMA_VAULT_PREFUND_MICRO_USDC = 1_000_000_000_000n; // 1M USDC

function printUsage() {
  console.log("Usage: npm run devnet [command] [args]");
  console.log("Commands:");
  console.log("  deploy [keypair]      Deploys or upgrades programs to devnet");
  console.log(
    "  clean-buffers [keypair] Reclaims SOL from aborted deploy buffers on devnet"
  );
  console.log(
    "  create-randomness [keypair] [--force] Provisions a Switchboard On-Demand VRF account on devnet (use --force for rebind)"
  );
  console.log(
    "  init [keypair]        Runs on-chain initialization sequence on devnet"
  );

  console.log(
    "  sync-env [target]     Synchronizes .env.devnet state and credentials to .env.local"
  );
  console.log(
    "  fund <wallet> <amount> [keypair] [--sol <amount>] Funds a wallet with Mock USDC and ensures target SOL balance"
  );
  console.log(
    "  yield <amount_usdc>   Simulates yield for the current pool on devnet"
  );
  console.log("  settle [count]        Settles pending redemptions on devnet");
}

export interface ExpectedPoolAddresses {
  readonly tokenMint: Address;
  readonly ticketRegistry: Address;
  readonly feeWallet: Address;
}

/**
 * Reconciles on-chain Prize Pool configuration against expected local addresses.
 */
export function reconcilePoolState(
  onChainPool: {
    tokenMint: Address;
    ticketRegistry: Address;
    feeWallet: Address;
  },
  expected: ExpectedPoolAddresses
): { isMatch: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  if (onChainPool.tokenMint !== expected.tokenMint) {
    mismatches.push(
      `tokenMint mismatch: on-chain=${onChainPool.tokenMint} vs local=${expected.tokenMint}`
    );
  }
  if (onChainPool.ticketRegistry !== expected.ticketRegistry) {
    mismatches.push(
      `ticketRegistry mismatch: on-chain=${onChainPool.ticketRegistry} vs local=${expected.ticketRegistry}`
    );
  }
  if (onChainPool.feeWallet !== expected.feeWallet) {
    mismatches.push(
      `feeWallet mismatch: on-chain=${onChainPool.feeWallet} vs local=${expected.feeWallet}`
    );
  }
  return { isMatch: mismatches.length === 0, mismatches };
}

const PROGRAM_DATA_AUTHORITY_FLAG_OFFSET = 12;
const PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET = 13;
const PUBKEY_LENGTH = 32;
const MIN_PROGRAM_DATA_HEADER_LEN =
  PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET + PUBKEY_LENGTH;

export async function getProgramDeployStatus(
  rpc: ReturnType<typeof createSolanaRpc>,
  programAddress: Address
): Promise<{ isDeployed: boolean; upgradeAuthority: Address | null }> {
  const account = await rpc
    .getAccountInfo(programAddress, { encoding: "base64" })
    .send();
  if (!account.value || !account.value.executable) {
    return { isDeployed: false, upgradeAuthority: null };
  }

  const programDataAddress = await findProgramDataPda(programAddress);
  const dataAccount = await rpc
    .getAccountInfo(programDataAddress, { encoding: "base64" })
    .send();
  if (!dataAccount.value) {
    return { isDeployed: true, upgradeAuthority: null };
  }

  const raw = decodeAccountBase64Data(dataAccount.value);
  if (!raw || raw.length < MIN_PROGRAM_DATA_HEADER_LEN) {
    return { isDeployed: true, upgradeAuthority: null };
  }

  // Verify UpgradeableLoaderState::ProgramData variant tag (3)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(0, true) !== 3) {
    return { isDeployed: true, upgradeAuthority: null };
  }

  const hasAuthority = raw[PROGRAM_DATA_AUTHORITY_FLAG_OFFSET] === 1;
  const authority = hasAuthority
    ? getBase58Decoder().decode(
        raw.subarray(
          PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET,
          PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET + PUBKEY_LENGTH
        )
      )
    : null;

  return {
    isDeployed: true,
    upgradeAuthority: authority ? address(authority) : null,
  };
}

async function deployOrUpgradeProgram(
  rpc: ReturnType<typeof createSolanaRpc>,
  prog: ProgramDeployConfig,
  payerKeypairPath: string,
  payerAddress: Address
): Promise<void> {
  const status = await getProgramDeployStatus(rpc, prog.expectedAddress);

  if (status.isDeployed) {
    if (status.upgradeAuthority === null) {
      throw new Error(
        `Program ${prog.name} (${prog.expectedAddress}) is immutable and cannot be upgraded.`
      );
    }
    if (status.upgradeAuthority !== payerAddress) {
      throw new Error(
        `Authority mismatch for ${prog.name}!\n` +
          `On-chain Upgrade Authority: ${status.upgradeAuthority}\n` +
          `Signer Keypair: ${payerAddress}\n` +
          `Please use the authorized wallet to perform upgrades.`
      );
    }

    console.log(
      `Program ${prog.name} (${prog.expectedAddress}) is initialized on Devnet. Performing upgrade...`
    );
    execFileSync(
      "solana",
      [
        "program",
        "deploy",
        prog.soPath,
        "--program-id",
        prog.expectedAddress,
        "--fee-payer",
        payerKeypairPath,
        "--upgrade-authority",
        payerKeypairPath,
        "--url",
        DEVNET_RPC_URL,
        "--with-compute-unit-price",
        DEPLOY_COMPUTE_UNIT_PRICE,
      ],
      { stdio: "inherit" }
    );
  } else {
    console.log(
      `Program ${prog.name} not found on Devnet. Performing Day-1 initial deployment...`
    );
    const keyPath = await resolveProgramKeypairPath(prog);

    execFileSync(
      "solana",
      [
        "program",
        "deploy",
        prog.soPath,
        "--program-id",
        keyPath,
        "--fee-payer",
        payerKeypairPath,
        "--upgrade-authority",
        payerKeypairPath,
        "--url",
        DEVNET_RPC_URL,
        "--with-compute-unit-price",
        DEPLOY_COMPUTE_UNIT_PRICE,
      ],
      { stdio: "inherit" }
    );
  }
}

async function handleDeploy(args: string[]) {
  const payerKeypairPath = resolveDefaultKeypairPath(args[0]);
  console.log(
    `Loading fee payer / upgrade authority keypair from ${payerKeypairPath}...`
  );
  const payerSigner = await loadKeypair(payerKeypairPath);
  const payerAddress = payerSigner.address;

  console.log("Ensuring keypairs are synchronized...");
  await syncKeypairs();

  console.log("Compiling contracts...");
  execFileSync("anchor", ["build"], {
    cwd: path.resolve(__dirname, "..", "anchor"),
    stdio: "inherit",
    env: { ...process.env, NO_DNA: "1" },
  });

  console.log(`Verifying Devnet RPC connection (${DEVNET_RPC_URL})...`);
  const isHealthy = await checkRpcHealth(DEVNET_RPC_URL);
  if (!isHealthy) {
    console.error(
      `Error: Devnet RPC is not active or reachable at ${DEVNET_RPC_URL}.`
    );
    process.exit(1);
  }

  const rpc = createResilientRpc(DEVNET_RPC_URL);

  for (const prog of DEVNET_PROGRAM_CONFIGS) {
    await deployOrUpgradeProgram(rpc, prog, payerKeypairPath, payerAddress);
  }

  console.log("✓ Deployment pipeline completed successfully!");
}

async function handleCleanBuffers(args: string[]) {
  const payerKeypairPath = resolveDefaultKeypairPath(args[0]);
  console.log(
    `Reclaiming unused program deploy buffers with fee payer / authority ${payerKeypairPath}...`
  );
  execFileSync(
    "solana",
    [
      "program",
      "close",
      "--buffers",
      "--fee-payer",
      payerKeypairPath,
      "--url",
      DEVNET_RPC_URL,
    ],
    { stdio: "inherit" }
  );
  console.log("✓ Buffer cleanup complete.");
}

async function handleCreateRandomness(args: string[]) {
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positionals = args.filter((a) => !a.startsWith("--"));
  const payerKeypairPath = resolveDefaultKeypairPath(positionals[0]);
  const forceNew = flags.has("--force");
  await provisionDevnetRandomnessAccount({ payerKeypairPath, forceNew });
}

async function handleInit(args: string[]) {
  const keypairPath = resolveDefaultKeypairPath(args[0]);
  console.log(
    `Loading administration authority keypair from ${keypairPath}...`
  );
  const adminSigner = await loadKeypair(keypairPath);
  const adminAddress = adminSigner.address;

  console.log(`Admin authority address: ${adminAddress}`);

  console.log("Verifying Devnet RPC connection...");
  const isHealthy = await checkRpcHealth(DEVNET_RPC_URL);
  if (!isHealthy) {
    console.error("Error: Devnet RPC is not active or reachable.");
    process.exit(1);
  }

  const rpc = createResilientRpc(DEVNET_RPC_URL);

  // Switchboard randomness account: auto-provision if missing
  const devnetEnv = readEnvFile(DEVNET_ENV_PATH);
  let randomnessAddressStr =
    process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT ||
    devnetEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT;

  if (!randomnessAddressStr) {
    console.log(
      "ℹ No NEXT_PUBLIC_RANDOMNESS_ACCOUNT configured. Automatically provisioning Switchboard On-Demand VRF account..."
    );
    const result = await provisionDevnetRandomnessAccount({
      payerKeypairPath: keypairPath,
    });
    randomnessAddressStr = result.address;
  }

  // Create state directory
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  const anchorProgramId = PROGRAM_ID;
  const mockHumaProgramId = HUMA_PROGRAM_ID;

  // Create mock Huma state accounts
  console.log("Deriving Huma accounts...");
  const humaPoolStateKeyPath = path.resolve(
    STATE_DIR,
    "huma-pool-state-key.json"
  );
  const humaPoolStateSigner = await loadOrGenerateKeypair(
    humaPoolStateKeyPath,
    { overwriteIfInvalid: true, label: "Huma Pool State" }
  );

  console.log(`Huma Pool State address: ${humaPoolStateSigner.address}`);

  // Call initialize_mock_pool_state on mock_huma program
  const humaPoolStateInfo = await fetchAccountInfo(
    rpc,
    humaPoolStateSigner.address
  );
  if (!humaPoolStateInfo?.value) {
    console.log("Initializing Huma mock pool state on-chain...");
    const initHumaIx = {
      programAddress: address(mockHumaProgramId),
      accounts: [
        {
          address: humaPoolStateSigner.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer: humaPoolStateSigner,
        },
        {
          address: address(adminAddress),
          role: AccountRole.WRITABLE_SIGNER,
          signer: adminSigner,
        },
        {
          address: SYSTEM_PROGRAM_ID,
          role: AccountRole.READONLY,
        },
      ],
      data: getInitializeMockPoolStateInstructionDataEncoder().encode({}),
    };
    await sendTx(rpc, initHumaIx, [adminSigner, humaPoolStateSigner]);
  } else {
    console.log("Huma mock pool state already initialized on-chain.");
  }

  // Create mock USDC Mint if not specified
  const usdcKeyPath = path.resolve(STATE_DIR, "usdc-mint.json");
  const usdcMintSigner = await loadOrGenerateKeypair(usdcKeyPath, {
    overwriteIfInvalid: true,
    label: "Mock USDC Mint",
  });
  const usdcMintAddress = process.env.NEXT_PUBLIC_USDC_MINT
    ? address(process.env.NEXT_PUBLIC_USDC_MINT)
    : usdcMintSigner.address;

  if (!process.env.NEXT_PUBLIC_USDC_MINT) {
    await ensureTokenMintOnChain(rpc, {
      payer: adminSigner,
      mint: usdcMintSigner,
      decimals: 6,
      mintAuthority: adminAddress,
      label: "Mock USDC Mint",
    });
  }

  // Derive pool authority
  const poolAuthority = await findHumaPoolAuthorityPda(
    humaPoolStateSigner.address
  );
  console.log(`Derived Huma Pool Authority: ${poolAuthority}`);

  // Create PST Mint on-chain
  console.log("Creating Huma Mock PST Mint on-chain...");
  const pstKeyPath = path.resolve(STATE_DIR, "pst-mint.json");
  const pstMintSigner = await loadOrGenerateKeypair(pstKeyPath, {
    overwriteIfInvalid: true,
    label: "Mock PST Mint",
  });
  const pstMintAddress = pstMintSigner.address;
  console.log(`Mock PST Address: ${pstMintAddress}`);

  await ensureTokenMintOnChain(rpc, {
    payer: adminSigner,
    mint: pstMintSigner,
    decimals: 6,
    mintAuthority: poolAuthority,
    label: "Mock PST Mint",
  });

  // Create Huma Pool Underlying token account owned by pool_authority
  console.log("Creating Huma Pool Underlying Token Account...");
  const humaPoolUnderlying = await findAtaAddress(
    poolAuthority,
    usdcMintAddress
  );
  console.log(`Huma Pool Underlying ATA: ${humaPoolUnderlying}`);

  // Create Huma Pool Mode Token account owned by pool_authority
  console.log("Creating Huma Pool Mode Token Account...");
  const humaPoolModeToken = await findAtaAddress(poolAuthority, pstMintAddress);
  console.log(`Huma Pool Mode Token ATA: ${humaPoolModeToken}`);

  // Create Admin Fee Wallet (Associated USDC Token Account for Admin)
  console.log("Creating Admin Fee Wallet...");
  const feeWallet = await findAtaAddress(adminAddress, usdcMintAddress);
  console.log(`Admin Fee Wallet: ${feeWallet}`);

  // Batch ATA creation in single transaction
  console.log("Creating ATAs idempotently on-chain...");
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
  await sendTx(rpc, [underlyingAtaIx, modeAtaIx, feeWalletAtaIx], adminSigner);

  // Create Huma Lender State account
  console.log("Creating Huma Lender State account...");
  const humaLenderStateKeyPath = path.resolve(
    STATE_DIR,
    "huma-lender-state-key.json"
  );
  const humaLenderStateSigner = await loadOrGenerateKeypair(
    humaLenderStateKeyPath,
    { overwriteIfInvalid: true, label: "Huma Lender State" }
  );

  // Call create_lender_accounts_v2 on mock_huma program
  const humaLenderStateInfo = await fetchAccountInfo(
    rpc,
    humaLenderStateSigner.address
  );
  if (!humaLenderStateInfo?.value) {
    console.log("Initializing Huma lender accounts on-chain...");
    const initLenderIx = {
      programAddress: address(mockHumaProgramId),
      accounts: [
        {
          address: address(adminAddress),
          role: AccountRole.WRITABLE_SIGNER,
          signer: adminSigner,
        },
        {
          address: address(adminAddress),
          role: AccountRole.WRITABLE_SIGNER,
          signer: adminSigner,
        }, // lender
        { address: address(adminAddress), role: AccountRole.READONLY }, // huma_config
        { address: address(adminAddress), role: AccountRole.READONLY }, // pool_config
        {
          address: address(humaPoolStateSigner.address),
          role: AccountRole.READONLY,
        },
        { address: address(adminAddress), role: AccountRole.READONLY }, // mode_config
        { address: address(pstMintAddress), role: AccountRole.READONLY }, // mode_mint
        {
          address: address(humaLenderStateSigner.address),
          role: AccountRole.WRITABLE_SIGNER,
          signer: humaLenderStateSigner,
        },
        { address: address(adminAddress), role: AccountRole.WRITABLE }, // lender_mode_token
        {
          address: TOKEN_PROGRAM_ID,
          role: AccountRole.READONLY,
        },
        {
          address: ATA_PROGRAM_ID,
          role: AccountRole.READONLY,
        },
        {
          address: SYSTEM_PROGRAM_ID,
          role: AccountRole.READONLY,
        },
      ],
      data: getCreateLenderAccountsV2InstructionDataEncoder().encode({}),
    };
    await sendTx(rpc, initLenderIx, [adminSigner, humaLenderStateSigner]);
  } else {
    console.log("Huma lender accounts already initialized on-chain.");
  }

  // Derive Prize Pool 1 PDAs
  const poolId = 1;
  const poolAddress = await findPrizePoolPda(poolId);
  const poolVaultAddress = await findPoolVaultPda(poolId);
  const poolPstVaultAddress = await findPoolPstVaultPda(poolId);
  const poolInfo = await rpc
    .getAccountInfo(poolAddress, { encoding: "base64" })
    .send();

  // Create Ticket Registry
  console.log("Allocating Ticket Registry account...");
  const ticketRegistryKeyPath = path.resolve(
    STATE_DIR,
    "ticket-registry-key.json"
  );
  let ticketRegistrySigner = await loadOrGenerateKeypair(
    ticketRegistryKeyPath,
    { overwriteIfInvalid: true, label: "Ticket Registry" }
  );

  let ticketRegistryAddress = ticketRegistrySigner.address;
  console.log(`Ticket Registry address: ${ticketRegistryAddress}`);

  let ticketRegistryInfo = await rpc
    .getAccountInfo(ticketRegistryAddress, { encoding: "base64" })
    .send();

  // If ticket registry account exists on-chain but pool is not yet initialized, verify discriminator is all zeros
  if (ticketRegistryInfo?.value && !poolInfo?.value) {
    const rawData = decodeAccountBase64Data(ticketRegistryInfo.value);
    const isZeroed = rawData
      ? rawData.subarray(0, 8).every((b: number) => b === 0)
      : true;
    if (!isZeroed) {
      console.warn(
        "⚠️  Existing Ticket Registry account has non-zero discriminator from a prior run. Regenerating fresh keypair..."
      );
      ticketRegistrySigner = await generateAndSaveKeypair(
        ticketRegistryKeyPath
      );
      ticketRegistryAddress = ticketRegistrySigner.address;
      console.log(`New Ticket Registry address: ${ticketRegistryAddress}`);
      ticketRegistryInfo = await rpc
        .getAccountInfo(ticketRegistryAddress, { encoding: "base64" })
        .send();
    }
  }

  if (!ticketRegistryInfo?.value) {
    const space = 262248;
    const rentExempt = await rpc
      .getMinimumBalanceForRentExemption(BigInt(space))
      .send();
    console.log(
      `Required rent exemption for Ticket Registry: ${Number(rentExempt) / 1_000_000_000} SOL`
    );

    const createAccountData = new Uint8Array(4 + 8 + 8 + 32);
    const createAccountView = new DataView(createAccountData.buffer);
    createAccountView.setUint32(0, 0, true); // SystemProgram::CreateAccount instruction index
    createAccountView.setBigUint64(4, rentExempt, true);
    createAccountView.setBigUint64(12, BigInt(space), true);
    const base58 = getBase58Encoder();
    createAccountData.set(base58.encode(address(anchorProgramId)), 20);

    const createAccountIx = {
      programAddress: SYSTEM_PROGRAM_ID,
      accounts: [
        {
          address: address(adminAddress),
          role: AccountRole.WRITABLE_SIGNER,
          signer: adminSigner,
        },
        {
          address: address(ticketRegistryAddress),
          role: AccountRole.WRITABLE_SIGNER,
          signer: ticketRegistrySigner,
        },
      ],
      data: createAccountData,
    };
    console.log(
      "Sending System CreateAccount transaction for Ticket Registry..."
    );
    await sendTx(rpc, createAccountIx, [adminSigner, ticketRegistrySigner]);
  } else {
    console.log("Ticket Registry account already allocated on-chain.");
  }

  // Initialize Global Config
  const globalConfigAddress = await findGlobalConfigPda();
  const globalConfigInfo = await fetchAccountInfo(rpc, globalConfigAddress);
  if (!globalConfigInfo?.value) {
    console.log("Initializing YieldBonds GlobalConfig...");
    const initGlobalIx = await buildInitializeGlobalInstruction({
      authority: adminSigner,
      admin: address(adminAddress),
      jobsAccount: address(adminAddress),
    });
    await sendTx(rpc, initGlobalIx, adminSigner);
  } else {
    console.log("GlobalConfig already initialized on-chain.");
  }

  // Initialize Prize Pool 1
  let canonicalUsdcMint: Address = usdcMintAddress;
  let canonicalPstMint: Address = pstMintAddress;
  let canonicalTicketRegistry: Address = ticketRegistryAddress;
  let canonicalFeeWallet: Address = address(feeWallet);

  if (!poolInfo?.value) {
    console.log("Creating Prize Pool 1 via SDK builder...");
    const prizeTiers: PrizeTierInput[] = [
      { basisPoints: 5000, numWinners: 1 }, // Grand prize: 50%
      { basisPoints: 1500, numWinners: 2 }, // Runner-up: 30% (15% each)
      { basisPoints: 400, numWinners: 5 }, // Consolation: 20% (4% each)
    ];

    const createPoolIx = await buildCreatePoolInstruction({
      admin: adminSigner,
      poolId,
      bondPrice: 1_000_000n, // 1 USDC
      stakeCycleDurationHrs: 6n,
      feeBasisPoints: 100, // 1%
      minYieldThreshold: 0n,
      maxYieldBasisPoints: 0,
      payoutTimelockSeconds: 300,
      prizeTiers,
      tokenMint: usdcMintAddress,
      pstMint: pstMintAddress,
      ticketRegistry: ticketRegistryAddress,
      feeWallet: address(feeWallet),
      humaPoolState: humaPoolStateSigner.address,
    });
    await sendTx(rpc, createPoolIx, adminSigner);

    console.log("Initializing Huma lender account on YieldBonds program...");
    const initHumaLenderIx = await buildInitializeHumaLenderInstruction({
      admin: adminSigner,
      poolId,
      humaStateAddresses: {
        humaProgram: mockHumaProgramId,
        humaConfig: mockHumaProgramId,
        humaPoolConfig: mockHumaProgramId,
        humaPoolState: humaPoolStateSigner.address,
        humaModeConfig: mockHumaProgramId,
        humaModeMint: pstMintAddress,
        humaLenderState: humaLenderStateSigner.address,
        humaLenderModeToken: poolPstVaultAddress,
      },
    });
    await sendTx(rpc, initHumaLenderIx, adminSigner);
  } else {
    console.log(
      "Prize Pool 1 already initialized on-chain. Reconciling state..."
    );
    const rawData = decodeAccountBase64Data(poolInfo.value);
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
        console.warn(
          "⚠️  On-chain Prize Pool 1 addresses differ from local disk state:"
        );
        for (const mismatch of reconciliation.mismatches) {
          console.warn(`    - ${mismatch}`);
        }
        console.log(
          "Adopting canonical on-chain addresses for configuration sync."
        );
      }
      canonicalUsdcMint = onChainPool.tokenMint;
      canonicalTicketRegistry = onChainPool.ticketRegistry;
      canonicalFeeWallet = onChainPool.feeWallet;
    }
  }

  // Write addresses configuration files
  const devnetAccounts: DevnetProtocolAccounts = {
    programId: anchorProgramId,
    humaProgramId: mockHumaProgramId,
    adminAddress,
    usdcMint: canonicalUsdcMint,
    pstMint: canonicalPstMint,
    ticketRegistry: canonicalTicketRegistry,
    feeWallet: canonicalFeeWallet,
    humaPoolState: humaPoolStateSigner.address,
    humaLenderState: humaLenderStateSigner.address,
    humaPoolUnderlying,
    humaPoolModeToken,
    humaRedemptionRequest: generateRandomAddress(),
    randomnessAccount: randomnessAddressStr,
  };

  writeDevnetAddresses(devnetAccounts);
  syncDevnetToActiveEnv();

  console.log("Devnet initialization sequence completed successfully!");
}

export interface FundCliOptions {
  readonly recipient: Address;
  readonly microUsdcAmount: bigint;
  readonly targetSolLamports: bigint;
  readonly keypairPath?: string;
}

export function parseFundArgs(args: readonly string[]): FundCliOptions {
  let solStr: string | undefined;
  let i = 0;
  const positionals: string[] = [];

  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--sol=")) {
      solStr = arg.slice("--sol=".length);
      i++;
    } else if (arg === "--sol") {
      if (i + 1 >= args.length) {
        throw new Error("Missing value for --sol argument.");
      }
      solStr = args[i + 1];
      i += 2;
    } else {
      positionals.push(arg);
      i++;
    }
  }

  if (positionals.length < 2) {
    throw new Error(
      "Missing required arguments. Usage: npm run devnet fund <wallet> <amount> [keypair] [--sol <amount>]"
    );
  }

  const recipient = address(positionals[0]);
  const microUsdcAmount = parseTokenAmount(positionals[1], USDC_DECIMALS);
  const keypairPath = positionals[2];

  let targetSolLamports = DEFAULT_TARGET_SOL_LAMPORTS;
  if (solStr !== undefined) {
    const trimmedSol = solStr.trim();
    if (trimmedSol === "0" || trimmedSol === "0.0") {
      targetSolLamports = 0n;
    } else {
      targetSolLamports = parseTokenAmount(trimmedSol, SOL_DECIMALS);
    }
  }

  return {
    recipient,
    microUsdcAmount,
    targetSolLamports,
    keypairPath,
  };
}

export interface CalculateFallbackSolParams {
  readonly recipientBalance: bigint;
  readonly targetSolLamports: bigint;
  readonly adminBalance: bigint;
  readonly minAdminReserveLamports?: bigint;
  readonly minTransferThresholdLamports?: bigint;
}

export interface FallbackSolCalculation {
  readonly neededLamports: bigint;
  readonly transferSolLamports: bigint;
  readonly shouldFallbackTransfer: boolean;
  readonly adminHasShortfall: boolean;
}

export function calculateFallbackSolTransfer(
  params: CalculateFallbackSolParams
): FallbackSolCalculation {
  const minReserve =
    params.minAdminReserveLamports ?? MIN_ADMIN_RESERVE_LAMPORTS;
  const minThreshold =
    params.minTransferThresholdLamports ?? MIN_TRANSFER_THRESHOLD_LAMPORTS;

  const neededLamports =
    params.recipientBalance >= params.targetSolLamports
      ? 0n
      : params.targetSolLamports - params.recipientBalance;

  if (neededLamports === 0n || neededLamports < minThreshold) {
    return {
      neededLamports,
      transferSolLamports: 0n,
      shouldFallbackTransfer: false,
      adminHasShortfall: false,
    };
  }

  const availableAdminLamports =
    params.adminBalance > minReserve ? params.adminBalance - minReserve : 0n;

  if (availableAdminLamports < minThreshold) {
    return {
      neededLamports,
      transferSolLamports: 0n,
      shouldFallbackTransfer: false,
      adminHasShortfall: true,
    };
  }

  const transferSolLamports =
    availableAdminLamports >= neededLamports
      ? neededLamports
      : availableAdminLamports;

  return {
    neededLamports,
    transferSolLamports,
    shouldFallbackTransfer: true,
    adminHasShortfall: availableAdminLamports < neededLamports,
  };
}

export async function requestDevnetAirdrop(
  rpc: ReturnType<typeof createSolanaRpc>,
  recipient: Address,
  lamports: bigint,
  timeoutMs = 6000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await rpc
        .requestAirdrop(recipient, lamports as any, {
          commitment: "confirmed",
        })
        .send({ abortSignal: controller.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
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

  const mintToIx = buildMintToInstruction({
    mint: params.usdcMint,
    destination: recipientAta,
    authority: mintAuthority,
    amount: params.microUsdcAmount,
  });
  instructions.push(mintToIx);

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

async function handleFund(args: string[]) {
  const {
    recipient,
    microUsdcAmount,
    targetSolLamports,
    keypairPath: customKeypairPath,
  } = parseFundArgs(args);
  const keypairPath = resolveDefaultKeypairPath(customKeypairPath);

  const rpc = createResilientRpc(DEVNET_RPC_URL);
  const adminSigner = await loadKeypair(keypairPath);

  // 1. Pre-flight check admin fee payer SOL balance
  const adminBalanceRes = await rpc.getBalance(adminSigner.address).send();
  const adminBalance = adminBalanceRes.value;
  if (adminBalance < MIN_ADMIN_FEE_PAYER_LAMPORTS) {
    throw new Error(
      `Admin fee payer (${adminSigner.address}) has insufficient SOL (${Number(adminBalance) / 1e9} SOL).\n` +
        `Please fund it: solana airdrop 2 ${adminSigner.address} --url ${DEVNET_RPC_URL}`
    );
  }

  let transferSolLamports: bigint | undefined;

  // 2. SOL Funding Check & Airdrop / Fallback Logic
  if (targetSolLamports > 0n) {
    const recipientBalanceRes = await rpc.getBalance(recipient).send();
    const recipientBalance = recipientBalanceRes.value;

    if (recipientBalance >= targetSolLamports) {
      console.log(
        `Recipient already holds ${Number(recipientBalance) / 1e9} SOL (target: ${Number(targetSolLamports) / 1e9} SOL); skipping SOL funding.`
      );
    } else {
      const neededLamports = targetSolLamports - recipientBalance;
      const isSelf = adminSigner.address === recipient;

      console.log(
        `Recipient holds ${Number(recipientBalance) / 1e9} SOL (target: ${Number(targetSolLamports) / 1e9} SOL). Requesting airdrop of ${Number(neededLamports) / 1e9} SOL...`
      );

      const airdropSuccess = await requestDevnetAirdrop(
        rpc,
        recipient,
        neededLamports,
        6000
      );

      if (airdropSuccess) {
        console.log(
          `✓ Devnet SOL faucet airdrop succeeded (${Number(neededLamports) / 1e9} SOL)!`
        );
      } else {
        console.warn(
          "⚠️  Devnet public faucet airdrop failed or was rate-limited (HTTP 429)."
        );

        if (isSelf) {
          console.warn(
            "Recipient is the admin fee payer; skipping self-transfer fallback."
          );
          console.warn(
            `Please obtain Devnet SOL from one of the following faucets:\n` +
              DEVNET_FAUCET_URLS.map((url) => `  • ${url}`).join("\n")
          );
        } else {
          const fallback = calculateFallbackSolTransfer({
            recipientBalance,
            targetSolLamports,
            adminBalance,
          });

          if (fallback.shouldFallbackTransfer) {
            transferSolLamports = fallback.transferSolLamports;
            console.log(
              `✓ Bundling direct SOL fallback transfer of ${Number(transferSolLamports) / 1e9} SOL from admin wallet (${adminSigner.address}) into atomic funding transaction.`
            );
          }

          if (fallback.adminHasShortfall) {
            console.warn(
              `⚠️  Admin wallet has insufficient SOL to cover full target top-up while preserving the 0.05 SOL gas reserve.`
            );
            console.warn(
              `Please obtain additional Devnet SOL from one of the following faucets:\n` +
                DEVNET_FAUCET_URLS.map((url) => `  • ${url}`).join("\n")
            );
          }
        }
      }
    }
  } else {
    console.log("Target SOL is 0; skipping SOL funding.");
  }

  // 3. Mock USDC Minting & Atomic Execution
  const accounts = loadDevnetAccounts();
  const usdcMintStr = accounts.usdcMint;
  if (!usdcMintStr) {
    throw new Error("Mock USDC mint not found in Devnet protocol accounts");
  }

  const { recipientAta, instructions, signers } = await buildFundInstructions({
    payer: adminSigner,
    recipient,
    usdcMint: address(usdcMintStr),
    microUsdcAmount,
    transferSolLamports,
  });

  console.log(
    `Broadcasting funding transaction to ${recipient} (ATA: ${recipientAta}${transferSolLamports ? `, SOL: ${Number(transferSolLamports) / 1e9} SOL` : ""})...`
  );
  await sendTx(rpc, instructions, signers);
  console.log(
    `✓ Successfully funded ${recipient} with ${microUsdcAmount} micro-USDC${transferSolLamports ? ` and ${Number(transferSolLamports) / 1e9} SOL` : ""}!`
  );
}

async function handleYield(args: string[]) {
  if (args.length < 1) {
    throw new Error(
      "Missing yield amount. Usage: npm run devnet yield <amount_usdc>"
    );
  }

  const amountUsdcStr = args[0];
  const yieldAmountMicroUsdc = parseTokenAmount(amountUsdcStr, USDC_DECIMALS);
  const rpc = createResilientRpc(DEVNET_RPC_URL);

  const accounts = loadDevnetAccounts();
  const { adminAddress, humaProgramId, humaPoolState } = accounts;

  if (!adminAddress || !humaProgramId || !humaPoolState) {
    throw new Error(
      "Missing required configuration variables in Devnet protocol accounts"
    );
  }

  // Load admin keypair
  const keypairPath = resolveDefaultKeypairPath();
  const adminSigner = await loadKeypair(keypairPath);

  console.log(
    `Sending simulate_yield transaction for ${amountUsdcStr} USDC...`
  );
  const yieldIx = {
    programAddress: address(humaProgramId),
    accounts: [
      { address: address(humaPoolState), role: AccountRole.WRITABLE },
      {
        address: address(adminAddress),
        role: AccountRole.WRITABLE_SIGNER,
        signer: adminSigner,
      },
    ],
    data: getSimulateYieldInstructionDataEncoder().encode({
      yieldAmount: yieldAmountMicroUsdc,
    }),
  };

  await sendTx(rpc, yieldIx, adminSigner);
  console.log("Simulated yield applied successfully on-chain!");
}

async function handleSettle(args: string[]) {
  const countStr = args[0] || "0";
  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 0) {
    throw new Error("count must be a non-negative integer.");
  }

  const rpc = createResilientRpc(DEVNET_RPC_URL);
  const accounts = loadDevnetAccounts();

  const {
    adminAddress,
    humaProgramId,
    humaPoolState,
    humaLenderState: lenderState,
    usdcMint,
    pstMint,
    humaPoolUnderlying,
    humaPoolModeToken,
  } = accounts;

  if (
    !adminAddress ||
    !humaProgramId ||
    !humaPoolState ||
    !lenderState ||
    !usdcMint ||
    !pstMint ||
    !humaPoolUnderlying ||
    !humaPoolModeToken
  ) {
    throw new Error(
      "Missing required configuration variables in Devnet protocol accounts"
    );
  }

  // Load admin keypair
  const keypairPath = resolveDefaultKeypairPath();
  const adminSigner = await loadKeypair(keypairPath);

  // Derive pool authority
  const poolAuthority = await findHumaPoolAuthorityPda(humaPoolState);

  console.log(`Sending settle_requests transaction for count=${count}...`);
  const settleIx = {
    programAddress: address(humaProgramId),
    accounts: [
      {
        address: address(adminAddress),
        role: AccountRole.WRITABLE_SIGNER,
        signer: adminSigner,
      }, // lender/signer
      { address: address(adminAddress), role: AccountRole.READONLY }, // mock config
      { address: address(adminAddress), role: AccountRole.READONLY }, // pool config
      { address: address(humaPoolState), role: AccountRole.WRITABLE },
      { address: address(adminAddress), role: AccountRole.READONLY }, // mode config
      { address: address(lenderState), role: AccountRole.WRITABLE },
      { address: address(usdcMint), role: AccountRole.READONLY },
      { address: address(pstMint), role: AccountRole.WRITABLE },
      { address: poolAuthority, role: AccountRole.READONLY },
      { address: address(humaPoolUnderlying), role: AccountRole.WRITABLE },
      { address: address(humaPoolModeToken), role: AccountRole.WRITABLE },
      {
        address: TOKEN_PROGRAM_ID,
        role: AccountRole.READONLY,
      },
    ],
    data: getSettleRequestsInstructionDataEncoder().encode({ count }),
  };

  // Fund Huma Pool Underlying token account with USDC to support disburse transfers if needed
  console.log("Ensuring Mock Huma Pool Vault has underlying funds...");
  try {
    const prefundIx = buildMintToInstruction({
      mint: address(usdcMint),
      destination: address(humaPoolUnderlying),
      authority: adminSigner,
      amount: DEFAULT_HUMA_VAULT_PREFUND_MICRO_USDC,
    });
    await sendTx(rpc, prefundIx, adminSigner);
    console.log("✓ Pre-funded mock Huma pool underlying vault.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Could not pre-fund mock Huma pool underlying vault: ${msg}`);
  }

  await sendTx(rpc, settleIx, adminSigner);
  console.log("Redemption requests settled successfully on-chain!");
}

async function handleSyncEnv(args: string[]) {
  const targetFile = args[0] || ".env.local";
  console.log(
    `Re-synchronizing Devnet configuration from .env.devnet to ${targetFile}...`
  );

  const devnetVars = syncDevnetToActiveEnv(
    path.resolve(PROJECT_ROOT, targetFile)
  );

  console.log(
    `✓ Successfully synchronized Devnet configuration to ${targetFile}`
  );
  if (devnetVars.DATABASE_URL) console.log("  • Preserved DATABASE_URL");
  if (devnetVars.HELIUS_WEBHOOK_SECRET)
    console.log("  • Preserved HELIUS_WEBHOOK_SECRET");
  if (devnetVars.NEXT_PUBLIC_RANDOMNESS_ACCOUNT)
    console.log("  • Preserved NEXT_PUBLIC_RANDOMNESS_ACCOUNT");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  // Mainnet Block Check
  for (const arg of args) {
    if (arg.includes("mainnet") || arg.includes("api.mainnet-beta")) {
      throw new Error(
        "❌ CRITICAL SECURITY ERROR: Devnet CLI is strictly blocked from targeting mainnet-beta."
      );
    }
  }

  switch (command) {
    case "deploy":
      await handleDeploy(args.slice(1));
      break;
    case "clean-buffers":
      await handleCleanBuffers(args.slice(1));
      break;
    case "create-randomness":
      await handleCreateRandomness(args.slice(1));
      break;
    case "init":
      await handleInit(args.slice(1));
      break;

    case "sync-env":
      await handleSyncEnv(args.slice(1));
      break;
    case "fund":
      await handleFund(args.slice(1));
      break;
    case "yield":
      await handleYield(args.slice(1));
      break;
    case "settle":
      await handleSettle(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (err) {
    printErrorDetails(err, "Devnet Orchestrator");
    process.exit(1);
  }
}

if (require.main === module) {
  void run();
}
