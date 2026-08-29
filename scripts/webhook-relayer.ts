import { createSolanaRpc } from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import { checkRpcHealth } from "./utils";
import type {
  HeliusTransactionPayload,
  WebhookRelayerConfig,
} from "../app/lib/types/webhook";

const STATE_DIR = path.resolve(__dirname, "localnet-state");
const DB_DIR = path.resolve(STATE_DIR, "dbs");

export function getCursorFilePath(dbName = "default"): string {
  const cleanName = path.basename(dbName).replace(/\.sqlite$/, "");
  return path.resolve(DB_DIR, `${cleanName}.cursor.json`);
}

export function readWatermarkCursor(dbName = "default"): string | undefined {
  try {
    const filePath = getCursorFilePath(dbName);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      return data?.watermarkSignature || undefined;
    }
  } catch {
    // ignore read errors
  }
  return undefined;
}

export function saveWatermarkCursor(
  signature: string | undefined,
  dbName = "default"
): void {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    const filePath = getCursorFilePath(dbName);
    if (signature) {
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            watermarkSignature: signature,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        "utf-8"
      );
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn("[Relayer] Failed to persist cursor file:", err);
  }
}

/**
 * Waits until the Next.js webhook endpoint is reachable (avoiding ECONNREFUSED during app startup).
 */
export async function waitForWebhookEndpoint(
  url: string,
  maxWaitMs = 30000
): Promise<boolean> {
  const start = Date.now();
  let delay = 500;

  while (Date.now() - start < maxWaitMs) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([]),
        signal: controller.signal,
      });
      clearTimeout(id);

      // Endpoint responded (even with 401 or 500, meaning server is up and listening)
      if (res.status >= 200 && res.status < 600) {
        return true;
      }
    } catch {
      // Connection refused or timeout, wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 3000);
  }
  return false;
}

