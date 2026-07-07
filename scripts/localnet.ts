import {
  createSolanaRpc,
  address,
  getProgramDerivedAddress,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  AccountRole,
  getBase58Encoder,
  getBase58Decoder,
  KeyPairSigner,
} from "@solana/kit";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Constants
const RPC_URL = "http://127.0.0.1:8899";
const PROGRAM_ID_STR = "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx";
const STATE_DIR = path.resolve(__dirname, "localnet-state");

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

function printUsage() {
  console.log("Usage: npm run localnet [command] [args]");
  console.log("Commands:");
  console.log(
    "  start                 Starts Surfpool (if not running), checks/initializes state, writes env, and starts Next.js (default)"
  );
  console.log("  init                  Runs state initialization sequence");
  console.log("  fund <wallet> <sol>   Funds a wallet with SOL");
  console.log(
    "  warp <seconds>        Time travels forward by relative seconds"
  );
  console.log(
    "  settle [--count <n>]  Updates mock Huma queue to enable the redemption of pending requests"
  );
}

async function checkRpcHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    clearTimeout(id);
    if (!res.ok) return false;
    const json = (await res.json()) as { result?: string };
    return json.result === "ok";
  } catch {
    clearTimeout(id);
    return false;
  }
}

// Helper functions for initialization
function generateRandomAddress(): string {
  const keyPair = crypto.generateKeyPairSync("ed25519");
  const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
  const publicKeyBytes = spki.subarray(12, 44);
  return getBase58Decoder().decode(publicKeyBytes);
}

function loadOrGenerateAddresses(): LocalnetAddresses {
  const filePath = path.resolve(STATE_DIR, "addresses.json");
  let addresses: Partial<LocalnetAddresses> = {};
  if (fs.existsSync(filePath)) {
    try {
      addresses = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      console.warn("Failed to parse addresses.json, generating new ones...");
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

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(addresses, null, 2), "utf-8");
  }

  return addresses as LocalnetAddresses;
}

