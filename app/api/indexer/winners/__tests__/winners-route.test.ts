import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET, handleGetWinners } from "../route";
import {
  createApiRequest,
  assertSuccessResponse,
  assertErrorResponse,
  assertPrivateNoCache,
  assertNoCache,
} from "@/app/lib/test-harness";
import type { PrizeHistoryEntryDto } from "@/app/lib/indexer-mappers";

describe("GET /api/indexer/winners Route Handler", () => {
  const validUser = "5xYz1234MockUserAddress56789012345678";

  const mockWinnersResult = {
    data: [
      {
        poolId: 1,
        cycleId: 42,
        winnerIndex: 0,
        winnerAddress: validUser,
        tierIndex: 0,
        amountOwed: "1000000000",
        winningTicketIdx: "12345",
        processed: true,
        bondsBought: "1000",
        dustAccumulated: "0",
        claimSignature: "sig1234567890abcdef",
        revealedAt: 1757184000,
        vrfSeedHex: "abcdef123456",
      },
    ],
    meta: {
      page: 1,
      pageSize: 10,
      totalCount: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    aggregates: {
      totalFilteredValue: "1000000000",
    },
  };

  it("should reject pageSize parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/winners?user=${validUser}&pageSize=500`
    );
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should reject invalid status filter with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/winners?user=${validUser}&status=unknown_status`
    );
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should reject invalid tierIndex filter with 400 Bad Request", async () => {
    const reqInvalidString = createApiRequest(
      `/api/indexer/winners?user=${validUser}&tierIndex=mythic`
    );
    const resInvalidString = await GET(reqInvalidString);
    assertNoCache(resInvalidString);
    await assertErrorResponse(resInvalidString, 400);

    const reqOutOfBounds = createApiRequest(
      `/api/indexer/winners?user=${validUser}&tierIndex=10`
    );
    const resOutOfBounds = await GET(reqOutOfBounds);
    assertNoCache(resOutOfBounds);
    await assertErrorResponse(resOutOfBounds, 400);
  });

  it("should return fallback response when database is unconfigured", async () => {
    const req = createApiRequest(`/api/indexer/winners?user=${validUser}`);
    const res = await handleGetWinners(req, { isConfigured: false });
    assertNoCache(res);
    const { error } = await assertErrorResponse(
      res,
      200,
      "Database not configured"
    );
    assert.ok(error.length > 0);
  });

  it("should return fallback response gracefully when query execution fails", async () => {
    const req = createApiRequest(`/api/indexer/winners?user=${validUser}`);
    const res = await handleGetWinners(req, {
      isConfigured: true,
      fetchWinners: async () => {
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

  it("should successfully fetch winners for user with private cache header and structured envelope", async () => {
    const req = createApiRequest(`/api/indexer/winners?user=${validUser}`);
    const res = await handleGetWinners(req, {
      isConfigured: true,
      fetchWinners: async (filters) => {
        assert.strictEqual(filters.user, validUser);
        return mockWinnersResult;
      },
    });
    assertPrivateNoCache(res);

    const { data, meta, aggregates } = await assertSuccessResponse<
      PrizeHistoryEntryDto[]
    >(res, 200);
    assert.ok(Array.isArray(data));
    assert.strictEqual(data.length, 1);
    assert.ok(meta);
    assert.strictEqual(meta.page, 1);
    assert.strictEqual(meta.pageSize, 10);
    assert.ok(aggregates);
    assert.strictEqual(aggregates.totalFilteredValue, "1000000000");
  });

  it("should return public cache header when user param is omitted", async () => {
    const req = createApiRequest(
      "/api/indexer/winners?poolId=1&page=1&pageSize=10"
    );
    const res = await handleGetWinners(req, {
      isConfigured: true,
      fetchWinners: async (filters) => {
        assert.strictEqual(filters.user, undefined);
        return mockWinnersResult;
      },
    });
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      "public, s-maxage=10, stale-while-revalidate=30"
    );
    await assertSuccessResponse(res, 200);
  });

  it("should accept valid status, tierIndex, and search filters", async () => {
    const req = createApiRequest(
      `/api/indexer/winners?user=${validUser}&status=processing&tierIndex=0&search=%231`
    );
    let capturedFilters: unknown = null;
    const res = await handleGetWinners(req, {
      isConfigured: true,
      fetchWinners: async (filters) => {
        capturedFilters = filters;
        return mockWinnersResult;
      },
    });
    assertNoCache(res);
    await assertSuccessResponse(res, 200);
    assert.deepStrictEqual(capturedFilters, {
      user: validUser,
      poolId: 1,
      cycleId: undefined,
      page: 1,
      pageSize: 10,
      status: "processing",
      tierIndex: 0,
      search: "#1",
    });
  });
});
