import "./load-env";
import { createSolanaRpc, createSolanaRpcFromTransport } from "@solana/kit";
import {
  resolveSolanaRpcUrl,
  resolveNetwork,
  type SolanaNetworkCluster,
} from "../app/lib/network";
import {
  db,
  isDatabaseConfigured as defaultIsDatabaseConfigured,
  closeDatabase,
  DatabaseNotConfiguredError,
} from "../app/lib/db";
import { indexerCursor } from "../app/lib/db/schema";
import { parseEventsFromTxMeta } from "../app/lib/anchor-events";
import {
  ingestTransactionBatch,
  IngestTransactionItem,
} from "../app/lib/db/ingest";
import { PayoutHydratorService } from "../app/lib/indexer/payout-hydrator";
import { SettlementMonitorService } from "../app/lib/indexer/settlement-monitor";
import { eq } from "drizzle-orm";
import { PROGRAM_ID } from "../app/lib/bonds-sdk";
import {
  createResilientRpc,
  RateLimitCoordinator,
  type ResilientRpcClient,
} from "../app/lib/rpc-transport";
import {
  SyncProgressTracker,
  type IndexerProgressEvent,
} from "./indexer-telemetry";

export interface SyncHistoricalTransactionsOptions {
  backfill?: boolean;
  silent?: boolean;
  onProgress?: (progress: IndexerProgressEvent) => void;
  onRetry?: (
    error: unknown,
    attempt: number,
    delayMs: number,
    context?: string
  ) => void;
  transport?: Parameters<typeof createSolanaRpcFromTransport>[0];
  maxTransactions?: number;
  rpcUrl?: string;
  network?: SolanaNetworkCluster | string;
  rpc?: ResilientRpcClient | ReturnType<typeof createSolanaRpc>;
  isDatabaseConfigured?: boolean;
  db?: typeof db;
  humaPoolStateAddress?: string;
  batchSize?: number;
  batchDelayMs?: number;
  workerStaggerMs?: number;
  maxRetries?: number;
  rateLimitCoordinator?: RateLimitCoordinator;
}

export interface SyncHistoricalTransactionsResult {
  success: boolean;
  totalIngested: number;
  contiguousWatermark: string | null;
}

export function parseIndexerSyncArgs(
  args: string[] = process.argv.slice(2)
): SyncHistoricalTransactionsOptions {
  const isBackfill = args.includes("--backfill");
  const isSilent =
    args.includes("--silent") ||
    args.includes("--quiet") ||
    args.includes("-q");
  let maxTransactions: number | undefined;
  let rpcUrl: string | undefined;
  let network: SolanaNetworkCluster | string | undefined;
  let batchSize: number | undefined;
  let batchDelayMs: number | undefined;
  let maxRetries: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (
      (args[i] === "--max" || args[i] === "--max-transactions") &&
      args[i + 1]
    ) {
      maxTransactions = parseInt(args[++i], 10);
    } else if (args[i] === "--rpc" && args[i + 1]) {
      rpcUrl = args[++i];
    } else if (args[i] === "--network" && args[i + 1]) {
      network = args[++i];
    } else if (args[i] === "--batch-size" && args[i + 1]) {
      batchSize = parseInt(args[++i], 10);
    } else if (args[i] === "--batch-delay" && args[i + 1]) {
      batchDelayMs = parseInt(args[++i], 10);
    } else if (args[i] === "--max-retries" && args[i + 1]) {
      maxRetries = parseInt(args[++i], 10);
    }
  }

  return {
    backfill: isBackfill,
    silent: isSilent,
    maxTransactions,
    rpcUrl,
    network,
    batchSize,
    batchDelayMs,
    maxRetries,
  };
}

