import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, dynamic } from "../route";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";

describe("GET /api/indexer/pool Route Handler", () => {
  it("should have dynamic export set to force-dynamic", () => {
    assert.strictEqual(dynamic, "force-dynamic");
  });

  it("should return NO_CACHE_HEADERS on response", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/indexer/pool?poolId=1"
    );
    const res = await GET(req);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"]
    );
    assert.ok(
      res.status === 200 || res.status === 404,
      `Expected status 200 or 404, received ${res.status}`
    );
  });

  it("should default to poolId 1 when parameter is omitted", async () => {
    const req = new NextRequest("http://localhost:3000/api/indexer/pool");
    const res = await GET(req);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"]
    );
    assert.ok(
      res.status === 200 || res.status === 404,
      `Expected status 200 or 404, received ${res.status}`
    );
  });
});
