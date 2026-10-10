import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPendingRedemptionCandidates,
  fetchHumaQueueNextRequestId,
  findRedemptionBatchPda,
  compareBigInt,
  PROGRAM_ID,
} from "../bonds-sdk";
import {
  MockRpcBuilder,
  buildMockPendingRedemptionEncoded,
  buildMockRedemptionBatchEncoded,
  RedemptionBatchStatus,
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

describe("fetchPendingRedemptionCandidates & Batch Invariants", () => {
  const poolId = 1;
  const humaPoolStateAddr = MOCK_HUMA_ADDRESSES.poolState;

  describe("1. Fast-path settledBatchIds Invariants", () => {
    it("filters candidates strictly in-memory using array settledBatchIds without querying batch accounts", async () => {
      const red1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 10n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });
      const red2 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 20n,
        batchId: 1n,
        user: TEST_ADDRESSES.USER,
      });

      // RPC does NOT have batch accounts configured, so if it queried them it would find nulls
      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: red1 } },
          { pubkey: TEST_ADDRESSES.USER_2, account: { data: red2 } },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        settledBatchIds: [0n],
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 10n);
      assert.strictEqual(candidates[0].batchId, 0n);
      assert.strictEqual(candidates[0].pubkey, TEST_ADDRESSES.USER);
    });

    it("filters candidates correctly when settledBatchIds is passed as a Set<bigint>", async () => {
      const red1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 10n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });
      const red2 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 20n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER_2,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: red1 } },
          { pubkey: TEST_ADDRESSES.USER_2, account: { data: red2 } },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        settledBatchIds: new Set([2n]),
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 20n);
      assert.strictEqual(candidates[0].batchId, 2n);
    });

    it("returns empty array if no pending redemptions match settledBatchIds", async () => {
      const red1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 10n,
        batchId: 5n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: red1 } },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
        settledBatchIds: [1n, 2n],
      });

      assert.deepStrictEqual(candidates, []);
    });
  });

  describe("2. On-Chain RedemptionBatch Resolution Invariants", () => {
    it("fetches batch accounts and returns candidates only for batches with status === Settled", async () => {
      const redBatch0 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });
      const redBatch1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 2n,
        batchId: 1n,
        user: TEST_ADDRESSES.USER_2,
      });
      const redBatch2 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 3n,
        batchId: 2n,
        user: TEST_ADDRESSES.ADMIN,
      });

      const batch0Pda = await findRedemptionBatchPda(1, 0n);
      const batch1Pda = await findRedemptionBatchPda(1, 1n);
      const batch2Pda = await findRedemptionBatchPda(1, 2n);

      const batch0Data = buildMockRedemptionBatchEncoded({
        poolId: 1,
        batchId: 0n,
        status: RedemptionBatchStatus.Settled,
      });
      const batch1Data = buildMockRedemptionBatchEncoded({
        poolId: 1,
        batchId: 1n,
        status: RedemptionBatchStatus.Accumulating,
      });
      const batch2Data = buildMockRedemptionBatchEncoded({
        poolId: 1,
        batchId: 2n,
        status: RedemptionBatchStatus.Submitted,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: redBatch0 } },
          { pubkey: TEST_ADDRESSES.USER_2, account: { data: redBatch1 } },
          { pubkey: TEST_ADDRESSES.ADMIN, account: { data: redBatch2 } },
        ])
        .withAccount(batch0Pda, batch0Data)
        .withAccount(batch1Pda, batch1Data)
        .withAccount(batch2Pda, batch2Data)
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 1n);
      assert.strictEqual(candidates[0].batchId, 0n);
    });

    it("falls back to getAccountInfo when getMultipleAccounts is unavailable", async () => {
      const red = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 5n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });

      const batch0Pda = await findRedemptionBatchPda(1, 0n);
      const batch0Data = buildMockRedemptionBatchEncoded({
        poolId: 1,
        batchId: 0n,
        status: RedemptionBatchStatus.Settled,
      });

      const baseRpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: red } },
        ])
        .withAccount(batch0Pda, batch0Data)
        .build();

      // RPC without getMultipleAccounts method
      const rpcWithoutGMA = {
        getProgramAccounts: baseRpc.getProgramAccounts,
        getAccountInfo: baseRpc.getAccountInfo,
      };

      const candidates = await fetchPendingRedemptionCandidates({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rpc: rpcWithoutGMA as any,
        poolId,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 5n);
    });
  });

  describe("3. Fault Tolerance & Corrupt Account Handling", () => {
    it("handles missing batch account (null) safely without throwing, excluding candidate", async () => {
      const red = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 99n,
        user: TEST_ADDRESSES.USER,
      });

      // No batch account added for batch 99n
      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: red } },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
      });

      assert.deepStrictEqual(candidates, []);
    });

    it("handles corrupt batch account data safely without throwing, excluding candidate", async () => {
      const red = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });

      const batch0Pda = await findRedemptionBatchPda(1, 0n);

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: red } },
        ])
        .withAccount(batch0Pda, new Uint8Array(10)) // corrupted short byte length
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
      });

      assert.deepStrictEqual(candidates, []);
    });

    it("gracefully ignores corrupted or unparsable account bytes in getProgramAccounts", async () => {
      const redValid = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });

      const batch0Pda = await findRedemptionBatchPda(1, 0n);
      const batch0Data = buildMockRedemptionBatchEncoded({
        poolId: 1,
        batchId: 0n,
        status: RedemptionBatchStatus.Settled,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          {
            pubkey: TEST_ADDRESSES.ADMIN,
            account: { data: new Uint8Array(10) }, // corrupted short bytes
          },
          {
            pubkey: TEST_ADDRESSES.USER,
            account: { data: redValid },
          },
        ])
        .withAccount(batch0Pda, batch0Data)
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 1n);
    });

    it("propagates transport errors from getProgramAccounts so callers can detect failures", async () => {
      const rpc = new MockRpcBuilder()
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
          });
        },
        {
          name: "Error",
          message: "504 Gateway Timeout on GPA",
        }
      );
    });
  });

  describe("4. Multi-Pool & User Isolation", () => {
    it("excludes redemptions belonging to other pool IDs", async () => {
      const redPool1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });
      const redPool2 = buildMockPendingRedemptionEncoded({
        poolId: 2,
        redemptionId: 2n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });

      const batch0Pda = await findRedemptionBatchPda(1, 0n);
      const batch0Data = buildMockRedemptionBatchEncoded({
        poolId: 1,
        batchId: 0n,
        status: RedemptionBatchStatus.Settled,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: redPool1 } },
          { pubkey: TEST_ADDRESSES.USER_2, account: { data: redPool2 } },
        ])
        .withAccount(batch0Pda, batch0Data)
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId: 1,
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 1n);
    });

    it("filters by user when user parameter is supplied", async () => {
      const redUser1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });
      const redUser2 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 2n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER_2,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: redUser1 } },
          { pubkey: TEST_ADDRESSES.USER_2, account: { data: redUser2 } },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId: 1,
        user: TEST_ADDRESSES.USER_2,
        settledBatchIds: [0n],
      });

      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].redemptionId, 2n);
      assert.strictEqual(candidates[0].user, TEST_ADDRESSES.USER_2);
    });
  });

  describe("5. Sorting & Limit Invariants", () => {
    it("sorts candidates ascending by batchId, then by redemptionId", async () => {
      const redBatch2Id5 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 5n,
        batchId: 2n,
        user: TEST_ADDRESSES.USER,
      });
      const redBatch1Id20 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 20n,
        batchId: 1n,
        user: TEST_ADDRESSES.USER,
      });
      const redBatch1Id10 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 10n,
        batchId: 1n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: redBatch2Id5 } },
          { pubkey: TEST_ADDRESSES.USER_2, account: { data: redBatch1Id20 } },
          { pubkey: TEST_ADDRESSES.ADMIN, account: { data: redBatch1Id10 } },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId: 1,
        settledBatchIds: [1n, 2n],
      });

      assert.strictEqual(candidates.length, 3);
      assert.strictEqual(candidates[0].batchId, 1n);
      assert.strictEqual(candidates[0].redemptionId, 10n);
      assert.strictEqual(candidates[1].batchId, 1n);
      assert.strictEqual(candidates[1].redemptionId, 20n);
      assert.strictEqual(candidates[2].batchId, 2n);
      assert.strictEqual(candidates[2].redemptionId, 5n);
    });

    it("respects limit parameter and caps returned candidates", async () => {
      const red1 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 1n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });
      const red2 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 2n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });
      const red3 = buildMockPendingRedemptionEncoded({
        poolId: 1,
        redemptionId: 3n,
        batchId: 0n,
        user: TEST_ADDRESSES.USER,
      });

      const rpc = new MockRpcBuilder()
        .withProgramAccounts(PROGRAM_ID, [
          { pubkey: TEST_ADDRESSES.USER, account: { data: red1 } },
          { pubkey: TEST_ADDRESSES.USER_2, account: { data: red2 } },
          { pubkey: TEST_ADDRESSES.ADMIN, account: { data: red3 } },
        ])
        .build();

      const candidates = await fetchPendingRedemptionCandidates({
        rpc,
        poolId: 1,
        settledBatchIds: [0n],
        limit: 2,
      });

      assert.strictEqual(candidates.length, 2);
      assert.strictEqual(candidates[0].redemptionId, 1n);
      assert.strictEqual(candidates[1].redemptionId, 2n);
    });
  });

  describe("6. Helper Unit Tests", () => {
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

    it("fetchHumaQueueNextRequestId returns null on missing account", async () => {
      const rpc = new MockRpcBuilder()
        .withAccount(humaPoolStateAddr, null)
        .build();

      const nextReqId = await fetchHumaQueueNextRequestId(
        rpc,
        humaPoolStateAddr
      );
      assert.strictEqual(nextReqId, null);
    });

    it("fetchHumaQueueNextRequestId returns null on truncated account", async () => {
      const rpc = new MockRpcBuilder()
        .withAccount(humaPoolStateAddr, new Uint8Array(20))
        .build();

      const nextReqId = await fetchHumaQueueNextRequestId(
        rpc,
        humaPoolStateAddr
      );
      assert.strictEqual(nextReqId, null);
    });
  });
});
