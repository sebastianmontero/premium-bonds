import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import {
  createApiRequest,
  assertSuccessResponse,
  assertErrorResponse,
  assertPrivateNoCache,
} from "@/app/lib/test-harness";
import type { PrizeHistoryEntryDto } from "@/app/lib/indexer-mappers";

describe("GET /api/indexer/winners Route Handler", () => {
  const validUser = "5xYz1234MockUserAddress56789012345678";

  it("should reject pageSize parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/winners?user=${validUser}&pageSize=500`
    );
    const res = await GET(req);
    await assertErrorResponse(res, 400);
  });

  it("should reject invalid status filter with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/winners?user=${validUser}&status=unknown_status`
    );
    const res = await GET(req);
    await assertErrorResponse(res, 400);
  });

  it("should reject invalid tier filter with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/winners?user=${validUser}&tier=mythic`
    );
    const res = await GET(req);
    await assertErrorResponse(res, 400);
  });

  it("should successfully fetch winners for user with private cache header and structured envelope", async () => {
    const req = createApiRequest(`/api/indexer/winners?user=${validUser}`);
    const res = await GET(req);
    assertPrivateNoCache(res);

    const { data, meta, aggregates } = await assertSuccessResponse<
      PrizeHistoryEntryDto[]
    >(res, 200);
    assert.ok(Array.isArray(data));
    assert.ok(meta);
    assert.strictEqual(meta.page, 1);
    assert.strictEqual(meta.pageSize, 10);
    assert.ok(aggregates);
    assert.strictEqual(typeof aggregates.totalFilteredValue, "string");
  });

  it("should return public cache header when user param is omitted", async () => {
    const req = createApiRequest(
      "/api/indexer/winners?poolId=1&page=1&pageSize=10"
    );
    const res = await GET(req);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      "public, s-maxage=10, stale-while-revalidate=30"
    );
    await assertSuccessResponse(res, 200);
  });

  it("should accept valid status, tier, and search filters", async () => {
    const req = createApiRequest(
      `/api/indexer/winners?user=${validUser}&status=processing&tier=grand&search=%231`
    );
    const res = await GET(req);
    await assertSuccessResponse(res, 200);
  });
});
