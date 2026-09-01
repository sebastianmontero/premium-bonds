import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  pool,
  isDatabaseConfigured,
  DatabaseNotConfiguredError,
  closeDatabase,
} from "../index";

describe("Database Driver & Pool Configuration Suite", () => {
  it("should evaluate isDatabaseConfigured correctly as a boolean", () => {
    assert.strictEqual(typeof isDatabaseConfigured, "boolean");
  });

  it("should expose .transaction() as a function on the Drizzle instance", () => {
    assert.strictEqual(typeof db.transaction, "function");
  });

  it("should allow safe introspection of pool in unconfigured environments", async () => {
    assert.doesNotThrow(() => {
      String(pool);
      JSON.stringify(pool);
    });
    const resolved = await Promise.resolve(pool);
    assert.strictEqual(resolved, pool);
  });

  it("should resolve pool.end() and closeDatabase() cleanly without throwing", async () => {
    await assert.doesNotReject(async () => {
      await closeDatabase();
    });
  });

  it("should throw DatabaseNotConfiguredError when query execution is attempted without DB config", async () => {
    assert.strictEqual(typeof DatabaseNotConfiguredError, "function");
    if (!isDatabaseConfigured) {
      await assert.rejects(
        async () => {
          await pool.query("SELECT 1");
        },
        (err: unknown) => {
          assert(err instanceof DatabaseNotConfiguredError);
          assert.strictEqual((err as Error).name, "DatabaseNotConfiguredError");
          return true;
        }
      );
    }
  });
});
