import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../route";

describe("GET /api/indexer/redemptions route", () => {
  it("should return 400 when user parameter is missing", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/indexer/redemptions?poolId=1"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.fallbackRequired, true);
    assert.strictEqual(json.error, "Missing 'user' parameter");
  });

  it("should accept valid status parameters and handle unconfigured DB gracefully", async () => {
    const reqDefault = new NextRequest(
      "http://localhost:3000/api/indexer/redemptions?user=user1&poolId=1"
    );
    const resDefault = await GET(reqDefault);
    assert.strictEqual(resDefault.status, 200);

    const reqPending = new NextRequest(
      "http://localhost:3000/api/indexer/redemptions?user=user1&poolId=1&status=pending"
    );
    const resPending = await GET(reqPending);
    assert.strictEqual(resPending.status, 200);

    const reqAll = new NextRequest(
      "http://localhost:3000/api/indexer/redemptions?user=user1&poolId=1&status=all"
    );
    const resAll = await GET(reqAll);
    assert.strictEqual(resAll.status, 200);

    const reqClaimed = new NextRequest(
      "http://localhost:3000/api/indexer/redemptions?user=user1&poolId=1&status=claimed"
    );
    const resClaimed = await GET(reqClaimed);
    assert.strictEqual(resClaimed.status, 200);

    const reqInvalid = new NextRequest(
      "http://localhost:3000/api/indexer/redemptions?user=user1&poolId=1&status=bogus_status"
    );
    const resInvalid = await GET(reqInvalid);
    assert.strictEqual(resInvalid.status, 200);
  });
});
