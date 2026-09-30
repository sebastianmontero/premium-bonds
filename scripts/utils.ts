import {
  createSolanaRpc,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  KeyPairSigner,
  Instruction,
  AccountRole,
  Address,
  address,
  getBase58Encoder,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import {
  parseTransactionError,
  getExplorerUrl,
  truncateSignature,
  matchAnchorError,
} from "../app/lib/errors";
import {
  decodeAccountBase64Data,
  parseTokenAccountBalance,
  type DeficitSimulationReport,
  SOLVENCY_DUST_TOLERANCE_BASE_UNITS,
  DEFAULT_DEFICIT_USDC,
} from "../app/lib/bonds-sdk";
export {
  decodeAccountBase64Data,
  parseTokenAccountBalance,
  type DeficitSimulationReport,
  SOLVENCY_DUST_TOLERANCE_BASE_UNITS,
  DEFAULT_DEFICIT_USDC,
};
import { normalizeInstructionSigners } from "../app/lib/tx-utils";
export { normalizeInstructionSigners };
import { readEnvFile } from "./env-utils";
import {
  LOCAL_ENV_PATH,
  DEVNET_ENV_PATH,
  DEFAULT_ENV_PATH,
  isLocalMockUrl,
} from "./devnet-state";
export {
  parseEnvLine,
  readEnvFile,
  upsertEnvFile,
  type UpsertEnvOptions,
  type ParsedEnvLine,
} from "./env-utils";

export {
  isRetryableRpcError,
  isRateLimitRpcError,
  getErrorChain,
  getRetryAfterMs,
  calculateBackoffDelay,
  ACCOUNT_QUERY_METHODS,
  normalizeRpcPayload,
  createResilientRpc,
  type BackoffConfig,
  type ResilientRpcConfig,
  type ResilientRpcClient,
} from "../app/lib/rpc-transport";

/**
 * Standardized wrapper over rpc.getAccountInfo with base64 encoding and abortSignal support.
 */
export async function fetchAccountInfo(
  rpc: ReturnType<typeof createSolanaRpc>,
  accountAddress: Address | string,
  config?: Parameters<ReturnType<typeof createSolanaRpc>["getAccountInfo"]>[1],
  sendOptions?: Parameters<
    ReturnType<ReturnType<typeof createSolanaRpc>["getAccountInfo"]>["send"]
  >[0]
) {
  return await rpc
    .getAccountInfo(address(accountAddress), {
      encoding: "base64",
      ...config,
    })
    .send(sendOptions);
}

/**
 * Standardized helper to fetch and base64-decode binary account data.
 */
export async function fetchAccountData(
  rpc: ReturnType<typeof createSolanaRpc>,
  accountAddress: Address | string,
  config?: Parameters<ReturnType<typeof createSolanaRpc>["getAccountInfo"]>[1],
  sendOptions?: Parameters<
    ReturnType<ReturnType<typeof createSolanaRpc>["getAccountInfo"]>["send"]
  >[0]
): Promise<Uint8Array | null> {
  const res = await fetchAccountInfo(rpc, accountAddress, config, sendOptions);
  return decodeAccountBase64Data(res?.value);
}

export interface ResolveDevnetRpcOptions {
  devnetEnvPath?: string;
  localEnvPath?: string;
  defaultEnvPath?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolves the Devnet RPC URL respecting CLI env vars, .env.devnet, .env.local, and canonical fallback.
 */
export function resolveDevnetRpcUrl(options?: ResolveDevnetRpcOptions): string {
  const processEnv = options?.env ?? process.env;
  if (processEnv.SOLANA_RPC_URL && !isLocalMockUrl(processEnv.SOLANA_RPC_URL)) {
    return processEnv.SOLANA_RPC_URL;
  }
  if (processEnv.DEVNET_RPC_URL && !isLocalMockUrl(processEnv.DEVNET_RPC_URL)) {
    return processEnv.DEVNET_RPC_URL;
  }

  // 1. Check dedicated .env.devnet profile (Priority source of truth)
  const devnetPath = options?.devnetEnvPath ?? DEVNET_ENV_PATH;
  if (fs.existsSync(devnetPath)) {
    const devnetEnv = readEnvFile(devnetPath);
    if (devnetEnv.SOLANA_RPC_URL && !isLocalMockUrl(devnetEnv.SOLANA_RPC_URL)) {
      return devnetEnv.SOLANA_RPC_URL;
    }
    if (devnetEnv.DEVNET_RPC_URL && !isLocalMockUrl(devnetEnv.DEVNET_RPC_URL)) {
      return devnetEnv.DEVNET_RPC_URL;
    }
    if (
      devnetEnv.NEXT_PUBLIC_SOLANA_RPC_URL &&
      !isLocalMockUrl(devnetEnv.NEXT_PUBLIC_SOLANA_RPC_URL)
    ) {
      return devnetEnv.NEXT_PUBLIC_SOLANA_RPC_URL;
    }
  }

  // 2. Check active .env.local (ONLY if actively running in devnet mode)
  const localPath = options?.localEnvPath ?? LOCAL_ENV_PATH;
  if (fs.existsSync(localPath)) {
    const localEnv = readEnvFile(localPath);
    if (localEnv.DEVNET_RPC_URL && !isLocalMockUrl(localEnv.DEVNET_RPC_URL)) {
      return localEnv.DEVNET_RPC_URL;
    }
    if (localEnv.NEXT_PUBLIC_ENVIRONMENT === "devnet") {
      if (localEnv.SOLANA_RPC_URL && !isLocalMockUrl(localEnv.SOLANA_RPC_URL)) {
        return localEnv.SOLANA_RPC_URL;
      }
      if (
        localEnv.NEXT_PUBLIC_SOLANA_RPC_URL &&
        !isLocalMockUrl(localEnv.NEXT_PUBLIC_SOLANA_RPC_URL)
      ) {
        return localEnv.NEXT_PUBLIC_SOLANA_RPC_URL;
      }
    }
  }

  // 3. Check generic .env fallback
  const defaultPath = options?.defaultEnvPath ?? DEFAULT_ENV_PATH;
  if (fs.existsSync(defaultPath)) {
    const env = readEnvFile(defaultPath);
    if (env.DEVNET_RPC_URL && !isLocalMockUrl(env.DEVNET_RPC_URL)) {
      return env.DEVNET_RPC_URL;
    }
    if (env.NEXT_PUBLIC_ENVIRONMENT === "devnet") {
      if (env.SOLANA_RPC_URL && !isLocalMockUrl(env.SOLANA_RPC_URL)) {
        return env.SOLANA_RPC_URL;
      }
      if (
        env.NEXT_PUBLIC_SOLANA_RPC_URL &&
        !isLocalMockUrl(env.NEXT_PUBLIC_SOLANA_RPC_URL)
      ) {
        return env.NEXT_PUBLIC_SOLANA_RPC_URL;
      }
    }
  }

  return "https://api.devnet.solana.com";
}

/**
 * Checks if the RPC node at the given URL is healthy, with configurable timeout and retry support.
 */
export async function checkRpcHealth(
  url: string,
  timeoutMs = 5000,
  maxRetries = 2
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: controller.signal,
      });
      clearTimeout(id);
      if (res.ok) return true;
    } catch {
      clearTimeout(id);
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  return false;
}