async function loadOrGenerateAdminKey(): Promise<KeyPairSigner> {
  const adminKeyPath = path.resolve(__dirname, "admin-key.json");
  let secretKey: Uint8Array;

  if (fs.existsSync(adminKeyPath)) {
    const bytes = JSON.parse(fs.readFileSync(adminKeyPath, "utf-8"));
    secretKey = new Uint8Array(bytes);
  } else {
    console.log("Generating new admin keypair...");
    const keyPair = crypto.generateKeyPairSync("ed25519");

    const pkcs8 = keyPair.privateKey.export({ format: "der", type: "pkcs8" });
    const secretKeyBytes = pkcs8.subarray(16, 48);

    const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
    const publicKeyBytes = spki.subarray(12, 44);

    const derivedSecretKey = new Uint8Array(64);
    derivedSecretKey.set(secretKeyBytes);
    derivedSecretKey.set(publicKeyBytes, 32);

    fs.writeFileSync(
      adminKeyPath,
      JSON.stringify(Array.from(derivedSecretKey)),
      "utf-8"
    );
    secretKey = derivedSecretKey;
  }

  return await createKeyPairSignerFromBytes(secretKey);
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
      `RPC Error setting account ${addr}: ${JSON.stringify(json.error)}`
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
    await rpc.requestAirdrop(address(targetAddress), lamports).send();
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

async function deriveHumaPoolAuthority(humaPoolState: string): Promise<string> {
  const base58 = getBase58Encoder();
  const [humaPoolAuthority] = await getProgramDerivedAddress({
    programAddress: address("ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj"),
    seeds: [
      new TextEncoder().encode("pool_authority"),
      base58.encode(address(humaPoolState)),
    ],
  });
  return humaPoolAuthority;
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

function serializeInitializeGlobalData(maxTicketsPerBuy: number): Uint8Array {
  const data = new Uint8Array(8 + 4);
  const view = new DataView(data.buffer);

  const discriminator = [47, 225, 15, 112, 86, 51, 190, 231];
  for (let i = 0; i < 8; i++) {
    data[i] = discriminator[i];
  }
  view.setUint32(8, maxTicketsPerBuy, true);
  return data;
}

function serializeCreatePoolData(
  poolId: number,
  bondPrice: bigint,
  stakeCycleDurationHrs: bigint,
  feeBasisPoints: number
): Uint8Array {
  const data = new Uint8Array(8 + 4 + 8 + 8 + 2);
  const view = new DataView(data.buffer);

  const discriminator = [233, 146, 209, 142, 207, 104, 64, 188];
  for (let i = 0; i < 8; i++) {
    data[i] = discriminator[i];
  }
  view.setUint32(8, poolId, true);
  view.setBigUint64(12, bondPrice, true);
  view.setBigInt64(20, stakeCycleDurationHrs, true);
  view.setUint16(28, feeBasisPoints, true);
  return data;
}

async function sendTx(
  rpc: ReturnType<typeof createSolanaRpc>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instruction: any,
  payerSigner: KeyPairSigner
) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  let message = createTransactionMessage({ version: 0 });
  message = appendTransactionMessageInstruction(instruction, message);
  message = setTransactionMessageFeePayerSigner(payerSigner, message);
  message = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    message
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const wireTx = getBase64EncodedWireTransaction(signedTx);
  const signature = await rpc
    .sendTransaction(wireTx, { encoding: "base64" })
    .send();

  console.log(`Transaction sent: ${signature}. Waiting for confirmation...`);

  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const status = await rpc.getSignatureStatuses([signature]).send();
      if (status && status.value && status.value[0]) {
        const err = status.value[0].err;
        if (err) {
          throw new Error(`Transaction failed: ${JSON.stringify(err)}`);
        }
        console.log("Transaction confirmed successfully!");
        return signature;
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("Failed checking signature status:", errMsg);
    }
  }

  console.warn(
    "Transaction signature status check timed out, continuing anyway."
  );
  return signature;
}

async function injectProgram(programIdStr: string, soPath: string) {
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
  // 45-byte header: 03000000 (tag) + 0100000000000000 (slot 1) + 01 (option Some) + 32 bytes authority
  const headerHex = "03000000" + "0100000000000000" + "01" + "00".repeat(32);
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

function writeEnvLocal(addresses: LocalnetAddresses, adminAddress: string) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const envContent = `# Generated by localnet orchestrator
NEXT_PUBLIC_HUMA_CONFIG=ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj
NEXT_PUBLIC_HUMA_POOL_CONFIG=ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj
NEXT_PUBLIC_HUMA_POOL_STATE=${addresses.humaPoolState}
NEXT_PUBLIC_HUMA_MODE_CONFIG=ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj
NEXT_PUBLIC_HUMA_LENDER_STATE=${addresses.humaLenderState}
NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN=${addresses.humaPoolUnderlying}
NEXT_PUBLIC_HUMA_MODE_MINT=${addresses.pstMint}
NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN=${addresses.humaPoolModeToken}
NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST=${addresses.humaRedemptionRequest}
NEXT_PUBLIC_ADMIN_ADDRESS=${adminAddress}
NEXT_PUBLIC_TICKET_REGISTRY=${addresses.ticketRegistry}
NEXT_PUBLIC_FEE_WALLET=${addresses.feeWallet}
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
`;
  fs.writeFileSync(envPath, envContent, "utf-8");
  console.log("Successfully wrote .env.local configuration.");
}

