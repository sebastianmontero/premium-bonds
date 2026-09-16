import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import {
  createApiRequest,
  assertErrorResponse,
  assertNoCache,
} from "@/app/lib/test-harness";

describe("GET /api/indexer/redemptions route", () => {
  it("should return 400 when user parameter is missing", async () => {
    const req = createApiRequest("/api/indexer/redemptions?poolId=1");
    const res = await GET(req);
    assertNoCache(res);
    await assertErrorResponse(res, 400, "Missing 'user' parameter");
  });

  it("should accept valid status parameters and handle unconfigured DB gracefully", async () => {
    const reqDefault = createApiRequest(
      "/api/indexer/redemptions?user=user1&poolId=1"
    );
    const resDefault = await GET(reqDefault);
    assertNoCache(resDefault);
    assert.strictEqual(resDefault.status, 200);

    const reqPending = createApiRequest(
      "/api/indexer/redemptions?user=user1&poolId=1&status=pending"
    );
    const resPending = await GET(reqPending);
    assertNoCache(resPending);
    assert.strictEqual(resPending.status, 200);

    const reqAll = createApiRequest(
      "/api/indexer/redemptions?user=user1&poolId=1&status=all"
    );
    const resAll = await GET(reqAll);
    assertNoCache(resAll);
    assert.strictEqual(resAll.status, 200);

    const reqClaimed = createApiRequest(
      "/api/indexer/redemptions?user=user1&poolId=1&status=claimed"
    );
    const resClaimed = await GET(reqClaimed);
    assertNoCache(resClaimed);
    assert.strictEqual(resClaimed.status, 200);

    const reqInvalid = createApiRequest(
      "/api/indexer/redemptions?user=user1&poolId=1&status=bogus_status"
    );
    const resInvalid = await GET(reqInvalid);
    assertNoCache(resInvalid);
    assert.strictEqual(resInvalid.status, 200);
  });
});
