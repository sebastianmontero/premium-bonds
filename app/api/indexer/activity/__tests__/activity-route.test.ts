import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { encodeKeysetCursor } from "@/app/types/indexer-contracts";

describe("GET /api/indexer/activity Route Handler", () => {
  const validUser = "5xYz1234MockUserAddress56789012345678";

  it("should return 400 Bad Request when user parameter is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/indexer/activity");
    const res = await GET(req);
    assert.strictEqual(
      res.status,
      400,
      "Missing user address query param must return 400"
    );

    const json = await res.json();
    assert.strictEqual(
      json.success,
      false,
      "Response success boolean must be false"
    );
    assert.strictEqual(
      json.fallbackRequired,
      true,
      "Client fallback should be signaled"
    );
    assert.strictEqual(
      typeof json.error,
      "string",
      "Error description must be a string"
    );
    assert.ok(json.error.length > 0, "Error description must not be empty");
  });

  it("should reject limit parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}&limit=250`
    );
    const res = await GET(req);
    assert.strictEqual(
      res.status,
      400,
      "Limit exceeding max allowed bounds (100) must return 400"
    );

    const json = await res.json();
    assert.strictEqual(json.success, false, "Success field must be false");
    assert.strictEqual(
      json.fallbackRequired,
      true,
      "Fallback required flag must be true"
    );
  });

  it("should reject invalid activity type filter with 400 Bad Request", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}&type=invalid-type`
    );
    const res = await GET(req);
    assert.strictEqual(
      res.status,
      400,
      "Unknown activity type filter must return 400"
    );

    const json = await res.json();
    assert.strictEqual(
      json.success,
      false,
      "Success flag must be false for invalid query type"
    );
  });

  it("should successfully fetch activity with default parameters and private cache header", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}`
    );
    const res = await GET(req);
    assert.strictEqual(
      res.status,
      200,
      "Valid activity query must return 200 OK"
    );
    assert.strictEqual(
      res.headers.get("Cache-Control"),
      "private, no-cache, no-store, must-revalidate",
      "Private cache header must be present on user activity response"
    );

    const json = await res.json();
    assert.strictEqual(
      json.success,
      true,
      "Response payload success field must be true"
    );
    assert.strictEqual(
      json.fallbackRequired,
      false,
      "Fallback required must be false on valid response"
    );
    assert.ok(
      Array.isArray(json.data),
      "Response data field must be an array of activity records"
    );
    assert.ok("meta" in json, "Response must include pagination metadata");
    assert.strictEqual(
      json.meta.limit,
      20,
      "Default pagination limit must equal 20"
    );
    assert.strictEqual(
      typeof json.meta.hasMore,
      "boolean",
      "Pagination hasMore must be a boolean flag"
    );
  });

  it("should accept valid keyset cursor, type, and search filters", async () => {
    const cursor = encodeKeysetCursor(1757184000, 100);
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}&limit=10&type=deposit&search=%2342&cursor=${cursor}`
    );
    const res = await GET(req);
    assert.strictEqual(
      res.status,
      200,
      "Activity request with filters and cursor must return 200"
    );

    const json = await res.json();
    assert.strictEqual(json.success, true, "Success boolean must be true");
    assert.strictEqual(
      json.meta.limit,
      10,
      "Response meta limit must reflect custom parameter (10)"
    );
  });
});
