import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPendingRedemptionCandidates,
  fetchHumaQueueNextRequestId,
  compareBigInt,
  PROGRAM_ID,
} from "../bonds-sdk";
import {
  MockRpcBuilder,
  buildMockPendingRedemptionEncoded,
  TEST_ADDRESSES,
  MOCK_HUMA_ADDRESSES,
} from "../test-harness";

function createHumaPoolStateBytes(
  options: {
    numModes?: number;
    totalAssets?: bigint;
    numConfigKeys?: number;
    nextRequestId?: bigint;
    lastRequestId?: bigint;
  } = {}
): Uint8Array {
  const numModes = options.numModes ?? 1;
  const numConfigKeys = options.numConfigKeys ?? 0;
  const modeConfigKeysOffset = 30 + numModes * 216;
  const redemptionOffset = modeConfigKeysOffset + 4 + numConfigKeys * 32;
  const totalLength = redemptionOffset + 32;

  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer);

  view.setUint32(26, numModes, true);
  const totalAssets = options.totalAssets ?? 10_000_000n;
  view.setBigUint64(30, totalAssets & 0xffffffffffffffffn, true);
  view.setBigUint64(38, totalAssets >> 64n, true);

  view.setUint32(modeConfigKeysOffset, numConfigKeys, true);

  const nextReq = options.nextRequestId ?? 0n;
  const lastReq = options.lastRequestId ?? 0n;

  view.setBigUint64(redemptionOffset, nextReq & 0xffffffffffffffffn, true);
  view.setBigUint64(redemptionOffset + 8, nextReq >> 64n, true);
  view.setBigUint64(redemptionOffset + 16, lastReq & 0xffffffffffffffffn, true);
  view.setBigUint64(redemptionOffset + 24, lastReq >> 64n, true);

  return buffer;
}