async function handleInit() {
  console.log("Starting localnet state initialization...");

  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  // Check if RPC is running
  const isRpcsActive = await checkRpcHealth(RPC_URL);
  if (!isRpcsActive) {
    console.error(
      "Error: Solana RPC is not running. Please start the localnet orchestrator or your validator first."
    );
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);

  // 1. Load or generate admin key
  const adminSigner = await loadOrGenerateAdminKey();
  const adminAddress = adminSigner.address;
  console.log("Admin address:", adminAddress);

  // 2. Load or generate addresses
  const addresses = loadOrGenerateAddresses();
  console.log(
    "Injected/configured addresses:",
    JSON.stringify(addresses, null, 2)
  );

  // 3. Fund admin key
  await airdropSol(rpc, adminAddress, 100);

  // 4. Inject programs
  const deployDir = path.resolve(__dirname, "..", "anchor", "target", "deploy");
  const anchorSoPath = path.resolve(deployDir, "anchor.so");
  const mockHumaSoPath = path.resolve(deployDir, "mock_huma.so");

  await injectProgram(PROGRAM_ID_STR, anchorSoPath);
  await injectProgram(
    "ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj",
    mockHumaSoPath
  );

  // 5. Inject mock accounts
  console.log("Injecting USDC Mint account...");
  const usdcMintData = serializeMintAccount(adminAddress, 6);
  await setAccount(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    1_000_000_000,
    usdcMintData,
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    false
  );

  console.log("Injecting Huma Pool State account...");
  const humaPoolStateData = serializeHumaPoolState();
  await setAccount(
    addresses.humaPoolState,
    1_000_000_000,
    humaPoolStateData,
    "ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj",
    false
  );

  const humaPoolAuthority = await deriveHumaPoolAuthority(
    addresses.humaPoolState
  );
  console.log("Derived Huma Pool Authority:", humaPoolAuthority);

  console.log("Injecting PST Mint account...");
  const pstMintData = serializeMintAccount(humaPoolAuthority, 6);
  await setAccount(
    addresses.pstMint,
    1_000_000_000,
    pstMintData,
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    false
  );

  console.log("Injecting Ticket Registry account...");
  const ticketRegistryData = "00".repeat(131072);
  await setAccount(
    addresses.ticketRegistry,
    10_000_000_000,
    ticketRegistryData,
    PROGRAM_ID_STR,
    false
  );

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

  console.log("Injecting Admin Fee Wallet token account...");
  const feeWalletData = serializeTokenAccount(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    adminAddress,
    0n
  );
  await setAccount(
    addresses.feeWallet,
    1_000_000_000,
    feeWalletData,
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    false
  );

  // 6. Execute transactions on-chain
  const programAddress = address(PROGRAM_ID_STR);
  const encoder = new TextEncoder();
  const [globalConfigAddress] = await getProgramDerivedAddress({
    programAddress,
    seeds: [encoder.encode("global_config")],
  });

  let globalInitialized = false;
  try {
    const acc = await rpc.getAccountInfo(globalConfigAddress).send();
    if (acc && acc.value) {
      globalInitialized = true;
    }
  } catch {}

  if (!globalInitialized) {
    console.log("Initializing GlobalConfig on-chain...");
    const initGlobalData = serializeInitializeGlobalData(50_000_000);
    const instruction = {
      programAddress,
      accounts: [
        { address: globalConfigAddress, role: AccountRole.WRITABLE },
        { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER },
        { address: address(adminAddress), role: AccountRole.READONLY },
        {
          address: address("11111111111111111111111111111111"),
          role: AccountRole.READONLY,
        },
      ],
      data: initGlobalData,
    };
    await sendTx(rpc, instruction, adminSigner);
  } else {
    console.log("GlobalConfig is already initialized on-chain.");
  }

  // Check if PrizePool (pool_id: 1) exists
  const poolIdBytes = new Uint8Array(4);
  new DataView(poolIdBytes.buffer).setUint32(0, 1, true);

  const [poolAddress] = await getProgramDerivedAddress({
    programAddress,
    seeds: [encoder.encode("prize_pool"), poolIdBytes],
  });

  let poolInitialized = false;
  try {
    const acc = await rpc.getAccountInfo(poolAddress).send();
    if (acc && acc.value) {
      poolInitialized = true;
    }
  } catch {}

  if (!poolInitialized) {
    console.log("Creating Pool (pool_id: 1) on-chain...");
    const [poolVaultAddress] = await getProgramDerivedAddress({
      programAddress,
      seeds: [encoder.encode("pool_vault"), poolIdBytes],
    });
    const [poolPstVaultAddress] = await getProgramDerivedAddress({
      programAddress,
      seeds: [encoder.encode("pool_pst"), poolIdBytes],
    });

    const createPoolData = serializeCreatePoolData(
      1,
      1_000_000n, // bond_price = 1 USDC (decimals 6)
      24n, // stake_cycle_duration_hrs = 24
      100 // fee_basis_points = 100 (1%)
    );

    const instruction = {
      programAddress,
      accounts: [
        { address: globalConfigAddress, role: AccountRole.READONLY },
        { address: address(adminAddress), role: AccountRole.WRITABLE_SIGNER },
        { address: poolAddress, role: AccountRole.WRITABLE },
        {
          address: address(addresses.ticketRegistry),
          role: AccountRole.WRITABLE,
        },
        {
          address: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          role: AccountRole.READONLY,
        },
        { address: address(addresses.pstMint), role: AccountRole.READONLY },
        { address: poolVaultAddress, role: AccountRole.WRITABLE },
        { address: poolPstVaultAddress, role: AccountRole.WRITABLE },
        { address: address(addresses.feeWallet), role: AccountRole.READONLY },
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
      data: createPoolData,
    };
    await sendTx(rpc, instruction, adminSigner);
  } else {
    console.log("Pool (pool_id: 1) is already created on-chain.");
  }

  // 7. Write the environment file
  writeEnvLocal(addresses, adminAddress);

  console.log("Localnet initialization sequence completed successfully!");
}

async function deriveAssociatedTokenAddress(
  wallet: string,
  mint: string
): Promise<string> {
  const base58 = getBase58Encoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    seeds: [
      base58.encode(address(wallet)),
      base58.encode(address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
      base58.encode(address(mint)),
    ],
  });
  return ata;
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
  const usdcAta = await deriveAssociatedTokenAddress(walletStr, usdcMint);
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
  if (args.length < 1) {
    console.error(
      "Error: Missing arguments. Usage: npm run localnet warp <seconds>"
    );
    process.exit(1);
  }

  const seconds = parseFloat(args[0]);
  if (isNaN(seconds) || seconds <= 0) {
    console.error(
      `Error: Invalid warp amount '${args[0]}'. Must be a positive number of seconds.`
    );
    process.exit(1);
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
    const slot = await rpc.getSlot().send();
    const blockTimeResult = await rpc.getBlockTime(slot).send();
    if (blockTimeResult === null) {
      console.warn(
        "Warning: getBlockTime returned null. Falling back to host system clock."
      );
      currentBlockTime = Math.floor(Date.now() / 1000);
    } else {
      currentBlockTime = Number(blockTimeResult);
    }
  } catch {
    console.warn(
      "Warning: Failed to fetch current slot/blockTime. Falling back to host system clock."
    );
    currentBlockTime = Math.floor(Date.now() / 1000);
  }

  // 3. Time travel execution
  const targetSeconds = currentBlockTime + seconds;
  const targetMs = Math.floor(targetSeconds * 1000);

  console.log(`Warping localnet clock forward by ${seconds} seconds...`);

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
      error?: unknown;
    }
    const json = (await res.json()) as TimeTravelResponse;
    if (json.error) {
      throw new Error(
        `RPC Error traveling time: ${JSON.stringify(json.error)}`
      );
    }

    const result = json.result;
    if (!result) {
      throw new Error("RPC response missing result");
    }
    console.log(
      `Successfully warped to slot ${result.absoluteSlot} (time travelled to ${targetMs} ms).`
    );
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

