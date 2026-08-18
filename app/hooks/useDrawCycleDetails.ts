"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { getBase64Encoder } from "@solana/kit";
import {
  findDrawCyclePda,
  findPayoutRegistryPda,
  parseDrawCycle,
  parsePayoutRegistry,
  DrawCycleInfo,
  PayoutRegistryInfo,
} from "../lib/bonds-sdk";
import {
  formatDrawCycleSummary,
  parseWinnersWithVrf,
} from "../lib/draw-helpers";
import type { DetailedDrawCycle } from "../types";

const base64Encoder = getBase64Encoder();

interface DrawCycleDetailsResult {
  /** Detailed draw cycle with parsed winners and VRF derivations. */
  details: DetailedDrawCycle | null;
  /** Loading state indicator. */
  isLoading: boolean;
  /** Error message if fetch failed. */
  error: string | null;
  /** Refetch function. */
  refetch: () => void;
}

/**
 * On-demand hook for inspecting a specific draw cycle's complete PayoutRegistry.
 * Computes deterministic winning ticket numbers via client-side VRF derivation.
 */
export function useDrawCycleDetails(
  poolId: number,
  cycleId: number | null | undefined,
  userAddress?: string
): DrawCycleDetailsResult {
  const client = useSolanaClient();
  const [details, setDetails] = useState<DetailedDrawCycle | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const fetchDetails = useCallback(async () => {
    if (cycleId === null || cycleId === undefined || cycleId < 0) {
      setDetails(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const rpc = client.runtime.rpc;
      const drawPda = await findDrawCyclePda(poolId, cycleId);
      const payoutPda = await findPayoutRegistryPda(poolId, cycleId);

      const accountsRes = await rpc
        .getMultipleAccounts([drawPda, payoutPda], { encoding: "base64" })
        .send();

      if (fetchId !== fetchIdRef.current) return;

      const drawAcc = accountsRes?.value?.[0];
      const payoutAcc = accountsRes?.value?.[1];

      if (!drawAcc?.data) {
        setDetails(null);
        setError(`Draw cycle #${cycleId} account not found on-chain.`);
        setIsLoading(false);
        return;
      }

      const drawBytes = new Uint8Array(base64Encoder.encode(drawAcc.data[0]));
      const drawCycle: DrawCycleInfo = parseDrawCycle(drawBytes);

      let payout: PayoutRegistryInfo | undefined;
      if (payoutAcc?.data) {
        const payoutBytes = new Uint8Array(
          base64Encoder.encode(payoutAcc.data[0])
        );
        payout = parsePayoutRegistry(payoutBytes);
      }

      const summary = formatDrawCycleSummary(drawCycle, payout);
      const winners = payout
        ? await parseWinnersWithVrf(payout, drawCycle)
        : [];

      let isUserWinner = false;
      let userWinningsTotal = 0;

      if (userAddress) {
        const userMatches = winners.filter(
          (w) => w.winnerAddress.toLowerCase() === userAddress.toLowerCase()
        );
        if (userMatches.length > 0) {
          isUserWinner = true;
          userWinningsTotal = userMatches.reduce(
            (sum, w) => sum + w.amountOwed,
            0
          );
        }
      }

      if (fetchId !== fetchIdRef.current) return;

      setDetails({
        ...summary,
        payoutRegistryStatus:
          payout && payout.status === 1 ? "Voided" : "Active",
        winners,
        isUserWinner,
        userWinningsTotal,
      });
    } catch (err) {
      console.error(
        `useDrawCycleDetails fetch error for cycle #${cycleId}:`,
        err
      );
      if (fetchId === fetchIdRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load draw cycle details."
        );
        setDetails(null);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [client, poolId, cycleId, userAddress]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  return {
    details,
    isLoading,
    error,
    refetch: fetchDetails,
  };
}