describe("fetchPendingRedemptionCandidates & Huma Queue Invariants", () => {
  const poolId = 1;
  const humaPoolStateAddr = MOCK_HUMA_ADDRESSES.poolState;

  describe("1. Pre-fetched nextRequestId Invariants", () => {
    it("silently returns [] immediately with zero RPC calls when pre-fetched nextRequestId is 0n", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

      try {
        const rpc = new MockRpcBuilder().build();
        const candidates = await fetchPendingRedemptionCandidates({
          rpc,
          poolId,
          nextRequestId: 0n,
        });

        assert.deepStrictEqual(candidates, []);
        assert.strictEqual(
          warnings.length,
          0,
          "No warnings should be emitted on nextRequestId === 0n"
        );
      } finally {
        console.warn = origWarn;
      }
    });

    it("skips getAccountInfo and only invokes getProgramAccounts when nextRequestId > 0n is passed", async () => {
      const red1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 10n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: red1 },
          },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        nextRequestId: 5n,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 10n);
      assert.strictEqual(candidates[0].humaRequestId, 2n);
    });
  });

  describe("2. Address & Missing Account Handling", () => {
    it("returns [] immediately without RPC calls when humaPoolState is unconfigured", async () => {
      const rpc = new MockRpcBuilder().build();
      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        humaPoolState: "",
      });

      assert.deepStrictEqual(candidates, []);
    });

    it("logs warning and returns [] when Huma pool state account does not exist (null value)", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

      try {
        const rpc = new MockRpcBuilder()
          .withAccount(humaPoolStateAddr, null)
          .build();

        const candidates = await fetchPendingRedemptionCandidates({
          rpc,
          poolId,
          humaPoolState: humaPoolStateAddr,
        });

        assert.deepStrictEqual(candidates, []);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Huma pool state account not found/);
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe("3. Data Integrity & Truncation", () => {
    it("logs warning and returns [] when Huma pool state data fails base64 decoding", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

      try {
        const rpc = {
          getAccountInfo: () => ({
            send: async () => ({
              value: {
                executable: false,
                lamports: 1_000_000n,
                owner: TEST_ADDRESSES.USER,
                space: 10n,
                data: ["!!!invalid-base64!!!", "base64"],
              },
            }),
          }),
        };

        const candidates = await fetchPendingRedemptionCandidates({
          rpc,
          poolId,
          humaPoolState: humaPoolStateAddr,
        });

        assert.deepStrictEqual(candidates, []);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Failed to decode Huma pool state data/);
      } finally {
        console.warn = origWarn;
      }
    });

    it("logs warning and returns [] when Huma pool state is truncated (< 30 bytes)", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

      try {
        const rpc = new MockRpcBuilder()
          .withAccount(humaPoolStateAddr, new Uint8Array(20))
          .build();

        const candidates = await fetchPendingRedemptionCandidates({
          rpc,
          poolId,
          humaPoolState: humaPoolStateAddr,
        });

        assert.deepStrictEqual(candidates, []);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Truncated Huma pool state account data/);
      } finally {
        console.warn = origWarn;
      }
    });

    it("logs warning and returns [] when Huma pool state is truncated before redemption queue (30..281 bytes)", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

      try {
        // Buffer has numModes = 1 (modeConfigKeysOffset = 246, redemptionOffset = 250, required = 282 bytes)
        // Providing 100 bytes is between 30 and 281 bytes
        const truncatedBytes = new Uint8Array(100);
        const view = new DataView(truncatedBytes.buffer);
        view.setUint32(26, 1, true); // numModes = 1

        const rpc = new MockRpcBuilder()
          .withAccount(humaPoolStateAddr, truncatedBytes)
          .build();

        const candidates = await fetchPendingRedemptionCandidates({
          rpc,
          poolId,
          humaPoolState: humaPoolStateAddr,
        });

        assert.deepStrictEqual(candidates, []);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /Truncated Huma pool state account data/);
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe("4. Idle Queue Invariant (Primary Bug Fix)", () => {
    it("silently returns [] without warning or getProgramAccounts when nextRequestId is 0n on-chain", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

      try {
        const healthyIdleState = createHumaPoolStateBytes({
          numModes: 1,
          nextRequestId: 0n,
          lastRequestId: 0n,
        });

        const rpc = new MockRpcBuilder()
          .withAccount(humaPoolStateAddr, healthyIdleState)
          .build();

        const candidates = await fetchPendingRedemptionCandidates({
          rpc,
          poolId,
          humaPoolState: humaPoolStateAddr,
        });

        assert.deepStrictEqual(candidates, []);
        assert.strictEqual(
          warnings.length,
          0,
          "No false-alarm warning when nextRequestId is legitimately 0n"
        );
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe("5. RPC Error Propagation (Non-Swallowing)", () => {
    it("propagates transport errors from getAccountInfo so callers can detect network failures", async () => {
      const rpc = new MockRpcBuilder()
        .withAccountError(
          humaPoolStateAddr,
          new Error("HTTP 429 Too Many Requests")
        )
        .build();

      await assert.rejects(
        async () => {
          await fetchPendingRedemptionCandidates({
            rpc,
            poolId,
            humaPoolState: humaPoolStateAddr,
          });
        },
        {
          name: "Error",
          message: "HTTP 429 Too Many Requests",
        }
      );
    });

    it("propagates transport errors from getProgramAccounts so callers can detect network failures", async () => {
      const healthyActiveState = createHumaPoolStateBytes({
        numModes: 1,
        nextRequestId: 5n,
        lastRequestId: 10n,
      });

      const rpc = new MockRpcBuilder()
        .withAccount(humaPoolStateAddr, healthyActiveState)
        .withProgramAccountsError(
          PROGRAM_ID,
          new Error("504 Gateway Timeout on GPA")
        )
        .build();

      await assert.rejects(
        async () => {
          await fetchPendingRedemptionCandidates({
            rpc,
            poolId,
            humaPoolState: humaPoolStateAddr,
          });
        },
        {
          name: "Error",
          message: "504 Gateway Timeout on GPA",
        }
      );
    });
  });

  describe("6. Candidate Filtering Invariants", () => {
    it("includes redemptions where humaRequestId < nextRequestId", async () => {
      const redSettled = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: redSettled },
          },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        nextRequestId: 3n,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 1n);
      assert.strictEqual(candidates[0].humaRequestId, 2n);
    });

    it("excludes redemptions where humaRequestId >= nextRequestId (unsettled)", async () => {
      const redSettled = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });
      const redUnsettledExact = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 2n,
        batchId: 5n,
        user: TEST_ADDRESSES.USER,
      });
      const redUnsettledFuture = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 3n,
        batchId: 6n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: redSettled },
          },
          {
            pubkey: TEST_ADDRESSES.USER_2,
            account: { data: redUnsettledExact },
          },
          {
            pubkey: TEST_ADDRESSES.ADMIN,
            account: { data: redUnsettledFuture },
          },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        nextRequestId: 5n,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 1n);
      assert.strictEqual(candidates[0].humaRequestId, 2n);
    });

    it("excludes redemptions belonging to other pool IDs", async () => {
      const redPool1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });
      const redPool2 = buildMockPendingRedemptionEncoded({
        poolId: 2,
        redemptionId: 2n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: redPool1 },
          },
          {
            pubkey: TEST_ADDRESSES.USER_2,
            account: { data: redPool2 },
          },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId: 1,
        nextRequestId: 5n,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 1n);
    });

    it("gracefully ignores corrupted or unparsable account bytes in getProgramAccounts", async () => {
      const redValid = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.ADMIN,
            account: { data: new Uint8Array(10) }, // too short / unparsable
          },
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: redValid },
          },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        nextRequestId: 5n,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 1n);
    });
  });

  describe("7. Sorting Invariants", () => {
    it("sorts candidates ascending by humaRequestId", async () => {
      const redReq3 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 3n,
        user: TEST_ADDRESSES.USER,
      });
      const redReq1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 2n,
        batchId: 1n,
        user: TEST_ADDRESSES.USER,
      });
      const redReq2 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 3n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: redReq3 },
          },
          {
            pubkey: TEST_ADDRESSES.USER_2,
            account: { data: redReq1 },
          },
          {
            pubkey: TEST_ADDRESSES.ADMIN,
            account: { data: redReq2 },
          },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        nextRequestId: 10n,
      });

      assert.strictEqual(candidates.length, 3);
      assert.strictEqual(candidates[0].humaRequestId, 1n);
      assert.strictEqual(candidates[1].humaRequestId, 2n);
      assert.strictEqual(candidates[2].humaRequestId, 3n);
    });

    it("breaks humaRequestId ties by sorting redemptionId ascending", async () => {
      const redId20 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 20n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });
      const redId10 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 10n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });
      const redId30 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 30n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: redId20 },
          },
          {
            pubkey: TEST_ADDRESSES.USER_2,
            account: { data: redId10 },
          },
          {
            pubkey: TEST_ADDRESSES.ADMIN,
            account: { data: redId30 },
          },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        nextRequestId: 5n,
      });

      assert.strictEqual(candidates.length, 3);
      assert.strictEqual(candidates[0].redemptionId, 10n);
      assert.strictEqual(candidates[1].redemptionId, 20n);
      assert.strictEqual(candidates[2].redemptionId, 30n);
    });
  });

  describe("8. Helper Unit Tests", () => {
    it("compareBigInt correctly orders negative, equal, and positive bigint relations", () => {
      assert.strictEqual(compareBigInt(1n, 2n), -1);
      assert.strictEqual(compareBigInt(2n, 1n), 1);
      assert.strictEqual(compareBigInt(5n, 5n), 0);
      assert.strictEqual(compareBigInt(-10n, 0n), -1);
      assert.strictEqual(compareBigInt(0n, -10n), 1);
      assert.strictEqual(compareBigInt(0n, 0n), 0);
    });

    it("fetchHumaQueueNextRequestId returns nextRequestId for valid queue state", async () => {
      const state = createHumaPoolStateBytes({
        numModes: 1,
        nextRequestId: 42n,
        lastRequestId: 50n,
      });

      const rpc = new MockRpcBuilder()
        .withAccount(humaPoolStateAddr, state)
        .build();

      const nextReqId = await fetchHumaQueueNextRequestId(
        rpc,
        humaPoolStateAddr
      );
      assert.strictEqual(nextReqId, 42n);
    });
  });
});
