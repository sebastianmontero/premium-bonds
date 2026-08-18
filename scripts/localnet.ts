import {
  createSolanaRpc,
  address,
  Address,
  getProgramDerivedAddress,
  AccountRole,
  getBase58Encoder,
  getBase58Decoder,
  getBase64Encoder,
  KeyPairSigner,
  createKeyPairSignerFromBytes,
} from "@solana/kit";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline";
import {
  checkRpcHealth,
  sendTx,
  safeStringify,
  printErrorDetails,
} from "./utils";
import {
  findHumaPoolAuthorityPda,
  findAtaAddress,
  findDrawCyclePda,
  parseDrawCycle,
  parsePrizePool,
  fetchPoolYieldOnChainState,
  findGlobalConfigPda,
  findPrizePoolPda,
  buildInitializeGlobalInstruction,
  buildCreatePoolInstruction,
  buildSetPrizeTiersInstruction,
} from "../app/lib/bonds-sdk";
import {
  TICKET_REGISTRY_DISCRIMINATOR,
  serializeTicketRegistry,
} from "../app/lib/ticket-registry-helpers";
import { executeHarvest, executeReveal, executeReinvest } from "./pb-cli";

// Constants
const RPC_URL = "http://127.0.0.1:8899";
const PROGRAM_ID_STR = "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx";
const MOCK_HUMA_PROGRAM_ID_STR = "XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw";
const STATE_DIR = path.resolve(__dirname, "localnet-state");
const DB_DIR = path.resolve(STATE_DIR, "dbs");
const SNAPSHOT_DIR = path.resolve(STATE_DIR, "snapshots");

// Child processes references
let surfpoolProcess: ChildProcess | null = null;
let nextProcess: ChildProcess | null = null;

interface LocalnetAddresses {
  humaPoolState: string;
  pstMint: string;
  ticketRegistry: string;
  humaPoolUnderlying: string;
  humaPoolModeToken: string;
  feeWallet: string;
  humaRedemptionRequest: string;
  humaLenderState: string;
}

function ensureDirsExist() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function resolveDbPath(dbInput: string): {
  dbPath: string;
  addressesPath: string;
  cleanName: string;
} {
  ensureDirsExist();
  const rawName = dbInput.trim();
  const baseName = path.basename(rawName);
  const cleanName = baseName.endsWith(".sqlite")
    ? baseName.slice(0, -7)
    : baseName;
  const sqliteFilename = `${cleanName}.sqlite`;
  const dbPath = path.resolve(DB_DIR, sqliteFilename);
  const addressesPath = path.resolve(DB_DIR, `${cleanName}.addresses.json`);
  return { dbPath, addressesPath, cleanName };
}

function resolveSnapshotPath(snapshotInput: string): {
  snapshotPath: string;
  addressesPath: string | null;
  cleanName: string;
} {
  ensureDirsExist();
  const raw = snapshotInput.trim();

  // 1. Direct path check (relative to process.cwd() or absolute)
  const directPath = path.resolve(process.cwd(), raw);
  if (fs.existsSync(directPath)) {
    const ext = path.extname(directPath);
    const cleanName = path.basename(directPath, ext);
    const candidateAddressesPath = directPath.replace(
      new RegExp(`${ext}$`),
      ".addresses.json"
    );
    const addressesPath = fs.existsSync(candidateAddressesPath)
      ? candidateAddressesPath
      : null;
    return { snapshotPath: directPath, addressesPath, cleanName };
  }

  // 2. Check inside SNAPSHOT_DIR
  const baseName = path.basename(raw);
  const cleanName = baseName.endsWith(".json")
    ? baseName.slice(0, -5)
    : baseName;
  const jsonPath = path.resolve(SNAPSHOT_DIR, `${cleanName}.json`);
  const addressesPathCandidate = path.resolve(
    SNAPSHOT_DIR,
    `${cleanName}.addresses.json`
  );
  const addressesPath = fs.existsSync(addressesPathCandidate)
    ? addressesPathCandidate
    : null;

  return { snapshotPath: jsonPath, addressesPath, cleanName };
}

export interface LocalnetFlags {
  dbName?: string;
  snapshotInput?: string;
  bootstrapOnly: boolean;
  positionals: string[];
}

export function parseLocalnetFlags(args: string[]): LocalnetFlags {
  let dbName: string | undefined;
  let snapshotInput: string | undefined;
  let bootstrapOnly = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--db" || arg === "-d") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        console.error("Error: Missing value for --db / -d flag.");
        process.exit(1);
      }
      dbName = nextArg;
      i++;
    } else if (arg.startsWith("--db=")) {
      dbName = arg.slice(5);
    } else if (arg.startsWith("-d=")) {
      dbName = arg.slice(3);
    } else if (arg === "--snapshot") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        console.error("Error: Missing value for --snapshot flag.");
        process.exit(1);
      }
      snapshotInput = nextArg;
      i++;
    } else if (arg.startsWith("--snapshot=")) {
      snapshotInput = arg.slice(11);
    } else if (
      arg === "--bootstrap-only" ||
      arg === "--pre-global" ||
      arg === "--setup-base" ||
      arg === "--base"
    ) {
      bootstrapOnly = true;
    } else if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  return { dbName, snapshotInput, bootstrapOnly, positionals };
}

function printUsage() {
  console.log("Usage: npm run localnet [command] [args]");
  console.log("Commands:");
  console.log(
    "  start                 Starts Surfpool (if not running), checks/initializes state, writes env, and starts Next.js (default)"
  );
  console.log(
    "                        Flags: [--db <name> | -d <name>] [--snapshot <path>] [--bootstrap-only | --pre-global]"
  );
  console.log(
    "  bootstrap             Bootstraps base accounts, programs, and env up to pre-global state (for pb-cli testing)"
  );
  console.log("                        Aliases: setup-base, pre-global");
  console.log(
    "  init                  Runs full state initialization sequence (base + GlobalConfig + Pool 1)"
  );
  console.log("  fund <wallet> <sol>   Funds a wallet with SOL");
  console.log(
    "  warp [--seconds <n> | -s <n>] [--pool-id <id> | -i <id>] [--pool-end | -p]"
  );
  console.log(
    "                        Time travels forward. If --seconds is omitted, defaults"
  );
  console.log(
    "                        to warping to the end of the current active pool cycle."
  );
  console.log(
    "                        --pool-id / -i specifies which pool to target (defaults to 1)."
  );
  console.log(
    "  draw [--pool-id <id> | -i <id>] [--yield <amount> | -y <amount>] [--reinvest | -r] [--seed <hex> | -s <hex>]"
  );
  console.log(
    "                        Warps clock to cycle end, harvests & commits draw, reveals winners, and optionally reinvests."
  );
  console.log(
    "  settle [--count <n>]  Updates mock Huma queue to enable the redemption of pending requests (settles all by default)"
  );
  console.log("  yield <amount_usdc> [--pool-id <id> | -i <id>]");
  console.log(
    "                        Simulates yield generated by Huma for a specific pool"
  );
  console.log("  set-prize-tiers [--pool-id <id> | -i <id>]");
  console.log(
    "                        Configures default prize tiers on-chain for the pool"
  );
  console.log(
    "  db list               Lists all saved SQLite database state files"
  );
  console.log(
    "  db delete <name>      Deletes a saved SQLite database state file with confirmation"
  );
  console.log(
    "  snapshot save [name]  Exports current live RPC state to a snapshot file"
  );
  console.log("  snapshot list         Lists all available state snapshots");
  console.log(
    "  snapshot delete <name> Deletes a saved state snapshot file with confirmation"
  );
}

// Helper functions for initialization
function generateRandomAddress(): string {
  const keyPair = crypto.generateKeyPairSync("ed25519");
  const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
  const publicKeyBytes = spki.subarray(12, 44);
  return getBase58Decoder().decode(publicKeyBytes);
}

function getAddressesFilePath(dbName?: string): string {
  ensureDirsExist();
  if (dbName) {
    const { addressesPath } = resolveDbPath(dbName);
    return addressesPath;
  }
  return path.resolve(STATE_DIR, "addresses.json");
}

function loadOrGenerateAddresses(dbName?: string): LocalnetAddresses {
  const filePath = getAddressesFilePath(dbName);
  let addresses: Partial<LocalnetAddresses> = {};
  if (fs.existsSync(filePath)) {
    try {
      addresses = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      console.warn(
        `Failed to parse ${path.basename(filePath)}, generating new ones...`
      );
    }
  } else if (dbName) {
    // Fallback: try copying global addresses.json if available
    const globalPath = path.resolve(STATE_DIR, "addresses.json");
    if (fs.existsSync(globalPath)) {
      try {
        addresses = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
      } catch {}
    }
  }

  let modified = false;
  const requiredKeys: (keyof LocalnetAddresses)[] = [
    "humaPoolState",
    "pstMint",
    "ticketRegistry",
    "humaPoolUnderlying",
    "humaPoolModeToken",
    "feeWallet",
    "humaRedemptionRequest",
    "humaLenderState",
  ];

  for (const key of requiredKeys) {
    if (!addresses[key]) {
      addresses[key] = generateRandomAddress();
      modified = true;
    }
  }

  if (modified || !fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2), "utf-8");
  }

  return addresses as LocalnetAddresses;
}

async function loadOrGenerateKeypair(
  keyPath: string,
  label: string
): Promise<KeyPairSigner> {
  if (fs.existsSync(keyPath)) {
    const bytes = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    return await createKeyPairSignerFromBytes(new Uint8Array(bytes));
  }

  console.log(`Generating new ${label} keypair at ${keyPath}...`);
  const keyPair = crypto.generateKeyPairSync("ed25519");

  const pkcs8 = keyPair.privateKey.export({ format: "der", type: "pkcs8" });
  const secretKeyBytes = pkcs8.subarray(16, 48);

  const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
  const publicKeyBytes = spki.subarray(12, 44);

  const derivedSecretKey = new Uint8Array(64);
  derivedSecretKey.set(secretKeyBytes);
  derivedSecretKey.set(publicKeyBytes, 32);

  fs.writeFileSync(
    keyPath,
    JSON.stringify(Array.from(derivedSecretKey)),
    "utf-8"
  );

  return await createKeyPairSignerFromBytes(derivedSecretKey);
}

async function loadOrGenerateAdminKey(): Promise<KeyPairSigner> {
  return loadOrGenerateKeypair(
    path.resolve(__dirname, "admin-key.json"),
    "admin"
  );
}

async function loadOrGenerateRandomnessKey(): Promise<KeyPairSigner> {
  return loadOrGenerateKeypair(
    path.resolve(__dirname, "randomness-key.json"),
    "randomness"
  );
}

