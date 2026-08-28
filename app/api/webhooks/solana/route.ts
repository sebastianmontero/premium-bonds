import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  parseEventsFromTxMeta,
  resolveEventMetadata,
} from "@/app/lib/anchor-events";
import {
  ingestTransactionBatch,
  IngestTransactionItem,
} from "@/app/lib/db/ingest";
import {
  broadcastAggregatedInvalidations,
  RealtimeBroadcastItem,
} from "@/app/lib/realtime/server";

export const dynamic = "force-dynamic";

function isAuthorized(
  authHeader: string | null,
  expectedSecret: string
): boolean {
  if (!authHeader) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (token.length !== expectedSecret.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expectedSecret)
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expectedSecret = process.env.HELIUS_WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("[Webhook Error] HELIUS_WEBHOOK_SECRET is not configured.");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  if (!isAuthorized(authHeader, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await req.json();
    const transactions = Array.isArray(payload) ? payload : [payload];
    const network = process.env.NEXT_PUBLIC_ENVIRONMENT || "mainnet-beta";

    // Strictly filter out null signatures and reverted/failed transactions
    const validTransactions = transactions.filter((tx) => {
      if (!tx?.signature) return false;
      if (tx.err != null || tx.meta?.err != null || tx.transactionError != null)
        return false;
      return true;
    });

    const batch: IngestTransactionItem[] = validTransactions.map((tx) => ({
      context: {
        signature: tx.signature as string,
        slot: Number(tx.slot || 0),
        blockTime: Number(tx.timestamp || Math.floor(Date.now() / 1000)),
        network,
      },
      events: parseEventsFromTxMeta({
        logMessages: tx.meta?.logMessages || tx.logs || [],
        innerInstructions: tx.meta?.innerInstructions || [],
      }),
    }));

    const eventCount = await ingestTransactionBatch(batch, {
      updateLatestCursor: true,
    });

    // Collect invalidation events and perform single aggregated broadcast
    const broadcastEvents: RealtimeBroadcastItem[] = [];
    for (const item of batch) {
      for (const evt of item.events) {
        const meta = resolveEventMetadata(evt);
        broadcastEvents.push({
          scope: meta.scope,
          poolId: meta.poolId,
          userAddress: meta.userAddress,
          txSignature: item.context.signature,
          reason: `webhook:${evt.type}`,
        });
      }
    }

    if (broadcastEvents.length > 0) {
      await broadcastAggregatedInvalidations(broadcastEvents);
    }

    return NextResponse.json({
      success: true,
      received: transactions.length,
      ingested: validTransactions.length,
      events: eventCount,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[Webhook Ingestion Error]:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
