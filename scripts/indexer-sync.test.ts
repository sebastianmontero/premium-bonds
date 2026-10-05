import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseIndexerSyncArgs,
  syncHistoricalTransactions,
} from "./indexer-sync";
import { DatabaseNotConfiguredError } from "../app/lib/db";
import { resolveNetwork } from "../app/lib/network";
import {
  createResilientRpc,
  RateLimitCoordinator,
} from "../app/lib/rpc-transport";
import type { IndexerProgressEvent } from "./indexer-telemetry";

describe("Indexer Sync Suite", () => {
  describe("CLI Argument Parsing", () => {
    it("should parse default arguments when no flags are passed", () => {
      const options = parseIndexerSyncArgs([]);
      assert.deepStrictEqual(options, {
        backfill: false,
        silent: false,
        maxTransactions: undefined,
        rpcUrl: undefined,
        network: undefined,
        batchSize: undefined,
        batchDelayMs: undefined,
        maxRetries: undefined,
      });
    });

    it("should parse --backfill flag", () => {
      const options = parseIndexerSyncArgs(["--backfill"]);
      assert.strictEqual(options.backfill, true);
    });

    it("should parse --silent, --quiet, and -q flags", () => {
      assert.strictEqual(parseIndexerSyncArgs(["--silent"]).silent, true);
      assert.strictEqual(parseIndexerSyncArgs(["--quiet"]).silent, true);
      assert.strictEqual(parseIndexerSyncArgs(["-q"]).silent, true);
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

    it("should parse --batch-size, --batch-delay, and --max-retries flags", () => {
      const options = parseIndexerSyncArgs([
        "--batch-size",
        "2",
        "--batch-delay",
        "150",
        "--max-retries",
        "4",
      ]);
      assert.strictEqual(options.batchSize, 2);
      assert.strictEqual(options.batchDelayMs, 150);
      assert.strictEqual(options.maxRetries, 4);
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
      cursorRow: { contiguousSignature: string } | null = null,
      onInsert?: (values: any) => void
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
          values: (v: any) => {
            if (onInsert) onInsert(v);
            return {
              onConflictDoUpdate: async () => ({}),
            };
          },
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
        silent: true,
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
        silent: true,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.totalIngested, 0);
      assert.strictEqual(
        result.contiguousWatermark,
        "existing_watermark_sig_123"
      );
    });

    it("should NOT advance watermark on partial sync with maxTransactions before genesis is reached", async () => {
      // Simulate 100 signatures returned (so genesis is not reached)
      const mockSigs = Array.from({ length: 100 }, (_, i) => ({
        signature: `sig_${i}`,
        slot: 1000 + i,
        blockTime: 1700000000 + i,
        err: null,
      }));

      let insertedWatermark: string | null = null;
      const mockDb = createMockDb(null, (values) => {
        insertedWatermark = values.contiguousSignature;
      });

      const mockRpc = {
        getSignaturesForAddress: () => ({
          send: async () => mockSigs,
        }),
        getTransaction: () => ({
          send: async () => ({
            slot: 1000,
            meta: { logMessages: [] },
          }),
        }),
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
      } as any;

      const result = await syncHistoricalTransactions({
        isDatabaseConfigured: true,
        db: mockDb,
        rpc: mockRpc,
        rpcUrl: "http://127.0.0.1:8899",
        network: "localnet",
        maxTransactions: 1,
        batchSize: 1,
        batchDelayMs: 0,
        workerStaggerMs: 0,
        silent: true,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(
        insertedWatermark,
        null,
        "Watermark must NOT advance when genesis/until is not reached"
      );
      assert.strictEqual(result.contiguousWatermark, null);
    });

    it("should advance watermark when genesis is reached (sigs < 100)", async () => {
      const mockSigs = [
        {
          signature: "newest_sig_abc",
          slot: 1050,
          blockTime: 1700000050,
          err: null,
        },
        {
          signature: "oldest_sig_genesis",
          slot: 1000,
          blockTime: 1700000000,
          err: null,
        },
      ];

      let insertedWatermark: string | null = null;
      const mockDb = createMockDb(null, (values) => {
        insertedWatermark = values.contiguousSignature;
      });

      const mockRpc = {
        getSignaturesForAddress: () => ({
          send: async () => mockSigs,
        }),
        getTransaction: () => ({
          send: async () => ({
            slot: 1000,
            meta: { logMessages: [] },
          }),
        }),
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
      } as any;

      const result = await syncHistoricalTransactions({
        isDatabaseConfigured: true,
        db: mockDb,
        rpc: mockRpc,
        rpcUrl: "http://127.0.0.1:8899",
        network: "localnet",
        batchSize: 2,
        batchDelayMs: 0,
        workerStaggerMs: 0,
        silent: true,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(insertedWatermark, "newest_sig_abc");
      assert.strictEqual(result.contiguousWatermark, "newest_sig_abc");
    });

    it("should recover from 429 rate limit errors on getTransaction using resilient RPC", async () => {
      const mockSigs = [
        {
          signature: "sig_429_test",
          slot: 1000,
          blockTime: 1700000000,
          err: null,
        },
      ];

      let txAttempts = 0;
      const mockTransport: any = async (req: any) => {
        if (req.payload.method === "getSignaturesForAddress") {
          return {
            jsonrpc: "2.0",
            id: req.payload.id ?? 1,
            result: mockSigs,
          };
        }
        if (req.payload.method === "getTransaction") {
          txAttempts++;
          if (txAttempts === 1) {
            // First attempt hits 429
            throw new Error("HTTP error (429): Too Many Requests");
          }
          return {
            jsonrpc: "2.0",
            id: req.payload.id ?? 1,
            result: {
              slot: 1000,
              meta: { logMessages: [] },
            },
          };
        }
        return {
          jsonrpc: "2.0",
          id: req.payload.id ?? 1,
          result: null,
        };
      };

      const coordinator = new RateLimitCoordinator({
        defaultFallbackCooldownMs: 10,
        defaultJitterMs: 0,
        defaultStaggerJitterMs: 0,
        minCooldownFloorMs: 5,
      });

      const resilientRpc = createResilientRpc("http://mock-rpc", {
        transport: mockTransport,
        rateLimitCoordinator: coordinator,
        initialDelayMs: 5,
        maxDelayMs: 20,
        onRetry: () => {},
      });

      const mockDb = createMockDb();

      const result = await syncHistoricalTransactions({
        isDatabaseConfigured: true,
        db: mockDb,
        rpc: resilientRpc,
        rpcUrl: "http://127.0.0.1:8899",
        network: "localnet",
        batchSize: 1,
        batchDelayMs: 0,
        workerStaggerMs: 0,
        silent: true,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(
        txAttempts,
        2,
        "Should have retried getTransaction and succeeded on 2nd attempt"
      );
      assert.strictEqual(result.contiguousWatermark, "sig_429_test");
    });

    it("should recover from 429 rate limit errors on getSignaturesForAddress using resilient RPC", async () => {
      let sigAttempts = 0;
      const mockTransport: any = async (req: any) => {
        if (req.payload.method === "getSignaturesForAddress") {
          sigAttempts++;
          if (sigAttempts === 1) {
            throw new Error("HTTP error (429): Too Many Requests");
          }
          return {
            jsonrpc: "2.0",
            id: req.payload.id ?? 1,
            result: [],
          };
        }
        return {
          jsonrpc: "2.0",
          id: req.payload.id ?? 1,
          result: null,
        };
      };

      const coordinator = new RateLimitCoordinator({
        defaultFallbackCooldownMs: 10,
        defaultJitterMs: 0,
        defaultStaggerJitterMs: 0,
        minCooldownFloorMs: 5,
      });

      const resilientRpc = createResilientRpc("http://mock-rpc", {
        transport: mockTransport,
        rateLimitCoordinator: coordinator,
        initialDelayMs: 5,
        maxDelayMs: 20,
        onRetry: () => {},
      });

      const mockDb = createMockDb();

      const result = await syncHistoricalTransactions({
        isDatabaseConfigured: true,
        db: mockDb,
        rpc: resilientRpc,
        rpcUrl: "http://127.0.0.1:8899",
        network: "localnet",
        batchSize: 1,
        batchDelayMs: 0,
        workerStaggerMs: 0,
        silent: true,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(
        sigAttempts,
        2,
        "Should have retried getSignaturesForAddress and succeeded on 2nd attempt"
      );
      assert.strictEqual(result.totalIngested, 0);
    });

    it("should emit structured progress events and pass contextual retry information", async () => {
      const events: IndexerProgressEvent[] = [];
      let retryContext: string | undefined;
      let txAttempts = 0;

      const mockTransport: any = async (req: any) => {
        if (req.payload.method === "getSignaturesForAddress") {
          return {
            jsonrpc: "2.0",
            id: req.payload.id ?? 1,
            result: [
              {
                signature: "sig_telemetry_test_1",
                slot: 1000,
                blockTime: 1700000000,
                err: null,
              },
            ],
          };
        }
        if (req.payload.method === "getTransaction") {
          txAttempts++;
          if (txAttempts === 1) {
            throw new Error("HTTP error (429): Too Many Requests");
          }
          return {
            jsonrpc: "2.0",
            id: req.payload.id ?? 1,
            result: {
              slot: 1000,
              meta: { logMessages: [] },
            },
          };
        }
        return {
          jsonrpc: "2.0",
          id: req.payload.id ?? 1,
          result: null,
        };
      };

      const coordinator = new RateLimitCoordinator({
        defaultFallbackCooldownMs: 5,
        defaultJitterMs: 0,
        defaultStaggerJitterMs: 0,
        minCooldownFloorMs: 5,
      });

      const mockDb = createMockDb();

      const result = await syncHistoricalTransactions({
        isDatabaseConfigured: true,
        db: mockDb,
        transport: mockTransport,
        rateLimitCoordinator: coordinator,
        rpcUrl: "http://mock-rpc",
        network: "localnet",
        batchSize: 1,
        batchDelayMs: 0,
        workerStaggerMs: 0,
        humaPoolStateAddress: "MockHumaPool1111111111111111111111111111111",
        silent: true,
        onProgress: (evt) => events.push(evt),
        onRetry: (_err, _attempt, _delay, context) => {
          retryContext = context;
        },
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(retryContext, "Page 1 Chunk 1/1 (txs 1..1/1)");

      const phases = events.map((e) => e.phase);
      assert.deepStrictEqual(phases, [
        "querying_signatures",
        "signatures_discovered",
        "fetching_transactions",
        "ingesting_batch",
        "reconciling_settlements",
        "complete",
      ]);
    });
  });
});