/**
 * Helper to calculate minimum rent exempt balance for a given byte size.
 */
export async function getRentExemption(
  rpc: ReturnType<typeof createSolanaRpc>,
  space: number | bigint
): Promise<bigint> {
  return await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
}

/**
 * Validates whether an account is rent-exempt for its size.
 */
export async function assertRentExempt(
  rpc: ReturnType<typeof createSolanaRpc>,
  accountBalance: bigint,
  space: number | bigint
): Promise<boolean> {
  const minBalance = await getRentExemption(rpc, space);
  if (accountBalance < minBalance) {
    throw new Error(
      `Account balance (${accountBalance}) is below the required rent exemption threshold (${minBalance}) for size ${space} bytes.`
    );
  }
  return true;
}

/**
 * Calculates lamport shortfall to reach rent-exemption.
 */
export async function getRentShortfall(
  rpc: ReturnType<typeof createSolanaRpc>,
  accountBalance: bigint,
  space: number | bigint
): Promise<bigint> {
  const minBalance = await getRentExemption(rpc, space);
  if (accountBalance >= minBalance) {
    return 0n;
  }
  return minBalance - accountBalance;
}

/**
 * Returns formatted diagnostic message for rent status.
 */
export async function getRentStatusSummary(
  rpc: ReturnType<typeof createSolanaRpc>,
  accountBalance: bigint,
  space: number | bigint
): Promise<string> {
  const minBalance = await getRentExemption(rpc, space);
  const isExempt = accountBalance >= minBalance;
  return (
    `Rent-Exempt: ${isExempt ? "YES" : "NO"} ` +
    `(Current: ${accountBalance} lamports, Required: ${minBalance} lamports for ${space} bytes)`
  );
}

/**
 * Checks if rent check should be skipped based on environment settings.
 */
export function shouldSkipRentCheck(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.SKIP_RENT_CHECK === "true" ||
    env.SKIP_RENT_CHECK === "1" ||
    env.NODE_ENV === "test"
  );
}

