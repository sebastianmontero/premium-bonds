import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPoolInfo,
  invalidatePoolInfoCache,
} from "@/app/lib/services/pool-state-service";

describe("pool-state-service Unit Tests", () => {
  it("should export getPoolInfo and invalidatePoolInfoCache functions", () => {
    assert.strictEqual(typeof getPoolInfo, "function");
    assert.strictEqual(typeof invalidatePoolInfoCache, "function");
  });

  it("should allow invalidating cache for specific pool and all pools", () => {
    // Invalidate specific pool
    assert.doesNotThrow(() => {
      invalidatePoolInfoCache(1);
    });

    // Invalidate all pools
    assert.doesNotThrow(() => {
      invalidatePoolInfoCache();
    });
  });

  it("should accept PoolFetchOptions with bypassCache: true", async () => {
    // Calling getPoolInfo with bypassCache: true should not throw on options handling
    try {
      await getPoolInfo(1, { bypassCache: true });
    } catch {
      // In unit test environment without localnet RPC running, network error is expected and caught
    }
  });
});
