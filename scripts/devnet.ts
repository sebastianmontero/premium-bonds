import {
  createSolanaRpc,
  address,
  KeyPairSigner,
  AccountRole,
  getProgramDerivedAddress,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
  getBase58Encoder,
} from "@solana/kit";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  checkRpcHealth,
  loadKeypair,
  sendTx,
  updateFileContent,
  safeStringify,
} from "./utils";
import {
  findHumaPoolAuthorityPda,
  findAtaAddress,
  buildInitializeGlobalInstruction,
  getInitializeGlobalInstructionDataEncoder,
  getCreatePoolInstructionDataEncoder,
  getSetPrizeTiersInstructionDataEncoder,
  getSimulateYieldInstructionDataEncoder,
  getSettleRequestsInstructionDataEncoder,
  getInitializeMockPoolStateInstructionDataEncoder,
  getCreateLenderAccountsV2InstructionDataEncoder,
} from "../app/lib/bonds-sdk";

function generateRandomAddress(): string {
  const keyPair = crypto.generateKeyPairSync("ed25519");
  const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
  const publicKeyBytes = spki.subarray(12, 44);
  return getBase58Decoder().decode(publicKeyBytes);
}

// Constants
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const STATE_DIR = path.resolve(__dirname, "devnet-state");

function printUsage() {
  console.log("Usage: npm run devnet [command] [args]");
  console.log("Commands:");
  console.log(
    "  deploy                Checks/generates keypairs, syncs IDs, compiles, and deploys programs to devnet"
  );
  console.log(
    "  init                  Runs on-chain initialization sequence on devnet"
  );
  console.log(
    "  fund <wallet> <amount> Funds a wallet with SOL (airdrop) and Mock USDC"
  );
  console.log(
    "  yield <amount_usdc>   Simulates yield for the current pool on devnet"
  );
  console.log("  settle [count]        Settles pending redemptions on devnet");
}