async function setAccount(
  addr: string,
  lamports: number,
  dataHex: string,
  owner: string,
  executable: boolean
) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "surfnet_setAccount",
      params: [
        addr,
        {
          lamports,
          data: dataHex,
          owner,
          executable,
        },
      ],
    }),
  });
  const json = (await res.json()) as { error?: unknown };
  if (json.error) {
    throw new Error(
      `RPC Error setting account ${addr}: ${safeStringify(json.error)}`
    );
  }
}

async function airdropSol(
  rpc: ReturnType<typeof createSolanaRpc>,
  targetAddress: string,
  amountSol: number
) {
  console.log(`Requesting ${amountSol} SOL airdrop for ${targetAddress}...`);
  try {
    const lamports = BigInt(amountSol) * 1_000_000_000n;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (rpc as any).requestAirdrop(address(targetAddress), lamports).send();
    // Poll for airdrop confirmation
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const balance = await rpc.getBalance(address(targetAddress)).send();
      if (balance.value >= lamports) {
        console.log(
          `Airdrop complete. Balance: ${Number(balance.value) / 1_000_000_000} SOL`
        );
        return;
      }
    }
    throw new Error("Airdrop verification timed out");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `Airdrop failed: ${errMsg}. Attempting state injection fallback...`
    );
    let currentLamports = 0;
    try {
      const balance = await rpc.getBalance(address(targetAddress)).send();
      currentLamports = Number(balance.value);
    } catch {
      // Account might not exist, default to 0
    }
    const newLamports = currentLamports + amountSol * 1_000_000_000;
    await setAccount(
      targetAddress,
      newLamports,
      "",
      "11111111111111111111111111111111",
      false
    );
    console.log(
      `Successfully injected ${amountSol} SOL directly into ${targetAddress}. New balance: ${newLamports / 1_000_000_000} SOL`
    );
  }
}

function serializeMintAccount(
  mintAuthorityStr: string | null,
  decimals: number
): string {
  const base58 = getBase58Encoder();
  const data = new Uint8Array(82);
  const view = new DataView(data.buffer);

  if (mintAuthorityStr) {
    view.setUint32(0, 1, true); // COption::Some
    data.set(base58.encode(address(mintAuthorityStr)), 4);
  } else {
    view.setUint32(0, 0, true); // COption::None
  }

  data[44] = decimals;
  data[45] = 1; // is_initialized = true

  return Buffer.from(data).toString("hex");
}

function serializeTokenAccount(
  mintStr: string,
  ownerStr: string,
  amount: bigint
): string {
  const base58 = getBase58Encoder();
  const data = new Uint8Array(165);

  data.set(base58.encode(address(mintStr)), 0);
  data.set(base58.encode(address(ownerStr)), 32);
  const view = new DataView(data.buffer);
  view.setBigUint64(64, amount, true);
  data[108] = 1; // state = Initialized

  return Buffer.from(data).toString("hex");
}

function serializeHumaPoolState(): string {
  const data = new Uint8Array(512);
  const view = new DataView(data.buffer);
  view.setUint32(26, 1, true); // ModeState array length = 1
  return Buffer.from(data).toString("hex");
}

async function ensurePrizeTiersConfigured(
  poolId: number,
  rpc: ReturnType<typeof createSolanaRpc>,
  adminSigner: KeyPairSigner
) {
  console.log(`Setting prize tiers for Pool (pool_id: ${poolId}) on-chain...`);
  const prizeTiers = [
    { basisPoints: 5000, numWinners: 1 }, // Grand prize: 50% for 1 winner
    { basisPoints: 1500, numWinners: 2 }, // Runner-up: 30% total (15% each for 2 winners)
    { basisPoints: 400, numWinners: 5 }, // Consolation: 20% total (4% each for 5 winners)
  ];
  const ix = await buildSetPrizeTiersInstruction({
    admin: adminSigner,
    poolId,
    tiers: prizeTiers,
  });
  await sendTx(rpc, ix, adminSigner);
  console.log(`Successfully configured prize tiers for pool ${poolId}.`);
}

async function injectProgram(
  programIdStr: string,
  soPath: string,
  upgradeAuthority?: string
) {
  if (!fs.existsSync(soPath)) {
    throw new Error(
      `Compiled program binary not found at: ${soPath}. Please run 'npm run build' inside anchor directory.`
    );
  }

  console.log(`Injecting program ${programIdStr} from ${soPath}...`);
  const base58 = getBase58Encoder();
  const programId = address(programIdStr);
  const BPFLoaderUpgradeable = address(
    "BPFLoaderUpgradeab1e11111111111111111111111"
  );

  const [programDataAddress] = await getProgramDerivedAddress({
    programAddress: BPFLoaderUpgradeable,
    seeds: [base58.encode(programId)],
  });

  const programDataAddressBytes = base58.encode(programDataAddress);
  const programDataAddressHex = Buffer.from(programDataAddressBytes).toString(
    "hex"
  );

  // Construct program account data: 4 bytes tag (2) + 32 bytes program data address
  const programAccountData = "02000000" + programDataAddressHex;

  // Construct program data account data:
  // 45-byte header: 03000000 (tag) + 0100000000000000 (slot 1) + (01 option Some / 00 None) + 32 bytes authority
  const authorityHex = upgradeAuthority
    ? Buffer.from(base58.encode(address(upgradeAuthority))).toString("hex")
    : "00".repeat(32);
  const optionHex = upgradeAuthority ? "01" : "00";
  const headerHex = "03000000" + "0100000000000000" + optionHex + authorityHex;
  const soHex = fs.readFileSync(soPath).toString("hex");
  const programDataAccountData = headerHex + soHex;

  // Inject program data account
  await setAccount(
    programDataAddress,
    5_000_000_000,
    programDataAccountData,
    BPFLoaderUpgradeable,
    false
  );

  // Inject program account
  await setAccount(
    programIdStr,
    2_000_000_000,
    programAccountData,
    BPFLoaderUpgradeable,
    true
  );

  console.log(`Successfully injected program ${programIdStr}`);
}

async function ensureProgramsInjected(upgradeAuthority?: string) {
  const deployDir = path.resolve(__dirname, "..", "anchor", "target", "deploy");
  const anchorSoPath = path.resolve(deployDir, "anchor.so");
  const mockHumaSoPath = path.resolve(deployDir, "mock_huma.so");

  await injectProgram(PROGRAM_ID_STR, anchorSoPath, upgradeAuthority);
  await injectProgram(MOCK_HUMA_PROGRAM_ID_STR, mockHumaSoPath);
}

function writeEnvLocal(
  addresses: LocalnetAddresses,
  adminAddress: string,
  randomnessAddress: string
) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const envContent = `# Generated by localnet orchestrator
NEXT_PUBLIC_HUMA_CONFIG=${MOCK_HUMA_PROGRAM_ID_STR}
NEXT_PUBLIC_HUMA_POOL_CONFIG=${MOCK_HUMA_PROGRAM_ID_STR}
NEXT_PUBLIC_HUMA_POOL_STATE=${addresses.humaPoolState}
NEXT_PUBLIC_HUMA_MODE_CONFIG=${MOCK_HUMA_PROGRAM_ID_STR}
NEXT_PUBLIC_HUMA_LENDER_STATE=${addresses.humaLenderState}
NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN=${addresses.humaPoolUnderlying}
NEXT_PUBLIC_HUMA_MODE_MINT=${addresses.pstMint}
NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN=${addresses.humaPoolModeToken}
NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST=${addresses.humaRedemptionRequest}
NEXT_PUBLIC_ADMIN_ADDRESS=${adminAddress}
NEXT_PUBLIC_TICKET_REGISTRY=${addresses.ticketRegistry}
NEXT_PUBLIC_FEE_WALLET=${addresses.feeWallet}
NEXT_PUBLIC_RANDOMNESS_ACCOUNT=${randomnessAddress}
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
`;
  fs.writeFileSync(envPath, envContent, "utf-8");
  console.log("Successfully wrote .env.local configuration.");
}

export interface BaseStateContext {
  rpc: ReturnType<typeof createSolanaRpc>;
  adminSigner: KeyPairSigner;
  randomnessSigner: KeyPairSigner;
  addresses: LocalnetAddresses;
  globalConfigAddress: Address;
  isGlobalInitialized: boolean;
}

