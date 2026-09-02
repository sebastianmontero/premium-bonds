import { NextRequest, NextResponse, after } from "next/server";
import {
  parseEventsFromTxMeta,
  resolveEventMetadata,
} from "@/app/lib/anchor-events";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  ingestTransactionBatch,
  IngestTransactionItem,
} from "@/app/lib/db/ingest";
import {
  broadcastAggregatedInvalidations,
  RealtimeBroadcastItem,
} from "@/app/lib/realtime/server";
import {
  SettlementMonitorService,
  isHumaSettlementTx,
  DEFAULT_POOL_ID,
} from "@/app/lib/indexer/settlement-monitor";
import type { HeliusTransactionPayload } from "@/app/lib/types/webhook";
import {
  isTimingSafeAuthorized,
  isSuccessfulHeliusTransaction,
} from "@/app/lib/webhook-auth";
import { resolveSolanaRpcUrl, getNetworkInfo } from "@/app/lib/network";
import { createSolanaRpc } from "@solana/kit";
import { PayoutHydratorService } from "@/app/lib/indexer/payout-hydrator";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expectedSecret = process.env.HELIUS_WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("[Webhook Error] HELIUS_WEBHOOK_SECRET is not configured.");
    return NextResponse.json(
      { error: "Server misconfiguration: HELIUS_WEBHOOK_SECRET missing" },
      { status: 500 }
    );
  }

  if (!isTimingSafeAuthorized(authHeader, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDatabaseConfigured) {
    console.error("[Webhook Error] DATABASE_URL is not configured.");
    return NextResponse.json(
      { error: "Server misconfiguration: Database not configured" },
      { status: 500 }
    );
  }

  try {
    const payload = await req.json();
    const transactions: HeliusTransactionPayload[] = Array.isArray(payload)
      ? payload
      : [payload];
    const network = getNetworkInfo().cluster;

    // Strictly filter out null signatures and reverted/failed transactions
    const validTransactions = transactions.filter(
      isSuccessfulHeliusTransaction
    );

    const batch: IngestTransactionItem[] = validTransactions.map((tx) => ({
      context: {
        signature: tx.signature,
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
          scopes: meta.scopes,
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

    // Trigger non-blocking Huma settlement sync via next/server after()
    const humaPoolStateAddress =
      process.env.NEXT_PUBLIC_HUMA_POOL_STATE || process.env.HUMA_POOL_STATE;

    if (
      humaPoolStateAddress &&
      validTransactions.some((tx) =>
        isHumaSettlementTx(tx, humaPoolStateAddress)
      )
    ) {
      const rpcUrl = resolveSolanaRpcUrl();
      const settlementMonitor = new SettlementMonitorService();

      after(async () => {
        try {
          const result = await settlementMonitor.syncHumaPoolSettlements(
            rpcUrl,
            humaPoolStateAddress,
            DEFAULT_POOL_ID
          );
          if (!result.success) {
            console.error("[Webhook Settlement Sync Error]:", result.error);
          } else if (result.updatedCount > 0) {
            console.log(
              `[Webhook Settlement] Transitioned ${result.updatedCount} redemptions to ready.`
            );
          }
        } catch (err) {
          console.error("[Webhook Settlement Notice]:", err);
        }
      });
    }

    // Trigger non-blocking Payout Registry hydration for completed draws
    const hasDrawCompleted = batch.some((item) =>
      item.events.some((evt) => evt.type === "DrawCompleted")
    );

    if (hasDrawCompleted) {
      const rpcUrl = resolveSolanaRpcUrl();
      const rpc = createSolanaRpc(rpcUrl);
      const hydrator = new PayoutHydratorService(rpc);

      after(async () => {
        try {
          const count = await hydrator.hydratePendingDraws();
          if (count > 0) {
            console.log(`[Webhook] Hydrated ${count} draw payout registries.`);
          }
        } catch (err) {
          console.error("[Webhook Payout Hydration Error]:", err);
        }
      });
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
