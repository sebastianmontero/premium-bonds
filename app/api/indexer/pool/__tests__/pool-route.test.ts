import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { handleGetPool, dynamic } from "../route";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";
import { MockRpcBuilder } from "@/app/lib/test-harness";
import type { createSolanaRpc } from "@solana/kit";

describe("GET /api/indexer/pool Route Handler", () => {
  it("should have dynamic export set to force-dynamic", () => {
    assert.strictEqual(dynamic, "force-dynamic");
  });

  it("should return 404 with NO_CACHE_HEADERS when pool state is not found", async () => {
    const mockRpc = new MockRpcBuilder().build();
    const req = new NextRequest(
      "http://localhost:3000/api/indexer/pool?poolId=9999"
    );
    const res = await handleGetPool(req, {
      rpc: mockRpc as unknown as ReturnType<typeof createSolanaRpc>,
    });

    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"],
      "Route response must include no-cache header"
    );
    assert.strictEqual(
      res.status,
      404,
      "Non-existent pool must return 404 Not Found"
    );

    const body = (await res.json()) as { error: string; code: string };
    assert.strictEqual(
      body.code,
      "POOL_NOT_INITIALIZED",
      "Error payload must return POOL_NOT_INITIALIZED code"
    );
  });

  it("should default to poolId 1 and return valid headers and deterministic status", async () => {
    const mockRpc = new MockRpcBuilder().build();
    const req = new NextRequest("http://localhost:3000/api/indexer/pool");
    const res = await handleGetPool(req, {
      rpc: mockRpc as unknown as ReturnType<typeof createSolanaRpc>,
    });

    assert.strictEqual(
      res.headers.get("Cache-Control"),
      NO_CACHE_HEADERS["Cache-Control"],
      "Default pool query must include no-cache header"
    );
    assert.strictEqual(
      res.status,
      404,
      "Uninitialized default pool must return 404"
    );
    const body = (await res.json()) as { error: string; code: string };
    assert.strictEqual(body.code, "POOL_NOT_INITIALIZED");
  });
});
