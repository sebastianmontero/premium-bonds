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
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  parseTransactionError,
  getExplorerUrl,
  truncateSignature,
  matchAnchorError,
} from "../app/lib/errors";
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

/**
 * Detects whether an RPC or network transport error is transient and safe to retry.
 */
export function isRetryableRpcError(err: unknown): boolean {
  if (!err) return false;

  // 1. Solana HTTP Transport errors (429, 408, 5xx)
  if (isSolanaError(err, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const status = err.context?.statusCode;
    if (
      status === 429 ||
      status === 408 ||
      (status !== undefined && status >= 500)
    ) {
      return true;
    }
    return false;
  }

  // 2. Solana JSON-RPC Server errors (node unhealthy, -32005)
  if (isSolanaError(err, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY)) {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errObj = err as any;
  const cause = errObj.cause;
  const msg = (errObj.message || "").toLowerCase();
  const causeMsg = (cause?.message || "").toLowerCase();
  const code = errObj.code || cause?.code;

  // 3. Known network / socket error codes
  const retryableCodes = new Set([
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENOTFOUND",
    "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
  ]);

  if (code && retryableCodes.has(code)) {
    return true;
  }

  // 4. Common transient error messages
  if (
    msg.includes("fetch failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror")
  ) {
    return true;
  }

  if (
    causeMsg.includes("other side closed") ||
    causeMsg.includes("socket hang up") ||
    causeMsg.includes("econnreset") ||
    causeMsg.includes("connection reset")
  ) {
    return true;
  }

  return false;
}

export interface ResilientRpcConfig {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
  readonly jitter?: boolean;
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  readonly headers?: Record<string, string>;
}

/**
 * Creates a Solana RPC client wrapped with a resilient transport that automatically
 * retries transient network, socket, rate-limit, and connection-drop errors with exponential backoff.
 */
export function createResilientRpc(
  clusterUrl: string,
  config?: ResilientRpcConfig
): ReturnType<typeof createSolanaRpc> {
  const defaultTransport = createDefaultRpcTransport({
    url: clusterUrl,
    headers: config?.headers,
  });

  const maxRetries = config?.maxRetries ?? 5;
  const initialDelayMs = config?.initialDelayMs ?? 500;
  const maxDelayMs = config?.maxDelayMs ?? 8000;
  const backoffFactor = config?.backoffFactor ?? 2;
  const useJitter = config?.jitter ?? true;

  const resilientTransport = async (
    request: Parameters<typeof defaultTransport>[0]
  ) => {
    let attempt = 0;
    while (true) {
      if (request.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      try {
        return await defaultTransport(request);
      } catch (err) {
        if (
          request.signal?.aborted ||
          !isRetryableRpcError(err) ||
          attempt >= maxRetries
        ) {
          throw err;
        }

        attempt++;
        const exponentialDelay = Math.min(
          maxDelayMs,
          initialDelayMs * Math.pow(backoffFactor, attempt - 1)
        );
        const jitterMs = useJitter ? Math.random() * 250 : 0;
        const delayMs = exponentialDelay + jitterMs;

        if (config?.onRetry) {
          config.onRetry(err, attempt, delayMs);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg =
            err instanceof Error
              ? (err as any).cause?.message || err.message
              : String(err);
          console.warn(
            `[RPC Retry] Transient network error (${msg}) on attempt ${attempt}/${maxRetries}. Retrying in ${Math.round(delayMs)}ms...`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  };

  return createSolanaRpcFromTransport(resilientTransport);
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
 * Defensively normalizes instruction accounts matching the signers' addresses
 * to use the canonical KeyPairSigner instances, avoiding reference-mismatch errors.
 */
export function normalizeInstructionSigners(
  instructions: readonly Instruction[],
  signers: KeyPairSigner | readonly KeyPairSigner[]
): Instruction[] {
  const signerList = Array.isArray(signers) ? signers : [signers];
  const signerMap = new Map(signerList.map((s) => [s.address, s]));
  return instructions.map((ix) => {
    if (!ix.accounts) return ix;
    const sanitizedAccounts = ix.accounts.map((acc) => {
      const isSignerRole =
        acc.role === AccountRole.READONLY_SIGNER ||
        acc.role === AccountRole.WRITABLE_SIGNER ||
        ("signer" in acc && Boolean(acc.signer));
      const matchedSigner = signerMap.get(acc.address);
      if (isSignerRole && matchedSigner) {
        const existingSigner = "signer" in acc ? acc.signer : undefined;
        if (existingSigner !== matchedSigner) {
          return { ...acc, signer: matchedSigner };
        }
      }
      return acc;
    });
    return { ...ix, accounts: sanitizedAccounts };
  });
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
