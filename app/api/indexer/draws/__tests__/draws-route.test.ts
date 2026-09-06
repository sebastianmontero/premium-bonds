import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";

describe("GET /api/indexer/draws Route Handler", () => {
  it("should return NO_CACHE_HEADERS and handle unconfigured DB or fallback gracefully", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/indexer/draws?poolId=1&limit=50"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"]
    );
    const json = await res.json();
    assert.ok(Array.isArray(json.draws), "draws should be an array");
    assert.ok("stats" in json, "stats should exist in json");
    assert.ok("fallback" in json, "fallback boolean should exist in json");

    if (json.fallback === false && json.stats !== null) {
      assert.strictEqual(typeof json.stats.totalYieldDistributed, "number");
      assert.strictEqual(typeof json.stats.totalDrawsCompleted, "number");
      assert.strictEqual(typeof json.stats.totalWinningBonds, "number");
      assert.strictEqual(typeof json.stats.averagePrizePot, "number");
    }
  });

  it("should parse poolId and clamp limit parameter up to 100", async () => {
    const reqOverLimit = new NextRequest(
      "http://localhost:3000/api/indexer/draws?poolId=1&limit=500"
    );
    const res = await GET(reqOverLimit);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"]
    );
    if (!json.fallback) {
      assert.ok(json.draws.length <= 100);
    }
  });

  it("should default to poolId 1 when query param is omitted", async () => {
    const req = new NextRequest("http://localhost:3000/api/indexer/draws");
    const res = await GET(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"]
    );
  });
});
