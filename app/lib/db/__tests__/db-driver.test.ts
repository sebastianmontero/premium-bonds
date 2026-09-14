import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  isDatabaseConfigured,
  DatabaseNotConfiguredError,
  closeDatabase,
  createUnconfiguredPool,
} from "../index";

describe("Database Driver & Pool Configuration Suite", () => {
  it("should evaluate isDatabaseConfigured correctly as a boolean", () => {
    assert.strictEqual(typeof isDatabaseConfigured, "boolean");
  });

  it("should expose .transaction() as a function on the Drizzle instance", () => {
    assert.strictEqual(typeof db.transaction, "function");
  });

  it("should allow safe introspection of pool in unconfigured environments", async () => {
    const unconfiguredPool = createUnconfiguredPool();
    assert.doesNotThrow(() => {
      String(unconfiguredPool);
      JSON.stringify(unconfiguredPool);
    });
    const resolved = await Promise.resolve(unconfiguredPool);
    assert.strictEqual(resolved, unconfiguredPool);
  });

  it("should resolve pool.end() and closeDatabase() cleanly without throwing", async () => {
    await assert.doesNotReject(async () => {
      await closeDatabase();
    });
  });

  it("should throw DatabaseNotConfiguredError when query execution is attempted on unconfigured pool", async () => {
    assert.strictEqual(typeof DatabaseNotConfiguredError, "function");
    const unconfiguredPool = createUnconfiguredPool();
    await assert.rejects(
      async () => {
        await unconfiguredPool.query("SELECT 1");
      },
      (err: unknown) => {
        assert(err instanceof DatabaseNotConfiguredError);
        assert.strictEqual((err as Error).name, "DatabaseNotConfiguredError");
        return true;
      }
    );
  });
});