export async function runWebhookRelayer(
  config: WebhookRelayerConfig
): Promise<void> {
  const rpc = createSolanaRpc(config.rpcUrl);
  let isRunning = true;

  const handleShutdown = () => {
    if (isRunning) {
      console.log("\n[Relayer] Shutting down gracefully...");
      isRunning = false;
    }
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  if (!config.quiet) {
    console.log(
      `[Relayer] Initializing Solana Webhook Relayer for ${config.programId}`
    );
    console.log(`[Relayer] RPC: ${config.rpcUrl} | Network: ${config.network}`);
    console.log(`[Relayer] Target Webhook: ${config.webhookUrl}`);
  }

  // 1. Ensure RPC is online
  const isRpcHealthy = await checkRpcHealth(config.rpcUrl);
  if (!isRpcHealthy) {
    console.warn(
      `[Relayer] Solana RPC at ${config.rpcUrl} is not reachable yet. Waiting...`
    );
  }

  // 2. Determine initial watermark cursor
  let watermarkSig: string | undefined = undefined;

  if (config.fromGenesis) {
    if (!config.quiet) {
      console.log("[Relayer] Mode: SYNC FROM INCEPTION (--from-genesis)");
    }
    watermarkSig = undefined;
  } else {
    // Check saved cursor file first
    const savedCursor = readWatermarkCursor(config.dbName);
    if (savedCursor) {
      watermarkSig = savedCursor;
      if (!config.quiet) {
        console.log(
          `[Relayer] Resuming from saved watermark: ${watermarkSig.slice(0, 16)}...`
        );
      }
    } else {
      // Live Tail Mode: obtain newest signature currently on chain to avoid re-broadcasting old history
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const latestSigs: any[] = await rpc
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .getSignaturesForAddress(config.programId as any, { limit: 1 })
          .send();
        if (latestSigs && latestSigs.length > 0) {
          watermarkSig = latestSigs[0].signature;
          saveWatermarkCursor(watermarkSig, config.dbName);
          if (!config.quiet) {
            console.log(
              `[Relayer] Mode: LIVE TAIL (Watermark: ${watermarkSig?.slice(0, 16)}...)`
            );
          }
        }
      } catch {
        // chain might be empty or booting
      }
    }
  }

  // 3. Polling Loop
  while (isRunning) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let sigs: any[] = [];
      try {
        sigs = await rpc
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .getSignaturesForAddress(config.programId as any, {
            limit: config.batchSize || 50,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            until: watermarkSig as any,
          })
          .send();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (
          errMsg.includes("not found") ||
          errMsg.includes("Invalid param") ||
          errMsg.includes("unknown signer")
        ) {
          console.warn(
            "[Relayer] Ledger reset / stale watermark detected. Resetting cursor."
          );
          watermarkSig = undefined;
          saveWatermarkCursor(undefined, config.dbName);
          continue;
        }
        throw err;
      }

      if (sigs && sigs.length > 0) {
        const newestSigInBatch = sigs[0].signature;
        // Filter successful transactions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const validSigs = sigs.filter((s: any) => s.err === null);

        // Reverse to dispatch in ascending chronological execution order
        validSigs.reverse();

        const payloads: HeliusTransactionPayload[] = [];

        for (const s of validSigs) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tx: any = await rpc
              .getTransaction(s.signature, {
                encoding: "json",
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
              })
              .send();

            if (tx && tx.meta) {
              payloads.push({
                signature: s.signature,
                slot: Number(tx.slot || s.slot || 0),
                timestamp: Number(s.blockTime || Math.floor(Date.now() / 1000)),
                err: tx.meta.err ?? null,
                meta: {
                  err: tx.meta.err ?? null,
                  fee: tx.meta.fee,
                  preBalances: tx.meta.preBalances,
                  postBalances: tx.meta.postBalances,
                  logMessages: tx.meta.logMessages || [],
                  innerInstructions: tx.meta.innerInstructions || [],
                },
              });
            }
          } catch (txErr) {
            console.warn(
              `[Relayer] Failed to fetch metadata for tx ${s.signature}:`,
              txErr
            );
          }
        }

        if (payloads.length > 0) {
          // Chunk payloads (max 25 per request) to prevent HTTP body overflows
          const CHUNK_SIZE = 25;
          let allChunksSuccess = true;

          for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
            const chunk = payloads.slice(i, i + CHUNK_SIZE);
            const res = await fetch(config.webhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.webhookSecret}`,
              },
              body: JSON.stringify(chunk),
            });

            if (!res.ok) {
              const body = await res.text().catch(() => "");
              console.warn(
                `[Relayer Webhook Error] Status ${res.status}: ${body}`
              );
              allChunksSuccess = false;
              break;
            }
          }

          if (allChunksSuccess) {
            watermarkSig = newestSigInBatch;
            saveWatermarkCursor(watermarkSig, config.dbName);
            if (!config.quiet) {
              console.log(
                `[Relayer] ✓ Relayed ${payloads.length} transaction(s) to webhook (Watermark: ${watermarkSig.slice(0, 8)}...)`
              );
            }
          }
        } else {
          // Advance watermark if there were only reverted transactions
          watermarkSig = newestSigInBatch;
          saveWatermarkCursor(watermarkSig, config.dbName);
        }
      }
    } catch (err: unknown) {
      if (isRunning && !config.quiet) {
        console.warn("[Relayer Warning] Polling transient error:", err);
      }
    }

    if (config.once || !isRunning) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }

  process.removeListener("SIGINT", handleShutdown);
  process.removeListener("SIGTERM", handleShutdown);
}

// ─── CLI Entrypoint ──────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);

  const getArg = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const dbName = getArg("--db", "default");
  const rpcUrl = getArg(
    "--rpc",
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "http://127.0.0.1:8899"
  );
  const webhookUrl = getArg(
    "--webhook-url",
    process.env.WEBHOOK_URL || "http://127.0.0.1:3000/api/webhooks/solana"
  );
  const webhookSecret = getArg(
    "--secret",
    process.env.HELIUS_WEBHOOK_SECRET || "pb_webhook_secret_local_dev_123"
  );
  const programId = getArg(
    "--program-id",
    process.env.NEXT_PUBLIC_PROGRAM_ID ||
      "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx"
  );
  const pollIntervalMs = Number(getArg("--poll-interval", "800"));
  const network = getArg(
    "--network",
    process.env.NEXT_PUBLIC_ENVIRONMENT || "localnet"
  );
  const fromGenesis =
    args.includes("--from-genesis") || args.includes("--backfill");
  const once = args.includes("--once");
  const quiet = args.includes("--quiet");

  const config: WebhookRelayerConfig = {
    rpcUrl,
    programId,
    webhookUrl,
    webhookSecret,
    pollIntervalMs,
    batchSize: 50,
    network,
    dbName,
    fromGenesis,
    once,
    quiet,
  };

  runWebhookRelayer(config)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Relayer Fatal Error]:", err);
      process.exit(1);
    });
}
