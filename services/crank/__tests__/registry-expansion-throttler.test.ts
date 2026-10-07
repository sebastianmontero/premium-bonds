import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RegistryExpansionThrottler,
  calculateDynamicHourlyLimit,
} from "../workers/registry-expansion-throttler";

describe("RegistryExpansionThrottler Unit Tests", () => {
  it("should correctly identify RPC settle propagation delay", () => {
    let mockTime = 1_000_000;
    const throttler = new RegistryExpansionThrottler(
      {
        rpcCooldownMs: 15_000,
        maxExpansionsPerHour: 24,
        alertCooldownMs: 30 * 60 * 1000,
      },
      () => mockTime
    );

    // Initial state: not awaiting
    assert.strictEqual(throttler.isAwaitingRpcPropagation(1, 4096), false);
    assert.strictEqual(throttler.getRpcWaitRemainingSeconds(1), 0);

    // Record expansion targeting 4256 slots
    throttler.recordExpansion(1, 4256);

    // Immediate next query with stale capacity 4096
    assert.strictEqual(throttler.isAwaitingRpcPropagation(1, 4096), true);
    assert.strictEqual(throttler.getRpcWaitRemainingSeconds(1), 15);

    // Advance 5 seconds: still awaiting
    mockTime += 5000;
    assert.strictEqual(throttler.isAwaitingRpcPropagation(1, 4096), true);
    assert.strictEqual(throttler.getRpcWaitRemainingSeconds(1), 10);

    // Capacity observed as 4256 (RPC caught up): no longer awaiting even within 15s window
    assert.strictEqual(throttler.isAwaitingRpcPropagation(1, 4256), false);

    // Stale capacity again, but 15s elapsed: no longer awaiting
    mockTime += 10001; // total 15001ms elapsed
    assert.strictEqual(throttler.isAwaitingRpcPropagation(1, 4096), false);
    assert.strictEqual(throttler.getRpcWaitRemainingSeconds(1), 0);
  });

  it("should calculate dynamic hourly limit and enforce sliding window budget without mutating in queries", () => {
    // Dynamic hourly limit calculation
    assert.strictEqual(calculateDynamicHourlyLimit(320, 24), 24); // ceil(320/160)+4 = 6 <= 24 -> 24
    assert.strictEqual(calculateDynamicHourlyLimit(4800, 24), 34); // ceil(4800/160)+4 = 30+4 = 34 > 24 -> 34

    let mockTime = 1_000_000;
    const throttler = new RegistryExpansionThrottler(
      {
        rpcCooldownMs: 15_000,
        maxExpansionsPerHour: 3,
        alertCooldownMs: 30 * 60 * 1000,
      },
      () => mockTime
    );

    // Record 3 expansions within the hour
    throttler.recordExpansion(1, 4256);
    mockTime += 1000;
    throttler.recordExpansion(1, 4416);
    mockTime += 1000;
    throttler.recordExpansion(1, 4576);

    // Should be rate limited (3 expansions in sliding window for headroom threshold 320 -> limit 6)
    // For maxExpansionsPerHour = 3 and threshold = 160: catchup 1 + 4 = 5 > 3 -> effective limit 5
    assert.strictEqual(throttler.isHourlyRateLimited(1, 160), false); // 3 < 5

    // Add 2 more to hit limit 5
    mockTime += 1000;
    throttler.recordExpansion(1, 4736);
    mockTime += 1000;
    throttler.recordExpansion(1, 4896);

    // Query multiple times: pure query must not mutate state
    assert.strictEqual(throttler.isHourlyRateLimited(1, 160), true);
    assert.strictEqual(throttler.isHourlyRateLimited(1, 160), true);

    // Advance 61 minutes from start: all 5 previous expansions roll out of window on next record
    mockTime += 61 * 60 * 1000;
    assert.strictEqual(throttler.isHourlyRateLimited(1, 160), false);

    // Record new expansion: prunes expired entries
    throttler.recordExpansion(1, 5056);
    assert.strictEqual(throttler.isHourlyRateLimited(1, 160), false);
  });

  it("should isolate alert categories and prevent cross-alert suppression", () => {
    let mockTime = 1_000_000;
    const throttler = new RegistryExpansionThrottler(
      {
        rpcCooldownMs: 15_000,
        maxExpansionsPerHour: 24,
        alertCooldownMs: 30 * 60 * 1000, // 30 min
      },
      () => mockTime
    );

    // Initially all categories can alert
    assert.strictEqual(throttler.shouldAlert(1, "LOW_SOL_BALANCE"), true);
    assert.strictEqual(throttler.shouldAlert(1, "EXPANSION_RATE_LIMIT"), true);
    assert.strictEqual(
      throttler.shouldAlert(1, "REGISTRY_CAPACITY_CRITICAL"),
      true
    );

    // Record LOW_SOL_BALANCE alert
    throttler.recordAlert(1, "LOW_SOL_BALANCE");

    // LOW_SOL_BALANCE is suppressed for 30m
    assert.strictEqual(throttler.shouldAlert(1, "LOW_SOL_BALANCE"), false);

    // CRITICAL ceiling alert and RATE LIMIT alert are NOT suppressed
    assert.strictEqual(
      throttler.shouldAlert(1, "REGISTRY_CAPACITY_CRITICAL"),
      true
    );
    assert.strictEqual(throttler.shouldAlert(1, "EXPANSION_RATE_LIMIT"), true);

    // Advance 31 minutes: LOW_SOL_BALANCE can alert again
    mockTime += 31 * 60 * 1000;
    assert.strictEqual(throttler.shouldAlert(1, "LOW_SOL_BALANCE"), true);
  });

  it("should maintain pool isolation on reset", () => {
    const throttler = new RegistryExpansionThrottler({
      rpcCooldownMs: 15_000,
      maxExpansionsPerHour: 24,
      alertCooldownMs: 30 * 60 * 1000,
    });

    throttler.recordExpansion(1, 4256);
    throttler.recordExpansion(2, 4256);
    throttler.recordAlert(1, "LOW_SOL_BALANCE");
    throttler.recordAlert(2, "LOW_SOL_BALANCE");

    // Reset only pool 1
    throttler.reset(1);

    assert.strictEqual(throttler.isAwaitingRpcPropagation(1, 4096), false);
    assert.strictEqual(throttler.shouldAlert(1, "LOW_SOL_BALANCE"), true);

    // Pool 2 remains throttled/alerted
    assert.strictEqual(throttler.isAwaitingRpcPropagation(2, 4096), true);
    assert.strictEqual(throttler.shouldAlert(2, "LOW_SOL_BALANCE"), false);

    // Global reset
    throttler.reset();
    assert.strictEqual(throttler.isAwaitingRpcPropagation(2, 4096), false);
    assert.strictEqual(throttler.shouldAlert(2, "LOW_SOL_BALANCE"), true);
  });
});