/**
 * High-level wrapper that logs rent-exemption diagnostics and enforces minimum balance unless explicitly skipped.
 */
export async function verifyAndEnforceRentExemption(
  rpc: ReturnType<typeof createSolanaRpc>,
  accountAddress: string,
  accountBalance: bigint,
  space: number | bigint,
  accountLabel = "Account"
): Promise<void> {
  const summary = await getRentStatusSummary(rpc, accountBalance, space);
  console.log(`[Rent Check] ${accountLabel} (${accountAddress}): ${summary}`);

  if (shouldSkipRentCheck()) {
    console.log(
      `[Rent Check] Skipping strict enforcement for ${accountLabel} due to SKIP_RENT_CHECK setting.`
    );
    return;
  }

  await assertRentExempt(rpc, accountBalance, space);
}

/**
 * Domain constants for devnet funding and SOL gas limits.
 */
export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const DEFAULT_TARGET_SOL_LAMPORTS = 1_000_000_000n; // 1.0 SOL
export const MIN_ADMIN_RESERVE_LAMPORTS = 50_000_000n; // 0.05 SOL donor safety reserve
export const MIN_TRANSFER_THRESHOLD_LAMPORTS = 10_000_000n; // 0.01 SOL minimum transfer threshold
export const DEVNET_FAUCET_URLS = [
  "https://faucet.solana.com",
  "https://faucet.quicknode.com/solana/devnet",
  "https://faucet.helius.dev",
] as const;
export const MIN_ADMIN_FEE_PAYER_LAMPORTS = 5_000_000n; // 0.005 SOL
export const RECIPIENT_AIRDROP_THRESHOLD_LAMPORTS = 100_000_000n; // 0.1 SOL

export const SWITCHBOARD_ON_DEMAND_DEVNET_PID =
  "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2" as const;
export const SWITCHBOARD_ON_DEMAND_MAINNET_PID =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv" as const;
export const SWITCHBOARD_RANDOMNESS_DISCRIMINATOR = [
  10, 66, 229, 135, 220, 239, 217, 114,
] as const;

export function resolveSwitchboardProgramId(): string {
  const isMainnet =
    process.env.SB_ENV === "mainnet" ||
    process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
  return isMainnet
    ? SWITCHBOARD_ON_DEMAND_MAINNET_PID
    : SWITCHBOARD_ON_DEMAND_DEVNET_PID;
}

export class InsufficientFundsError extends Error {
  constructor(
    public readonly address: Address | string,
    public readonly balanceLamports: bigint,
    public readonly requiredLamports: bigint,
    message: string
  ) {
    super(message);
    this.name = "InsufficientFundsError";
  }
}

/**
 * Expands UNIX home directory tilde (~) prefix to os.homedir().
 */
export function expandHomeDir(
  filePath: string,
  baseHome: string = os.homedir()
): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(baseHome, filePath.slice(filePath === "~" ? 1 : 2));
  }
  return path.resolve(filePath);
}

export interface ResolveKeypairOptions {
  customPath?: string;
  rpcUrl?: string;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  fsExists?: (filePath: string) => boolean;
}

/**
 * Resolves the fee payer keypair path with standard fallback hierarchy:
 * 1. Explicit argument / customPath
 * 2. Environment variables: KEYPAIR_PATH, ANCHOR_WALLET, SOLANA_KEYPAIR_PATH
 * 3. Local clusters: scripts/admin-key.json (if exists)
 * 4. Remote clusters: SOLANA_CONFIG_DIR / cli/config.yml (keypair_path)
 * 5. Canonical fallback: ~/.config/solana/id.json
 */
