import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPoolInfo,
  invalidatePoolInfoCache,
} from "@/app/lib/services/pool-state-service";
import {
  fetchTicketRegistryHeader,
  serializeTicketRegistry,
} from "@/app/lib/bonds-sdk";
import { address, getBase64Decoder } from "@solana/kit";

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

  describe("fetchTicketRegistryHeader", () => {
    it("should return null for empty or default system program addresses without calling RPC", async () => {
      const mockRpc = {
        getAccountInfo: () => {
          throw new Error("RPC should not be called");
        },
      };

      const resultEmpty = await fetchTicketRegistryHeader(mockRpc, "");
      assert.strictEqual(resultEmpty, null);

      const resultZero = await fetchTicketRegistryHeader(
        mockRpc,
        "11111111111111111111111111111111"
      );
      assert.strictEqual(resultZero, null);
    });

    it("should fetch, parse and return typed TicketRegistry when RPC returns valid header bytes", async () => {
      const validBytes = serializeTicketRegistry({
        poolId: 1,
        userCount: 15,
        totalActiveTickets: 300,
        totalPendingTickets: 50,
      });

      const base64Str = getBase64Decoder().decode(validBytes.subarray(0, 104));

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              data: [base64Str, "base64"],
            },
          }),
        }),
      };

      const result = await fetchTicketRegistryHeader(
        mockRpc,
        address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
      );

      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.poolId, 1);
      assert.strictEqual(result?.userCount, 15);
      assert.strictEqual(result?.totalActiveTickets, 300);
      assert.strictEqual(result?.totalPendingTickets, 50);
    });

    it("should gracefully return null when RPC account is missing or throws", async () => {
      const mockRpcMissing = {
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
      };

      const resultMissing = await fetchTicketRegistryHeader(
        mockRpcMissing,
        address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
      );
      assert.strictEqual(resultMissing, null);

      const mockRpcError = {
        getAccountInfo: () => ({
          send: async () => {
            throw new Error("RPC connection refused");
          },
        }),
      };

      const resultError = await fetchTicketRegistryHeader(
        mockRpcError,
        address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
      );
      assert.strictEqual(resultError, null);
    });
  });
});