export async function injectBaseState(options?: {
  dbName?: string;
  rpcUrl?: string;
}): Promise<BaseStateContext> {
  const rpcUrl = options?.rpcUrl ?? RPC_URL;
  ensureDirsExist();

  const isRpcsActive = await checkRpcHealth(rpcUrl);
  if (!isRpcsActive) {
    console.error(
      "Error: Solana RPC is not running. Please start the localnet orchestrator or your validator first."
    );
    process.exit(1);
  }

  const rpc = createSolanaRpc(rpcUrl);

  // 1. Load or generate admin and randomness keys
  const adminSigner = await loadOrGenerateAdminKey();
  const randomnessSigner = await loadOrGenerateRandomnessKey();
  console.log("Admin address:", adminSigner.address);
  console.log("Mock Switchboard Randomness address:", randomnessSigner.address);

  // 2. Load or generate addresses
  const addresses = loadOrGenerateAddresses(options?.dbName);
  console.log(
    "Injected/configured addresses:",
    JSON.stringify(addresses, null, 2)
  );

  // 3. Fund admin key
  await airdropSol(rpc, adminSigner.address, 100);

  // 4. Inject compiled programs
  await ensureProgramsInjected(adminSigner.address);

  // 5. Inject mock accounts with atomic batch inspection
  const accountsToQuery = [
    address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), // 0: USDC mint
    address(randomnessSigner.address), // 1: Mock Randomness
    address(addresses.humaPoolState), // 2: Huma Pool State
    address(addresses.pstMint), // 3: PST Mint
    address(addresses.ticketRegistry), // 4: Ticket Registry
    address(addresses.humaPoolUnderlying), // 5: Huma Underlying
    address(addresses.humaPoolModeToken), // 6: Huma Mode Token
    address(addresses.feeWallet), // 7: Fee Wallet
  ];

  const poolAddress = await findPrizePoolPda(1);
  const [existingAccounts, poolAcc] = await Promise.all([
    rpc
      .getMultipleAccounts(accountsToQuery, { encoding: "base64" })
      .send()
      .catch(() => null),
    rpc
      .getAccountInfo(poolAddress, { encoding: "base64" })
      .send()
      .catch(() => null),
  ]);

  const accMap = existingAccounts?.value ?? [];
  const poolExists = Boolean(poolAcc?.value);

  // 5a. USDC Mint
  if (!accMap[0] || !accMap[0].data?.[0]) {
    console.log("Injecting USDC Mint account...");
    const usdcMintData = serializeMintAccount(adminSigner.address, 6);
    await setAccount(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      1_000_000_000,
      usdcMintData,
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      false
    );
  }

  // 5b. Mock Switchboard Randomness
  const sbProgramId =
    process.env.SB_ENV === "devnet"
      ? "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
      : "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv";
  if (!accMap[1]) {
    console.log("Injecting Mock Switchboard Randomness account...");
    await setAccount(
      randomnessSigner.address,
      1_000_000_000,
      "",
      sbProgramId,
      false
    );
  }

  // 5c. Huma Pool State
  if (!accMap[2] || !accMap[2].data?.[0]) {
    console.log("Injecting Huma Pool State account...");
    const humaPoolStateData = serializeHumaPoolState();
    await setAccount(
      addresses.humaPoolState,
      1_000_000_000,
      humaPoolStateData,
      MOCK_HUMA_PROGRAM_ID_STR,
      false
    );
  }

  const humaPoolAuthority = await findHumaPoolAuthorityPda(
    addresses.humaPoolState
  );
  console.log("Derived Huma Pool Authority:", humaPoolAuthority);

  // 5d. PST Mint
  if (!accMap[3] || !accMap[3].data?.[0]) {
    console.log("Injecting PST Mint account...");
    const pstMintData = serializeMintAccount(humaPoolAuthority, 6);
    await setAccount(
      addresses.pstMint,
      1_000_000_000,
      pstMintData,
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      false
    );
  }

  // 5e. Ticket Registry
  const regAcc = accMap[4];
  const REGISTRY_INITIAL_SIZE = 262248;
  const regBytes = regAcc?.data?.[0]
    ? Buffer.from(regAcc.data[0], "base64")
    : null;
  const hasValidRegDiscriminator =
    regBytes &&
    regBytes.length >= 8 &&
    Array.from(regBytes.subarray(0, 8)).every(
      (b, i) => b === TICKET_REGISTRY_DISCRIMINATOR[i]
    );

  if (!poolExists) {
    // Fresh bootstrap: zero-initialized buffer for createPool #[account(zero)]
    if (!regAcc || !regBytes || regBytes.length < REGISTRY_INITIAL_SIZE) {
      console.log(
        "Injecting Ticket Registry account (uninitialized zeroed buffer)..."
      );
      const ticketRegistryData = "00".repeat(REGISTRY_INITIAL_SIZE);
      await setAccount(
        addresses.ticketRegistry,
        10_000_000_000,
        ticketRegistryData,
        PROGRAM_ID_STR,
        false
      );
    }
  } else if (!hasValidRegDiscriminator) {
    // Pool exists but registry discriminator was corrupted (all zeros) -> initialize valid header
    console.log(
      "Pool exists but Ticket Registry discriminator is uninitialized. Initializing valid header..."
    );
    const poolBytes = poolAcc?.value
      ? new Uint8Array(Buffer.from(poolAcc.value.data[0], "base64"))
      : null;
    const parsedPool = poolBytes ? parsePrizePool(poolBytes) : null;
    const poolId = parsedPool ? parsedPool.poolId : 1;

    const repairedBuffer = serializeTicketRegistry({
      poolId,
      capacity: 4096,
      userCount: 0,
      totalActiveTickets: 0,
      totalPendingTickets: 0,
      drawCycleId: parsedPool ? parsedPool.currentDrawCycleId : 0,
      drawPreparedUpTo: 0,
      version: 1,
      totalSizeBytes: REGISTRY_INITIAL_SIZE,
    });
    const hexData = Buffer.from(repairedBuffer).toString("hex");
    await setAccount(
      addresses.ticketRegistry,
      10_000_000_000,
      hexData,
      PROGRAM_ID_STR,
      false
    );
  } else {
    console.log(
      "Ticket Registry already initialized on-chain; preserving existing data."
    );
  }

  // 5f. Huma Pool Underlying
  if (!accMap[5] || !accMap[5].data?.[0]) {
    console.log("Injecting Huma Pool Underlying token account...");
    const humaPoolUnderlyingData = serializeTokenAccount(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      humaPoolAuthority,
      0n
    );
    await setAccount(
      addresses.humaPoolUnderlying,
      1_000_000_000,
      humaPoolUnderlyingData,
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      false
    );
  }

  // 5g. Huma Pool Mode Token
  if (!accMap[6] || !accMap[6].data?.[0]) {
    console.log("Injecting Huma Pool Mode token account...");
    const humaPoolModeTokenData = serializeTokenAccount(
      addresses.pstMint,
      humaPoolAuthority,
      0n
    );
    await setAccount(
      addresses.humaPoolModeToken,
      1_000_000_000,
      humaPoolModeTokenData,
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      false
    );
  }

  // 5h. Admin Fee Wallet
  if (!accMap[7] || !accMap[7].data?.[0]) {
    console.log("Injecting Admin Fee Wallet token account...");
    const feeWalletData = serializeTokenAccount(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      adminSigner.address,
      0n
    );
    await setAccount(
      addresses.feeWallet,
      1_000_000_000,
      feeWalletData,
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      false
    );
  }

  // 6. Write the environment file
  writeEnvLocal(addresses, adminSigner.address, randomnessSigner.address);

  // 7. Check if GlobalConfig exists on-chain
  const globalConfigAddress = await findGlobalConfigPda();
  let isGlobalInitialized = false;
  try {
    const acc = await rpc.getAccountInfo(globalConfigAddress).send();
    if (acc && acc.value) {
      isGlobalInitialized = true;
    }
  } catch {}

  return {
    rpc,
    adminSigner,
    randomnessSigner,
    addresses,
    globalConfigAddress,
    isGlobalInitialized,
  };
}

async function initializeGlobalConfigOnChain(ctx: BaseStateContext) {
  const { rpc, adminSigner, isGlobalInitialized } = ctx;

  if (isGlobalInitialized) {
    console.log("GlobalConfig is already initialized on-chain.");
    return;
  }

  console.log("Initializing GlobalConfig on-chain...");
  const ix = await buildInitializeGlobalInstruction({
    admin: adminSigner,
    jobsAccount: adminSigner.address,
  });
  await sendTx(rpc, ix, adminSigner);
  ctx.isGlobalInitialized = true;
  console.log("GlobalConfig initialized successfully on-chain.");
}

async function initializePrizePoolOnChain(
  ctx: BaseStateContext,
  poolId: number = 1
) {
  const { rpc, adminSigner, addresses } = ctx;
  const poolAddress = await findPrizePoolPda(poolId);

  let poolInitialized = false;
  try {
    const acc = await rpc.getAccountInfo(poolAddress).send();
    if (acc && acc.value) {
      poolInitialized = true;
    }
  } catch {}

  if (!poolInitialized) {
    console.log(`Creating Pool (pool_id: ${poolId}) on-chain...`);
    const ix = await buildCreatePoolInstruction({
      admin: adminSigner,
      poolId,
      bondPrice: 1_000_000n, // bond_price = 1 USDC (decimals 6)
      stakeCycleDurationHrs: 24n, // stake_cycle_duration_hrs = 24
      feeBasisPoints: 100, // fee_basis_points = 100 (1%)
      minYieldThreshold: 0n,
      maxYieldBasisPoints: 0,
      payoutTimelockSeconds: 300,
      tokenMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
      pstMint: address(addresses.pstMint),
      ticketRegistry: address(addresses.ticketRegistry),
      feeWallet: address(addresses.feeWallet),
    });
    await sendTx(rpc, ix, adminSigner);
    await ensurePrizeTiersConfigured(poolId, rpc, adminSigner);
  } else {
    console.log(`Pool (pool_id: ${poolId}) is already created on-chain.`);
    const poolAcc = await rpc.getAccountInfo(poolAddress).send();
    if (poolAcc && poolAcc.value) {
      const rawData = new Uint8Array(
        Buffer.from(poolAcc.value.data[0], "base64")
      );
      const parsedPool = parsePrizePool(rawData);
      if (parsedPool.prizeTiers.length === 0) {
        console.log(
          `Prize tiers not configured for existing pool (pool_id: ${poolId}). Configuring now...`
        );
        await ensurePrizeTiersConfigured(poolId, rpc, adminSigner);
      }
    }
  }
}

export function getBootstrapGuideText(): string {
  return `
================================================================================
🚀 Localnet Base State is Ready for pb-cli Admin Testing!
================================================================================
The local validator has been injected with compiled programs and mock accounts,
and .env.local has been synchronized. GlobalConfig has NOT been initialized yet.

Next Steps to Test pb-cli:
  1. Initialize Global Configuration:
     npm run pb-cli init-global
     (Optional flags: --admin <PUBKEY> --guardian <PUBKEY> --jobs <CRANK_PUBKEY>)
     (Update existing: npm run pb-cli update-global-config -- --guardian <PUBKEY> --jobs <PUBKEY>)

  2. Query & Verify Global Configuration:
     npm run pb-cli query-config

  3. Create Prize Pool #1:
     npm run pb-cli create-pool -- --pool 1
     (Defaults: --bond-price 1000000 --stake-duration 24 --fee-bps 100 --min-yield-threshold 0 --max-yield-bps 0 --payout-timelock 300 --tiers "1:10000")
     (Custom params: npm run pb-cli create-pool -- --pool 1 --bond-price 1000000 --stake-duration 24 --fee-bps 100 --min-yield-threshold 0 --max-yield-bps 500 --payout-timelock 300 --tiers "1:5000,2:1500,5:400")
     (Optional accounts: --token-mint <PUBKEY> --pst-mint <PUBKEY> --fee-wallet <PUBKEY>)
     (Update existing: npm run pb-cli update-pool-config -- --pool 1 --fee-bps 100 --bond-price 1000000 --stake-duration 24 --min-yield-threshold 0 --max-yield-bps 500 --payout-timelock 0 --fee-wallet <PUBKEY>)

  4. Initialize Huma Lender:
     npm run pb-cli initialize-huma-lender -- --pool 1

  5. Update Prize Tiers (Optional - if customizing after creation):
     npm run pb-cli set-prize-tiers -- --pool 1 --tiers "1:5000,2:1500,5:400"

  6. Inspect State:
     npm run pb-cli query-pool -- --pool 1
     npm run pb-cli query-mock-huma-pool-state

Additional Commands:
  - Emergency Controls: npm run pb-cli pause-pool -- --pool 1 (or unpause-pool / close-pool / void-draw)
  - Draw Execution:     npm run pb-cli harvest -- --pool 1 -> prepare-draw -> reveal -> reinvest
                        (Or all-in-one: npm run localnet draw -- --pool-id 1)
================================================================================
`;
}

export function printBootstrapGuide() {
  console.log(getBootstrapGuideText());
}