export function resolveDefaultKeypairPath(
  customPathOrOptions?: string | ResolveKeypairOptions,
  maybeOptions?: ResolveKeypairOptions
): string {
  const options =
    typeof customPathOrOptions === "object"
      ? customPathOrOptions
      : maybeOptions;
  const customPath =
    typeof customPathOrOptions === "string"
      ? customPathOrOptions
      : options?.customPath;

  const env = options?.env ?? process.env;
  const baseHome = options?.homedir ?? os.homedir();
  const exists = options?.fsExists ?? fs.existsSync;

  // 1. Explicit argument / flag
  if (customPath && customPath.trim().length > 0) {
    return expandHomeDir(customPath.trim(), baseHome);
  }

  // 2. Standard Environment Variables
  for (const envVar of [
    env.KEYPAIR_PATH,
    env.ANCHOR_WALLET,
    env.SOLANA_KEYPAIR_PATH,
  ]) {
    if (envVar && envVar.trim().length > 0) {
      return expandHomeDir(envVar.trim(), baseHome);
    }
  }

  const isLocal = isLocalMockUrl(options?.rpcUrl);
  const localAdminKey = path.resolve(__dirname, "admin-key.json");

  // 3. Local clusters prioritize the pre-funded repo admin key
  if (isLocal && exists(localAdminKey)) {
    return localAdminKey;
  }

  // 4. Remote clusters: Check SOLANA_CONFIG_DIR or ~/.config/solana/cli/config.yml
  const solanaConfigDir = env.SOLANA_CONFIG_DIR
    ? expandHomeDir(env.SOLANA_CONFIG_DIR, baseHome)
    : path.resolve(baseHome, ".config", "solana");
  const cliConfigFile = path.resolve(solanaConfigDir, "cli", "config.yml");

  if (exists(cliConfigFile)) {
    try {
      const content = fs.readFileSync(cliConfigFile, "utf-8");
      const match = content.match(/keypair_path:\s*["']?([^"'\r\n]+)["']?/);
      if (match && match[1]) {
        return expandHomeDir(match[1].trim(), baseHome);
      }
    } catch {
      // Fall through to default id.json
    }
  }

  // 5. Canonical Solana CLI default (NEVER fall back to admin-key.json on remote clusters)
  return path.resolve(solanaConfigDir, "id.json");
}

export interface SignerBalanceCheckOptions {
  minLamports?: bigint;
  recommendedLamports?: bigint;
  rpcUrl?: string;
  keypairPath?: string;
  warnOnly?: boolean;
}

export async function assertSignerBalance(
  rpc: ReturnType<typeof createSolanaRpc>,
  signerAddress: Address | string,
  options?: SignerBalanceCheckOptions
): Promise<bigint> {
  const minLamports = options?.minLamports ?? 5_000n;
  const recommendedLamports =
    options?.recommendedLamports ?? MIN_ADMIN_FEE_PAYER_LAMPORTS;
  const balRes = await rpc.getBalance(address(signerAddress)).send();
  const lamports = balRes.value;

  if (lamports < minLamports) {
    const isDevnet = options?.rpcUrl?.includes("devnet");
    const airdropHint = isDevnet
      ? `\nTo fund this account on devnet, run:\n  solana airdrop 1 ${signerAddress} --url devnet`
      : "";
    const keypairHint = options?.keypairPath
      ? `\nConfigured keypair path: ${options.keypairPath}`
      : "";
    const msg =
      `Signer account ${signerAddress} has insufficient SOL (${lamports} lamports, minimum required: ${minLamports} lamports).` +
      keypairHint +
      `\nPlease specify a funded keypair via '--keypair <path>' or fund the account.${airdropHint}`;

    if (options?.warnOnly) {
      console.warn(`⚠️ Warning: ${msg}`);
      return lamports;
    }

    throw new InsufficientFundsError(signerAddress, lamports, minLamports, msg);
  }

  if (lamports < recommendedLamports) {
    console.warn(
      `⚠️ Warning: Signer ${signerAddress} has a low SOL balance (${(Number(lamports) / 1e9).toFixed(6)} SOL). Transactions requiring ATA creation or rent deposits may fail.`
    );
  }
  return lamports;
}

/**
 * Safely parses a human-readable decimal string into base token units (BigInt)
 * without floating-point precision loss.
 */
export function parseTokenAmount(
  amountStr: string,
  decimals: number = USDC_DECIMALS
): bigint {
  const trimmed = amountStr.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(
      `Invalid numeric amount: "${amountStr}". Expected a positive decimal number.`
    );
  }

  const [wholeStr, fracStr = ""] = trimmed.split(".");
  if (fracStr.length > decimals) {
    throw new Error(
      `Amount "${amountStr}" exceeds maximum precision of ${decimals} decimal places.`
    );
  }

  const paddedFrac = fracStr.padEnd(decimals, "0");
  const units = BigInt(wholeStr) * 10n ** BigInt(decimals) + BigInt(paddedFrac);
  if (units <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return units;
}

/**
 * Loads an existing keypair from the specified JSON file path.
 * Raises a clear error if the file is missing or invalid.
 */