function getInstructionDiscriminator(name: string): Uint8Array {
  const hash = crypto.createHash("sha256").update(`global:${name}`).digest();
  return new Uint8Array(hash.slice(0, 8));
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

function serializeInitializeGlobalData(): Uint8Array {
  return getInitializeGlobalInstructionDataEncoder().encode({});
}

function serializeCreatePoolData(
  poolId: number,
  bondPrice: bigint,
  stakeCycleDurationHrs: bigint,
  feeBasisPoints: number,
  minYieldThreshold: bigint = 0n
): Uint8Array {
  return getCreatePoolInstructionDataEncoder().encode({
    poolId,
    bondPrice,
    stakeCycleDurationHrs,
    feeBasisPoints,
    minYieldThreshold,
  });
}

function serializeSetPrizeTiersData(
  tiers: { basisPoints: number; numWinners: number }[]
): Uint8Array {
  return getSetPrizeTiersInstructionDataEncoder().encode({
    tiers: tiers.map((t) => ({
      numWinners: t.numWinners,
      basisPoints: t.basisPoints,
      padding: new Uint8Array(2),
    })),
  });
}

async function handleDeploy() {
  console.log("Checking deploy keypairs...");
  const deployDir = path.resolve(__dirname, "..", "anchor", "target", "deploy");
  if (!fs.existsSync(deployDir)) {
    fs.mkdirSync(deployDir, { recursive: true });
  }

  const anchorKeyPath = path.resolve(deployDir, "anchor-keypair.json");
  const mockHumaKeyPath = path.resolve(deployDir, "mock_huma-keypair.json");

  if (!fs.existsSync(anchorKeyPath)) {
    console.log("Generating new deploy keypair for YieldBonds program...");
    execSync(`solana-keygen new -o ${anchorKeyPath} --no-passphrase`, {
      stdio: "inherit",
    });
  }

  if (!fs.existsSync(mockHumaKeyPath)) {
    console.log("Generating new deploy keypair for Mock Huma program...");
    execSync(`solana-keygen new -o ${mockHumaKeyPath} --no-passphrase`, {
      stdio: "inherit",
    });
  }

  const anchorAddress = execSync(`solana address -k ${anchorKeyPath}`)
    .toString()
    .trim();
  const mockHumaAddress = execSync(`solana address -k ${mockHumaKeyPath}`)
    .toString()
    .trim();

  console.log(`Program IDs:
  anchor: ${anchorAddress}
  mock_huma: ${mockHumaAddress}
`);

  console.log(
    "Syncing Program IDs in Cargo & Anchor.toml using anchor keys sync..."
  );
  execSync("NO_DNA=1 anchor keys sync", {
    cwd: path.resolve(__dirname, "..", "anchor"),
    stdio: "inherit",
  });

  console.log(
    "Updating program ID references in constants.rs and bonds-sdk.ts..."
  );
  const constantsPath = path.resolve(
    __dirname,
    "..",
    "anchor",
    "programs",
    "anchor",
    "src",
    "constants.rs"
  );
  const bondsSdkPath = path.resolve(
    __dirname,
    "..",
    "app",
    "lib",
    "bonds-sdk.ts"
  );

  // Update mock Huma program ID constant in constants.rs
  const humaConstantRegex =
    /pub const HUMA_PROGRAM_ID: Pubkey =\s*solana_program::pubkey!\("[^"]+"\);/g;
  updateFileContent(
    constantsPath,
    humaConstantRegex,
    `pub const HUMA_PROGRAM_ID: Pubkey =\n    solana_program::pubkey!("${mockHumaAddress}");`
  );

  // Update PROGRAM_ID and HUMA_PROGRAM_ID in bonds-sdk.ts
  const anchorSdkRegex = /export const PROGRAM_ID = address\(\s*"[^"]+"\s*\);/g;
  const humaSdkRegex =
    /export const HUMA_PROGRAM_ID = address\(\s*"[^"]+"\s*\);/g;
  updateFileContent(
    bondsSdkPath,
    anchorSdkRegex,
    `export const PROGRAM_ID = address(\n  "${anchorAddress}"\n);`
  );
  updateFileContent(
    bondsSdkPath,
    humaSdkRegex,
    `export const HUMA_PROGRAM_ID = address(\n  "${mockHumaAddress}"\n);`
  );

  console.log("Compiling contracts...");
  execSync("NO_DNA=1 anchor build", {
    cwd: path.resolve(__dirname, "..", "anchor"),
    stdio: "inherit",
  });

  console.log("Deploying Mock Huma program to Devnet...");
  execSync(
    `NO_DNA=1 anchor deploy --provider.cluster devnet --program-name mock_huma`,
    {
      cwd: path.resolve(__dirname, "..", "anchor"),
      stdio: "inherit",
    }
  );

  console.log("Deploying main YieldBonds program to Devnet...");
  execSync(
    `NO_DNA=1 anchor deploy --provider.cluster devnet --program-name anchor`,
    {
      cwd: path.resolve(__dirname, "..", "anchor"),
      stdio: "inherit",
    }
  );

  console.log("Deployment completed successfully!");
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

  const rpc = createSolanaRpc(DEVNET_RPC_URL);

  // Ask for Switchboard randomness account
  const randomnessAddressStr = process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT;
  if (!randomnessAddressStr) {
    console.log(
      "⚠️  Warning: NEXT_PUBLIC_RANDOMNESS_ACCOUNT environment variable is not defined."
    );
    console.log(
      "Ensure you create, fund, and set a Switchboard Randomness account address in your environment."
    );
  }

  // Create state directory
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  const deployDir = path.resolve(__dirname, "..", "anchor", "target", "deploy");
  const anchorKeyPath = path.resolve(deployDir, "anchor-keypair.json");
  const mockHumaKeyPath = path.resolve(deployDir, "mock_huma-keypair.json");

  const anchorProgramId = execSync(`solana address -k ${anchorKeyPath}`)
    .toString()
    .trim();
  const mockHumaProgramId = execSync(`solana address -k ${mockHumaKeyPath}`)
    .toString()
    .trim();

  // Create mock Huma state accounts
  console.log("Deriving Huma accounts...");
  // Since we don't have Keypair.generate in @solana/kit, generate via crypto and load or create a raw keypair
  const humaPoolStateKeypair = crypto.generateKeyPairSync("ed25519");
  const pkcs8 = humaPoolStateKeypair.privateKey.export({
    format: "der",
    type: "pkcs8",
  });
  const secretKeyBytes = pkcs8.subarray(16, 48);
  const spki = humaPoolStateKeypair.publicKey.export({
    format: "der",
    type: "spki",
  });
  const publicKeyBytes = spki.subarray(12, 44);
  const derivedSecretKey = new Uint8Array(64);
  derivedSecretKey.set(secretKeyBytes);
  derivedSecretKey.set(publicKeyBytes, 32);
  const humaPoolStateSigner = await loadKeypair(
    path.resolve(STATE_DIR, "huma-pool-state-key.json")
  ).catch(async () => {
    const filePath = path.resolve(STATE_DIR, "huma-pool-state-key.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify(Array.from(derivedSecretKey)),
      "utf-8"
    );
    return await loadKeypair(filePath);
  });

  console.log(`Huma Pool State address: ${humaPoolStateSigner.address}`);

  // Call initialize_mock_pool_state on mock_huma program
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

  // We define a multi-signing sendTx function:
  const sendMultiSignedTx = async (
    ix: Parameters<typeof appendTransactionMessageInstruction>[0],
    signers: KeyPairSigner[]
  ) => {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = setTransactionMessageLifetimeUsingBlockhash(
      blockhash,
      setTransactionMessageFeePayerSigner(
        signers[0],
        appendTransactionMessageInstruction(
          ix,
          createTransactionMessage({ version: 0 })
        )
      )
    );
    // Sign with all signers
    const signedTx = await signTransactionMessageWithSigners(message);
    const wireTx = getBase64EncodedWireTransaction(signedTx);
    const signature = await rpc
      .sendTransaction(wireTx, { encoding: "base64" })
      .send();
    console.log(`Transaction sent: ${signature}. Confirming...`);
    // Wait for confirmation
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const status = await rpc.getSignatureStatuses([signature]).send();
      if (status?.value?.[0]) {
        if (status.value[0].err) {
          throw new Error(
            `Transaction failed: ${safeStringify(status.value[0].err)}`
          );
        }
        console.log("Confirmed!");
        return signature;
      }
    }
    throw new Error("Confirmation timed out");
  };

  console.log("Sending initialize mock pool state tx...");
  await sendMultiSignedTx(initHumaIx, [adminSigner, humaPoolStateSigner]);

  // Create mock USDC Mint if not specified
  let usdcMintStr = process.env.NEXT_PUBLIC_USDC_MINT;
  if (!usdcMintStr) {
    console.log("Creating new Mock USDC Mint on-chain...");
    // We can shell out to spl-token command to make it simple and bulletproof!
    const usdcKeyPath = path.resolve(STATE_DIR, "usdc-mint.json");
    if (!fs.existsSync(usdcKeyPath)) {
      execSync(`solana-keygen new -o ${usdcKeyPath} --no-passphrase`);
    }
    usdcMintStr = execSync(`solana address -k ${usdcKeyPath}`)
      .toString()
      .trim();
    console.log(`Derived Mock USDC Address: ${usdcMintStr}`);

    try {
      execSync(
        `spl-token create-mint ${usdcKeyPath} --decimals 6 --fee-payer ${keypairPath}`,
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
    execSync(`solana-keygen new -o ${pstKeyPath} --no-passphrase`);
  }
  const pstMintStr = execSync(`solana address -k ${pstKeyPath}`)
    .toString()
    .trim();
  console.log(`Mock PST Address: ${pstMintStr}`);

  try {
    execSync(
      `spl-token create-mint ${pstKeyPath} --decimals 6 --mint-authority ${poolAuthority} --fee-payer ${keypairPath}`,
      {
        stdio: "inherit",
      }
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
    execSync(
      `spl-token create-address ${usdcMintStr} --owner ${poolAuthority} --fee-payer ${keypairPath}`,
      { stdio: "inherit" }
    );
  } catch {}

  // Create Huma Pool Mode Token account owned by pool_authority
  console.log("Creating Huma Pool Mode Token Account...");
  const humaPoolModeToken = await findAtaAddress(poolAuthority, pstMintStr);
  console.log(`Huma Pool Mode Token ATA: ${humaPoolModeToken}`);
  try {
    execSync(
      `spl-token create-address ${pstMintStr} --owner ${poolAuthority} --fee-payer ${keypairPath}`,
      { stdio: "inherit" }
    );
  } catch {}

  // Create Admin Fee Wallet (Associated USDC Token Account for Admin)
  console.log("Creating Admin Fee Wallet...");
  const feeWallet = await findAtaAddress(adminAddress, usdcMintStr);
  console.log(`Admin Fee Wallet: ${feeWallet}`);
  try {
    execSync(
      `spl-token create-account ${usdcMintStr} --fee-payer ${keypairPath}`,
      { stdio: "inherit" }
    );
  } catch {}

  // Create Huma Lender State account
  console.log("Creating Huma Lender State account...");
  const humaLenderStateSigner = await loadKeypair(
    path.resolve(STATE_DIR, "huma-lender-state-key.json")
  ).catch(async () => {
    const filePath = path.resolve(STATE_DIR, "huma-lender-state-key.json");
    const bytes = crypto.randomBytes(64); // Since it's a mock state account we can generate randomly
    fs.writeFileSync(filePath, JSON.stringify(Array.from(bytes)), "utf-8");
    return await loadKeypair(filePath);
  });

  // Call create_lender_accounts_v2 on mock_huma program
  console.log("Initializing Huma lender accounts on-chain...");
  const initLenderIx = {
    programAddress: address(mockHumaProgramId),
    accounts: [
      { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER }, // lender
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
  await sendMultiSignedTx(initLenderIx, [adminSigner, humaLenderStateSigner]);

  // Create Ticket Registry
  console.log("Allocating Ticket Registry account...");
  const ticketRegistrySigner = await loadKeypair(
    path.resolve(STATE_DIR, "ticket-registry-key.json")
  ).catch(async () => {
    const filePath = path.resolve(STATE_DIR, "ticket-registry-key.json");
    const bytes = crypto.randomBytes(64);
    fs.writeFileSync(filePath, JSON.stringify(Array.from(bytes)), "utf-8");
    return await loadKeypair(filePath);
  });

  const ticketRegistryAddress = ticketRegistrySigner.address;
  console.log(`Ticket Registry address: ${ticketRegistryAddress}`);

  // Create Ticket Registry System Account with owner set to YieldBonds program
  const space = 262248;
  const rentExempt = await rpc
    .getMinimumBalanceForRentExemption(BigInt(space))
    .send();
  console.log(
    `Required rent exemption for Ticket Registry: ${Number(rentExempt) / 1_000_000_000} SOL`
  );

  // Construct System Program CreateAccount instruction
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
  await sendMultiSignedTx(createAccountIx, [adminSigner, ticketRegistrySigner]);

  // Initialize Global Config
  console.log("Initializing YieldBonds GlobalConfig...");
  const initGlobalIx = await buildInitializeGlobalInstruction({
    authority: adminSigner,
    admin: address(adminAddress),
    jobsAccount: address(adminAddress),
  });
  await sendTx(rpc, initGlobalIx, adminSigner);

  // Initialize Prize Pool 1
  console.log("Creating Prize Pool 1...");
  const poolId = 1;
  const poolIdBytes = new Uint8Array(4);
  new DataView(poolIdBytes.buffer).setUint32(0, poolId, true);
  const [poolAddress] = await getProgramDerivedAddress({
    programAddress: address(anchorProgramId),
    seeds: [new TextEncoder().encode("prize_pool"), poolIdBytes],
  });
  const [poolVaultAddress] = await getProgramDerivedAddress({
    programAddress: address(anchorProgramId),
    seeds: [new TextEncoder().encode("pool_vault"), poolIdBytes],
  });
  const [poolPstVaultAddress] = await getProgramDerivedAddress({
    programAddress: address(anchorProgramId),
    seeds: [new TextEncoder().encode("pool_pst"), poolIdBytes],
  });

  const createPoolIx = {
    programAddress: address(anchorProgramId),
    accounts: [
      { address: globalConfigAddress, role: AccountRole.READONLY },
      { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: poolAddress, role: AccountRole.WRITABLE },
      { address: address(ticketRegistryAddress), role: AccountRole.WRITABLE },
      { address: address(usdcMintStr), role: AccountRole.READONLY },
      { address: address(pstMintStr), role: AccountRole.READONLY },
      { address: poolVaultAddress, role: AccountRole.WRITABLE },
      { address: poolPstVaultAddress, role: AccountRole.WRITABLE },
      { address: address(feeWallet), role: AccountRole.READONLY },
      {
        address: address("11111111111111111111111111111111"),
        role: AccountRole.READONLY,
      },
      {
        address: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        role: AccountRole.READONLY,
      },
      {
        address: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        role: AccountRole.READONLY,
      },
    ],
    data: serializeCreatePoolData(
      poolId,
      1_000_000n, // bond price = 1 USDC
      24n, // stake duration = 24 hrs
      100, // fee = 1%
      0n // min_yield_threshold = 0
    ),
  };
  await sendTx(rpc, createPoolIx, adminSigner);

  // Set Prize Tiers
  console.log("Setting prize tiers...");
  const prizeTiers = [
    { basisPoints: 5000, numWinners: 1 }, // Grand prize: 50%
    { basisPoints: 1500, numWinners: 2 }, // Runner-up: 30% (15% each)
    { basisPoints: 400, numWinners: 5 }, // Consolation: 20% (4% each)
  ];
  const setTiersIx = {
    programAddress: address(anchorProgramId),
    accounts: [
      { address: globalConfigAddress, role: AccountRole.READONLY },
      { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: poolAddress, role: AccountRole.WRITABLE },
    ],
    data: serializeSetPrizeTiersData(prizeTiers),
  };
  await sendTx(rpc, setTiersIx, adminSigner);

  // Write addresses configuration files
  const addressesJson = {
    humaPoolState: humaPoolStateSigner.address,
    pstMint: pstMintStr,
    ticketRegistry: ticketRegistryAddress,
    humaPoolUnderlying,
    humaPoolModeToken,
    feeWallet,
    humaRedemptionRequest: generateRandomAddress(),
    humaLenderState: humaLenderStateSigner.address,
  };
  fs.writeFileSync(
    path.resolve(STATE_DIR, "addresses.json"),
    JSON.stringify(addressesJson, null, 2),
    "utf-8"
  );

  // Write .env.local
  const envContent = `# Generated by devnet orchestrator
NEXT_PUBLIC_HUMA_CONFIG=${mockHumaProgramId}
NEXT_PUBLIC_HUMA_POOL_CONFIG=${mockHumaProgramId}
NEXT_PUBLIC_HUMA_POOL_STATE=${humaPoolStateSigner.address}
NEXT_PUBLIC_HUMA_MODE_CONFIG=${mockHumaProgramId}
NEXT_PUBLIC_HUMA_LENDER_STATE=${humaLenderStateSigner.address}
NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN=${humaPoolUnderlying}
NEXT_PUBLIC_HUMA_MODE_MINT=${pstMintStr}
NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN=${humaPoolModeToken}
NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST=${addressesJson.humaRedemptionRequest}
NEXT_PUBLIC_ADMIN_ADDRESS=${adminAddress}
NEXT_PUBLIC_TICKET_REGISTRY=${ticketRegistryAddress}
NEXT_PUBLIC_FEE_WALLET=${feeWallet}
NEXT_PUBLIC_RANDOMNESS_ACCOUNT=${randomnessAddressStr || ""}
NEXT_PUBLIC_SOLANA_RPC_URL=${DEVNET_RPC_URL}
NEXT_PUBLIC_USDC_MINT=${usdcMintStr}
NEXT_PUBLIC_PST_MINT=${pstMintStr}
NEXT_PUBLIC_PROGRAM_ID=${anchorProgramId}
NEXT_PUBLIC_HUMA_PROGRAM_ID=${mockHumaProgramId}
`;
  fs.writeFileSync(
    path.resolve(process.cwd(), ".env.local"),
    envContent,
    "utf-8"
  );

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
  // Shell out to solana airdrop
  try {
    execSync(`solana airdrop ${amount} ${walletStr} --url ${DEVNET_RPC_URL}`, {
      stdio: "inherit",
    });
  } catch {
    console.warn(
      "Airdrop rate-limited. Please request SOL manually via devnet faucet if needed."
    );
  }

  // Mint USDC
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "Missing .env.local setup. Run 'npm run devnet init' first."
    );
  }

  const content = fs.readFileSync(envPath, "utf-8");
  const usdcMintMatch = content.match(/NEXT_PUBLIC_USDC_MINT\s*=\s*(.*)/);
  if (!usdcMintMatch) {
    throw new Error("Mock USDC mint not found in .env.local");
  }
  const usdcMintStr = usdcMintMatch[1].trim();

  console.log(`Minting mock USDC using spl-token CLI to ${walletStr}...`);
  const mintKeyPath = path.resolve(STATE_DIR, "usdc-mint.json");
  if (!fs.existsSync(mintKeyPath)) {
    throw new Error(
      "Mock USDC mint keypair not found in devnet-state directory."
    );
  }

  // Create recipient ATA
  try {
    execSync(
      `spl-token create-account ${usdcMintStr} --owner ${walletStr} --url ${DEVNET_RPC_URL}`,
      { stdio: "inherit" }
    );
  } catch {}

  // Mint USDC
  execSync(
    `spl-token mint ${usdcMintStr} ${amount} ${walletStr} --mint-authority ${mintKeyPath} --url ${DEVNET_RPC_URL}`,
    {
      stdio: "inherit",
    }
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
  const rpc = createSolanaRpc(DEVNET_RPC_URL);

  const envPath = path.resolve(process.cwd(), ".env.local");
  const envContent = fs.readFileSync(envPath, "utf-8");
  const adminAddressMatch = envContent.match(
    /NEXT_PUBLIC_ADMIN_ADDRESS\s*=\s*(.*)/
  );
  const humaProgramIdMatch = envContent.match(
    /NEXT_PUBLIC_HUMA_PROGRAM_ID\s*=\s*(.*)/
  );
  const humaPoolStateMatch = envContent.match(
    /NEXT_PUBLIC_HUMA_POOL_STATE\s*=\s*(.*)/
  );

  if (!adminAddressMatch || !humaProgramIdMatch || !humaPoolStateMatch) {
    throw new Error("Missing required configuration variables in .env.local");
  }

  const adminAddress = adminAddressMatch[1].trim();
  const humaProgramId = humaProgramIdMatch[1].trim();
  const humaPoolState = humaPoolStateMatch[1].trim();

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
      { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER },
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

  const rpc = createSolanaRpc(DEVNET_RPC_URL);
  const envPath = path.resolve(process.cwd(), ".env.local");
  const envContent = fs.readFileSync(envPath, "utf-8");

  const adminAddressMatch = envContent.match(
    /NEXT_PUBLIC_ADMIN_ADDRESS\s*=\s*(.*)/
  );
  const humaProgramIdMatch = envContent.match(
    /NEXT_PUBLIC_HUMA_PROGRAM_ID\s*=\s*(.*)/
  );
  const humaPoolStateMatch = envContent.match(
    /NEXT_PUBLIC_HUMA_POOL_STATE\s*=\s*(.*)/
  );
  const lenderStateMatch = envContent.match(
    /NEXT_PUBLIC_HUMA_LENDER_STATE\s*=\s*(.*)/
  );
  const usdcMintMatch = envContent.match(/NEXT_PUBLIC_USDC_MINT\s*=\s*(.*)/);
  const pstMintMatch = envContent.match(/NEXT_PUBLIC_PST_MINT\s*=\s*(.*)/);
  const humaPoolUnderlyingMatch = envContent.match(
    /NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN\s*=\s*(.*)/
  );
  const humaPoolModeTokenMatch = envContent.match(
    /NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN\s*=\s*(.*)/
  );

  if (
    !adminAddressMatch ||
    !humaProgramIdMatch ||
    !humaPoolStateMatch ||
    !lenderStateMatch ||
    !usdcMintMatch ||
    !pstMintMatch ||
    !humaPoolUnderlyingMatch ||
    !humaPoolModeTokenMatch
  ) {
    throw new Error("Missing required configuration variables in .env.local");
  }

  const adminAddress = adminAddressMatch[1].trim();
  const humaProgramId = humaProgramIdMatch[1].trim();
  const humaPoolState = humaPoolStateMatch[1].trim();
  const lenderState = lenderStateMatch[1].trim();
  const usdcMint = usdcMintMatch[1].trim();
  const pstMint = pstMintMatch[1].trim();
  const humaPoolUnderlying = humaPoolUnderlyingMatch[1].trim();
  const humaPoolModeToken = humaPoolModeTokenMatch[1].trim();

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
      { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER }, // lender/signer
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
      execSync(
        `spl-token mint ${usdcMint} 1000000 ${humaPoolUnderlying} --mint-authority ${usdcKeyPath} --url ${DEVNET_RPC_URL}`,
        { stdio: "inherit" }
      );
    } catch {}
  }

  await sendTx(rpc, settleIx, adminSigner);
  console.log("Redemption requests settled successfully on-chain!");
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
      await handleDeploy();
      break;
    case "init":
      await handleInit(args.slice(1));
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

main().catch((err) => {
  console.error("Unhandled error in devnet orchestrator:", err);
  process.exit(1);
});
