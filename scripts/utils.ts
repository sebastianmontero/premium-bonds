import {
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  KeyPairSigner,
} from "@solana/kit";
import * as fs from "fs";
import {
  parseTransactionError,
  getExplorerUrl,
  truncateSignature,
  matchAnchorError,
} from "../app/lib/errors";
export {
  parseEnvLine,
  readEnvFile,
  upsertEnvFile,
  type UpsertEnvOptions,
  type ParsedEnvLine,
} from "./env-utils";

/**
 * Checks if the RPC node at the given URL is healthy.
 */
export async function checkRpcHealth(url: string): Promise<boolean> {
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
  } catch {
    throw new Error(
      `Failed to parse keypair file at: ${filePath}. Ensure it is a valid JSON byte array.`
    );
  }
}

/**
 * Safely stringifies objects containing BigInt values without throwing a TypeError.
 */
export function safeStringify(obj: unknown, space?: string | number): string {
  return JSON.stringify(
    obj,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    space
  );
}

/**
 * Sends a transaction and polls for its confirmation status.
 */
export async function sendTx(
  rpc: ReturnType<typeof createSolanaRpc>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instruction: any,
  payerSigner: KeyPairSigner
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    setTransactionMessageFeePayerSigner(
      payerSigner,
      appendTransactionMessageInstruction(
        instruction,
        createTransactionMessage({ version: 0 })
      )
    )
  );

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
 * Updates a matching substring in a text file using RegExp.
 */
export function updateFileContent(
  filePath: string,
  regex: RegExp,
  replacement: string
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const updated = content.replace(regex, replacement);
  fs.writeFileSync(filePath, updated, "utf-8");
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