export async function loadKeypair(filePath: string): Promise<KeyPairSigner> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Keypair file not found at: ${filePath}. Please ensure your authority keypair is generated and placed there.`
    );
  }
  const content = fs.readFileSync(filePath, "utf-8");
  try {
    const bytes = JSON.parse(content);
    return await createKeyPairSignerFromBytes(new Uint8Array(bytes));
  } catch (err) {
    throw new Error(
      `Failed to parse keypair file at: ${filePath}. Ensure it is a valid JSON byte array.`,
      { cause: err }
    );
  }
}

/**
 * Generates a valid 64-byte Ed25519 Solana keypair (secret key + public key).
 */
export function generateKeypairBytes(): Uint8Array {
  const keyPair = crypto.generateKeyPairSync("ed25519");

  const pkcs8 = keyPair.privateKey.export({ format: "der", type: "pkcs8" });
  const secretKeyBytes = pkcs8.subarray(16, 48);

  const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
  const publicKeyBytes = spki.subarray(12, 44);

  const keypairBytes = new Uint8Array(64);
  keypairBytes.set(secretKeyBytes);
  keypairBytes.set(publicKeyBytes, 32);

  return keypairBytes;
}

/**
 * Saves a 64-byte Ed25519 keypair to a JSON file securely (0o600 permissions).
 */
export function saveKeypairBytes(filePath: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(bytes)), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Generates a fresh valid Ed25519 keypair and writes it to disk.
 */
export async function generateAndSaveKeypair(
  filePath: string
): Promise<KeyPairSigner> {
  const bytes = generateKeypairBytes();
  saveKeypairBytes(filePath, bytes);
  return await loadKeypair(filePath);
}

export interface LoadOrGenerateKeypairOptions {
  overwriteIfInvalid?: boolean;
  label?: string;
}

/**
 * Loads an existing keypair from the specified JSON file path, or generates
 * a new valid Ed25519 keypair and writes it to disk if it does not exist
 * or if overwriteIfInvalid is true and the existing file is invalid.
 */
export async function loadOrGenerateKeypair(
  filePath: string,
  optionsOrLabel?: string | LoadOrGenerateKeypairOptions
): Promise<KeyPairSigner> {
  const options: LoadOrGenerateKeypairOptions =
    typeof optionsOrLabel === "string"
      ? { label: optionsOrLabel }
      : (optionsOrLabel ?? {});

  if (fs.existsSync(filePath)) {
    try {
      return await loadKeypair(filePath);
    } catch (err) {
      if (!options.overwriteIfInvalid) {
        throw err;
      }
      console.warn(
        `⚠️ Invalid keypair at ${filePath}${options.label ? ` (${options.label})` : ""}. Regenerating fresh valid keypair...`
      );
    }
  } else if (options.label) {
    console.log(`Generating new ${options.label} keypair at ${filePath}...`);
  }

  return await generateAndSaveKeypair(filePath);
}

/**
 * Safely stringifies objects containing BigInt values or circular references without throwing a TypeError.
 */
export function safeStringify(obj: unknown, space?: string | number): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      obj,
      (_key, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular]";
          }
          seen.add(value);
        }
        return value;
      },
      space
    );
  } catch {
    return String(obj);
  }
}

/**
 * Sends a transaction and polls for its confirmation status.
 */
export async function sendTx(
  rpc: ReturnType<typeof createSolanaRpc>,
  instruction: Instruction | readonly Instruction[],
  signers:
    | KeyPairSigner
    | [KeyPairSigner, ...KeyPairSigner[]]
    | readonly KeyPairSigner[]
): Promise<string> {
  const signerList = Array.isArray(signers) ? signers : [signers];
  if (signerList.length === 0) {
    throw new Error("sendTx requires at least one signer (fee payer).");
  }
  const payerSigner = signerList[0];
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const rawInstructions: Instruction[] = Array.isArray(instruction)
    ? [...instruction]
    : [instruction];
  const instructions = normalizeInstructionSigners(rawInstructions, signerList);

  let message = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayerSigner(payerSigner, message);
  message = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    message
  );
  message = appendTransactionMessageInstructions(instructions, message);

  const signedTx = await signTransactionMessageWithSigners(message);
  const wireTx = getBase64EncodedWireTransaction(signedTx);
  let signature: string;

  try {
    signature = await rpc
      .sendTransaction(wireTx, { encoding: "base64" })
      .send();
  } catch (err) {
    // Attach error context if available
    const txErr = err instanceof Error ? err : new Error(String(err));
    throw txErr;
  }

  console.log(`Transaction sent: ${signature}. Waiting for confirmation...`);

  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const status = await rpc.getSignatureStatuses([signature]).send();
      if (status && status.value && status.value[0]) {
        const err = status.value[0].err;
        if (err) {
          const errDetails = safeStringify(err);
          const matched = matchAnchorError(errDetails);
          const msg = matched
            ? `Transaction failed: AnchorError ${matched.code} (${matched.info.name}): ${matched.info.message}`
            : `Transaction failed: ${errDetails}`;
          const txError = new Error(msg);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (txError as any).signature = signature;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (txError as any).rawError = err;
          throw txError;
        }
        console.log("Transaction confirmed successfully!");
        return signature;
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Transaction failed:")) {
        throw e;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("Failed checking signature status:", errMsg);
    }
  }

  const timeoutError = new Error(
    `Transaction confirmation timed out after 15 attempts. Signature: ${signature}`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (timeoutError as any).signature = signature;
  throw timeoutError;
}

/**
 * Extract all logs array from error or simulation response across @solana/kit and cause chains.
 */
export function extractAllLogs(err: unknown): string[] {
  if (!err || typeof err !== "object") return [];
  const logs: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj.logs)) logs.push(...obj.logs);
    if (Array.isArray(obj.context?.logs)) logs.push(...obj.context.logs);
    if (Array.isArray(obj.context?.data?.logs))
      logs.push(...obj.context.data.logs);
    if (Array.isArray(obj.simulationResponse?.logs))
      logs.push(...obj.simulationResponse.logs);
    if (obj.cause) collect(obj.cause);
  };

  collect(err);
  return Array.from(new Set(logs));
}

/**
 * Filters node internal and node_modules lines out of stack traces.
 */
export function formatStackTrace(stack?: string): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .filter(
      (line) =>
        !line.includes("node:internal") &&
        !line.includes("node_modules") &&
        !line.includes("ts-node/src")
    )
    .join("\n")
    .trim();
}

/**
 * Formats a rich, structured error detail string for CLI output.
 */
export function formatErrorDetails(
  err: unknown,
  contextTitle?: string
): string {
  const parsed = parseTransactionError(err);
  const logs = extractAllLogs(err);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errObj = err as any;
  const rawMessage =
    errObj?.message || errObj?.cause?.message || String(err || "Unknown error");
  const signature = errObj?.signature || parsed.rawError?.signature;

  const lines: string[] = [];
  const divider = "=".repeat(80);
  const subDivider = "-".repeat(80);

  lines.push("");
  lines.push(divider);
  lines.push(`❌ ${contextTitle ? `[${contextTitle}] ` : ""}${parsed.title}`);
  lines.push(subDivider);

  lines.push(`Category:   ${parsed.layer} / ${parsed.category}`);
  if (parsed.code !== undefined) {
    lines.push(`Error Code: ${parsed.code}`);
  }
  if (parsed.actionableStep) {
    lines.push(`Actionable: ${parsed.actionableStep}`);
  }

  if (signature) {
    const truncated = truncateSignature(signature);
    const explorerUrl = getExplorerUrl(signature, "localnet");
    lines.push(`Signature:  ${truncated} (${signature})`);
    lines.push(`Explorer:   ${explorerUrl}`);
  }

  lines.push("");
  lines.push("Message:");
  lines.push(`  ${rawMessage}`);

  if (logs.length > 0) {
    lines.push("");
    lines.push("Transaction Logs:");
    for (const log of logs) {
      lines.push(`  > ${log}`);
    }
  }

  // Extract causes recursively
  const causes: string[] = [];
  let currentCause = errObj?.cause;
  let depth = 1;
  while (currentCause && depth <= 5) {
    const msg = currentCause.message || String(currentCause);
    causes.push(`  [${depth}] ${msg}`);
    currentCause = currentCause.cause;
    depth++;
  }

  if (causes.length > 0) {
    lines.push("");
    lines.push("Cause Chain:");
    lines.push(...causes);
  }

  if (errObj?.stack) {
    const formattedStack = formatStackTrace(errObj.stack);
    if (formattedStack) {
      lines.push("");
      lines.push("Stack Trace:");
      lines.push(
        formattedStack
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
      );
    }
  }

  lines.push(divider);
  lines.push("");

  return lines.join("\n");
}

/**
 * Outputs structured error details to console.error.
 */
export function printErrorDetails(err: unknown, contextTitle?: string): void {
  console.error(formatErrorDetails(err, contextTitle));
}

// ─── Native SPL Token Helpers ──────────────────────────────────────────────────

export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ATA_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export interface BuildCreateAccountParams {
  readonly payer: KeyPairSigner;
  readonly newAccount: KeyPairSigner;
  readonly lamports: bigint;
  readonly space: bigint;
  readonly ownerProgramId: Address;
}

/**
 * Builds native SystemProgram CreateAccount instruction (Opcode 0).
 */
export function buildCreateAccountInstruction(
  params: BuildCreateAccountParams
): Instruction {
  const data = new Uint8Array(4 + 8 + 8 + 32);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, true); // SystemProgram::CreateAccount opcode (0)
  view.setBigUint64(4, params.lamports, true);
  view.setBigUint64(12, params.space, true);
  data.set(getBase58Encoder().encode(params.ownerProgramId), 20);

  return {
    programAddress: SYSTEM_PROGRAM_ID,
    accounts: [
      {
        address: params.payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: params.payer,
      },
      {
        address: params.newAccount.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: params.newAccount,
      },
    ],
    data,
  };
}

export interface CreateMintOptions {
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly payer: KeyPairSigner;
  readonly mint: KeyPairSigner;
  readonly decimals: number;
  readonly mintAuthority: Address;
  readonly freezeAuthority?: Address;
}

/**
 * Builds native SystemProgram.createAccount and TokenProgram.InitializeMint2 instructions.
 */
export async function buildCreateMintInstructions(
  params: CreateMintOptions
): Promise<Instruction[]> {
  const space = 82n;
  const rentExempt = await params.rpc
    .getMinimumBalanceForRentExemption(space)
    .send();

  // 1. SystemProgram::CreateAccount (Opcode 0)
  const createAccountIx = buildCreateAccountInstruction({
    payer: params.payer,
    newAccount: params.mint,
    lamports: rentExempt,
    space,
    ownerProgramId: TOKEN_PROGRAM_ID,
  });

  // 2. TokenProgram::InitializeMint2 (Opcode 20)
  const initMintData = new Uint8Array(1 + 1 + 32 + 1 + 32);
  initMintData[0] = 20; // InitializeMint2
  initMintData[1] = params.decimals;
  initMintData.set(getBase58Encoder().encode(params.mintAuthority), 2);
  if (params.freezeAuthority) {
    initMintData[34] = 1;
    initMintData.set(getBase58Encoder().encode(params.freezeAuthority), 35);
  } else {
    initMintData[34] = 0;
  }

  const initMintIx: Instruction = {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [{ address: params.mint.address, role: AccountRole.WRITABLE }],
    data: params.freezeAuthority ? initMintData : initMintData.subarray(0, 35),
  };

  return [createAccountIx, initMintIx];
}

export interface EnsureTokenMintParams {
  readonly payer: KeyPairSigner;
  readonly mint: KeyPairSigner;
  readonly decimals: number;
  readonly mintAuthority: Address;
  readonly freezeAuthority?: Address;
  readonly label?: string;
}

/**
 * Checks if a token mint exists on-chain and creates it atomically if missing.
 */
export async function ensureTokenMintOnChain(
  rpc: ReturnType<typeof createSolanaRpc>,
  params: EnsureTokenMintParams
): Promise<void> {
  const accountInfo = await fetchAccountInfo(rpc, params.mint.address);
  if (accountInfo?.value) {
    console.log(
      `${params.label || "Token mint"} ${params.mint.address} already exists on-chain.`
    );
    return;
  }
  console.log(
    `Creating ${params.label || "token mint"} ${params.mint.address} on-chain...`
  );
  try {
    const ixs = await buildCreateMintInstructions({
      rpc,
      payer: params.payer,
      mint: params.mint,
      decimals: params.decimals,
      mintAuthority: params.mintAuthority,
      freezeAuthority: params.freezeAuthority,
    });
    await sendTx(rpc, ixs, [params.payer, params.mint]);
    console.log(
      `${params.label || "Token mint"} ${params.mint.address} created successfully on-chain!`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to create token mint ${params.mint.address}: ${msg}`,
      { cause: err }
    );
  }
}

