import {
  createSolanaRpc,
  address,
  Address,
  AccountRole,
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
  sendTx,
  upsertEnvFile,
  readEnvFile,
  createResilientRpc,
  resolveDevnetRpcUrl,
  printErrorDetails,
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
  findPoolVaultAccountPda,
  findPoolPstVaultPda,
  findHumaPoolAuthorityPda,
  findAtaAddress,
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
    "  fund <wallet> <amount> Funds a wallet with SOL (airdrop) and Mock USDC"
  );
  console.log(
    "  yield <amount_usdc>   Simulates yield for the current pool on devnet"
  );
  console.log("  settle [count]        Settles pending redemptions on devnet");
}

function serializeSimulateYieldData(yieldAmount: bigint): Uint8Array {
  return getSimulateYieldInstructionDataEncoder().encode({ yieldAmount });
}

function serializeSettleRequestsData(count: number): Uint8Array {
  return getSettleRequestsInstructionDataEncoder().encode({ count });
}

function serializeInitializeMockPoolState(): Uint8Array {
  return getInitializeMockPoolStateInstructionDataEncoder().encode({});
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
  const payerKeypairPath =
    args[0] ||
    path.resolve(process.env.HOME || "", ".config", "solana", "id.json");
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
  const payerKeypairPath =
    args[0] ||
    path.resolve(process.env.HOME || "", ".config", "solana", "id.json");
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
  const payerKeypairPath = positionals[0];
  const forceNew = flags.has("--force");
  await provisionDevnetRandomnessAccount({ payerKeypairPath, forceNew });
}