async function handleBootstrap(args: string[] = []) {
  const flags = parseLocalnetFlags(args);
  const context = await injectBaseState({ dbName: flags.dbName });

  if (context.isGlobalInitialized) {
    console.warn(`
[WARNING] GlobalConfig is already initialized on this localnet node at ${context.globalConfigAddress}.
Running 'npm run pb-cli init-global' will return an error because the account already exists.
To start with a fresh state, either restart Surfpool or specify a new database using:
  npm run localnet start --bootstrap-only --db <clean-name>
`);
  } else {
    printBootstrapGuide();
  }
}

async function handleInit(args: string[] = []) {
  const flags = parseLocalnetFlags(args);
  console.log("Starting localnet state initialization...");
  const context = await injectBaseState({ dbName: flags.dbName });
  await initializeGlobalConfigOnChain(context);
  await initializePrizePoolOnChain(context, 1);
  console.log("Localnet initialization sequence completed successfully!");
}

async function handleFund(args: string[]) {
  if (args.length < 2) {
    console.error(
      "Error: Missing arguments. Usage: npm run localnet fund <wallet> <amount>"
    );
    process.exit(1);
  }

  const walletStr = args[0];
  const amountStr = args[1];

  // Validate wallet address
  try {
    address(walletStr);
  } catch {
    console.error(`Error: Invalid base58 wallet address "${walletStr}".`);
    process.exit(1);
  }

  // Validate amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    console.error(
      `Error: Invalid amount "${amountStr}". Must be a positive number.`
    );
    process.exit(1);
  }

  // Create RPC client
  const rpc = createSolanaRpc(RPC_URL);
  const isRpcsActive = await checkRpcHealth(RPC_URL);
  if (!isRpcsActive) {
    console.error(
      "Error: Solana RPC is not running. Please start the localnet orchestrator first."
    );
    process.exit(1);
  }

  // 1. Additive SOL Funding
  await airdropSol(rpc, walletStr, amount);

  // 2. Additive USDC Funding
  const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const usdcAta = await findAtaAddress(walletStr, usdcMint);
  console.log(`Derived USDC ATA: ${usdcAta}`);

  const addAmount = BigInt(Math.floor(amount * 1_000_000));
  let newAmount = addAmount;

  try {
    const info = await rpc.getAccountInfo(address(usdcAta)).send();
    if (info && info.value) {
      const dataBase64 = info.value.data[0];
      const buffer = Buffer.from(dataBase64, "base64");
      const view = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength
      );
      const existingAmount = view.getBigUint64(64, true);
      newAmount = existingAmount + addAmount;
      console.log(
        `ATA already exists. Existing balance: ${Number(existingAmount) / 1_000_000} USDC. New balance: ${Number(newAmount) / 1_000_000} USDC`
      );
    } else {
      console.log(`ATA does not exist. Initializing with: ${amount} USDC`);
    }
  } catch {
    console.log(
      `ATA query failed or does not exist. Initializing with: ${amount} USDC`
    );
  }

  // Serialize and inject token account state
  const usdcAtaData = serializeTokenAccount(usdcMint, walletStr, newAmount);
  await setAccount(
    usdcAta,
    1_000_000_000, // rent exemption lamports
    usdcAtaData,
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    false
  );

  console.log(
    `Successfully funded ${walletStr} with ${amount} SOL and ${amount} USDC.`
  );
}

async function handleWarp(args: string[]) {
  let seconds: number | undefined = undefined;
  let poolEnd = false;
  let poolId = 1;
  let poolIdSpecified = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--pool-end" || arg === "-p") {
      poolEnd = true;
    } else if (arg === "--pool-id" || arg === "-i") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("Error: Missing value for pool ID flag.");
        process.exit(1);
      }
      const parsedPoolId = parseInt(nextArg, 10);
      if (isNaN(parsedPoolId) || parsedPoolId <= 0) {
        console.error(
          `Error: Invalid pool ID '${nextArg}'. Must be a positive integer.`
        );
        process.exit(1);
      }
      poolId = parsedPoolId;
      poolIdSpecified = true;
      i++; // skip next arg
    } else if (arg === "--seconds" || arg === "-s") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("Error: Missing value for seconds flag.");
        process.exit(1);
      }
      const parsedSeconds = parseFloat(nextArg);
      if (isNaN(parsedSeconds) || parsedSeconds <= 0) {
        console.error(
          `Error: Invalid warp amount '${nextArg}'. Must be a positive number of seconds.`
        );
        process.exit(1);
      }
      seconds = parsedSeconds;
      i++; // skip next arg
    } else {
      console.error(
        `Error: Unknown argument '${arg}'. Usage: npm run localnet warp [--seconds <n> | -s <n>] [--pool-id <id> | -i <id>] [--pool-end | -p]`
      );
      process.exit(1);
    }
  }

  // Validation
  if (seconds !== undefined && poolEnd) {
    console.error(
      "Error: Cannot specify both relative seconds and pool-end warp."
    );
    process.exit(1);
  }

  if (seconds !== undefined && poolIdSpecified) {
    console.error(
      "Error: --pool-id / -i can only be specified when warping to a pool's end."
    );
    process.exit(1);
  }

  // If no relative seconds specified, default to pool-end warp
  if (seconds === undefined) {
    poolEnd = true;
  }

  // 1. Verify RPC Connection
  const isRpcActive = await checkRpcHealth(RPC_URL);
  if (!isRpcActive) {
    console.error(
      `Error: Solana RPC is not running at ${RPC_URL}.\nPlease start the localnet first with 'npm run localnet start'.`
    );
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);

  // 2. Fetch current clock state
  let currentBlockTime: number;
  try {
    const clockPda = address("SysvarC1ock11111111111111111111111111111111");
    const clockAcc = await rpc
      .getAccountInfo(clockPda, { encoding: "base64" })
      .send();
    if (
      clockAcc &&
      clockAcc.value &&
      clockAcc.value.data &&
      clockAcc.value.data[0]
    ) {
      const bytes = new Uint8Array(
        Buffer.from(clockAcc.value.data[0], "base64")
      );
      if (bytes.byteLength >= 40) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength
        );
        currentBlockTime = Number(view.getBigInt64(32, true));
      } else {
        throw new Error("SysvarClock data too short");
      }
    } else {
      throw new Error("SysvarClock account missing");
    }
  } catch {
    try {
      const slot = await rpc.getSlot().send();
      const blockTimeResult = await rpc.getBlockTime(slot).send();
      currentBlockTime =
        blockTimeResult !== null
          ? Number(blockTimeResult)
          : Math.floor(Date.now() / 1000);
    } catch {
      currentBlockTime = Math.floor(Date.now() / 1000);
    }
  }

  let warpSeconds = seconds;

  if (poolEnd) {
    const programAddress = address(PROGRAM_ID_STR);
    const poolIdBytes = new Uint8Array(4);
    new DataView(poolIdBytes.buffer).setUint32(0, poolId, true);

    const [poolAddress] = await getProgramDerivedAddress({
      programAddress,
      seeds: [new TextEncoder().encode("prize_pool"), poolIdBytes],
    });

    console.log(
      `Fetching PrizePool account state for pool ID ${poolId} (${poolAddress})...`
    );

    let acc;
    try {
      acc = await rpc.getAccountInfo(poolAddress).send();
    } catch (err) {
      console.error(
        `Error: Failed to fetch account info for PrizePool at address ${poolAddress}:`,
        err
      );
      process.exit(1);
    }

    if (!acc || !acc.value) {
      console.error(
        `Error: PrizePool account for pool ID ${poolId} does not exist at address ${poolAddress}.`
      );
      process.exit(1);
    }

    const rawData = new Uint8Array(Buffer.from(acc.value.data[0], "base64"));
    const parsedPool = parsePrizePool(rawData);
    const currentCycleEndAt = BigInt(parsedPool.currentCycleEndAt);
    if (currentCycleEndAt === 0n) {
      console.error(
        `Error: PrizePool cycle end time is 0. The pool may not be fully initialized or active.`
      );
      process.exit(1);
    }

    warpSeconds = Number(currentCycleEndAt) - currentBlockTime;

    if (warpSeconds <= 0) {
      console.error(
        `Error: The pool cycle has already ended (current block time: ${currentBlockTime}, cycle end: ${currentCycleEndAt}).` +
          ` You may need to crank/draw the pool to transition it to the next cycle.`
      );
      process.exit(1);
    }

    console.log(
      `Pool cycle end timestamp: ${currentCycleEndAt} (Seconds until end: ${warpSeconds})`
    );
  }

  if (warpSeconds === undefined) {
    console.error("Error: Warp duration is undefined.");
    process.exit(1);
  }

  // 3. Time travel execution
  const targetSeconds = currentBlockTime + warpSeconds;
  const targetMs = Math.floor(targetSeconds * 1000);

  if (poolEnd) {
    console.log(
      `Warping localnet clock forward by ${warpSeconds} seconds to the end of pool ${poolId} cycle...`
    );
  } else {
    console.log(`Warping localnet clock forward by ${warpSeconds} seconds...`);
  }

  const originalDate = new Date(currentBlockTime * 1000);
  const targetDate = new Date(targetSeconds * 1000);

  console.log(
    `  From: ${originalDate.toUTCString()} / ${originalDate.toString()} (Unix: ${currentBlockTime})`
  );
  console.log(
    `  To:   ${targetDate.toUTCString()} / ${targetDate.toString()} (Unix: ${targetSeconds})`
  );

  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "surfnet_timeTravel",
        params: [{ absoluteTimestamp: targetMs }],
      }),
    });
    interface TimeTravelResponse {
      result?: {
        absoluteSlot: number;
      };
      error?: {
        code: number;
        message: string;
        data?: string;
      };
    }
    const json = (await res.json()) as TimeTravelResponse;
    if (json.error) {
      const errStr = safeStringify(json.error);
      if (errStr.includes("Cannot travel to past timestamp")) {
        console.log(
          "Validator clock is already past the target timestamp. Skipping time travel call as it is already complete."
        );
      } else {
        throw new Error(`RPC Error traveling time: ${errStr}`);
      }
    } else {
      const result = json.result;
      if (!result) {
        throw new Error("RPC response missing result");
      }
      console.log(
        `Successfully warped to slot ${result.absoluteSlot} (time travelled to ${targetMs} ms).`
      );
    }

    // To force block/slot progression and update the block time, send a dummy transfer transaction to self.
    console.log(
      "Sending a dummy transaction to force block production and update block time..."
    );
    const adminSigner = await loadOrGenerateAdminKey();
    const adminAddress = adminSigner.address;

    // Construct System Program Transfer instruction: 1000 lamports from admin to admin
    const transferData = new Uint8Array(12);
    const dataView = new DataView(transferData.buffer);
    dataView.setUint32(0, 2, true); // SystemProgram index 2 is transfer
    dataView.setBigUint64(4, 1000n, true); // 1,000 lamports

    const dummyInstruction = {
      programAddress: address("11111111111111111111111111111111"), // System Program
      accounts: [
        { address: adminAddress, role: AccountRole.WRITABLE_SIGNER },
        { address: adminAddress, role: AccountRole.WRITABLE },
      ],
      data: transferData,
    };

    await sendTx(rpc, dummyInstruction, adminSigner);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error executing time travel:", message);
    process.exit(1);
  }
}

