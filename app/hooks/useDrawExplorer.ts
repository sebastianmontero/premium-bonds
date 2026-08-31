"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { Address, getBase64Encoder } from "@solana/kit";
import {
  findDrawCyclePda,
  findPayoutRegistryPda,
  parseDrawCycle,
  parsePayoutRegistry,
  chunkArray,
  DrawCycleInfo,
  PayoutRegistryInfo,
} from "../lib/bonds-sdk";
import { formatDrawCycleSummary } from "../lib/draw-helpers";
import { useProtocolSyncSubscription } from "./useProtocolSyncSubscription";
import type { DrawCycleSummary, DrawHistoryStats } from "../types";

const base64Encoder = getBase64Encoder();

function parseSeedFromHex(hex?: string): Uint8Array {
  if (!hex || hex.length !== 64) return new Uint8Array(32);
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
  }
  return arr;
}

interface DrawExplorerResult {
  /** All historical draw summaries (newest first). */
  drawSummaries: DrawCycleSummary[];
  /** Aggregate protocol statistics across all historical draws. */
  stats: DrawHistoryStats;
  /** Whether draw history is initially loading. */
  isLoading: boolean;
  /** Whether draw history is currently refetching in background. */
  isRefetching: boolean;
  /** Refetch all draw cycle headers. */
  refetch: () => Promise<void>;
}

/**
 * Fetches lightweight DrawCycle headers for a pool with dual-mode support
 * (Indexer REST primary with sub-10ms response, RPC batch scan fallback).
 */