async function handleInit(args: string[]) {
  const keypairPath =
    args[0] ||
    path.resolve(process.env.HOME || "", ".config", "solana", "id.json");
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
  const humaPoolStateSigner = await loadKeypair(humaPoolStateKeyPath).catch(
    async () => {
      const bytes = crypto.randomBytes(64);
      fs.writeFileSync(
        humaPoolStateKeyPath,
        JSON.stringify(Array.from(bytes)),
        "utf-8"
      );
      return await loadKeypair(humaPoolStateKeyPath);
    }
  );

  console.log(`Huma Pool State address: ${humaPoolStateSigner.address}`);

  // Call initialize_mock_pool_state on mock_huma program
  const humaPoolStateInfo = await rpc
    .getAccountInfo(humaPoolStateSigner.address)
    .send();
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
          address: address("11111111111111111111111111111111"),
          role: AccountRole.READONLY,
        },
      ],
      data: serializeInitializeMockPoolState(),
    };
    await sendTx(rpc, initHumaIx, [adminSigner, humaPoolStateSigner]);
  } else {
    console.log("Huma mock pool state already initialized on-chain.");
  }

  // Create mock USDC Mint if not specified
  let usdcMintStr = process.env.NEXT_PUBLIC_USDC_MINT;
  if (!usdcMintStr) {
    console.log("Creating new Mock USDC Mint on-chain...");
    const usdcKeyPath = path.resolve(STATE_DIR, "usdc-mint.json");
    if (!fs.existsSync(usdcKeyPath)) {
      execFileSync(
        "solana-keygen",
        ["new", "-o", usdcKeyPath, "--no-passphrase"],
        {
          stdio: "inherit",
        }
      );
    }
    usdcMintStr = execFileSync("solana", ["address", "-k", usdcKeyPath], {
      encoding: "utf-8",
    }).trim();
    console.log(`Derived Mock USDC Address: ${usdcMintStr}`);

    try {
      execFileSync(
        "spl-token",
        [
          "create-mint",
          usdcKeyPath,
          "--decimals",
          "6",
          "--fee-payer",
          keypairPath,
          "--url",
          DEVNET_RPC_URL,
        ],
        { stdio: "inherit" }
      );
      console.log("USDC Mint created successfully on-chain!");
    } catch {
      console.warn(
        "Failed creating USDC mint via spl-token CLI, it might already exist on-chain."
      );
    }
  }

  // Derive pool authority
  const poolAuthority = await findHumaPoolAuthorityPda(
    humaPoolStateSigner.address
  );
  console.log(`Derived Huma Pool Authority: ${poolAuthority}`);

  // Create PST Mint on-chain
  console.log("Creating Huma Mock PST Mint on-chain...");
  const pstKeyPath = path.resolve(STATE_DIR, "pst-mint.json");
  if (!fs.existsSync(pstKeyPath)) {
    execFileSync(
      "solana-keygen",
      ["new", "-o", pstKeyPath, "--no-passphrase"],
      {
        stdio: "inherit",
      }
    );
  }
  const pstMintStr = execFileSync("solana", ["address", "-k", pstKeyPath], {
    encoding: "utf-8",
  }).trim();
  console.log(`Mock PST Address: ${pstMintStr}`);

  try {
    execFileSync(
      "spl-token",
      [
        "create-mint",
        pstKeyPath,
        "--decimals",
        "6",
        "--mint-authority",
        poolAuthority,
        "--fee-payer",
        keypairPath,
        "--url",
        DEVNET_RPC_URL,
      ],
      { stdio: "inherit" }
    );
    console.log("PST Mint created successfully!");
  } catch {
    console.warn("PST mint creation failed or already exists.");
  }

  // Create Huma Pool Underlying token account owned by pool_authority
  console.log("Creating Huma Pool Underlying Token Account...");
  const humaPoolUnderlying = await findAtaAddress(poolAuthority, usdcMintStr);
  console.log(`Huma Pool Underlying ATA: ${humaPoolUnderlying}`);
  try {
    execFileSync(
      "spl-token",
      [
        "create-address",
        usdcMintStr,
        "--owner",
        poolAuthority,
        "--fee-payer",
        keypairPath,
        "--url",
        DEVNET_RPC_URL,
      ],
      { stdio: "inherit" }
    );
  } catch {
    console.warn(
      "Huma Pool Underlying token account creation skipped or already exists."
    );
  }

  // Create Huma Pool Mode Token account owned by pool_authority
  console.log("Creating Huma Pool Mode Token Account...");
  const humaPoolModeToken = await findAtaAddress(poolAuthority, pstMintStr);
  console.log(`Huma Pool Mode Token ATA: ${humaPoolModeToken}`);
  try {
    execFileSync(
      "spl-token",
      [
        "create-address",
        pstMintStr,
        "--owner",
        poolAuthority,
        "--fee-payer",
        keypairPath,
        "--url",
        DEVNET_RPC_URL,
      ],
      { stdio: "inherit" }
    );
  } catch {
    console.warn(
      "Huma Pool Mode Token account creation skipped or already exists."
    );
  }

  // Create Admin Fee Wallet (Associated USDC Token Account for Admin)
  console.log("Creating Admin Fee Wallet...");
  const feeWallet = await findAtaAddress(adminAddress, usdcMintStr);
  console.log(`Admin Fee Wallet: ${feeWallet}`);
  try {
    execFileSync(
      "spl-token",
      [
        "create-account",
        usdcMintStr,
        "--fee-payer",
        keypairPath,
        "--url",
        DEVNET_RPC_URL,
      ],
      { stdio: "inherit" }
    );
  } catch {
    console.warn("Admin Fee Wallet creation skipped or already exists.");
  }

  // Create Huma Lender State account
  console.log("Creating Huma Lender State account...");
  const humaLenderStateKeyPath = path.resolve(
    STATE_DIR,
    "huma-lender-state-key.json"
  );
  const humaLenderStateSigner = await loadKeypair(humaLenderStateKeyPath).catch(
    async () => {
      const bytes = crypto.randomBytes(64);
      fs.writeFileSync(
        humaLenderStateKeyPath,
        JSON.stringify(Array.from(bytes)),
        "utf-8"
      );
      return await loadKeypair(humaLenderStateKeyPath);
    }
  );

  // Call create_lender_accounts_v2 on mock_huma program
  const humaLenderStateInfo = await rpc
    .getAccountInfo(humaLenderStateSigner.address)
    .send();
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
        { address: address(pstMintStr), role: AccountRole.READONLY }, // mode_mint
        {
          address: address(humaLenderStateSigner.address),
          role: AccountRole.WRITABLE_SIGNER,
          signer: humaLenderStateSigner,
        },
        { address: address(adminAddress), role: AccountRole.WRITABLE }, // lender_mode_token
        {
          address: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          role: AccountRole.READONLY,
        },
        {
          address: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
          role: AccountRole.READONLY,
        },
        {
          address: address("11111111111111111111111111111111"),
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
  const [poolAddress] = await findPrizePoolPda(poolId);
  const [poolVaultAddress] = await findPoolVaultAccountPda(poolId);
  const [poolPstVaultAddress] = await findPoolPstVaultPda(poolId);
  const poolInfo = await rpc.getAccountInfo(poolAddress).send();

  // Create Ticket Registry
  console.log("Allocating Ticket Registry account...");
  const ticketRegistryKeyPath = path.resolve(
    STATE_DIR,
    "ticket-registry-key.json"
  );
  let ticketRegistrySigner = await loadKeypair(ticketRegistryKeyPath).catch(
    async () => {
      const bytes = crypto.randomBytes(64);
      fs.writeFileSync(
        ticketRegistryKeyPath,
        JSON.stringify(Array.from(bytes)),
        "utf-8"
      );
      return await loadKeypair(ticketRegistryKeyPath);
    }
  );

  let ticketRegistryAddress = ticketRegistrySigner.address;
  console.log(`Ticket Registry address: ${ticketRegistryAddress}`);

  let ticketRegistryInfo = await rpc
    .getAccountInfo(ticketRegistryAddress, { encoding: "base64" })
    .send();

  // If ticket registry account exists on-chain but pool is not yet initialized, verify discriminator is all zeros
  if (ticketRegistryInfo?.value && !poolInfo?.value) {
    const rawData = Array.isArray(ticketRegistryInfo.value.data)
      ? Buffer.from(ticketRegistryInfo.value.data[0], "base64")
      : Buffer.from(ticketRegistryInfo.value.data as any);
    const isZeroed = rawData.subarray(0, 8).every((b: number) => b === 0);
    if (!isZeroed) {
      console.warn(
        "⚠️  Existing Ticket Registry account has non-zero discriminator from a prior run. Regenerating fresh keypair..."
      );
      const newBytes = crypto.randomBytes(64);
      fs.writeFileSync(
        ticketRegistryKeyPath,
        JSON.stringify(Array.from(newBytes)),
        "utf-8"
      );
      ticketRegistrySigner = await loadKeypair(ticketRegistryKeyPath);
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
      programAddress: address("11111111111111111111111111111111"),
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
  const [globalConfigAddress] = await findGlobalConfigPda();
  const globalConfigInfo = await rpc.getAccountInfo(globalConfigAddress).send();
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
  const prizeTiers: PrizeTierInput[] = [
    { basisPoints: 5000, numWinners: 1 }, // Grand prize: 50%
    { basisPoints: 1500, numWinners: 2 }, // Runner-up: 30% (15% each)
    { basisPoints: 400, numWinners: 5 }, // Consolation: 20% (4% each)
  ];

  if (!poolInfo?.value) {
    console.log("Creating Prize Pool 1 via SDK builder...");
    const createPoolIx = await buildCreatePoolInstruction({
      admin: adminSigner,
      poolId,
      bondPrice: 1_000_000n, // 1 USDC
      stakeCycleDurationHrs: 24n,
      feeBasisPoints: 100, // 1%
      minYieldThreshold: 0n,
      maxYieldBasisPoints: 0,
      payoutTimelockSeconds: 300,
      prizeTiers,
      tokenMint: address(usdcMintStr),
      pstMint: address(pstMintStr),
      ticketRegistry: address(ticketRegistryAddress),
      feeWallet: address(feeWallet),
      humaPoolState: address(humaPoolStateSigner.address),
    });
    await sendTx(rpc, createPoolIx, adminSigner);
  } else {
    console.log("Prize Pool 1 already initialized on-chain.");
  }

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
      humaModeMint: pstMintStr,
      humaLenderState: humaLenderStateSigner.address,
      humaLenderModeToken: poolPstVaultAddress,
    },
  });
  await sendTx(rpc, initHumaLenderIx, adminSigner);

  // Write addresses configuration files
  const devnetAccounts: DevnetProtocolAccounts = {
    programId: anchorProgramId,
    humaProgramId: mockHumaProgramId,
    adminAddress,
    usdcMint: usdcMintStr,
    pstMint: pstMintStr,
    ticketRegistry: ticketRegistryAddress,
    feeWallet,
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

async function handleFund(args: string[]) {
  if (args.length < 2) {
    console.error(
      "Error: Missing arguments. Usage: npm run devnet fund <wallet> <amount>"
    );
    process.exit(1);
  }

  const walletStr = args[0];
  const amountStr = args[1];

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    console.error("Error: Invalid amount.");
    process.exit(1);
  }

  console.log(`Requesting Devnet SOL airdrop for ${walletStr}...`);
  try {
    execFileSync(
      "solana",
      ["airdrop", String(amount), walletStr, "--url", DEVNET_RPC_URL],
      { stdio: "inherit" }
    );
  } catch {
    console.warn(
      "Airdrop rate-limited. Please request SOL manually via devnet faucet if needed."
    );
  }

  // Mint USDC
  const accounts = loadDevnetAccounts();
  const usdcMintStr = accounts.usdcMint;
  if (!usdcMintStr) {
    throw new Error("Mock USDC mint not found in Devnet protocol accounts");
  }

  console.log(`Minting mock USDC using spl-token CLI to ${walletStr}...`);
  const mintKeyPath = path.resolve(STATE_DIR, "usdc-mint.json");
  if (!fs.existsSync(mintKeyPath)) {
    throw new Error(
      "Mock USDC mint keypair not found in devnet-state directory."
    );
  }

  // Create recipient ATA
  try {
    execFileSync(
      "spl-token",
      [
        "create-account",
        usdcMintStr,
        "--owner",
        walletStr,
        "--url",
        DEVNET_RPC_URL,
      ],
      { stdio: "inherit" }
    );
  } catch {
    console.warn("Recipient USDC account creation skipped or already exists.");
  }

  // Mint USDC
  execFileSync(
    "spl-token",
    [
      "mint",
      usdcMintStr,
      String(amount),
      walletStr,
      "--mint-authority",
      mintKeyPath,
      "--url",
      DEVNET_RPC_URL,
    ],
    { stdio: "inherit" }
  );
  console.log("Mock USDC minted successfully!");
}