function cleanupAndExit(code: number = 0) {
  console.log("\nStopping localnet orchestrator...");
  if (nextProcess) {
    console.log("Stopping Next.js dev server...");
    try {
      if (nextProcess.pid) {
        process.kill(-nextProcess.pid, "SIGINT");
      }
    } catch {
      try {
        nextProcess.kill("SIGINT");
      } catch {}
    }
    nextProcess = null;
  }
  if (surfpoolProcess) {
    console.log("Stopping Surfpool...");
    surfpoolProcess.kill("SIGINT");
    surfpoolProcess = null;
  }
  process.exit(code);
}

async function handleStart(args: string[] = []) {
  ensureDirsExist();
  const flags = parseLocalnetFlags(args);

  let snapshotPath: string | undefined;
  if (flags.snapshotInput) {
    const {
      snapshotPath: resolvedPath,
      addressesPath,
      cleanName,
    } = resolveSnapshotPath(flags.snapshotInput);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: Snapshot file not found at: ${resolvedPath}`);
      process.exit(1);
    }
    snapshotPath = resolvedPath;

    // Normalize snapshot: Unwrap JSON-RPC (.result) and RPC response (.value) wrappers
    try {
      const rawContent = fs.readFileSync(resolvedPath, "utf-8");
      let parsed = JSON.parse(rawContent);
      let modified = false;

      if (
        parsed &&
        typeof parsed === "object" &&
        "jsonrpc" in parsed &&
        "result" in parsed &&
        parsed.result
      ) {
        parsed = parsed.result;
        modified = true;
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        "value" in parsed &&
        parsed.value &&
        typeof parsed.value === "object" &&
        !Array.isArray(parsed.value)
      ) {
        parsed = parsed.value;
        modified = true;
      }

      if (modified) {
        console.log(
          `Normalizing snapshot structure for Surfpool in: ${resolvedPath}`
        );
        fs.writeFileSync(
          resolvedPath,
          JSON.stringify(parsed, null, 2),
          "utf-8"
        );
      }
    } catch (e) {
      console.warn(`Warning: Could not inspect snapshot JSON structure: ${e}`);
    }

    console.log(`Loading account snapshot from: ${snapshotPath}`);

    if (addressesPath && fs.existsSync(addressesPath)) {
      console.log(
        `Found paired address configuration for snapshot '${cleanName}': ${addressesPath}`
      );
      const targetAddressPath = getAddressesFilePath(flags.dbName);
      fs.copyFileSync(addressesPath, targetAddressPath);
    }
  }

  const surfpoolArgs = [
    "start",
    "--legacy-anchor-compatibility",
    "--no-tui",
    "--offline",
    "--no-deploy",
    "--yes",
  ];

  if (snapshotPath) {
    surfpoolArgs.push("--snapshot", snapshotPath);
  }

  if (flags.dbName) {
    const { dbPath, cleanName } = resolveDbPath(flags.dbName);
    const dbExists = fs.existsSync(dbPath);
    if (dbExists) {
      console.log(`Using existing SQLite database '${cleanName}' at ${dbPath}`);
    } else {
      console.log(`Creating new SQLite database '${cleanName}' at ${dbPath}`);
    }
    surfpoolArgs.push("--db", dbPath, "--surfnet-id", cleanName);
  }

  // 1. Check RPC health
  console.log("Checking Solana RPC health at", RPC_URL);
  const isRpcsActive = await checkRpcHealth(RPC_URL);

  if (!isRpcsActive) {
    console.log("Solana RPC is not running. Spawning Surfpool...");
    surfpoolProcess = spawn("surfpool", surfpoolArgs, { stdio: "inherit" });

    surfpoolProcess.on("error", (err) => {
      console.error("Failed to spawn Surfpool process:", err);
      cleanupAndExit(1);
    });

    surfpoolProcess.on("exit", (code) => {
      if (code !== 0 && surfpoolProcess !== null) {
        console.error(`Surfpool exited with code ${code}`);
        cleanupAndExit(code || 1);
      }
    });

    console.log("Waiting for Solana RPC to become healthy...");
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      if (await checkRpcHealth(RPC_URL)) {
        healthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!healthy) {
      console.error(
        "Error: Surfpool failed to start or become healthy within 30 seconds."
      );
      cleanupAndExit(1);
    }
    console.log("Surfpool is now healthy and running!");
  } else {
    console.log("Solana RPC is already active. Reusing existing instance.");
  }

  // 2. Inject Base State (Keys, SOL, Programs, Mock Accounts, .env.local)
  const context = await injectBaseState({ dbName: flags.dbName });

  if (flags.bootstrapOnly) {
    if (context.isGlobalInitialized) {
      console.warn(`
[WARNING] GlobalConfig is already initialized on this node at ${context.globalConfigAddress}.
To test pb-cli init-global against a clean ledger, restart Surfpool or specify a new database using:
  npm run localnet start --bootstrap-only --db <new-name>
`);
    } else {
      printBootstrapGuide();
    }
    console.log(
      "Localnet node is running in bootstrap mode (Next.js skipped). Press Ctrl+C to stop.\n"
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
    return;
  }

  // 3. Complete Protocol Initialization for standard dApp dev
  if (!context.isGlobalInitialized) {
    console.log(
      "GlobalConfig PDA not found. Initializing protocol state on-chain..."
    );
    await initializeGlobalConfigOnChain(context);
    await initializePrizePoolOnChain(context, 1);
  } else {
    console.log("GlobalConfig PDA is already initialized on localnet.");
    await initializePrizePoolOnChain(context, 1);
  }

  // 4. Start Next.js dev server
  console.log("Spawning Next.js dev server...");
  nextProcess = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    shell: true,
    detached: true,
  });

  nextProcess.on("error", (err) => {
    console.error("Failed to spawn Next.js process:", err);
    cleanupAndExit(1);
  });

  nextProcess.on("exit", (code) => {
    console.log(`Next.js process exited with code ${code}`);
    cleanupAndExit(code || 0);
  });
}

function handleDbList() {
  ensureDirsExist();
  const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith(".sqlite"));

  if (files.length === 0) {
    console.log("No saved SQLite databases found in localnet-state/dbs/.");
    return;
  }

  console.log("Available Localnet SQLite Databases:");
  console.log("------------------------------------------------------------");
  for (const file of files) {
    const filePath = path.resolve(DB_DIR, file);
    const stats = fs.statSync(filePath);
    const cleanName = file.replace(/\.sqlite$/, "");
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    const modified = stats.mtime.toLocaleString();
    console.log(
      `• ${cleanName.padEnd(20)} (${sizeMb.padStart(6)} MB) - Last modified: ${modified}`
    );
  }
}

async function handleDbDelete(args: string[]) {
  const dbInput = args[0];
  if (!dbInput) {
    console.error(
      "Error: Missing database name. Usage: npm run localnet db delete <name>"
    );
    process.exit(1);
  }

  const { dbPath, addressesPath, cleanName } = resolveDbPath(dbInput);

  if (!fs.existsSync(dbPath)) {
    console.error(
      `Error: Database '${cleanName}' does not exist at ${dbPath}.`
    );
    process.exit(1);
  }

  const isRpcActive = await checkRpcHealth(RPC_URL);
  if (isRpcActive) {
    console.warn(
      `\n[WARNING] Localnet RPC appears to be currently running at ${RPC_URL}.\nDeleting an active database while Surfpool is running may cause errors or state corruption.\n`
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `Are you sure you want to delete database '${cleanName}'? [y/N]: `,
      resolve
    );
  });
  rl.close();

  if (
    answer.trim().toLowerCase() !== "y" &&
    answer.trim().toLowerCase() !== "yes"
  ) {
    console.log("Operation cancelled.");
    return;
  }

  try {
    fs.unlinkSync(dbPath);
    for (const ext of ["-wal", "-shm"]) {
      const sidecar = `${dbPath}${ext}`;
      if (fs.existsSync(sidecar)) {
        fs.unlinkSync(sidecar);
      }
    }
    if (fs.existsSync(addressesPath)) {
      fs.unlinkSync(addressesPath);
    }
    console.log(`Successfully deleted database '${cleanName}'.`);
    console.log(
      `ℹ️  Note: Restarting the chain will initialize a new ledger with a fresh genesis hash.`
    );
    console.log(
      `   Client-side activity feed and transaction caches will automatically be invalidated on next load.\n`
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to delete database '${cleanName}': ${errMsg}`);
    process.exit(1);
  }
}

