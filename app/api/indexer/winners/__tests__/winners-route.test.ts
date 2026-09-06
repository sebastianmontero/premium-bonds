import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../route";

describe("GET /api/indexer/winners Route Handler", () => {
  const validUser = "5xYz1234MockUserAddress56789012345678";

  it("should reject pageSize parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/winners?user=${validUser}&pageSize=500`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.fallbackRequired, true);
  });

  it("should reject invalid status filter with 400 Bad Request", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/winners?user=${validUser}&status=unknown_status`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
  });

  it("should reject invalid tier filter with 400 Bad Request", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/winners?user=${validUser}&tier=mythic`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
  });

  it("should successfully fetch winners for user with private cache header and structured envelope", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/winners?user=${validUser}`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      "private, no-cache, no-store, must-revalidate"
    );

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.fallbackRequired, false);
    assert.ok(Array.isArray(json.data));
    assert.ok("meta" in json);
    assert.strictEqual(json.meta.page, 1);
    assert.strictEqual(json.meta.pageSize, 10);
    assert.ok("aggregates" in json);
    assert.strictEqual(typeof json.aggregates.totalFilteredValue, "string");
  });

  it("should return public cache header when user param is omitted", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/indexer/winners?poolId=1&page=1&pageSize=10"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      "public, s-maxage=10, stale-while-revalidate=30"
    );

    const json = await res.json();
    assert.strictEqual(json.success, true);
  });

  it("should accept valid status, tier, and search filters", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/winners?user=${validUser}&status=processing&tier=grand&search=%231`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
  });
});
