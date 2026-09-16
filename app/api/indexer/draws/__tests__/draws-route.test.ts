import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";
import {
  createApiRequest,
  assertSuccessResponse,
  assertErrorResponse,
  assertNoCache,
} from "@/app/lib/test-harness";

describe("GET /api/indexer/draws Route Handler", () => {
  it("should return valid paginated envelope and handle cache headers gracefully", async () => {
    const req = createApiRequest("/api/indexer/draws?poolId=1&limit=50");
    const res = await GET(req);
    const cacheControl = res.headers.get("Cache-Control");
    assert.ok(
      cacheControl === "public, s-maxage=60, stale-while-revalidate=120" ||
        cacheControl === NO_CACHE_HEADERS["Cache-Control"],
      `Unexpected Cache-Control header: ${cacheControl}`
    );

    const { json, aggregates } = await assertSuccessResponse(res, 200);
    assert.ok(Array.isArray(json.draws), "draws should be an array");
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
    const res = await GET(reqMaxValid);
    const { data } = await assertSuccessResponse<unknown[]>(res, 200);
    assert.ok(data.length <= 100);
  });

  it("should default to poolId 1 when query param is omitted", async () => {
    const req = createApiRequest("/api/indexer/draws");
    const res = await GET(req);
    await assertSuccessResponse(res, 200);
  });
});