async function handleSnapshotSave(args: string[]) {
  ensureDirsExist();

  const isRpcActive = await checkRpcHealth(RPC_URL);
  if (!isRpcActive) {
    console.error(
      `Error: Solana RPC is not running at ${RPC_URL}.\nPlease start localnet first ('npm run localnet start') before taking a snapshot.`
    );
    process.exit(1);
  }

  const rawName = args[0] || `snapshot-${Date.now()}`;
  const baseName = path.basename(rawName);
  const cleanName = baseName.endsWith(".json")
    ? baseName.slice(0, -5)
    : baseName;
  const targetJsonPath = path.resolve(SNAPSHOT_DIR, `${cleanName}.json`);
  const targetAddrPath = path.resolve(
    SNAPSHOT_DIR,
    `${cleanName}.addresses.json`
  );

  console.log(
    `Exporting snapshot from RPC (${RPC_URL}) to '${cleanName}.json'...`
  );

  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "surfnet_exportSnapshot",
        params: [],
      }),
    });
    const json = (await res.json()) as { error?: unknown; result?: unknown };
    if (json.error) {
      throw new Error(`RPC Error: ${safeStringify(json.error)}`);
    }
    let resultData: unknown = json.result !== undefined ? json.result : json;
    if (
      resultData &&
      typeof resultData === "object" &&
      "value" in resultData &&
      (resultData as { value?: unknown }).value &&
      typeof (resultData as { value?: unknown }).value === "object" &&
      !Array.isArray((resultData as { value?: unknown }).value)
    ) {
      resultData = (resultData as { value?: unknown }).value;
    }
    fs.writeFileSync(
      targetJsonPath,
      JSON.stringify(resultData, null, 2),
      "utf-8"
    );
    console.log(`Snapshot saved successfully to: ${targetJsonPath}`);

    const globalAddressesPath = path.resolve(STATE_DIR, "addresses.json");
    if (fs.existsSync(globalAddressesPath)) {
      fs.copyFileSync(globalAddressesPath, targetAddrPath);
      console.log(
        `Paired snapshot address configuration saved to: ${targetAddrPath}`
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to export snapshot: ${errMsg}`);
    process.exit(1);
  }
}

function handleSnapshotList() {
  ensureDirsExist();
  const files = fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".addresses.json"));

  if (files.length === 0) {
    console.log("No saved snapshots found in localnet-state/snapshots/.");
    return;
  }

  console.log("Available Localnet Snapshots:");
  console.log("------------------------------------------------------------");
  for (const file of files) {
    const filePath = path.resolve(SNAPSHOT_DIR, file);
    const stats = fs.statSync(filePath);
    const cleanName = file.slice(0, -5);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    const modified = stats.mtime.toLocaleString();
    const hasAddr = fs.existsSync(
      path.resolve(SNAPSHOT_DIR, `${cleanName}.addresses.json`)
    );
    console.log(
      `• ${cleanName.padEnd(20)} (${sizeMb.padStart(6)} MB) - Last modified: ${modified}${hasAddr ? " [paired env]" : ""}`
    );
  }
}

async function handleSnapshotDelete(args: string[]) {
  const inputName = args[0];
  if (!inputName) {
    console.error(
      "Error: Missing snapshot name. Usage: npm run localnet snapshot delete <name>"
    );
    process.exit(1);
  }

  const { snapshotPath, addressesPath, cleanName } =
    resolveSnapshotPath(inputName);

  if (!fs.existsSync(snapshotPath)) {
    console.error(
      `Error: Snapshot '${cleanName}' does not exist at ${snapshotPath}.`
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `Are you sure you want to delete snapshot '${cleanName}'? [y/N]: `,
      resolve
    );
  });
  rl.close();

  if (
    answer.trim().toLowerCase() !== "y" &&
    answer.trim().toLowerCase() !== "yes"
  ) {
    console.log("Operation cancelled.");
    return;
  }

  try {
    fs.unlinkSync(snapshotPath);
    if (addressesPath && fs.existsSync(addressesPath)) {
      fs.unlinkSync(addressesPath);
    }
    console.log(`Successfully deleted snapshot '${cleanName}'.`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to delete snapshot '${cleanName}': ${errMsg}`);
    process.exit(1);
  }
}

