"use client";

import { useBondsContract } from "@/app/hooks/useBondsContract";
import { useClusterTime } from "@/app/hooks/useOnChainClock";
import { useProtocolSync } from "@/app/hooks/useProtocolSync";

/**
 * Headless protocol synchronization orchestrator.
 * Mounted once at the dashboard layout boundary to drive real-time background
 * reactivity across all dashboard tabs without spawning duplicate timers.
 */
export function ProtocolSyncCoordinator() {
  const { pool, pendingRedemptions } = useBondsContract();
  const { now } = useClusterTime({ tick: true, tickIntervalMs: 2000 });

  const isFrozenForDraw = pool?.isFrozenForDraw ?? false;
  const isAwaitingDraw =
    !!pool &&
    pool.currentCycleEndAt > 0 &&
    now >= pool.currentCycleEndAt &&
    pool.status === "Active";

  const hasSettlingRedemptions = pendingRedemptions.some(
    (r) => r.status === "settling"
  );

  useProtocolSync({
    isFrozenForDraw,
    isAwaitingDraw,
    hasSettlingRedemptions,
  });

  return null;
}
