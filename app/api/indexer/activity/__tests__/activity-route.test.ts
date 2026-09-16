import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import { encodeKeysetCursor } from "@/app/types/indexer-contracts";
import {
  createApiRequest,
  assertSuccessResponse,
  assertErrorResponse,
  assertPrivateNoCache,
} from "@/app/lib/test-harness";
import type { ActivityEntry } from "@/app/types";

describe("GET /api/indexer/activity Route Handler", () => {
  const validUser = "5xYz1234MockUserAddress56789012345678";

  it("should return 400 Bad Request when user parameter is missing", async () => {
    const req = createApiRequest("/api/indexer/activity");
    const res = await GET(req);
    const { error } = await assertErrorResponse(res, 400);
    assert.strictEqual(typeof error, "string");
    assert.ok(error.length > 0, "Error description must not be empty");
  });

  it("should reject limit parameter exceeding max allowed bounds of 100 with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/activity?user=${validUser}&limit=250`
    );
    const res = await GET(req);
    await assertErrorResponse(res, 400);
  });

  it("should reject invalid activity type filter with 400 Bad Request", async () => {
    const req = createApiRequest(
      `/api/indexer/activity?user=${validUser}&type=invalid-type`
    );
    const res = await GET(req);
    await assertErrorResponse(res, 400);
  });

  it("should successfully fetch activity with default parameters and private cache header", async () => {
    const req = createApiRequest(`/api/indexer/activity?user=${validUser}`);
    const res = await GET(req);
    assertPrivateNoCache(res);

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
    const res = await GET(req);
    const { meta } = await assertSuccessResponse(res, 200);
    assert.ok(meta, "meta should be present");
    assert.strictEqual(
      meta?.limit,
      10,
      "Response meta limit must reflect custom parameter (10)"
    );
  });
});