async function main() {
  // Listen for signal handlers
  process.on("SIGINT", () => cleanupAndExit(0));
  process.on("SIGTERM", () => cleanupAndExit(0));

  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    printUsage();
    return;
  }

  let command = args[0];

  if (!command || command.startsWith("-")) {
    command = "start";
    await handleStart(args);
    return;
  }

  switch (command) {
    case "start":
      await handleStart(args.slice(1));
      break;
    case "bootstrap":
    case "setup-base":
    case "pre-global":
    case "pre-init":
      await handleBootstrap(args.slice(1));
      break;
    case "init":
      await handleInit(args.slice(1));
      break;
    case "inject-programs":
    case "reinject": {
      const adminSigner = await loadAdminSigner();
      await ensureProgramsInjected(adminSigner.address);
      break;
    }
    case "fund":
      await handleFund(args.slice(1));
      break;
    case "warp":
      await handleWarp(args.slice(1));
      break;
    case "draw":
      await handleDraw(args.slice(1));
      break;
    case "settle":
      await handleSettle(args.slice(1));
      break;
    case "yield":
      await handleYield(args.slice(1));
      break;
    case "set-prize-tiers":
    case "set-tiers":
      await handleSetPrizeTiers(args.slice(1));
      break;
    case "db":
    case "dbs": {
      const sub = args[1];
      if (sub === "list" || !sub) {
        handleDbList();
      } else if (sub === "delete") {
        await handleDbDelete(args.slice(2));
      } else {
        console.error(`Unknown db subcommand: ${sub}`);
        printUsage();
        process.exit(1);
      }
      break;
    }
    case "db-list":
      handleDbList();
      break;
    case "db-delete":
      await handleDbDelete(args.slice(1));
      break;
    case "snapshot":
    case "snapshots": {
      const sub = args[1];
      if (sub === "list") {
        handleSnapshotList();
      } else if (sub === "save" || sub === "export") {
        await handleSnapshotSave(args.slice(2));
      } else if (sub === "delete") {
        await handleSnapshotDelete(args.slice(2));
      } else {
        console.error(`Unknown snapshot subcommand: ${sub}`);
        printUsage();
        process.exit(1);
      }
      break;
    }
    case "snapshot-save":
    case "snapshot-export":
      await handleSnapshotSave(args.slice(1));
      break;
    case "snapshot-list":
      handleSnapshotList();
      break;
    case "snapshot-delete":
      await handleSnapshotDelete(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

async function handleSettle(args: string[]) {
  let count = -1; // sentinel: -1 means "settle all pending"
  const countEq = args.find((a) => a.startsWith("--count="));
  const cEq = args.find((a) => a.startsWith("-c="));
  const countIndex = args.indexOf("--count");
  const cIndex = args.indexOf("-c");

  if (countEq) {
    count = parseInt(countEq.split("=")[1], 10);
  } else if (cEq) {
    count = parseInt(cEq.split("=")[1], 10);
  } else if (countIndex !== -1 && args[countIndex + 1]) {
    count = parseInt(args[countIndex + 1], 10);
  } else if (cIndex !== -1 && args[cIndex + 1]) {
    count = parseInt(args[cIndex + 1], 10);
  } else if (args[0] && !isNaN(parseInt(args[0], 10))) {
    count = parseInt(args[0], 10);
  }

  if (isNaN(count) || count < 0) {
    console.error("Error: Invalid count value. Must be a non-negative number.");
    process.exit(1);
  }

  const isRpcActive = await checkRpcHealth(RPC_URL);
  if (!isRpcActive) {
    console.error(
      `Error: Solana RPC is not running at ${RPC_URL}.\nPlease start the localnet first with 'npm run localnet start'.`
    );
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);
  const addresses = loadOrGenerateAddresses();

  console.log(
    `Fetching Huma Pool State account: ${addresses.humaPoolState}...`
  );
  const poolStateInfo = await rpc
    .getAccountInfo(address(addresses.humaPoolState))
    .send();
  if (!poolStateInfo || !poolStateInfo.value) {
    console.error(
      `Error: Huma Pool State account does not exist. Run 'npm run localnet init' first.`
    );
    process.exit(1);
  }

  const rawData = Buffer.from(poolStateInfo.value.data[0], "base64");

  if (rawData.length < 30) {
    console.error("Error: Huma Pool State account data is too short.");
    process.exit(1);
  }
  const numModes = rawData.readUInt32LE(26);
  const modeConfigKeysOffset = 30 + numModes * 216;
  if (rawData.length < modeConfigKeysOffset + 4) {
    console.error(
      "Error: Huma Pool State account data is too short to read mode config keys offset."
    );
    process.exit(1);
  }
  const numConfigKeys = rawData.readUInt32LE(modeConfigKeysOffset);
  const redemptionOffset = modeConfigKeysOffset + 4 + numConfigKeys * 32;
  if (rawData.length < redemptionOffset + 32) {
    console.error(
      "Error: Huma Pool State account data is too short to read redemption queue."
    );
    process.exit(1);
  }

  // Read current IDs
  const nextLow = rawData.readBigUInt64LE(redemptionOffset);
  const nextHigh = rawData.readBigUInt64LE(redemptionOffset + 8);
  const next = (nextHigh << 64n) | nextLow;

  const lastLow = rawData.readBigUInt64LE(redemptionOffset + 16);
  const lastHigh = rawData.readBigUInt64LE(redemptionOffset + 24);
  const last = (lastHigh << 64n) | lastLow;

  const pendingCount = Number(last - next);
  console.log(`Current Mock Huma Queue Status:`);
  console.log(`  next_request_id: ${next}`);
  console.log(`  last_request_id: ${last}`);
  console.log(`  Pending requests: ${pendingCount}`);

  // Resolve sentinel: settle all pending if no explicit count given
  if (count === -1) {
    count = pendingCount;
    console.log(
      `No --count specified, settling all ${count} pending requests.`
    );
  }

  if (count === 0) {
    console.log("No pending requests to settle.");
    return;
  }

  if (count > pendingCount) {
    console.log(
      `Warning: requested to settle ${count} requests, but only ${pendingCount} are currently pending.`
    );
    console.log(`Advancing last_request_id to match the new next_request_id.`);
  }

  const newNext = next + BigInt(count);
  const newLast = last > newNext ? last : newNext;

  console.log(`Updating queue to:`);
  console.log(`  new next_request_id: ${newNext}`);
  console.log(`  new last_request_id: ${newLast}`);

  // Write new values
  rawData.writeBigUInt64LE(newNext & 0xffffffffffffffffn, redemptionOffset);
  rawData.writeBigUInt64LE(newNext >> 64n, redemptionOffset + 8);
  rawData.writeBigUInt64LE(
    newLast & 0xffffffffffffffffn,
    redemptionOffset + 16
  );
  rawData.writeBigUInt64LE(newLast >> 64n, redemptionOffset + 24);

  // Set Huma pool state account (queue IDs updated)
  await setAccount(
    addresses.humaPoolState,
    Number(poolStateInfo.value.lamports),
    rawData.toString("hex"),
    poolStateInfo.value.owner,
    poolStateInfo.value.executable
  );

  // ── Simulate Huma epoch processing ─────────────────────────────────────
  // The real Huma burns escrowed PST and decrements total_assets during
  // epoch settlement. The mock doesn't do this, so we simulate it here
  // by editing the mint supply and pool_state total_assets directly.

  // 1. Read escrowed PST balance from huma_pool_mode_token
  console.log(
    `Reading escrowed PST from huma_pool_mode_token: ${addresses.humaPoolModeToken}...`
  );
  const modeTokenInfo = await rpc
    .getAccountInfo(address(addresses.humaPoolModeToken))
    .send();

  let escrowedPst = 0n;
  if (modeTokenInfo?.value) {
    const modeTokenBuffer = Buffer.from(modeTokenInfo.value.data[0], "base64");
    if (modeTokenBuffer.length >= 72) {
      escrowedPst = modeTokenBuffer.readBigUInt64LE(64);
    }
  }

  let usdcValue = 0n;

  if (escrowedPst > 0n && pendingCount > 0) {
    const countBi = BigInt(count);
    const startRequestId = next;
    const endRequestId = next + countBi - 1n;

    // Calculate exact PST to burn by querying matching on-chain PendingRedemption accounts
    let exactPstToBurn = 0n;
    let matchedCount = 0;

    try {
      const redemptions = await rpc
        .getProgramAccounts(address(PROGRAM_ID_STR), {
          filters: [{ dataSize: 159n }],
          encoding: "base64",
        })
        .send();

      for (const acc of redemptions) {
        const buf = Buffer.from(acc.account.data[0], "base64");
        if (buf.length < 159) continue;

        const low = buf.readBigUInt64LE(8);
        const high = buf.readBigUInt64LE(16);
        const humaRequestId = low | (high << 64n);

        if (humaRequestId >= startRequestId && humaRequestId <= endRequestId) {
          const pstShares = buf.readBigUInt64LE(40);
          exactPstToBurn += pstShares;
          matchedCount++;
        }
      }
    } catch (e) {
      console.warn(
        "Could not query PendingRedemption accounts, using fallback formula:",
        e
      );
    }

    let pstToBurn = 0n;
    if (matchedCount > 0) {
      pstToBurn = exactPstToBurn > escrowedPst ? escrowedPst : exactPstToBurn;
      console.log(
        `Found ${matchedCount} matching PendingRedemption account(s) for Huma requests ${startRequestId}..${endRequestId}.`
      );
      console.log(`Exact PST to burn: ${pstToBurn} micro-PST`);
    } else {
      const pendingCountBi = BigInt(pendingCount);
      pstToBurn = (escrowedPst * countBi) / pendingCountBi;
      console.log(
        `No matching PendingRedemption accounts found. Using proportional PST burn fallback: ${pstToBurn} micro-PST`
      );
    }

    // 2. Read PST mint supply
    const pstMintInfo = await rpc
      .getAccountInfo(address(addresses.pstMint))
      .send();
    if (!pstMintInfo?.value) {
      console.error("Error: PST Mint account does not exist.");
      process.exit(1);
    }
    const pstMintBuffer = Buffer.from(pstMintInfo.value.data[0], "base64");
    const pstSupply = pstMintBuffer.readBigUInt64LE(36);

    // 3. Read current total_assets from pool_state (re-read after queue update)
    const updatedPoolStateInfo = await rpc
      .getAccountInfo(address(addresses.humaPoolState))
      .send();
    const updatedRawData = Buffer.from(
      updatedPoolStateInfo!.value!.data[0],
      "base64"
    );
    const totalAssetsLow = updatedRawData.readBigUInt64LE(30);
    const totalAssetsHigh = updatedRawData.readBigUInt64LE(38);
    const totalAssets = (totalAssetsHigh << 64n) | totalAssetsLow;

    // 4. Compute USDC value of pstToBurn and decrement total_assets
    // Use ceiling division to avoid rounding down by 1 micro-USDC, which would
    // leave the pool_vault underfunded when claim_redemption transfers exact principal.
    if (pstSupply > 0n && totalAssets > 0n) {
      usdcValue = (pstToBurn * totalAssets + pstSupply - 1n) / pstSupply;
    } else {
      usdcValue = pstToBurn; // 1:1 fallback
    }

    const newTotalAssets =
      totalAssets > usdcValue ? totalAssets - usdcValue : 0n;
    updatedRawData.writeBigUInt64LE(newTotalAssets & 0xffffffffffffffffn, 30);
    updatedRawData.writeBigUInt64LE(newTotalAssets >> 64n, 38);

    await setAccount(
      addresses.humaPoolState,
      Number(updatedPoolStateInfo!.value!.lamports),
      updatedRawData.toString("hex"),
      updatedPoolStateInfo!.value!.owner,
      updatedPoolStateInfo!.value!.executable
    );

    // 5. Burn proportional PST: decrement mint supply by pstToBurn
    const newSupply = pstSupply - pstToBurn;
    pstMintBuffer.writeBigUInt64LE(newSupply, 36);

    await setAccount(
      addresses.pstMint,
      Number(pstMintInfo.value.lamports),
      pstMintBuffer.toString("hex"),
      pstMintInfo.value.owner,
      pstMintInfo.value.executable
    );

    // 6. Decrement huma_pool_mode_token balance by pstToBurn
    const remainingEscrowedPst = escrowedPst - pstToBurn;
    const modeTokenBuffer2 = Buffer.from(
      modeTokenInfo!.value!.data[0],
      "base64"
    );
    modeTokenBuffer2.writeBigUInt64LE(remainingEscrowedPst, 64);

    await setAccount(
      addresses.humaPoolModeToken,
      Number(modeTokenInfo!.value!.lamports),
      modeTokenBuffer2.toString("hex"),
      modeTokenInfo!.value!.owner,
      modeTokenInfo!.value!.executable
    );

    console.log(
      `Epoch simulation: burned ${pstToBurn} escrowed PST (worth ${Number(usdcValue) / 1_000_000} USDC, remaining escrowed: ${remainingEscrowedPst})`
    );
    console.log(`  PST supply: ${pstSupply} → ${newSupply}`);
    console.log(
      `  Total assets: ${Number(totalAssets) / 1_000_000} → ${Number(newTotalAssets) / 1_000_000} USDC`
    );
  } else {
    console.log("No escrowed PST to burn — skipping epoch simulation.");
  }

  // 7. Read existing owed amount from Huma Lender State and add usdcValue
  let existingOwed = 0n;
  const lenderStateInfo = await rpc
    .getAccountInfo(address(addresses.humaLenderState))
    .send();
  if (lenderStateInfo?.value) {
    const buf = Buffer.from(lenderStateInfo.value.data[0], "base64");
    if (buf.length >= 16) {
      existingOwed = buf.readBigUInt64LE(8);
    }
  }

  // 8. Read existing balance from Huma Pool Underlying vault and add usdcValue
  let existingBalance = 0n;
  const humaUnderlyingInfo = await rpc
    .getAccountInfo(address(addresses.humaPoolUnderlying))
    .send();
  if (humaUnderlyingInfo?.value) {
    const buf = Buffer.from(humaUnderlyingInfo.value.data[0], "base64");
    if (buf.length >= 72) {
      existingBalance = buf.readBigUInt64LE(64);
    }
  }

  const newOwed = existingOwed + usdcValue;
  const newBalance = existingBalance + usdcValue;

  console.log(
    `Updating Huma Lender State owed: ${existingOwed} → ${newOwed} micro-USDC...`
  );
  const lenderStateData = new Uint8Array(16);
  const view = new DataView(lenderStateData.buffer);
  view.setBigUint64(8, newOwed, true);
  const lenderStateHex = Buffer.from(lenderStateData).toString("hex");
  await setAccount(
    addresses.humaLenderState,
    1_000_000_000,
    lenderStateHex,
    MOCK_HUMA_PROGRAM_ID_STR,
    false
  );

  console.log(
    `Funding Huma Pool Underlying vault balance: ${existingBalance} → ${newBalance} micro-USDC...`
  );
  const humaPoolAuthority = await findHumaPoolAuthorityPda(
    addresses.humaPoolState
  );
  const humaPoolUnderlyingData = serializeTokenAccount(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    humaPoolAuthority,
    newBalance
  );
  await setAccount(
    addresses.humaPoolUnderlying,
    1_000_000_000,
    humaPoolUnderlyingData,
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    false
  );

  console.log(`Successfully enabled redemption of pending requests!`);
}

async function handleYield(args: string[]) {
  let amountUsdcStr: string | undefined = undefined;
  let poolId = 1;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--pool-id" || arg === "-i") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("Error: Missing value for pool ID flag.");
        process.exit(1);
      }
      const parsedPoolId = parseInt(nextArg, 10);
      if (isNaN(parsedPoolId) || parsedPoolId <= 0) {
        console.error(
          `Error: Invalid pool ID '${nextArg}'. Must be a positive integer.`
        );
        process.exit(1);
      }
      poolId = parsedPoolId;
      i++; // skip next arg
    } else if (!arg.startsWith("-")) {
      if (amountUsdcStr === undefined) {
        amountUsdcStr = arg;
      } else {
        console.error(`Error: Unexpected argument '${arg}'.`);
        process.exit(1);
      }
    } else {
      console.error(
        `Error: Unknown argument '${arg}'. Usage: npm run localnet yield <amount_usdc> [--pool-id <id> | -i <id>]`
      );
      process.exit(1);
    }
  }

  if (amountUsdcStr === undefined) {
    console.error(
      "Error: Missing yield amount. Usage: npm run localnet yield <amount_usdc> [--pool-id <id> | -i <id>]"
    );
    process.exit(1);
  }

  const yieldAmountFloat = parseFloat(amountUsdcStr);
  if (isNaN(yieldAmountFloat) || yieldAmountFloat < 0) {
    console.error(
      `Error: Invalid yield amount '${amountUsdcStr}'. Must be a non-negative number.`
    );
    process.exit(1);
  }

  // USDC has 6 decimals
  const yieldAmountMicroUsdc = BigInt(Math.round(yieldAmountFloat * 1_000_000));

  const isRpcActive = await checkRpcHealth(RPC_URL);
  if (!isRpcActive) {
    console.error(
      `Error: Solana RPC is not running at ${RPC_URL}.\nPlease start the localnet first with 'npm run localnet start'.`
    );
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);
  const addresses = loadOrGenerateAddresses();

  // Derive pool PDAs
  const programAddress = address(PROGRAM_ID_STR);
  const encoder = new TextEncoder();
  const poolIdBytes = new Uint8Array(4);
  new DataView(poolIdBytes.buffer).setUint32(0, poolId, true);

  const [poolAddress] = await getProgramDerivedAddress({
    programAddress,
    seeds: [encoder.encode("prize_pool"), poolIdBytes],
  });

  const [poolPstVaultAddress] = await getProgramDerivedAddress({
    programAddress,
    seeds: [encoder.encode("pool_pst"), poolIdBytes],
  });

  console.log(`Fetching PrizePool account: ${poolAddress}...`);
  const poolInfo = await rpc.getAccountInfo(poolAddress).send();
  if (!poolInfo || !poolInfo.value) {
    console.error(
      `Error: PrizePool account for pool ID ${poolId} does not exist.`
    );
    process.exit(1);
  }

  const poolBuffer = new Uint8Array(
    Buffer.from(poolInfo.value.data[0], "base64")
  );
  const parsedPool = parsePrizePool(poolBuffer);
  const totalDepositedPrincipal = BigInt(parsedPool.totalDepositedPrincipal);
  const totalFeesAccrued = parsedPool.totalFeesAccrued;
  const totalFeesWithdrawn = parsedPool.totalFeesWithdrawn;
  const totalPrizesAllocated = parsedPool.totalPrizesAllocated;

  const feesInVault = totalFeesAccrued - totalFeesWithdrawn;
  const bookValue =
    totalDepositedPrincipal + feesInVault + totalPrizesAllocated;

  console.log("Fetching on-chain yield parameters...");
  const {
    humaTotalAssets: currentTotalAssets,
    pstSupply,
    poolPstBalance,
  } = await fetchPoolYieldOnChainState(rpc, {
    poolId,
    humaPoolStateAddress: addresses.humaPoolState,
    pstMintAddress: addresses.pstMint,
  });

  if (poolPstBalance === 0n) {
    console.error(
      "Error: Pool PST balance is 0. Cannot simulate yield without active deposits."
    );
    process.exit(1);
  }

  const requiredCurrentValue = bookValue + yieldAmountMicroUsdc;
  const requiredTotalAssets =
    (requiredCurrentValue * pstSupply) / poolPstBalance;

  // Safety check for u128 overflow
  if (requiredTotalAssets > 0xffffffffffffffffffffffffffffffffn) {
    console.error("Error: Calculated total assets exceeds u128 limit.");
    process.exit(1);
  }

  console.log(
    `Fetching Huma Pool State account: ${addresses.humaPoolState}...`
  );
  const poolStateInfo = await rpc
    .getAccountInfo(address(addresses.humaPoolState))
    .send();
  if (!poolStateInfo || !poolStateInfo.value) {
    console.error(
      `Error: Huma Pool State account does not exist. Run 'npm run localnet init' first.`
    );
    process.exit(1);
  }

  const rawData = Buffer.from(poolStateInfo.value.data[0], "base64");
  if (rawData.length < 46) {
    console.error("Error: Huma Pool State account data is too short.");
    process.exit(1);
  }

  console.log("\nYield Simulation Calculation Details:");
  console.log(`- Pool ID: ${poolId}`);
  console.log(
    `- Total Deposited Principal: ${Number(totalDepositedPrincipal) / 1_000_000} USDC`
  );
  console.log(
    `- Total Fees Accrued: ${Number(totalFeesAccrued) / 1_000_000} USDC`
  );
  console.log(
    `- Total Fees Withdrawn: ${Number(totalFeesWithdrawn) / 1_000_000} USDC`
  );
  console.log(`- Pool Book Value: ${Number(bookValue) / 1_000_000} USDC`);
  console.log(`- Target Yield to Simulate: ${yieldAmountFloat} USDC`);
  console.log(
    `- Required Current Value: ${Number(requiredCurrentValue) / 1_000_000} USDC`
  );
  console.log(`- PST Supply: ${pstSupply}`);
  console.log(`- Pool PST Balance: ${poolPstBalance}`);
  console.log(
    `- Current Huma Total Assets: ${Number(currentTotalAssets) / 1_000_000} USDC`
  );
  console.log(
    `- New Huma Total Assets: ${Number(requiredTotalAssets) / 1_000_000} USDC\n`
  );

  // Write new total assets (u128) back to the raw Huma Pool State data buffer at offset 30
  rawData.writeBigUInt64LE(requiredTotalAssets & 0xffffffffffffffffn, 30);
  rawData.writeBigUInt64LE(requiredTotalAssets >> 64n, 38);

  console.log("Injecting updated Huma Pool State account...");
  await setAccount(
    addresses.humaPoolState,
    Number(poolStateInfo.value.lamports),
    rawData.toString("hex"),
    poolStateInfo.value.owner,
    poolStateInfo.value.executable
  );

  console.log(
    `Successfully simulated yield! Huma pool total assets updated to ${Number(requiredTotalAssets) / 1_000_000} USDC.`
  );
}

