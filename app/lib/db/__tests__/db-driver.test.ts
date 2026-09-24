import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  db,
  getPoolConfig,
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

  it("should configure local database pool without SSL and with standard timeouts", () => {
    const localConfig = getPoolConfig(
      "postgresql://postgres:postgres@127.0.0.1:5432/pb_test"
    );
    assert.strictEqual(localConfig.ssl, undefined);
    assert.strictEqual(localConfig.connectionTimeoutMillis, 5_000);
    assert.strictEqual(localConfig.statement_timeout, 15_000);
    assert.strictEqual(localConfig.max, 5);
  });

  it("should configure remote database pool with SSL and resilient timeouts", () => {
    const remoteConfig = getPoolConfig(
      "postgresql://user:pass@ep-remote.aws.neon.tech/pb_test"
    );
    assert.deepStrictEqual(remoteConfig.ssl, { rejectUnauthorized: false });
    assert.strictEqual(remoteConfig.connectionTimeoutMillis, 15_000);
    assert.strictEqual(remoteConfig.statement_timeout, 15_000);
  });

  it("should support overriding pool configuration parameters", () => {
    const customConfig = getPoolConfig(
      "postgresql://user:pass@ep-remote.aws.neon.tech/pb_test",
      {
        max: 1,
        connectionTimeoutMillis: 30_000,
        statement_timeout: 60_000,
      }
    );
    assert.strictEqual(customConfig.max, 1);
    assert.strictEqual(customConfig.connectionTimeoutMillis, 30_000);
    assert.strictEqual(customConfig.statement_timeout, 60_000);
    assert.deepStrictEqual(customConfig.ssl, { rejectUnauthorized: false });
  });
});