async function handleStart() {
  // Ensure state directory exists
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  // 1. Check RPC health
  console.log("Checking Solana RPC health at", RPC_URL);
  const isRpcsActive = await checkRpcHealth(RPC_URL);

  if (!isRpcsActive) {
    console.log("Solana RPC is not running. Spawning Surfpool...");
    surfpoolProcess = spawn(
      "surfpool",
      [
        "start",
        "--legacy-anchor-compatibility",
        "--no-tui",
        "--offline",
        "--no-deploy",
        "--yes",
      ],
      { stdio: "inherit" }
    );

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

  // 2. Load admin key and addresses
  const adminSigner = await loadOrGenerateAdminKey();
  const addresses = loadOrGenerateAddresses();

  // 3. Derive GlobalConfig PDA and check if initialized
  const rpc = createSolanaRpc(RPC_URL);
  const programAddress = address(PROGRAM_ID_STR);
  const encoder = new TextEncoder();
  const [globalConfigAddress] = await getProgramDerivedAddress({
    programAddress,
    seeds: [encoder.encode("global_config")],
  });

  console.log("Deriving GlobalConfig PDA:", globalConfigAddress);

  let initialized = false;
  try {
    const accountInfo = await rpc.getAccountInfo(globalConfigAddress).send();
    if (accountInfo && accountInfo.value) {
      initialized = true;
    }
  } catch {
    console.log("GlobalConfig PDA not found on chain (yet).");
  }

  if (!initialized) {
    console.log("GlobalConfig PDA not found. Executing initialization...");
    await handleInit();
  } else {
    console.log("GlobalConfig PDA is already initialized on localnet.");
    writeEnvLocal(addresses, adminSigner.address);
  }

  // 4. Start Next.js dev server
  console.log("Spawning Next.js dev server...");
  nextProcess = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    shell: true,
    detached: true,
  });

  nextProcess.on("exit", (code) => {
    console.log(`Next.js process exited with code ${code}`);
    cleanupAndExit(code || 0);
  });
}