export function useDrawExplorer(
  poolId: number = 1,
  currentDrawCycleId: number | undefined,
  maxCyclesToFetch: number = 100,
  poolTotalPrizesDistributed?: number
): DrawExplorerResult {
  const client = useSolanaClient();
  const [drawSummaries, setDrawSummaries] = useState<DrawCycleSummary[]>([]);
  const [stats, setStats] = useState<DrawHistoryStats>({
    totalYieldDistributed: poolTotalPrizesDistributed ?? 0,
    totalDrawsCompleted: 0,
    totalWinningBonds: 0,
    averagePrizePot: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const fetchIdRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const lastPoolIdRef = useRef(poolId);

  useEffect(() => {
    if (poolTotalPrizesDistributed !== undefined) {
      setStats((prev) => ({
        ...prev,
        totalYieldDistributed: poolTotalPrizesDistributed,
      }));
    }
  }, [poolTotalPrizesDistributed]);

  useEffect(() => {
    if (lastPoolIdRef.current !== poolId) {
      lastPoolIdRef.current = poolId;
      hasLoadedRef.current = false;
    }
  }, [poolId]);

  const fetchDraws = useCallback(async () => {
    if (currentDrawCycleId === undefined || currentDrawCycleId < 0) {
      setDrawSummaries([]);
      setStats({
        totalYieldDistributed: poolTotalPrizesDistributed ?? 0,
        totalDrawsCompleted: 0,
        totalWinningBonds: 0,
        averagePrizePot: 0,
      });
      hasLoadedRef.current = true;
      setIsLoading(false);
      setIsRefetching(false);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    } else {
      setIsRefetching(true);
    }

    // 1. Primary Path: Try Indexer REST API
    try {
      const res = await fetch(
        `/api/indexer/draws?poolId=${poolId}&limit=${maxCyclesToFetch}`,
        { cache: "no-store" }
      );

      if (res.ok) {
        const data = await res.json();
        if (data && data.fallback !== true && Array.isArray(data.draws)) {
          if (fetchId !== fetchIdRef.current) return;

          const hydratedSummaries: DrawCycleSummary[] = (
            data.draws as Array<Omit<DrawCycleSummary, "randomnessSeed">>
          ).map((d) => ({
            ...d,
            randomnessSeed: parseSeedFromHex(d.vrfSeedHex),
          }));

          setDrawSummaries(hydratedSummaries);
          if (data.stats) {
            setStats({
              ...data.stats,
              totalYieldDistributed:
                poolTotalPrizesDistributed !== undefined
                  ? poolTotalPrizesDistributed
                  : data.stats.totalYieldDistributed,
            });
          }

          hasLoadedRef.current = true;
          setIsLoading(false);
          setIsRefetching(false);
          return;
        }
      }
    } catch {
      // Non-critical: Fallback cleanly to RPC
    }

    // 2. Fallback Path: Client-Side RPC Batch Query
    try {
      const rpc = client.runtime.rpc;

      // Build range of historical cycle IDs (newest first)
      const cycleIds: number[] = [];
      for (
        let cId = currentDrawCycleId;
        cId >= 0 && cId > currentDrawCycleId - maxCyclesToFetch;
        cId--
      ) {
        cycleIds.push(cId);
      }

      if (cycleIds.length === 0) {
        if (fetchId === fetchIdRef.current) {
          setDrawSummaries([]);
          setStats({
            totalYieldDistributed: 0,
            totalDrawsCompleted: 0,
            totalWinningBonds: 0,
            averagePrizePot: 0,
          });
          hasLoadedRef.current = true;
          setIsLoading(false);
          setIsRefetching(false);
        }
        return;
      }

      // Deriving PDAs for all candidate cycles
      const pdaPairs = await Promise.all(
        cycleIds.map(async (cId) => {
          const drawPda = await findDrawCyclePda(poolId, cId);
          const payoutPda = await findPayoutRegistryPda(poolId, cId);
          return { cycleId: cId, drawPda, payoutPda };
        })
      );

      if (fetchId !== fetchIdRef.current) return;

      const pdaKeys: Address[] = [];
      for (const pair of pdaPairs) {
        pdaKeys.push(pair.drawPda, pair.payoutPda);
      }

      // Chunk requests to safely stay within 100-account RPC limit
      const pdaChunks = chunkArray(pdaKeys, 80);
      const accountsResArrays = await Promise.all(
        pdaChunks.map((chunk) =>
          rpc
            .getMultipleAccounts(chunk, {
              encoding: "base64",
              commitment: "confirmed",
            })
            .send()
        )
      );

      if (fetchId !== fetchIdRef.current) return;

      const accountValues = accountsResArrays.flatMap(
        (res) => res?.value || []
      );

      const summaries: DrawCycleSummary[] = [];
      let totalYield = 0;
      let completedDraws = 0;
      let totalWinningBonds = 0;

      for (let i = 0; i < pdaPairs.length; i++) {
        const drawAcc = accountValues[2 * i];
        const payoutAcc = accountValues[2 * i + 1];

        if (!drawAcc?.data) continue;

        try {
          const drawBytes = new Uint8Array(
            base64Encoder.encode(drawAcc.data[0])
          );
          const drawCycle: DrawCycleInfo = parseDrawCycle(drawBytes);

          let payout: PayoutRegistryInfo | undefined;
          if (payoutAcc?.data) {
            const payoutBytes = new Uint8Array(
              base64Encoder.encode(payoutAcc.data[0])
            );
            payout = parsePayoutRegistry(payoutBytes);
          }

          const summary = formatDrawCycleSummary(drawCycle, payout);
          summaries.push(summary);

          if (summary.status === "Complete") {
            completedDraws++;
            totalYield += summary.prizePot;
            totalWinningBonds += summary.winnersCount;
          }
        } catch {
          // Account parse failure gracefully skipped
        }
      }

      if (fetchId !== fetchIdRef.current) return;

      const lifetimeYield =
        poolTotalPrizesDistributed !== undefined
          ? poolTotalPrizesDistributed
          : totalYield;

      setDrawSummaries(summaries);
      setStats({
        totalYieldDistributed: lifetimeYield,
        totalDrawsCompleted: completedDraws,
        totalWinningBonds,
        averagePrizePot: completedDraws > 0 ? totalYield / completedDraws : 0,
      });
    } catch (err) {
      console.error("useDrawExplorer fetch error:", err);
    } finally {
      if (fetchId === fetchIdRef.current) {
        hasLoadedRef.current = true;
        setIsLoading(false);
        setIsRefetching(false);
      }
    }
  }, [
    client,
    poolId,
    currentDrawCycleId,
    maxCyclesToFetch,
    poolTotalPrizesDistributed,
  ]);

  useEffect(() => {
    fetchDraws();
  }, [fetchDraws]);

  // Listen for custom protocol draw events with scoped filtering
  useProtocolSyncSubscription(fetchDraws, {
    scopes: ["draws"],
    poolId,
    debounceMs: 150,
  });

  return {
    drawSummaries,
    stats,
    isLoading,
    isRefetching,
    refetch: fetchDraws,
  };
}
