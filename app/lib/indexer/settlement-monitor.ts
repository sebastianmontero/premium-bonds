import { db } from "../db";
import { pendingRedemptions } from "../db/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import {
  broadcastAggregatedInvalidations,
  type RealtimeBroadcastItem,
} from "../realtime/server";
import { createSolanaRpc, address, type Address } from "@solana/kit";
import { decodeAccountBase64Data, parseMockHumaPoolState } from "../bonds-sdk";
import type { HeliusTransactionPayload } from "../types/webhook";

export const DEFAULT_POOL_ID = 1;

export type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

export interface HumaSettlementCheckResult {
  success: boolean;
  updatedCount: number;
  nextRequestId?: bigint;
  error?: string;
}

/**
 * Checks whether a Helius transaction payload interacts with the Huma Pool State account.
 * Compatible with localnet simulated payloads, local relayer RPC captures, and live Helius Enhanced Webhooks.
 */
export function isHumaSettlementTx(
  tx: HeliusTransactionPayload,
  humaPoolStateAddress?: string | Address
): boolean {
  if (!humaPoolStateAddress) return false;
  const target = humaPoolStateAddress.toString();

  // 1. Check meta.accountKeys (Simulated localnet & standard RPC format)
  if (tx.meta?.accountKeys?.some((key) => key.toString() === target)) {
    return true;
  }

  // 2. Check meta.loadedAddresses (Solana v0 Versioned Transactions / ALTs)
  if (tx.meta?.loadedAddresses) {
    const writable = tx.meta.loadedAddresses.writable || [];
    const readonly = tx.meta.loadedAddresses.readonly || [];
    if (
      writable.some((k) => k.toString() === target) ||
      readonly.some((k) => k.toString() === target)
    ) {
      return true;
    }
  }

  // 3. Check top-level accountData (Live Helius Enhanced Webhook format)
  if (Array.isArray(tx.accountData)) {
    return tx.accountData.some((item) => {
      if (typeof item === "string") return item === target;
      if (item && typeof item === "object" && "account" in item) {
        return (item as { account: string }).account === target;
      }
      return false;
    });
  }

  return false;
}

export class SettlementMonitorService {
  /**
   * Fetches the latest on-chain Huma pool state and transitions eligible pending redemptions to 'ready'.
   */
  async syncHumaPoolSettlements(
    rpcOrUrl: string | SolanaRpcClient,
    humaPoolStateAddress: string | Address,
    poolId: number = DEFAULT_POOL_ID
  ): Promise<HumaSettlementCheckResult> {
    try {
      if (!humaPoolStateAddress) {
        return {
          success: false,
          updatedCount: 0,
          error: "Huma pool state address is required",
        };
      }

      const rpc =
        typeof rpcOrUrl === "string" ? createSolanaRpc(rpcOrUrl) : rpcOrUrl;

      const humaInfo = await rpc
        .getAccountInfo(address(humaPoolStateAddress), {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send();

      if (!humaInfo?.value) {
        return {
          success: false,
          updatedCount: 0,
          error: `Huma pool state account not found: ${humaPoolStateAddress.toString()} on RPC ${typeof rpcOrUrl === "string" ? rpcOrUrl : "client"}`,
        };
      }

      // Pass humaInfo.value directly to decodeAccountBase64Data
      const humaBytes = decodeAccountBase64Data(humaInfo.value);
      if (!humaBytes) {
        return {
          success: false,
          updatedCount: 0,
          error: "Failed to decode account base64 data",
        };
      }

      const humaState = parseMockHumaPoolState(humaBytes);
      const updatedCount = await this.settleEligibleRedemptions(
        poolId,
        humaState.nextRequestId
      );

      return {
        success: true,
        updatedCount,
        nextRequestId: humaState.nextRequestId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, updatedCount: 0, error: message };
    }
  }

  /**
   * Transitions redemptions in PostgreSQL where pool_id = poolId, status = 'settling', and huma_request_id < nextRequestId.
   */
  async settleEligibleRedemptions(
    poolId: number,
    nextRequestId: bigint
  ): Promise<number> {
    const updated = await db
      .update(pendingRedemptions)
      .set({ status: "ready" })
      .where(
        and(
          eq(pendingRedemptions.poolId, poolId),
          eq(pendingRedemptions.status, "settling"),
          isNotNull(pendingRedemptions.humaRequestId),
          lt(pendingRedemptions.humaRequestId, nextRequestId.toString())
        )
      )
      .returning({ userAddress: pendingRedemptions.userAddress });

    if (updated.length > 0) {
      const distinctUsers = Array.from(
        new Set(updated.map((u) => u.userAddress))
      );
      const invalidations: RealtimeBroadcastItem[] = distinctUsers.map(
        (userAddress) => ({
          scopes: ["redemptions", "user"],
          poolId,
          userAddress,
          reason: "settlement:huma_ready",
        })
      );
      await broadcastAggregatedInvalidations(invalidations);
    }
    return updated.length;
  }
}