export async function syncHistoricalTransactions(
  options: SyncHistoricalTransactionsOptions = {}
): Promise<SyncHistoricalTransactionsResult> {
  const isDbConfigured =
    options.isDatabaseConfigured !== undefined
      ? options.isDatabaseConfigured
      : defaultIsDatabaseConfigured;

  if (!isDbConfigured) {
    throw new DatabaseNotConfiguredError();
  }

  const tracker = new SyncProgressTracker({
    silent: options.silent,
    onProgress: options.onProgress,
  });

  const dbClient = options.db || db;
  const rpcUrl = options.rpcUrl || resolveSolanaRpcUrl();
  const network =
    options.network ||
    resolveNetwork(
      process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NEXT_PUBLIC_NETWORK,
      rpcUrl
    ).cluster;

  const coordinator =
    options.rateLimitCoordinator ?? new RateLimitCoordinator();
  const batchSize = options.batchSize ?? 3;
  const batchDelayMs = options.batchDelayMs ?? 200;
  const workerStaggerMs = options.workerStaggerMs ?? 50;
  const maxRetries = options.maxRetries ?? 5;

  const rpc =
    options.rpc ||
    createResilientRpc(rpcUrl, {
      rateLimitCoordinator: coordinator,
      maxRetries,
      transport: options.transport,
      onRetry: tracker.createRetryListener(maxRetries, options.onRetry),
    });
  const hydrator = new PayoutHydratorService(rpc);
  const settlementMonitor = new SettlementMonitorService();

  tracker.log(
    `[Indexer Sync] Network: ${network} | RPC: ${rpcUrl} | Program: ${PROGRAM_ID}`
  );

  const [cursorRow] = await dbClient
    .select()
    .from(indexerCursor)
    .where(eq(indexerCursor.network, network))
    .limit(1);

  const untilSig = options.backfill
    ? undefined
    : cursorRow?.contiguousSignature || undefined;

  tracker.log(
    `[Indexer Sync Mode]: ${options.backfill ? "DEEP BACKFILL" : "INCREMENTAL GAP FILL"}`
  );
  tracker.log(
    `[Indexer Sync Watermark 'until']: ${untilSig || "GENESIS / INCEPTION"}`
  );

  let beforeSig: string | undefined = undefined;
  let newestSignatureScanned: string | null = null;
  let newestSlotScanned = 0;
  let newestBlockTime = 0;
  let totalIngested = 0;
  let totalTransactionsScanned = 0;
  let hasMore = true;
  let syncEncounteredErrors = false;
  let reachedTargetWatermark = false;
  let pageCounter = 0;

  while (hasMore) {
    pageCounter++;
    tracker.emit({
      phase: "querying_signatures",
      page: pageCounter,
      untilSig,
      beforeSig,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sigs: any[] = [];
    try {
      sigs = await rpc
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .getSignaturesForAddress(PROGRAM_ID as any, {
          limit: 100,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          before: beforeSig as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          until: untilSig as any,
        })
        .send();
    } catch (err) {
      tracker.error(
        "[Indexer Sync Error] Failed to fetch signatures for address:",
        err
      );
      tracker.emit({
        phase: "aborted",
        page: pageCounter,
        reason: "Failed to fetch signatures for address",
        error: err,
      });
      syncEncounteredErrors = true;
      break;
    }

    if (!sigs || sigs.length === 0) {
      tracker.log("[Indexer Sync] Fully synced up to watermark.");
      reachedTargetWatermark = true;
      break;
    }

    if (!newestSignatureScanned) {
      newestSignatureScanned = sigs[0].signature;
      newestSlotScanned = Number(sigs[0].slot || 0);
      newestBlockTime = Number(
        sigs[0].blockTime || Math.floor(Date.now() / 1000)
      );
    }

    // Filter out failed transactions and reverse window to process in ascending slot order
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validSigs = sigs.filter((s: any) => s.err === null).reverse();
    tracker.emit({
      phase: "signatures_discovered",
      page: pageCounter,
      totalDiscovered: sigs.length,
      validCount: validSigs.length,
    });

    const batch: IngestTransactionItem[] = [];
    const totalChunks = Math.max(1, Math.ceil(validSigs.length / batchSize));

    for (let i = 0; i < validSigs.length; i += batchSize) {
      if (i > 0 && batchDelayMs > 0) {
        await new Promise((r) => setTimeout(r, batchDelayMs));
      }
      const chunk = validSigs.slice(i, i + batchSize);
      const chunkNumber = Math.floor(i / batchSize) + 1;
      const txStartIndex = i + 1;
      const txEndIndex = Math.min(i + batchSize, validSigs.length);

      tracker.emit({
        phase: "fetching_transactions",
        page: pageCounter,
        chunk: {
          chunkNumber,
          totalChunks,
          txStartIndex,
          txEndIndex,
          totalTransactions: validSigs.length,
        },
        eventsParsedSoFar: batch.reduce(
          (sum, item) => sum + item.events.length,
          0
        ),
      });

      const txResults = await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chunk.map(async (s: any, idx: number) => {
          try {
            if (workerStaggerMs > 0 && idx > 0) {
              await new Promise((r) => setTimeout(r, idx * workerStaggerMs));
            }
            const tx = await rpc
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .getTransaction(s.signature as any, {
                encoding: "json",
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
              })
              .send();
            return { s, tx, error: null };
          } catch (err) {
            return { s, tx: null, error: err };
          }
        })
      );

      const failure = txResults.find((r) => r.error !== null);
      if (failure) {
        tracker.error(
          `[Indexer Sync Error] Failed to fetch tx ${failure.s.signature}:`,
          failure.error
        );
        syncEncounteredErrors = true;
        break;
      }

      for (const item of txResults) {
        if (!item?.tx?.meta) continue;
        batch.push({
          context: {
            signature: item.s.signature,
            slot: Number(item.tx.slot || 0),
            blockTime: Number(
              item.s.blockTime || Math.floor(Date.now() / 1000)
            ),
            network: network,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          events: parseEventsFromTxMeta(item.tx.meta as any),
        });
      }
    }

    if (syncEncounteredErrors) {
      tracker.emit({
        phase: "aborted",
        page: pageCounter,
        reason: "Fetch failures in transaction chunk",
      });
      break;
    }

    const ingestStartTime = performance.now();
    const ingestResult = await ingestTransactionBatch(batch, {
      updateLatestCursor: false,
    });
    const ingestDurationMs = Math.round(performance.now() - ingestStartTime);
    const count = ingestResult.insertedCount;
    totalIngested += count;
    totalTransactionsScanned += validSigs.length;

    tracker.emit({
      phase: "ingesting_batch",
      page: pageCounter,
      batchSize: validSigs.length,
      insertedCount: count,
      durationMs: ingestDurationMs,
    });

    // Immediately hydrate pending draws if batch contained DrawCompleted or DrawVoided, ensuring chronological
    // consistency before downstream reinvestments are processed.
    const batchHasDrawCompletedOrVoided = batch.some((item) =>
      item.events.some(
        (evt) => evt.type === "DrawCompleted" || evt.type === "DrawVoided"
      )
    );
    if (batchHasDrawCompletedOrVoided) {
      tracker.emit({
        phase: "hydrating_draws",
        page: pageCounter,
      });
      await hydrator.hydratePendingDraws();
    }

    // The oldest signature in original sigs (which was descending) is at index length - 1
    beforeSig = sigs[sigs.length - 1].signature;
    if (
      sigs.length < 100 ||
      (options.maxTransactions &&
        (totalIngested >= options.maxTransactions ||
          totalTransactionsScanned >= options.maxTransactions))
    ) {
      hasMore = false;
      if (sigs.length < 100) {
        reachedTargetWatermark = true;
      }
    }
  }

  // Advance contiguous watermark once contiguous range is confirmed without errors
  const canAdvanceWatermark = reachedTargetWatermark;
  if (
    newestSignatureScanned &&
    !options.backfill &&
    !syncEncounteredErrors &&
    canAdvanceWatermark
  ) {
    await dbClient
      .insert(indexerCursor)
      .values({
        network: network,
        contiguousSignature: newestSignatureScanned,
        contiguousSlot: newestSlotScanned,
        lastBlockTime: newestBlockTime,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: indexerCursor.network,
        set: {
          contiguousSignature: newestSignatureScanned,
          contiguousSlot: newestSlotScanned,
          lastBlockTime: newestBlockTime,
          updatedAt: new Date(),
        },
      });
    tracker.log(
      `[Indexer Sync] Contiguous watermark updated to: ${newestSignatureScanned}`
    );
  } else if (syncEncounteredErrors) {
    tracker.warn(
      "[Indexer Sync] Watermark advancement skipped due to fetch errors in batch."
    );
  }

  // Run hydrator for any unhydrated completed draws
  try {
    const hydratorResult = await hydrator.hydratePendingDraws(50);
    if (hydratorResult.succeeded > 0) {
      tracker.log(
        `[Indexer Sync] Hydrated ${hydratorResult.succeeded} draw payout registries.`
      );
    }
    if (hydratorResult.failed > 0) {
      tracker.warn(
        `[Indexer Sync] Payout hydration encountered ${hydratorResult.failed} failures:`,
        hydratorResult.errors
      );
    }
  } catch (err) {
    tracker.warn("[Indexer Sync] Hydrator execution notice:", err);
  }

  // Run settlement monitor for self-healing reconciliation of Huma pool redemptions
  try {
    const humaPoolStateAddress =
      options.humaPoolStateAddress !== undefined
        ? options.humaPoolStateAddress
        : process.env.NEXT_PUBLIC_HUMA_POOL_STATE ||
          process.env.HUMA_POOL_STATE;
    if (humaPoolStateAddress) {
      tracker.emit({
        phase: "reconciling_settlements",
        poolStateAddress: humaPoolStateAddress,
      });
      const result = await settlementMonitor.syncHumaPoolSettlements(
        rpc,
        humaPoolStateAddress,
        1
      );
      if (result.success && result.updatedCount > 0) {
        tracker.log(
          `[Indexer Sync] Self-healing: Transitioned ${result.updatedCount} ready redemptions from Huma queue state.`
        );
      }
    }
  } catch (err) {
    tracker.warn("[Indexer Sync] Huma settlement reconciliation notice:", err);
  }

  tracker.emit({
    phase: "complete",
    totalIngested,
    totalScanned: totalTransactionsScanned,
    totalPages: pageCounter,
  });

  return {
    success: !syncEncounteredErrors,
    totalIngested,
    contiguousWatermark:
      newestSignatureScanned &&
      !options.backfill &&
      !syncEncounteredErrors &&
      canAdvanceWatermark
        ? newestSignatureScanned
        : cursorRow?.contiguousSignature || null,
  };
}

if (require.main === module) {
  const options = parseIndexerSyncArgs(process.argv.slice(2));
  syncHistoricalTransactions(options)
    .then(async (result) => {
      await closeDatabase();
      process.exit(result.success ? 0 : 1);
    })
    .catch(async (err) => {
      console.error("[Indexer Sync Fatal]:", err);
      await closeDatabase().catch(() => {});
      process.exit(1);
    });
}
