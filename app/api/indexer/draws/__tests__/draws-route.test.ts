import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET, handleGetDraws } from "../route";
import {
  createApiRequest,
  assertSuccessResponse,
  assertErrorResponse,
  assertNoCache,
} from "@/app/lib/test-harness";
import type { DrawCycleSummaryDto } from "@/app/lib/indexer-mappers";
import type { DrawHistoryStats } from "@/app/types";

describe("GET /api/indexer/draws Route Handler", () => {
  const mockDrawsResult = {
    data: [
      {
        poolId: 1,
        cycleId: 42,
        status: "Complete" as const,
        prizePot: 5000000000,
        cycleFeeCollected: 50000000,
        lockedTicketCount: 10000,
        vrfSeedSlot: 123456,
        randomnessAccount: "RandomnessAccount111111111111111111111111",
        vrfSeedHex: "abcdef123456",
        winnersCount: 3,
        payoutsCompleted: 3,
        hasPayoutRegistry: true,
        completedAt: 1757184000,
        initiatedAt: 1757180000,
        revealedAt: 1757182000,
      },
    ],
    meta: {
      page: 1,
      pageSize: 50,
      totalCount: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };

  const mockStats: DrawHistoryStats = {
    totalYieldDistributed: 5000000000,
    totalDrawsCompleted: 1,
    totalWinningBonds: 3,
    averagePrizePot: 5000000000,
  };

  it("should return valid paginated envelope and enforce strict no-cache headers", async () => {
    const req = createApiRequest("/api/indexer/draws?poolId=1&limit=50");
    const res = await handleGetDraws(req, {
      isConfigured: true,
      fetchDraws: async () => mockDrawsResult,
      getPoolStats: async () => mockStats,
    });
    assertNoCache(res);

    const { json, aggregates, data } = await assertSuccessResponse<
      DrawCycleSummaryDto[]
    >(res, 200);
    assert.ok(Array.isArray(data), "data should be an array");
    assert.strictEqual(data.length, 1);
    assert.ok("meta" in json, "meta should exist in json");
    assert.ok("aggregates" in json, "aggregates should exist in json");
    assert.ok(aggregates, "aggregates should not be null or undefined");
    assert.strictEqual(typeof aggregates?.totalYieldDistributed, "number");
    assert.strictEqual(typeof aggregates?.totalDrawsCompleted, "number");
    assert.strictEqual(typeof aggregates?.totalWinningBonds, "number");
    assert.strictEqual(typeof aggregates?.averagePrizePot, "number");
  });

  it("should reject limit parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const reqOverLimit = createApiRequest(
      "/api/indexer/draws?poolId=1&limit=500"
    );
    const res = await GET(reqOverLimit);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should accept valid limit parameter up to 100 with 200 OK", async () => {
    const reqMaxValid = createApiRequest(
      "/api/indexer/draws?poolId=1&limit=100&page=1"
    );
    const res = await handleGetDraws(reqMaxValid, {
      isConfigured: true,
      fetchDraws: async (filters) => {
        assert.strictEqual(filters.limit, 100);
        return {
          ...mockDrawsResult,
          meta: { ...mockDrawsResult.meta, pageSize: 100 },
        };
      },
      getPoolStats: async () => mockStats,
    });
    assertNoCache(res);
    const { data } = await assertSuccessResponse<DrawCycleSummaryDto[]>(
      res,
      200
    );
    assert.ok(data.length <= 100);
  });

  it("should default to poolId 1 when query param is omitted", async () => {
    const req = createApiRequest("/api/indexer/draws");
    let queriedPoolId: number | null = null;
    const res = await handleGetDraws(req, {
      isConfigured: true,
      fetchDraws: async (filters) => {
        queriedPoolId = filters.poolId;
        return mockDrawsResult;
      },
      getPoolStats: async (poolId) => {
        assert.strictEqual(poolId, 1);
        return mockStats;
      },
    });
    assertNoCache(res);
    await assertSuccessResponse(res, 200);
    assert.strictEqual(queriedPoolId, 1);
  });

  it("should return fallback response when database is unconfigured", async () => {
    const req = createApiRequest("/api/indexer/draws");
    const res = await handleGetDraws(req, { isConfigured: false });
    assertNoCache(res);
    const { error } = await assertErrorResponse(
      res,
      200,
      "Database not configured"
    );
    assert.ok(error.length > 0);
  });

  it("should return fallback response gracefully when query execution fails", async () => {
    const req = createApiRequest("/api/indexer/draws");
    const res = await handleGetDraws(req, {
      isConfigured: true,
      fetchDraws: async () => {
        throw new Error("Simulated database timeout");
      },
    });
    assertNoCache(res);
    const { error } = await assertErrorResponse(
      res,
      200,
      "Simulated database timeout"
    );
    assert.ok(error.length > 0);
  });
});
