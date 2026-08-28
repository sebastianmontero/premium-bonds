"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useBondsContract } from "@/app/hooks/useBondsContract";
import { useClusterTime } from "@/app/hooks/useOnChainClock";
import { useProtocolSync } from "@/app/hooks/useProtocolSync";
import { useProtocolPushSync } from "@/app/hooks/useProtocolPushSync";

/**
 * Headless protocol synchronization orchestrator.
 * Mounted once at the dashboard layout boundary to drive real-time background
 * reactivity across all dashboard tabs without spawning duplicate timers.
 */
export function ProtocolSyncCoordinator() {
  const { wallet } = useWalletConnection();
  const address = wallet?.account.address.toString();
  const { isConnected: isPushConnected } = useProtocolPushSync(address);

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
    ambientIntervalMs: isPushConnected ? 90000 : 18000,
  });

  return null;
}