export interface MintToParams {
  readonly mint: Address;
  readonly destination: Address;
  readonly authority: KeyPairSigner;
  readonly amount: bigint;
}

/**
 * Builds native SPL Token Program MintTo instruction (Opcode 7).
 */
export function buildMintToInstruction(params: MintToParams): Instruction {
  const data = new Uint8Array(1 + 8);
  data[0] = 7; // MintTo opcode
  const view = new DataView(data.buffer);
  view.setBigUint64(1, params.amount, true);

  return {
    programAddress: TOKEN_PROGRAM_ID,
    accounts: [
      { address: params.mint, role: AccountRole.WRITABLE },
      { address: params.destination, role: AccountRole.WRITABLE },
      {
        address: params.authority.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: params.authority,
      },
    ],
    data,
  };
}

export interface TransferSolParams {
  readonly from: KeyPairSigner;
  readonly to: Address;
  readonly lamports: bigint;
}

/**
 * Builds native SystemProgram Transfer instruction (Opcode 2).
 * Validates that transfer amount is strictly positive to prevent binary wrapping.
 */
export function buildTransferSolInstruction(
  params: TransferSolParams
): Instruction {
  if (params.lamports <= 0n) {
    throw new Error(
      `Transfer lamports must be greater than zero. Received: ${params.lamports}`
    );
  }

  const data = new Uint8Array(4 + 8);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // SystemProgram::Transfer opcode (2)
  view.setBigUint64(4, params.lamports, true);

  return {
    programAddress: SYSTEM_PROGRAM_ID,
    accounts: [
      {
        address: params.from.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: params.from,
      },
      {
        address: params.to,
        role: AccountRole.WRITABLE,
      },
    ],
    data,
  };
}