async function handleYield(args: string[]) {
  if (args.length < 1) {
    console.error(
      "Error: Missing yield amount. Usage: npm run devnet yield <amount_usdc>"
    );
    process.exit(1);
  }

  const amountUsdcStr = args[0];
  const yieldAmountFloat = parseFloat(amountUsdcStr);
  if (isNaN(yieldAmountFloat) || yieldAmountFloat < 0) {
    console.error("Error: Invalid yield amount.");
    process.exit(1);
  }

  const yieldAmountMicroUsdc = BigInt(Math.round(yieldAmountFloat * 1_000_000));
  const rpc = createResilientRpc(DEVNET_RPC_URL);

  const accounts = loadDevnetAccounts();
  const { adminAddress, humaProgramId, humaPoolState } = accounts;

  if (!adminAddress || !humaProgramId || !humaPoolState) {
    throw new Error(
      "Missing required configuration variables in Devnet protocol accounts"
    );
  }

  // Load admin keypair
  const keypairPath = path.resolve(
    process.env.HOME || "",
    ".config",
    "solana",
    "id.json"
  );
  const adminSigner = await loadKeypair(keypairPath);

  console.log(
    `Sending simulate_yield transaction for ${yieldAmountFloat} USDC...`
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
    data: serializeSimulateYieldData(yieldAmountMicroUsdc),
  };

  await sendTx(rpc, yieldIx, adminSigner);
  console.log("Simulated yield applied successfully on-chain!");
}

async function handleSettle(args: string[]) {
  const countStr = args[0] || "0";
  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 0) {
    console.error("Error: count must be a non-negative integer.");
    process.exit(1);
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
  const keypairPath = path.resolve(
    process.env.HOME || "",
    ".config",
    "solana",
    "id.json"
  );
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
        address: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        role: AccountRole.READONLY,
      },
    ],
    data: serializeSettleRequestsData(count),
  };

  // Fund Huma Pool Underlying token account with USDC to support disburse transfers if needed
  console.log("Ensuring Mock Huma Pool Vault has underlying funds...");
  const usdcKeyPath = path.resolve(STATE_DIR, "usdc-mint.json");
  if (fs.existsSync(usdcKeyPath)) {
    try {
      execFileSync(
        "spl-token",
        [
          "mint",
          usdcMint,
          "1000000",
          humaPoolUnderlying,
          "--mint-authority",
          usdcKeyPath,
          "--url",
          DEVNET_RPC_URL,
        ],
        { stdio: "inherit" }
      );
    } catch {
      console.warn("Could not pre-fund mock Huma pool underlying vault.");
    }
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
