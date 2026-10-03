import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseIndexerSyncArgs,
  syncHistoricalTransactions,
} from "./indexer-sync";
import { DatabaseNotConfiguredError } from "../app/lib/db";
import { resolveNetwork } from "../app/lib/network";

describe("Indexer Sync Suite", () => {
  describe("CLI Argument Parsing", () => {
    it("should parse default arguments when no flags are passed", () => {
      const options = parseIndexerSyncArgs([]);
      assert.deepStrictEqual(options, {
        backfill: false,
        maxTransactions: undefined,
        rpcUrl: undefined,
        network: undefined,
      });
    });

    it("should parse --backfill flag", () => {
      const options = parseIndexerSyncArgs(["--backfill"]);
      assert.strictEqual(options.backfill, true);
    });

    it("should parse --max and --max-transactions flags", () => {
      const options1 = parseIndexerSyncArgs(["--max", "25"]);
      assert.strictEqual(options1.maxTransactions, 25);

      const options2 = parseIndexerSyncArgs(["--max-transactions", "100"]);
      assert.strictEqual(options2.maxTransactions, 100);
    });

    it("should parse --rpc and --network flags", () => {
      const options = parseIndexerSyncArgs([
        "--rpc",
        "https://api.devnet.solana.com",
        "--network",
        "devnet",
        "--backfill",
      ]);
      assert.strictEqual(options.rpcUrl, "https://api.devnet.solana.com");
      assert.strictEqual(options.network, "devnet");
      assert.strictEqual(options.backfill, true);
    });
  });

  describe("Database Guard & Error Handling", () => {
    it("should throw DatabaseNotConfiguredError when isDatabaseConfigured is false", async () => {
      await assert.rejects(
        async () => {
          await syncHistoricalTransactions({ isDatabaseConfigured: false });
        },
        (err: unknown) => {
          return err instanceof DatabaseNotConfiguredError;
        }
      );
    });
  });

  describe("Cluster Resolution Alignment", () => {
    it("should infer localnet from localnet RPC URL when no explicit network is supplied", () => {
      const localnetRpc = "http://127.0.0.1:8899";
      const config = resolveNetwork(undefined, localnetRpc);
      assert.strictEqual(config.cluster, "localnet");
    });

    it("should infer devnet from devnet RPC URL", () => {
      const devnetRpc = "https://api.devnet.solana.com";
      const config = resolveNetwork(undefined, devnetRpc);
      assert.strictEqual(config.cluster, "devnet");
    });

    it("should infer mainnet-beta from mainnet/helius RPC URL", () => {
      const mainnetRpc = "https://mainnet.helius-rpc.com/?api-key=test";
      const config = resolveNetwork(undefined, mainnetRpc);
      assert.strictEqual(config.cluster, "mainnet-beta");
    });
  });

  describe("Mock RPC & Execution Telemetry", () => {
    function createMockDb(
      cursorRow: { contiguousSignature: string } | null = null
    ) {
      return {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => (cursorRow ? [cursorRow] : []),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: async () => ({}),
          }),
        }),
      } as any;
    }

    it("should complete gracefully when RPC returns no signatures", async () => {
      const mockRpc = {
        getSignaturesForAddress: () => ({
          send: async () => [],
        }),
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
      } as any;

      const mockDb = createMockDb();

      const result = await syncHistoricalTransactions({
        isDatabaseConfigured: true,
        db: mockDb,
        rpc: mockRpc,
        rpcUrl: "http://127.0.0.1:8899",
        network: "localnet",
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalIngested, 0);
      assert.strictEqual(result.contiguousWatermark, null);
    });

    it("should return failure telemetry when RPC signature fetching throws", async () => {
      const mockRpc = {
        getSignaturesForAddress: () => ({
          send: async () => {
            throw new Error("RPC network failure: connection refused");
          },
        }),
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
      } as any;

      const mockDb = createMockDb({
        contiguousSignature: "existing_watermark_sig_123",
      });

      const result = await syncHistoricalTransactions({
        isDatabaseConfigured: true,
        db: mockDb,
        rpc: mockRpc,
        rpcUrl: "http://127.0.0.1:8899",
        network: "localnet",
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.totalIngested, 0);
      assert.strictEqual(
        result.contiguousWatermark,
        "existing_watermark_sig_123"
      );
    });
  });
});
