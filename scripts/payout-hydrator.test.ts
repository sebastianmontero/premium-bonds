import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PayoutHydratorService,
  deriveDrawWinnerRows,
  type SolanaRpcClient,
} from "../app/lib/indexer/payout-hydrator";
import {
  findPayoutRegistryPda,
  findDrawCyclePda,
  parsePayoutRegistry,
  parseDrawCycle,
} from "../app/lib/bonds-sdk";
import { deriveRandomIndex } from "../app/lib/vrf-utils";
import { isAddress } from "@solana/kit";
import { DrawStatus } from "../app/lib/generated/yield-bonds/src/generated/types/drawStatus";
import {
  buildMockDrawCycleEncoded,
  buildMockPayoutRegistryEncoded,
  MockRpcBuilder,
  TEST_ADDRESSES,
} from "@/app/lib/test-harness";

describe("PayoutHydrator Test Hardening Suite", () => {
  const TEST_ADDR_1 = TEST_ADDRESSES.USER;
  const TEST_ADDR_2 = TEST_ADDRESSES.USER_2;

  describe("Vector 1: PDA Regression & Address Guards", () => {
    it("should return valid base58 address for findPayoutRegistryPda without string destructuring bug", async () => {
      const payoutPda = await findPayoutRegistryPda(1, 1);
      assert.strictEqual(typeof payoutPda, "string");
      assert.ok(
        payoutPda.length >= 32 && payoutPda.length <= 44,
        `PDA length ${payoutPda.length} out of range 32..44`
      );
      assert.strictEqual(
        isAddress(payoutPda),
        true,
        "payoutPda is a valid Solana Address"
      );

      // Verify the post-mortem bug: array destructuring a string produces a 1-character string
      const [corruptedSingleChar] = payoutPda;
      assert.strictEqual(corruptedSingleChar.length, 1);
      assert.strictEqual(
        isAddress(corruptedSingleChar),
        false,
        "1-character string must be rejected by isAddress"
      );
    });

    it("should return valid base58 address for findDrawCyclePda", async () => {
      const cyclePda = await findDrawCyclePda(1, 1);
      assert.strictEqual(typeof cyclePda, "string");
      assert.ok(
        cyclePda.length >= 32 && cyclePda.length <= 44,
        `PDA length ${cyclePda.length} out of range 32..44`
      );
      assert.strictEqual(
        isAddress(cyclePda),
        true,
        "cyclePda is a valid Solana Address"
      );
    });
  });

  describe("Vector 2: Pure Winner Row Derivation (deriveDrawWinnerRows)", () => {
    it("should fallback to winningTicketIdx = null when randomnessSeed is all zeros", async () => {
      const allZeroSeed = new Uint8Array(32).fill(0);
      const rows = await deriveDrawWinnerRows({
        poolId: 1,
        cycleId: 1,
        payout: {
          revealedAt: 1700003600n,
          winnersCount: 2,
          winners: [
            {
              winner: TEST_ADDR_1,
              tierIndex: 0,
              amountOwed: 50_000_000n,
              processed: 0,
              bondsBought: 0,
            },
            {
              winner: TEST_ADDR_2,
              tierIndex: 1,
              amountOwed: 25_000_000n,
              processed: 0,
              bondsBought: 0,
            },
          ],
        } as any,
        cycle: {
          randomnessSeed: allZeroSeed,
          lockedTicketCount: 500,
        },
      });

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].winningTicketIdx, null);
      assert.strictEqual(rows[1].winningTicketIdx, null);
      assert.strictEqual(rows[0].winnerAddress, TEST_ADDR_1.toString());
      assert.strictEqual(rows[1].winnerAddress, TEST_ADDR_2.toString());
      assert.strictEqual(rows[0].amountOwed, 50_000_000n);
      assert.strictEqual(rows[1].amountOwed, 25_000_000n);
    });

    it("should fallback to winningTicketIdx = null when lockedTicketCount is 0", async () => {
      const activeSeed = new Uint8Array(32).fill(99);
      const rows = await deriveDrawWinnerRows({
        poolId: 1,
        cycleId: 1,
        payout: {
          revealedAt: 1700003600n,
          winnersCount: 1,
          winners: [
            {
              winner: TEST_ADDR_1,
              tierIndex: 0,
              amountOwed: 10_000_000n,
              processed: 0,
            },
          ],
        } as any,
        cycle: {
          randomnessSeed: activeSeed,
          lockedTicketCount: 0,
        },
      });

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].winningTicketIdx, null);
    });

    it("should derive deterministic ticket indices when VRF seed is active and lockedTickets > 0", async () => {
      const activeSeed = new Uint8Array(32);
      for (let i = 0; i < 32; i++) activeSeed[i] = i + 1;

      const lockedTickets = 1000;
      const cycleId = 5;

      const expectedTicketTier0Slot0 = await deriveRandomIndex(
        activeSeed,
        0, // tier 0
        0, // slot 0
        cycleId,
        lockedTickets
      );
      const expectedTicketTier0Slot1 = await deriveRandomIndex(
        activeSeed,
        0, // tier 0
        1, // slot 1
        cycleId,
        lockedTickets
      );
      const expectedTicketTier1Slot0 = await deriveRandomIndex(
        activeSeed,
        1, // tier 1
        0, // slot 0
        cycleId,
        lockedTickets
      );

      const rows = await deriveDrawWinnerRows({
        poolId: 1,
        cycleId,
        payout: {
          revealedAt: 1700003600n,
          winnersCount: 3,
          winners: [
            {
              winner: TEST_ADDR_1,
              tierIndex: 0,
              amountOwed: 50_000_000n,
              processed: 0,
              bondsBought: 10,
            },
            {
              winner: TEST_ADDR_2,
              tierIndex: 0,
              amountOwed: 50_000_000n,
              processed: 1,
              bondsBought: 0,
            },
            {
              winner: TEST_ADDR_1,
              tierIndex: 1,
              amountOwed: 20_000_000n,
              processed: 0,
              bondsBought: 0,
            },
          ],
        } as any,
        cycle: {
          randomnessSeed: activeSeed,
          lockedTicketCount: lockedTickets,
        },
      });

      assert.strictEqual(rows.length, 3);
      assert.strictEqual(
        rows[0].winningTicketIdx,
        BigInt(expectedTicketTier0Slot0)
      );
      assert.strictEqual(
        rows[1].winningTicketIdx,
        BigInt(expectedTicketTier0Slot1)
      );
      assert.strictEqual(
        rows[2].winningTicketIdx,
        BigInt(expectedTicketTier1Slot0)
      );

      // Invariant: Different slots in same tier must have distinct ticket numbers (unless modulo collides)
      assert.strictEqual(rows[0].tierIndex, 0);
      assert.strictEqual(rows[1].tierIndex, 0);
      assert.strictEqual(rows[2].tierIndex, 1);
      assert.strictEqual(rows[0].processed, false);
      assert.strictEqual(rows[1].processed, true);
      assert.strictEqual(rows[0].bondsBought, 10n);
    });

    it("should slice winners up to winnersCount, ignoring uninitialized trailing array slots", async () => {
      const activeSeed = new Uint8Array(32).fill(42);
      const rows = await deriveDrawWinnerRows({
        poolId: 1,
        cycleId: 1,
        payout: {
          revealedAt: 1700003600n,
          winnersCount: 1,
          winners: [
            {
              winner: TEST_ADDR_1,
              tierIndex: 0,
              amountOwed: 100_000_000n,
            },
            {
              winner: TEST_ADDR_2,
              tierIndex: 1,
              amountOwed: 50_000_000n,
            },
            {
              winner: TEST_ADDR_1,
              tierIndex: 2,
              amountOwed: 25_000_000n,
            },
          ],
        } as any,
        cycle: {
          randomnessSeed: activeSeed,
          lockedTicketCount: 500,
        },
      });

      assert.strictEqual(
        rows.length,
        1,
        "Only 1 row should be processed because winnersCount = 1"
      );
      assert.strictEqual(rows[0].winnerAddress, TEST_ADDR_1.toString());
    });

    it("should handle null or missing winner address gracefully with Unknown fallback", async () => {
      const activeSeed = new Uint8Array(32).fill(1);
      const rows = await deriveDrawWinnerRows({
        poolId: 1,
        cycleId: 1,
        payout: {
          revealedAt: 1700003600n,
          winnersCount: 1,
          winners: [
            {
              winner: null,
              tierIndex: 0,
              amountOwed: 10_000_000n,
            },
          ],
        } as any,
        cycle: {
          randomnessSeed: activeSeed,
          lockedTicketCount: 100,
        },
      });

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].winnerAddress, "Unknown");
    });
  });

  describe("Vector 3: RPC Replication Lag & Transient Retry Logic", () => {
    it("should retry and successfully recover when accounts are missing on first attempt", async () => {
      const payoutPda = await findPayoutRegistryPda(1, 1);
      const cyclePda = await findDrawCyclePda(1, 1);

      const mockPayoutBuf = buildMockPayoutRegistryEncoded({
        poolId: 1,
        cycleId: 1,
      });
      const mockCycleBuf = buildMockDrawCycleEncoded({
        poolId: 1,
        cycleId: 1,
        status: DrawStatus.Complete,
      });

      const rpcBuilder = new MockRpcBuilder()
        .withAccountSequence(payoutPda, [null, mockPayoutBuf])
        .withAccountSequence(cyclePda, [null, mockCycleBuf]);

      const mockRpc = rpcBuilder.build() as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0], // zero delays for fast test
      });

      const accounts = await service.fetchDrawAccounts(1, 1);
      assert.ok(accounts !== null, "Accounts should be resolved after retry");
      assert.strictEqual(
        rpcBuilder.getAccountCallCount(payoutPda),
        2,
        "RPC should have been called exactly twice"
      );

      const parsedPayout = parsePayoutRegistry(accounts.payoutData);
      const parsedCycle = parseDrawCycle(accounts.cycleData);
      assert.strictEqual(parsedPayout.poolId, 1);
      assert.strictEqual(parsedCycle.poolId, 1);
    });
  });

  describe("Vector 4: Missing Accounts & Permanent Failure Recovery", () => {
    it("should return null after exhausting all retries when accounts do not exist", async () => {
      const payoutPda = await findPayoutRegistryPda(1, 999);
      const cyclePda = await findDrawCyclePda(1, 999);

      const rpcBuilder = new MockRpcBuilder()
        .withAccountSequence(payoutPda, [null, null, null])
        .withAccountSequence(cyclePda, [null, null, null]);

      const mockRpc = rpcBuilder.build() as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0], // 1 initial + 2 retries = 3 calls
      });

      const accounts = await service.fetchDrawAccounts(1, 999);
      assert.strictEqual(accounts, null);
      assert.strictEqual(
        rpcBuilder.getAccountCallCount(payoutPda),
        3,
        "RPC should have been called 3 times (1 initial + 2 retries)"
      );
    });
  });

  describe("Vector 5: RPC Network Exception Handling", () => {
    it("should recover from transient network exception on first call and succeed on second call", async () => {
      const payoutPda = await findPayoutRegistryPda(1, 2);
      const cyclePda = await findDrawCyclePda(1, 2);

      const mockPayoutBuf = buildMockPayoutRegistryEncoded({
        poolId: 1,
        cycleId: 2,
      });
      const mockCycleBuf = buildMockDrawCycleEncoded({
        poolId: 1,
        cycleId: 2,
        status: DrawStatus.Complete,
      });

      const rpcBuilder = new MockRpcBuilder()
        .withAccountSequence(payoutPda, [
          new Error("HTTP 429 Too Many Requests"),
          mockPayoutBuf,
        ])
        .withAccount(cyclePda, mockCycleBuf);

      const mockRpc = rpcBuilder.build() as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0],
      });

      const accounts = await service.fetchDrawAccounts(1, 2);
      assert.ok(
        accounts !== null,
        "Should recover after transient network exception"
      );
      assert.strictEqual(rpcBuilder.getAccountCallCount(payoutPda), 2);
    });

    it("should re-throw when network exception persists across all retries", async () => {
      const payoutPda = await findPayoutRegistryPda(1, 1);
      const cyclePda = await findDrawCyclePda(1, 1);

      const rpcBuilder = new MockRpcBuilder()
        .withAccountSequence(payoutPda, [
          new Error("Connection Refused ECONNREFUSED"),
          new Error("Connection Refused ECONNREFUSED"),
          new Error("Connection Refused ECONNREFUSED"),
        ])
        .withAccountSequence(cyclePda, [
          new Error("Connection Refused ECONNREFUSED"),
          new Error("Connection Refused ECONNREFUSED"),
          new Error("Connection Refused ECONNREFUSED"),
        ]);

      const mockRpc = rpcBuilder.build() as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0],
      });

      await assert.rejects(async () => {
        await service.fetchDrawAccounts(1, 1);
      }, /Connection Refused ECONNREFUSED/);
      assert.strictEqual(
        rpcBuilder.getAccountCallCount(payoutPda),
        3,
        "Should have attempted initial + 2 retries"
      );
    });
  });

  describe("Service Instantiation & Interface", () => {
    it("should instantiate with URL string or SolanaRpcClient instance", () => {
      const serviceFromUrl = new PayoutHydratorService("http://127.0.0.1:8899");
      assert.ok(serviceFromUrl instanceof PayoutHydratorService);

      const mockRpc = {} as SolanaRpcClient;
      const serviceFromClient = new PayoutHydratorService(mockRpc);
      assert.ok(serviceFromClient instanceof PayoutHydratorService);
    });
  });
});
