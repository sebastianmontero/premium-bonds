import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatIndexerProgressMessage,
  SyncProgressTracker,
  type IndexerProgressEvent,
} from "./indexer-telemetry";

describe("Indexer Telemetry Suite", () => {
  describe("formatIndexerProgressMessage", () => {
    it("formats querying_signatures with default until / before", () => {
      const msg = formatIndexerProgressMessage({
        phase: "querying_signatures",
        page: 1,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 1] Querying signatures (until: GENESIS / INCEPTION)..."
      );
    });

    it("formats querying_signatures with explicit until and before", () => {
      const msg = formatIndexerProgressMessage({
        phase: "querying_signatures",
        page: 2,
        untilSig: "sig_until_123",
        beforeSig: "sig_before_456",
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 2] Querying signatures (until: sig_until_123, before: sig_before_456)..."
      );
    });

    it("formats signatures_discovered", () => {
      const msg = formatIndexerProgressMessage({
        phase: "signatures_discovered",
        page: 1,
        totalDiscovered: 100,
        validCount: 95,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 1] Discovered 100 signatures (95 valid)."
      );
    });

    it("formats fetching_transactions with accurate percentages and chunk info", () => {
      const msg = formatIndexerProgressMessage({
        phase: "fetching_transactions",
        page: 1,
        chunk: {
          chunkNumber: 1,
          totalChunks: 34,
          txStartIndex: 1,
          txEndIndex: 3,
          totalTransactions: 100,
        },
        eventsParsedSoFar: 12,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 1] Fetching chunk 1/34 (txs 1..3/100, 3%) | 12 events parsed so far"
      );
    });

    it("handles fetching_transactions edge case when totalTransactions is 0", () => {
      const msg = formatIndexerProgressMessage({
        phase: "fetching_transactions",
        page: 1,
        chunk: {
          chunkNumber: 1,
          totalChunks: 1,
          txStartIndex: 1,
          txEndIndex: 0,
          totalTransactions: 0,
        },
        eventsParsedSoFar: 0,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 1] Fetching chunk 1/1 (txs 1..0/0, 100%) | 0 events parsed so far"
      );
    });

    it("formats ingesting_batch with inserted count and duration", () => {
      const msg = formatIndexerProgressMessage({
        phase: "ingesting_batch",
        page: 1,
        batchSize: 10,
        insertedCount: 8,
        durationMs: 42,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 1] Ingesting batch of 10 transactions (8 events inserted in 42ms)."
      );
    });

    it("formats ingesting_batch without durationMs", () => {
      const msg = formatIndexerProgressMessage({
        phase: "ingesting_batch",
        page: 2,
        batchSize: 5,
        insertedCount: 5,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 2] Ingesting batch of 5 transactions (5 events inserted)."
      );
    });

    it("formats hydrating_draws", () => {
      const msg = formatIndexerProgressMessage({
        phase: "hydrating_draws",
        page: 1,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] [Page 1] Hydrating pending draws triggered by batch..."
      );
    });

    it("formats reconciling_settlements", () => {
      const msg = formatIndexerProgressMessage({
        phase: "reconciling_settlements",
        poolStateAddress: "Pool111111111111111111111111111111111111111",
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync] Reconciling Huma settlements for pool Pool111111111111111111111111111111111111111..."
      );
    });

    it("formats complete", () => {
      const msg = formatIndexerProgressMessage({
        phase: "complete",
        totalPages: 3,
        totalScanned: 250,
        totalIngested: 42,
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync Complete] Synced 3 pages, scanned 250 txs, ingested 42 events."
      );
    });

    it("formats aborted", () => {
      const msg = formatIndexerProgressMessage({
        phase: "aborted",
        page: 2,
        reason: "Fetch failures in transaction chunk",
      });
      assert.strictEqual(
        msg,
        "[Indexer Sync Aborted] [Page 2] Aborting sync: Fetch failures in transaction chunk"
      );
    });
  });

  describe("SyncProgressTracker", () => {
    it("tracks activeContext when emitting lifecycle events", () => {
      const events: IndexerProgressEvent[] = [];
      const tracker = new SyncProgressTracker({
        silent: true,
        onProgress: (e) => events.push(e),
      });

      assert.strictEqual(tracker.getActiveContext(), undefined);

      tracker.emit({
        phase: "querying_signatures",
        page: 1,
      });
      assert.strictEqual(
        tracker.getActiveContext(),
        "Page 1 Signature Discovery"
      );

      tracker.emit({
        phase: "fetching_transactions",
        page: 1,
        chunk: {
          chunkNumber: 2,
          totalChunks: 5,
          txStartIndex: 4,
          txEndIndex: 6,
          totalTransactions: 15,
        },
        eventsParsedSoFar: 3,
      });
      assert.strictEqual(
        tracker.getActiveContext(),
        "Page 1 Chunk 2/5 (txs 4..6/15)"
      );

      tracker.emit({
        phase: "ingesting_batch",
        page: 1,
        batchSize: 15,
      });
      assert.strictEqual(
        tracker.getActiveContext(),
        "Page 1 Database Ingestion"
      );

      tracker.emit({
        phase: "hydrating_draws",
        page: 1,
      });
      assert.strictEqual(tracker.getActiveContext(), "Page 1 Draw Hydration");

      tracker.emit({
        phase: "reconciling_settlements",
        poolStateAddress: "Pool111",
      });
      assert.strictEqual(
        tracker.getActiveContext(),
        "Settlement Reconciliation"
      );

      tracker.emit({
        phase: "complete",
        totalPages: 1,
        totalScanned: 15,
        totalIngested: 3,
      });
      assert.strictEqual(tracker.getActiveContext(), undefined);

      assert.strictEqual(events.length, 6);
    });

    it("creates retry listener passing active context and parameters", () => {
      const tracker = new SyncProgressTracker({ silent: true });
      let capturedContext: string | undefined;
      let capturedAttempt = 0;
      let capturedDelay = 0;
      let capturedError: unknown;

      const listener = tracker.createRetryListener(
        5,
        (err, attempt, delayMs, context) => {
          capturedError = err;
          capturedAttempt = attempt;
          capturedDelay = delayMs;
          capturedContext = context;
        }
      );

      tracker.emit({
        phase: "fetching_transactions",
        page: 1,
        chunk: {
          chunkNumber: 1,
          totalChunks: 10,
          txStartIndex: 1,
          txEndIndex: 3,
          totalTransactions: 30,
        },
        eventsParsedSoFar: 0,
      });

      const sampleErr = new Error("429 Too Many Requests");
      listener(sampleErr, 1, 10200);

      assert.strictEqual(capturedError, sampleErr);
      assert.strictEqual(capturedAttempt, 1);
      assert.strictEqual(capturedDelay, 10200);
      assert.strictEqual(capturedContext, "Page 1 Chunk 1/10 (txs 1..3/30)");
    });

    it("respects silent mode and suppresses log/warn/error", () => {
      const tracker = new SyncProgressTracker({ silent: true });
      const originalLog = console.log;
      const originalWarn = console.warn;
      const originalError = console.error;

      let logged = false;
      console.log = () => {
        logged = true;
      };
      console.warn = () => {
        logged = true;
      };
      console.error = () => {
        logged = true;
      };

      try {
        tracker.log("test log");
        tracker.warn("test warn");
        tracker.error("test error");
        tracker.emit({ phase: "querying_signatures", page: 1 });
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
      }

      assert.strictEqual(logged, false);
    });
  });
});
