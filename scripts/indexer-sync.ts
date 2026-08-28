import { createSolanaRpc } from "@solana/kit";
import { db, isDatabaseConfigured } from "../app/lib/db";
import { indexerCursor } from "../app/lib/db/schema";
import { parseEventsFromTxMeta } from "../app/lib/anchor-events";
import {
  ingestTransactionBatch,
  IngestTransactionItem,
} from "../app/lib/db/ingest";
import { eq } from "drizzle-orm";

const PROGRAM_ID =
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
  "H5uC6b7DkE6wY2aP9L6vJ6K8z5Y1a2b3c4d5e6f7g8h9";
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const NETWORK = process.env.NEXT_PUBLIC_ENVIRONMENT || "devnet";

async function fetchTransactionWithRetry(
  rpc: any,
  signature: string,
  maxRetries = 3
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const tx = await rpc
        .getTransaction(signature as any, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        })
        .send();
      return tx;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(
          `[Indexer Sync Error] Failed to fetch tx ${signature} after ${maxRetries} attempts:`,
          err
        );
        throw err;
      }
      const delay = Math.min(
        1000 * Math.pow(2, attempt) + Math.random() * 200,
        5000
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function syncHistoricalTransactions(
  options: { backfill?: boolean; maxTransactions?: number } = {}
) {
  if (!isDatabaseConfigured) {
    console.error("[Indexer Sync Fatal]: DATABASE_URL is not configured.");
    process.exit(1);
  }

  const rpc = createSolanaRpc(RPC_URL);
  console.log(
    `[Indexer Sync] Network: ${NETWORK} | RPC: ${RPC_URL} | Program: ${PROGRAM_ID}`
  );

  const [cursorRow] = await db
    .select()
    .from(indexerCursor)
    .where(eq(indexerCursor.network, NETWORK))
    .limit(1);

  const untilSig = options.backfill
    ? undefined
    : cursorRow?.contiguousSignature || undefined;

  console.log(
    `[Indexer Sync Mode]: ${options.backfill ? "DEEP BACKFILL" : "INCREMENTAL GAP FILL"}`
  );
  console.log(
    `[Indexer Sync Watermark 'until']: ${untilSig || "GENESIS / INCEPTION"}`
  );

  let beforeSig: string | undefined = undefined;
  let newestSignatureScanned: string | null = null;
  let newestSlotScanned = 0;
  let newestBlockTime = 0;
  let totalIngested = 0;
  let hasMore = true;
  let syncEncounteredErrors = false;
  let reachedTargetWatermark = false;

  while (hasMore) {
    let sigs: any[] = [];
    try {
      sigs = await rpc
        .getSignaturesForAddress(PROGRAM_ID as any, {
          limit: 100,
          before: beforeSig as any,
          until: untilSig as any,
        })
        .send();
    } catch (err) {
      console.error(
        "[Indexer Sync Error] Failed to fetch signatures for address:",
        err
      );
      syncEncounteredErrors = true;
      break;
    }

    if (!sigs || sigs.length === 0) {
      console.log("[Indexer Sync] Fully synced up to watermark.");
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

    // Filter out failed transactions
    const validSigs = sigs.filter((s: any) => s.err === null);
    const batch: IngestTransactionItem[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < validSigs.length; i += BATCH_SIZE) {
      const chunk = validSigs.slice(i, i + BATCH_SIZE);
      let txResults: any[] = [];

      try {
        txResults = await Promise.all(
          chunk.map(async (s: any) => {
            const tx = await fetchTransactionWithRetry(rpc, s.signature);
            return { s, tx };
          })
        );
      } catch {
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
            network: NETWORK,
          },
          events: parseEventsFromTxMeta(item.tx.meta as any),
        });
      }
    }

    if (syncEncounteredErrors) {
      console.warn(
        "[Indexer Sync] Aborting current loop due to fetch failures."
      );
      break;
    }

    const count = await ingestTransactionBatch(batch, {
      updateLatestCursor: false,
    });
    totalIngested += count;
    console.log(
      `[Indexer Sync] Processed batch of ${sigs.length} signatures (${count} events).`
    );

    beforeSig = sigs[sigs.length - 1].signature;
    if (
      sigs.length < 100 ||
      (options.maxTransactions && totalIngested >= options.maxTransactions)
    ) {
      hasMore = false;
      if (sigs.length < 100) {
        reachedTargetWatermark = true;
      }
    }
  }

  // Advance contiguous watermark once contiguous range is confirmed without errors
  if (
    newestSignatureScanned &&
    !options.backfill &&
    !syncEncounteredErrors &&
    (reachedTargetWatermark || !untilSig)
  ) {
    await db
      .insert(indexerCursor)
      .values({
        network: NETWORK,
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
    console.log(
      `[Indexer Sync] Contiguous watermark updated to: ${newestSignatureScanned}`
    );
  } else if (syncEncounteredErrors) {
    console.warn(
      "[Indexer Sync] Watermark advancement skipped due to fetch errors in batch."
    );
  }

  console.log(
    `[Indexer Sync Complete]: Total events ingested = ${totalIngested}`
  );
}

if (require.main === module) {
  const isBackfill = process.argv.includes("--backfill");
  syncHistoricalTransactions({ backfill: isBackfill })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Indexer Sync Fatal]:", err);
      process.exit(1);
    });
}
