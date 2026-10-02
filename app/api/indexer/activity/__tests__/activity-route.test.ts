import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET, handleGetActivity } from "../route";
import {
  encodeKeysetCursor,
  type KeysetCursor,
} from "@/app/types/indexer-contracts";
import {
  createApiRequest,
  assertSuccessResponse,
  assertErrorResponse,
  assertNoCache,
} from "@/app/lib/test-harness";
import type { ActivityEntry } from "@/app/types";

describe("GET /api/indexer/activity Route Handler", () => {
  const validUser = "5xYz1234MockUserAddress56789012345678";

  const mockMockActivityResult = (limit = 20) => ({
    data: [
      {
        id: "evt-deposit-tx123456-0",
        date: new Date(1757184000 * 1000).toISOString(),
        type: "deposit" as const,
        description: "Deposited 100 USDC (100 bonds)",
        amount: 100,
        txSignature: "tx1234567890abcdef",
        metadata: {
          bonds: 100,
          cycleId: 1,
          amountUsdc: 100,
        },
      },
    ],
    meta: {
      limit,
      nextCursor: "mockNextCursor" as KeysetCursor,
      hasMore: false,
    },
  });

  it("should return 400 Bad Request when user parameter is missing", async () => {
    const req = createApiRequest("/api/indexer/activity");
    const res = await GET(req);
    assertNoCache(res);
    const { error } = await assertErrorResponse(res, 400);
    assert.strictEqual(typeof error, "string");
    assert.ok(error.length > 0, "Error description must not be empty");
  });

  it("should reject limit parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/activity?user=${validUser}&limit=250`
    );
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should reject user address that is too short (< 32 chars) with 400 Bad Request", async () => {
    const req = createApiRequest("/api/indexer/activity?user=shortUser");
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should reject invalid activity type filter with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/activity?user=${validUser}&type=invalid-type`
    );
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should return fallback response when database is unconfigured", async () => {
    const req = createApiRequest(`/api/indexer/activity?user=${validUser}`);
    const res = await handleGetActivity(req, { isConfigured: false });
    assertNoCache(res);
    const { error } = await assertErrorResponse(
      res,
      200,
      "Database not configured"
    );
    assert.ok(error.length > 0);
  });

  it("should return fallback response gracefully when query execution fails", async () => {
    const req = createApiRequest(`/api/indexer/activity?user=${validUser}`);
    const res = await handleGetActivity(req, {
      isConfigured: true,
      fetchActivity: async () => {
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

  it("should successfully fetch activity with default parameters and private cache header", async () => {
    const req = createApiRequest(`/api/indexer/activity?user=${validUser}`);
    const res = await handleGetActivity(req, {
      isConfigured: true,
      fetchActivity: async (filters) => {
        assert.strictEqual(filters.user, validUser);
        assert.strictEqual(filters.limit, 20);
        return mockMockActivityResult(20);
      },
    });
    assertNoCache(res);

    const { data, meta } = await assertSuccessResponse<ActivityEntry[]>(
      res,
      200
    );
    assert.ok(
      Array.isArray(data),
      "Response data field must be an array of activity records"
    );
    assert.ok(meta, "Response must include pagination metadata");
    assert.strictEqual(
      meta.limit,
      20,
      "Default pagination limit must equal 20"
    );
    assert.strictEqual(
      typeof meta.hasMore,
      "boolean",
      "Pagination hasMore must be a boolean flag"
    );
  });

  it("should accept valid keyset cursor, type, and search filters", async () => {
    const cursor = encodeKeysetCursor(1757184000, 100);
    const req = createApiRequest(
      `/api/indexer/activity?user=${validUser}&limit=10&type=deposit&search=%2342&cursor=${cursor}`
    );
    let capturedFilters: unknown = null;
    const res = await handleGetActivity(req, {
      isConfigured: true,
      fetchActivity: async (filters) => {
        capturedFilters = filters;
        return mockMockActivityResult(10);
      },
    });
    assertNoCache(res);
    const { meta } = await assertSuccessResponse(res, 200);
    assert.ok(meta, "meta should be present");
    assert.strictEqual(
      meta?.limit,
      10,
      "Response meta limit must reflect custom parameter (10)"
    );
    assert.deepStrictEqual(capturedFilters, {
      user: validUser,
      poolId: 1,
      limit: 10,
      cursor,
      type: "deposit",
      search: "#42",
    });
  });

  it("should handle malformed cursor strings gracefully without throwing uncaught error", async () => {
    const req = createApiRequest(
      `/api/indexer/activity?user=${validUser}&cursor=not-a-valid-cursor`
    );
    const res = await handleGetActivity(req, {
      isConfigured: true,
      fetchActivity: async (filters) => {
        assert.strictEqual(filters.cursor, "not-a-valid-cursor");
        return mockMockActivityResult(20);
      },
    });
    assertNoCache(res);
    await assertSuccessResponse(res, 200);
  });
});
