import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET, handleGetRedemptions } from "../route";
import {
  createApiRequest,
  assertSuccessResponse,
  assertErrorResponse,
  assertNoCache,
} from "@/app/lib/test-harness";
import type { PendingRedemptionDto } from "@/app/lib/indexer-mappers";

describe("GET /api/indexer/redemptions Route Handler", () => {
  const validUser = "5xYz1234MockUserAddress56789012345678";

  const mockRedemptions: PendingRedemptionDto[] = [
    {
      poolId: 1,
      redemptionId: "101",
      userAddress: validUser,
      redemptionType: "bond_sale",
      amountUsdc: "50000000",
      pstSharesLocked: "50",
      humaRequestId: "req-12345",
      status: "ready",
      requestSignature: "reqSig1234567890abcdef",
      claimSignature: null,
      requestedAt: 1757180000,
      claimedAt: null,
    },
  ];

  it("should return 400 Bad Request when user parameter is missing", async () => {
    const req = createApiRequest("/api/indexer/redemptions?poolId=1");
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should reject user address that is too short (< 32 chars) with 400 Bad Request", async () => {
    const req = createApiRequest("/api/indexer/redemptions?user=shortUser");
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should reject invalid status parameter with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/redemptions?user=${validUser}&status=invalid_status`
    );
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should reject limit parameter exceeding 100 with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/redemptions?user=${validUser}&limit=200`
    );
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400);
  });

  it("should return fallback response when database is unconfigured", async () => {
    const req = createApiRequest(`/api/indexer/redemptions?user=${validUser}`);
    const res = await handleGetRedemptions(req, { isConfigured: false });
    assertNoCache(res);
    const { error } = await assertErrorResponse(
      res,
      200,
      "Database not configured"
    );
    assert.ok(error.length > 0);
  });

  it("should return fallback response gracefully when query execution fails", async () => {
    const req = createApiRequest(`/api/indexer/redemptions?user=${validUser}`);
    const res = await handleGetRedemptions(req, {
      isConfigured: true,
      fetchRedemptions: async () => {
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

  it("should successfully fetch pending redemptions with default parameters and private cache header", async () => {
    const req = createApiRequest(`/api/indexer/redemptions?user=${validUser}`);
    const res = await handleGetRedemptions(req, {
      isConfigured: true,
      fetchRedemptions: async (filters) => {
        assert.strictEqual(filters.user, validUser);
        assert.strictEqual(filters.poolId, 1);
        assert.strictEqual(filters.status, "pending");
        assert.strictEqual(filters.limit, 50);
        return mockRedemptions;
      },
    });
    assertNoCache(res);

    const { data } = await assertSuccessResponse<PendingRedemptionDto[]>(
      res,
      200
    );
    assert.ok(Array.isArray(data));
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].redemptionId, "101");
    assert.strictEqual(data[0].amountUsdc, "50000000");
    assert.strictEqual(data[0].status, "ready");
  });

  it("should accept custom status and limit parameters", async () => {
    const req = createApiRequest(
      `/api/indexer/redemptions?user=${validUser}&status=claimed&limit=10&poolId=2`
    );
    let capturedFilters: unknown = null;
    const res = await handleGetRedemptions(req, {
      isConfigured: true,
      fetchRedemptions: async (filters) => {
        capturedFilters = filters;
        return mockRedemptions;
      },
    });
    assertNoCache(res);
    await assertSuccessResponse(res, 200);
    assert.deepStrictEqual(capturedFilters, {
      user: validUser,
      poolId: 2,
      status: "claimed",
      limit: 10,
    });
  });
});
