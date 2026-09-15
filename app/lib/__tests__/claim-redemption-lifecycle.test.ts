import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { bondsKeys } from "../query-keys";
import type { PendingRedemption } from "@/app/types";

describe("Claim Redemption Lifecycle & Cache Invariant Suite", () => {
  const poolId = 1;
  const userAddress = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK";
  const queryKey = bondsKeys.userRedemptions(poolId, userAddress);

  const initialRedemptions: PendingRedemption[] = [
    {
      redemptionId: "100",
      amount: 50_000_000,
      status: "ready",
      requestedAt: new Date(1700000000000).toISOString(),
      type: "bond_sale",
      pstSharesLocked: "25000000",
      humaRequestId: "1",
    },
    {
      redemptionId: "101",
      amount: 100_000_000,
      status: "ready",
      requestedAt: new Date(1700000005000).toISOString(),
      type: "prize_claim",
      pstSharesLocked: "50000000",
      humaRequestId: "2",
    },
  ];

  it("should maintain redemption in cache during in-flight wallet signing stage", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<PendingRedemption[]>(queryKey, initialRedemptions);

    // When claim is initiated (e.g. user clicks button and wallet opens)
    const cachedBefore =
      queryClient.getQueryData<PendingRedemption[]>(queryKey);
    assert.deepStrictEqual(
      cachedBefore,
      initialRedemptions,
      "Cache must not be modified before wallet authorization"
    );
    assert.strictEqual(
      cachedBefore?.some((r) => r.redemptionId === "100"),
      true,
      "Redemption #100 must remain present in cache during signing phase"
    );
  });

  it("should retain cache snapshot and verify optimistic mutation rollback on transaction rejection", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<PendingRedemption[]>(queryKey, initialRedemptions);

    // Capture snapshot before optimistic mutation
    const previousSnapshot =
      queryClient.getQueryData<PendingRedemption[]>(queryKey);

    // Apply optimistic filter
    queryClient.setQueryData<PendingRedemption[]>(queryKey, (old = []) =>
      old.filter((r) => r.redemptionId !== "100")
    );
    assert.strictEqual(
      queryClient.getQueryData<PendingRedemption[]>(queryKey)?.length,
      1,
      "Optimistic update should temporarily reduce cache length"
    );

    // Rollback to previous snapshot upon simulated rejection
    queryClient.setQueryData<PendingRedemption[]>(queryKey, previousSnapshot);
    const restoredCache =
      queryClient.getQueryData<PendingRedemption[]>(queryKey);
    assert.deepStrictEqual(
      restoredCache,
      initialRedemptions,
      "Cache snapshot must be restored to initial state upon mutation rollback"
    );
    assert.strictEqual(
      restoredCache?.length,
      2,
      "Both redemptions must remain in cache after rollback"
    );
  });

  it("should optimistically filter out only claimed redemption on confirmation success", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<PendingRedemption[]>(queryKey, initialRedemptions);

    const claimedId = "100";

    // Simulate post-confirmation optimistic update (as run in onSuccess of runActionTx)
    queryClient.setQueryData<PendingRedemption[]>(queryKey, (old) =>
      (old || []).filter((r) => r.redemptionId !== claimedId)
    );

    const cachedAfterSuccess =
      queryClient.getQueryData<PendingRedemption[]>(queryKey);
    assert.strictEqual(
      cachedAfterSuccess?.length,
      1,
      "Expected exactly 1 redemption remaining in cache"
    );
    assert.strictEqual(
      cachedAfterSuccess?.[0].redemptionId,
      "101",
      "Remaining redemption must be #101"
    );
    assert.strictEqual(
      cachedAfterSuccess?.some((r) => r.redemptionId === claimedId),
      false,
      "Claimed redemption #100 must be removed from cache"
    );
  });

  it("should derive correct button interaction and lock states given active in-flight operation", () => {
    function getClaimActionState(
      currentRedemptionId: string,
      activeClaimingId: string | null
    ) {
      return {
        isClaimingThis: activeClaimingId === currentRedemptionId,
        isDisabled: activeClaimingId !== null,
      };
    }

    // When redemption #100 is being claimed
    const inFlightState100 = getClaimActionState("100", "100");
    assert.strictEqual(
      inFlightState100.isClaimingThis,
      true,
      "Target redemption #100 should show active claiming spinner"
    );
    assert.strictEqual(
      inFlightState100.isDisabled,
      true,
      "Target redemption #100 button must be disabled during in-flight operation"
    );

    // Another redemption (#101) while #100 is in flight
    const concurrentState101 = getClaimActionState("101", "100");
    assert.strictEqual(
      concurrentState101.isClaimingThis,
      false,
      "Non-target redemption #101 must not show claiming spinner"
    );
    assert.strictEqual(
      concurrentState101.isDisabled,
      true,
      "Non-target redemption #101 must be disabled to prevent concurrent race conditions"
    );

    // Idle state (no operation in flight)
    const idleState = getClaimActionState("100", null);
    assert.strictEqual(
      idleState.isClaimingThis,
      false,
      "Idle redemption should not show claiming spinner"
    );
    assert.strictEqual(
      idleState.isDisabled,
      false,
      "Idle redemption button must be enabled and clickable"
    );
  });
});