export interface DeficitCliOptions {
  readonly deficitMicroUsdc: bigint;
  readonly poolId: number;
  readonly keypairPath?: string;
}

/**
 * Parses CLI arguments for simulated deficit commands.
 * Defaults to 1.0 USDC on Pool 1 when arguments are omitted.
 */
export function parseDeficitArgs(args: readonly string[]): DeficitCliOptions {
  let amountStr: string | undefined;
  let poolId = 1;
  let keypairPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle equals-separated flags (e.g., --pool=1, -k=/path/to/key.json)
    let flag = arg;
    let val: string | undefined = undefined;
    const eqIdx = arg.indexOf("=");
    if (arg.startsWith("-") && eqIdx !== -1) {
      flag = arg.slice(0, eqIdx);
      val = arg.slice(eqIdx + 1);
    }

    if (flag === "--pool" || flag === "--pool-id" || flag === "-i") {
      if (val === undefined) {
        val = args[++i];
      }
      if (!val || (val.startsWith("-") && isNaN(Number(val)))) {
        throw new Error(`Missing value for '${flag}' flag.`);
      }
      if (!/^\d+$/.test(val)) {
        throw new Error(
          `Invalid pool ID '${val}'. Must be a positive integer.`
        );
      }
      const parsedPool = parseInt(val, 10);
      if (isNaN(parsedPool) || parsedPool <= 0) {
        throw new Error(
          `Invalid pool ID '${val}'. Must be a positive integer.`
        );
      }
      poolId = parsedPool;
    } else if (flag === "--keypair" || flag === "-k") {
      if (val === undefined) {
        val = args[++i];
      }
      if (!val || val.startsWith("-")) {
        throw new Error(`Missing value for '${flag}' flag.`);
      }
      keypairPath = val;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument '${arg}'.`);
    } else {
      // Positional argument: either keypair path (.json) or amount
      if (arg.endsWith(".json")) {
        if (keypairPath !== undefined) {
          throw new Error(`Unexpected duplicate keypair argument '${arg}'.`);
        }
        keypairPath = arg;
      } else {
        if (amountStr !== undefined) {
          throw new Error(`Unexpected argument '${arg}'.`);
        }
        amountStr = arg;
      }
    }
  }

  const deficitMicroUsdc =
    amountStr !== undefined
      ? parseTokenAmount(amountStr, USDC_DECIMALS)
      : parseTokenAmount(DEFAULT_DEFICIT_USDC.toString(), USDC_DECIMALS);

  return {
    deficitMicroUsdc,
    poolId,
    keypairPath,
  };
}

/**
 * Prints formatted deficit simulation calculation breakdown to console.
 */
export function printDeficitCalculationBreakdown(
  report: DeficitSimulationReport
): void {
  if (report.isBelowDustTolerance) {
    console.warn(
      `\n⚠️  Advisory Warning: Specified deficit (${Number(report.deficitMicroUsdc) / 1_000_000} USDC / ${report.deficitMicroUsdc} micro-units) is <= SOLVENCY_DUST_TOLERANCE (${SOLVENCY_DUST_TOLERANCE_BASE_UNITS} base units / 0.001 USDC).\n` +
        `   The on-chain solvency circuit breaker only trips when deficit > 1,000 base units.\n`
    );
  }

  console.log("\n📉 Deficit Simulation Calculation Details:");
  console.log(`- Pool ID: ${report.poolId}`);
  console.log(
    `- Total Deposited Principal: ${Number(report.totalDepositedPrincipal) / 1_000_000} USDC`
  );
  console.log(
    `- Total Fees Accrued: ${Number(report.totalFeesAccrued) / 1_000_000} USDC`
  );
  console.log(
    `- Total Fees Withdrawn: ${Number(report.totalFeesWithdrawn) / 1_000_000} USDC`
  );
  console.log(
    `- Pool Book Value: ${Number(report.bookValue) / 1_000_000} USDC`
  );
  console.log(
    `- Target Deficit: ${Number(report.deficitMicroUsdc) / 1_000_000} USDC (${report.deficitMicroUsdc} micro-USDC)`
  );
  console.log(
    `- Target Current Value: ${Number(report.targetCurrentValue) / 1_000_000} USDC`
  );
  console.log(`- PST Supply: ${report.pstSupply}`);
  console.log(`- Pool PST Balance: ${report.poolPstBalance}`);
  console.log(
    `- Current Huma Total Assets: ${Number(report.currentTotalAssets) / 1_000_000} USDC`
  );
  console.log(
    `- New Huma Total Assets: ${Number(report.requiredTotalAssets) / 1_000_000} USDC\n`
  );
}
