import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";

describe("GET /api/indexer/draws Route Handler", () => {
  it("should return valid paginated envelope and handle cache headers gracefully", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/indexer/draws?poolId=1&limit=50"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);

    const cacheControl = res.headers.get("Cache-Control");
    assert.ok(
      cacheControl === "public, s-maxage=60, stale-while-revalidate=120" ||
        cacheControl === NO_CACHE_HEADERS["Cache-Control"],
      `Unexpected Cache-Control header: ${cacheControl}`
    );

    const json = await res.json();
    assert.ok(Array.isArray(json.draws), "draws should be an array");
    assert.ok("meta" in json, "meta should exist in json");
    assert.ok("aggregates" in json, "aggregates should exist in json");
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.fallbackRequired, false);

    if (json.aggregates !== null) {
      assert.strictEqual(
        typeof json.aggregates.totalYieldDistributed,
        "number"
      );
      assert.strictEqual(typeof json.aggregates.totalDrawsCompleted, "number");
      assert.strictEqual(typeof json.aggregates.totalWinningBonds, "number");
      assert.strictEqual(typeof json.aggregates.averagePrizePot, "number");
    }
  });

  it("should reject limit parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const reqOverLimit = new NextRequest(
      "http://localhost:3000/api/indexer/draws?poolId=1&limit=500"
    );
    const res = await GET(reqOverLimit);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"]
    );
    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.fallbackRequired, true);
  });

  it("should accept valid limit parameter up to 100 with 200 OK", async () => {
    const reqMaxValid = new NextRequest(
      "http://localhost:3000/api/indexer/draws?poolId=1&limit=100&page=1"
    );
    const res = await GET(reqMaxValid);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(json.data.length <= 100);
  });

  it("should default to poolId 1 when query param is omitted", async () => {
    const req = new NextRequest("http://localhost:3000/api/indexer/draws");
    const res = await GET(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
  });
});
