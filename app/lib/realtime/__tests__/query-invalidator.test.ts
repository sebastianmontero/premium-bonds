import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { DebouncedQueryInvalidator } from "../query-invalidator";

function createMockQueryClient() {
  const invalidatedKeys: QueryKey[] = [];
  const client = {
    invalidateQueries: ({ queryKey }: { queryKey?: QueryKey }) => {
      if (queryKey) {
        invalidatedKeys.push(queryKey);
      }
      return Promise.resolve();
    },
  } as unknown as QueryClient;

  return { client, invalidatedKeys };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("DebouncedQueryInvalidator Unit Tests", () => {
  it("should coalesce rapid schedule calls into a single batch after delayMs", async () => {
    const { client, invalidatedKeys } = createMockQueryClient();
    const invalidator = new DebouncedQueryInvalidator(client, 50, 200);

    for (let i = 0; i < 20; i++) {
      invalidator.schedule([["bonds", 1, "draws"]]);
      invalidator.schedule([["bonds", 1, "pool"]]);
    }

    assert.strictEqual(
      invalidatedKeys.length,
      0,
      "Should not invalidate immediately"
    );

    await sleep(80);

    assert.strictEqual(
      invalidatedKeys.length,
      2,
      "Should deduplicate and invalidate each unique key once"
    );
    assert.deepStrictEqual(invalidatedKeys, [
      ["bonds", 1, "draws"],
      ["bonds", 1, "pool"],
    ]);

    invalidator.dispose();
  });

  it("should deduplicate identical keys across different schedule invocations", async () => {
    const { client, invalidatedKeys } = createMockQueryClient();
    const invalidator = new DebouncedQueryInvalidator(client, 50, 200);

    invalidator.schedule([["bonds", 1, "prizes"]]);
    await sleep(10);
    invalidator.schedule([["bonds", 1, "prizes"]]);
    await sleep(10);
    invalidator.schedule([
      ["bonds", 1, "prizes"],
      ["bonds", 1, "activity"],
    ]);

    await sleep(80);

    assert.strictEqual(invalidatedKeys.length, 2);
    assert.deepStrictEqual(invalidatedKeys, [
      ["bonds", 1, "prizes"],
      ["bonds", 1, "activity"],
    ]);

    invalidator.dispose();
  });

  it("should enforce maxCoalesceMs burst ceiling and fire rather than delaying indefinitely", async () => {
    const { client, invalidatedKeys } = createMockQueryClient();
    const invalidator = new DebouncedQueryInvalidator(client, 40, 100);

    invalidator.schedule([["bonds", 1, "draws"]]);

    // Continuously schedule events every 25ms (less than delayMs = 40ms)
    // to keep extending the debounce timer until maxCoalesceMs = 100ms ceiling is reached
    const interval = setInterval(() => {
      invalidator.schedule([["bonds", 1, "draws"]]);
    }, 25);

    // Wait until just after maxCoalesceMs ceiling (e.g. 150ms)
    await sleep(160);
    clearInterval(interval);

    assert.ok(
      invalidatedKeys.length >= 1,
      "Should have fired at least once due to maxCoalesceMs burst ceiling"
    );

    invalidator.dispose();
  });

  it("should flush pending keys immediately when dispose() is called", () => {
    const { client, invalidatedKeys } = createMockQueryClient();
    const invalidator = new DebouncedQueryInvalidator(client, 200, 500);

    invalidator.schedule([
      ["bonds", 1, "draws"],
      ["bonds", 1, "user", "addr1"],
    ]);
    assert.strictEqual(invalidatedKeys.length, 0);

    invalidator.dispose();

    assert.strictEqual(invalidatedKeys.length, 2);
    assert.deepStrictEqual(invalidatedKeys, [
      ["bonds", 1, "draws"],
      ["bonds", 1, "user", "addr1"],
    ]);
  });

  it("should be idempotent on multiple dispose() calls", () => {
    const { client, invalidatedKeys } = createMockQueryClient();
    const invalidator = new DebouncedQueryInvalidator(client, 200, 500);

    invalidator.schedule([["bonds", 1, "pool"]]);
    invalidator.dispose();
    assert.strictEqual(invalidatedKeys.length, 1);

    // Second dispose call should do nothing and not throw
    assert.doesNotThrow(() => {
      invalidator.dispose();
    });
    assert.strictEqual(invalidatedKeys.length, 1);
  });

  it("should ignore schedule() calls after dispose()", () => {
    const { client, invalidatedKeys } = createMockQueryClient();
    const invalidator = new DebouncedQueryInvalidator(client, 50, 200);

    invalidator.dispose();
    invalidator.schedule([["bonds", 1, "pool"]]);

    assert.strictEqual(invalidatedKeys.length, 0);
  });

  it("should execute immediately when flush() is invoked manually", () => {
    const { client, invalidatedKeys } = createMockQueryClient();
    const invalidator = new DebouncedQueryInvalidator(client, 500, 1000);

    invalidator.schedule([["bonds", 1, "root"]]);
    assert.strictEqual(invalidatedKeys.length, 0);

    invalidator.flush();
    assert.strictEqual(invalidatedKeys.length, 1);
    assert.deepStrictEqual(invalidatedKeys[0], ["bonds", 1, "root"]);

    invalidator.dispose();
  });
});
