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
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.fallbackRequired, true);
    assert.strictEqual(typeof json.error, "string");
    assert.ok(json.error.length > 0);
  });

  it("should reject limit parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}&limit=250`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.fallbackRequired, true);
  });

  it("should reject invalid activity type filter with 400 Bad Request", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}&type=invalid-type`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 400);

    const json = await res.json();
    assert.strictEqual(json.success, false);
  });

  it("should successfully fetch activity with default parameters and private cache header", async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}`
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
    assert.strictEqual(json.meta.limit, 20);
    assert.strictEqual(typeof json.meta.hasMore, "boolean");
  });

  it("should accept valid keyset cursor, type, and search filters", async () => {
    const cursor = encodeKeysetCursor(1757184000, 100);
    const req = new NextRequest(
      `http://localhost:3000/api/indexer/activity?user=${validUser}&limit=10&type=deposit&search=%2342&cursor=${cursor}`
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.meta.limit, 10);
  });
});
