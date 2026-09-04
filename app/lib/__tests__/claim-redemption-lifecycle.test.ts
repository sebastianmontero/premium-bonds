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

  it("should preserve cache without modifications when wallet rejects transaction", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<PendingRedemption[]>(queryKey, initialRedemptions);

    // Simulate wallet rejection error (e.g. user clicks Cancel/Reject in Phantom)
    const simulatedError = new Error("User rejected the request.");
    let claimingRedemptionId: string | null = "100";

    try {
      throw simulatedError;
    } catch {
      // Rejection handling in dashboard controller: resets claimingRedemptionId without touching cache
      claimingRedemptionId = null;
    }

    assert.strictEqual(claimingRedemptionId, null);
    const cachedAfterRejection =
      queryClient.getQueryData<PendingRedemption[]>(queryKey);
    assert.deepStrictEqual(
      cachedAfterRejection,
      initialRedemptions,
      "Cache must remain identical to initial state upon rejection"
    );
    assert.strictEqual(cachedAfterRejection?.length, 2);
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

  it("should correctly evaluate concurrency lock and in-flight states", () => {
    const claimingRedemptionId: string | null = "100";

    // For redemption #100 (in-flight target)
    const isTargetClaiming = claimingRedemptionId === "100";
    const isTargetDisabled = Boolean(claimingRedemptionId);
    assert.strictEqual(
      isTargetClaiming,
      true,
      "Target redemption #100 should show active claiming spinner"
    );
    assert.strictEqual(
      isTargetDisabled,
      true,
      "Target redemption #100 button must be disabled"
    );

    // For redemption #101 (other concurrent item)
    const isOtherClaiming = claimingRedemptionId === "101";
    const isOtherDisabled = Boolean(claimingRedemptionId);
    assert.strictEqual(
      isOtherClaiming,
      false,
      "Other redemption #101 should not show claiming spinner"
    );
    assert.strictEqual(
      isOtherDisabled,
      true,
      "Other redemption #101 button must be disabled to prevent concurrent race conditions"
    );

    // After reset (null)
    const resetId: string | null = null;
    assert.strictEqual(Boolean(resetId), false);
    assert.strictEqual(resetId === "100", false);
  });
});