async function handleSettle(args: string[]) {
  let count = 1;
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

  // Set Huma pool state account
  await setAccount(
    addresses.humaPoolState,
    Number(poolStateInfo.value.lamports),
    rawData.toString("hex"),
    poolStateInfo.value.owner,
    poolStateInfo.value.executable
  );

  // Inject/update Huma Lender State with a large settled amount
  console.log(
    `Updating Huma Lender State account: ${addresses.humaLenderState}...`
  );
  const lenderStateData = new Uint8Array(16);
  const view = new DataView(lenderStateData.buffer);
  view.setBigUint64(8, 1_000_000_000_000n, true); // 1M USDC (6 decimals)
  const lenderStateHex = Buffer.from(lenderStateData).toString("hex");
  await setAccount(
    addresses.humaLenderState,
    1_000_000_000,
    lenderStateHex,
    "ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj",
    false
  );

  // Fund Huma pool underlying token account to support disburse transfers
  console.log("Funding Huma Pool Underlying token account with USDC...");
  const humaPoolAuthority = await deriveHumaPoolAuthority(
    addresses.humaPoolState
  );
  const humaPoolUnderlyingData = serializeTokenAccount(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    humaPoolAuthority,
    1_000_000_000_000n
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

async function main() {
  // Listen for signal handlers
  process.on("SIGINT", () => cleanupAndExit(0));
  process.on("SIGTERM", () => cleanupAndExit(0));

  const args = process.argv.slice(2);
  const command = args[0] || "start";

  switch (command) {
    case "start":
      await handleStart();
      break;
    case "init":
      await handleInit();
      break;
    case "fund":
      await handleFund(args.slice(1));
      break;
    case "warp":
      await handleWarp(args.slice(1));
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
  console.error("Unhandled error in orchestrator:", err);
  cleanupAndExit(1);
});