async function handleSetPrizeTiers(args: string[]) {
  let poolId = 1;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--pool-id" || arg === "-i") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("Error: Missing value for --pool-id flag.");
        process.exit(1);
      }
      const parsed = parseInt(nextArg, 10);
      if (isNaN(parsed) || parsed <= 0) {
        console.error(`Error: Invalid pool ID '${nextArg}'.`);
        process.exit(1);
      }
      poolId = parsed;
      i++;
    }
  }

  const isRpcActive = await checkRpcHealth(RPC_URL);
  if (!isRpcActive) {
    console.error(
      `Error: Solana RPC is not running at ${RPC_URL}.\nPlease start localnet first with 'npm run localnet start'.`
    );
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);
  const adminSigner = await loadOrGenerateAdminKey();
  await ensurePrizeTiersConfigured(poolId, rpc, adminSigner);
}

async function handleDraw(args: string[]) {
  let poolId = 1;
  let yieldAmountStr: string | undefined = undefined;
  let reinvest = false;
  let seedHex: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--pool-id" || arg === "-i") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("Error: Missing value for pool ID flag.");
        process.exit(1);
      }
      const parsedPoolId = parseInt(nextArg, 10);
      if (isNaN(parsedPoolId) || parsedPoolId <= 0) {
        console.error(`Error: Invalid pool ID '${nextArg}'.`);
        process.exit(1);
      }
      poolId = parsedPoolId;
      i++;
    } else if (arg === "--yield" || arg === "-y") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("Error: Missing value for yield flag.");
        process.exit(1);
      }
      yieldAmountStr = nextArg;
      i++;
    } else if (arg === "--reinvest" || arg === "-r") {
      reinvest = true;
    } else if (arg === "--seed" || arg === "-s") {
      const nextArg = args[i + 1];
      if (!nextArg) {
        console.error("Error: Missing value for seed flag.");
        process.exit(1);
      }
      seedHex = nextArg;
      i++;
    } else {
      console.error(`Error: Unknown argument '${arg}' for draw command.`);
      process.exit(1);
    }
  }

  const isRpcActive = await checkRpcHealth(RPC_URL);
  if (!isRpcActive) {
    console.error(
      `Error: Solana RPC is not running at ${RPC_URL}.\nPlease start localnet first with 'npm run localnet start'.`
    );
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);

  if (yieldAmountStr !== undefined) {
    console.log(
      `Simulating ${yieldAmountStr} USDC yield for pool ${poolId}...`
    );
    await handleYield([yieldAmountStr, "--pool-id", poolId.toString()]);
  }

  const programAddress = address(PROGRAM_ID_STR);
  const poolIdBytes = new Uint8Array(4);
  new DataView(poolIdBytes.buffer).setUint32(0, poolId, true);

  const [poolAddress] = await getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode("prize_pool"), poolIdBytes],
  });

  const poolAcc = await rpc.getAccountInfo(poolAddress).send();
  if (!poolAcc || !poolAcc.value) {
    console.error(
      `Error: PrizePool account for pool ${poolId} does not exist.`
    );
    process.exit(1);
  }

  const rawData = new Uint8Array(Buffer.from(poolAcc.value.data[0], "base64"));
  const parsedPool = parsePrizePool(rawData);
  const currentCycleEndAt = parsedPool.currentCycleEndAt;
  const currentDrawCycleId = parsedPool.currentDrawCycleId;

  if (parsedPool.prizeTiers.length === 0) {
    console.log(
      `Notice: Prize tiers have not been configured for pool ${poolId}. Configuring default prize tiers...`
    );
    const adminSigner = await loadOrGenerateAdminKey();
    await ensurePrizeTiersConfigured(poolId, rpc, adminSigner);
  }

  let currentBlockTime: number;
  try {
    const clockPda = address("SysvarC1ock11111111111111111111111111111111");
    const clockAcc = await rpc
      .getAccountInfo(clockPda, { encoding: "base64" })
      .send();
    if (
      clockAcc &&
      clockAcc.value &&
      clockAcc.value.data &&
      clockAcc.value.data[0]
    ) {
      const bytes = new Uint8Array(
        Buffer.from(clockAcc.value.data[0], "base64")
      );
      if (bytes.byteLength >= 40) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength
        );
        currentBlockTime = Number(view.getBigInt64(32, true));
      } else {
        throw new Error("SysvarClock data too short");
      }
    } else {
      throw new Error("SysvarClock account missing");
    }
  } catch {
    try {
      const slot = await rpc.getSlot().send();
      const blockTimeResult = await rpc.getBlockTime(slot).send();
      currentBlockTime =
        blockTimeResult !== null
          ? Number(blockTimeResult)
          : Math.floor(Date.now() / 1000);
    } catch {
      currentBlockTime = Math.floor(Date.now() / 1000);
    }
  }

  const warpSeconds = currentCycleEndAt - currentBlockTime;
  if (warpSeconds > 0) {
    console.log(
      `Warping ${warpSeconds} seconds to pool ${poolId} cycle end timestamp (${currentCycleEndAt})...`
    );
    await handleWarp(["--seconds", warpSeconds.toString()]);
  } else {
    console.log(
      `Pool cycle end timestamp (${currentCycleEndAt}) already reached or past. Ensuring validator clock sync...`
    );
    try {
      const targetMs = (currentCycleEndAt + 1) * 1000;
      await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "surfnet_timeTravel",
          params: [{ absoluteTimestamp: targetMs }],
        }),
      });
    } catch {
      // Ignore if validator clock is already past targetMs
    }
  }

  const adminSigner = await loadOrGenerateAdminKey();

  console.log(
    `Harvesting yield and committing draw cycle ${currentDrawCycleId} for pool ${poolId}...`
  );
  const harvestResult = await executeHarvest({
    poolId,
    rpcUrl: RPC_URL,
    signer: adminSigner,
  });

  const targetCycleId = harvestResult.drawCycleId;
  console.log(`Harvest completed for draw cycle ${targetCycleId}.`);

  const drawCyclePda = await findDrawCyclePda(poolId, targetCycleId);
  const drawCycleAcc = await rpc
    .getAccountInfo(drawCyclePda, { encoding: "base64" })
    .send();
  if (drawCycleAcc && drawCycleAcc.value) {
    const base64Encoder = getBase64Encoder();
    const drawCycleBytes = new Uint8Array(
      base64Encoder.encode(drawCycleAcc.value.data[0])
    );
    const drawCycleState = parseDrawCycle(drawCycleBytes);
    if (
      drawCycleState.status === "Complete" ||
      drawCycleState.status === "Skipped" ||
      drawCycleState.status === "ForceUnlocked"
    ) {
      console.log(
        `Notice: Draw cycle ${targetCycleId} status is '${drawCycleState.status}' (0 prize pot or 0 active tickets). Skipping reveal and reinvestment.`
      );
      return;
    }
  }

  console.log(`Revealing winners for draw cycle ${targetCycleId}...`);
  await executeReveal({
    poolId,
    cycleId: targetCycleId,
    seedHex,
    rpcUrl: RPC_URL,
    signer: adminSigner,
  });

  if (reinvest) {
    console.log(`Reinvesting all winnings for draw cycle ${targetCycleId}...`);
    await executeReinvest({
      poolId,
      cycleId: targetCycleId,
      rpcUrl: RPC_URL,
      signer: adminSigner,
    });
  }

  console.log(
    `Draw workflow completed successfully for pool ${poolId}, cycle ${targetCycleId}!`
  );
}

if (require.main === module) {
  main().catch((err) => {
    printErrorDetails(err, "Unhandled error in localnet orchestrator");
    cleanupAndExit(1);
  });
}
