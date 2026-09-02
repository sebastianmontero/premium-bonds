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
import { isAddress, address, type Address } from "@solana/kit";
import { getPayoutRegistryEncoder } from "../app/lib/generated/yield-bonds/src/generated/accounts/payoutRegistry";
import { getDrawCycleEncoder } from "../app/lib/generated/yield-bonds/src/generated/accounts/drawCycle";
import { DrawStatus } from "../app/lib/generated/yield-bonds/src/generated/types/drawStatus";

// Helpers to construct valid mock binary accounts
function createMockDrawCycleBuffer(params: {
  poolId?: number;
  cycleId?: number;
  lockedTicketCount?: number;
  randomnessSeed?: Uint8Array;
  status?: DrawStatus;
}): Buffer {
  const bytes = getDrawCycleEncoder().encode({
    poolId: params.poolId ?? 1,
    cycleId: params.cycleId ?? 1,
    prizePot: 100_000_000n,
    cycleFeeCollected: 5_000_000n,
    harvestSlot: 1000n,
    initiatedAt: 1700000000n,
    completedAt: 1700003600n,
    randomnessAccount: address("11111111111111111111111111111111"),
    lockedTicketCount: params.lockedTicketCount ?? 500,
    status: params.status ?? DrawStatus.Complete,
    version: 1,
    randomnessSeed: params.randomnessSeed ?? new Uint8Array(32).fill(7),
    reserved: new Uint8Array(64),
  });
  return Buffer.from(bytes);
}

function createMockPayoutRegistryBuffer(params: {
  poolId?: number;
  cycleId?: number;
  winnersCount?: number;
  winners?: Array<{
    winner: Address;
    tierIndex: number;
    amountOwed: bigint;
    processed?: number;
    bondsBought?: number;
  }>;
}): Buffer {
  const emptyWinner = {
    winner: address("11111111111111111111111111111111"),
    tierIndex: 0,
    amountOwed: 0n,
    processed: 0,
    bondsBought: 0,
    version: 1,
    padding: new Uint8Array(1),
    reserved: new Uint8Array(8),
  };

  const winnersList = Array.from({ length: 50 }, (_, idx) => {
    const custom = params.winners?.[idx];
    if (custom) {
      return {
        ...emptyWinner,
        winner: custom.winner,
        tierIndex: custom.tierIndex,
        amountOwed: custom.amountOwed,
        processed: custom.processed ?? 0,
        bondsBought: custom.bondsBought ?? 0,
      };
    }
    return { ...emptyWinner };
  });

  const bytes = getPayoutRegistryEncoder().encode({
    poolId: params.poolId ?? 1,
    cycleId: params.cycleId ?? 1,
    winnersCount:
      params.winnersCount ?? (params.winners ? params.winners.length : 0),
    payoutsCompleted: 0,
    revealedAt: 1700003600n,
    status: 0,
    version: 1,
    padding: new Uint8Array(6),
    reserved: new Uint8Array(64),
    winners: winnersList,
  });
  return Buffer.from(bytes);
}

describe("PayoutHydrator Test Hardening Suite", () => {
  const TEST_ADDR_1 = address("11111111111111111111111111111111");
  const TEST_ADDR_2 = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

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
      const mockPayoutBuf = createMockPayoutRegistryBuffer({
        poolId: 1,
        cycleId: 1,
      });
      const mockCycleBuf = createMockDrawCycleBuffer({ poolId: 1, cycleId: 1 });

      let callCount = 0;
      const mockRpc = {
        getMultipleAccounts: (_addresses: any, _opts: any) => ({
          send: async () => {
            callCount++;
            if (callCount === 1) {
              // Attempt 1: replication lag (accounts not yet available)
              return { value: [null, null] };
            }
            // Attempt 2: accounts available
            return {
              value: [
                { data: [mockPayoutBuf.toString("base64"), "base64"] },
                { data: [mockCycleBuf.toString("base64"), "base64"] },
              ],
            };
          },
        }),
      } as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0], // zero delays for fast test
      });

      const accounts = await service.fetchDrawAccounts(1, 1);
      assert.ok(accounts !== null, "Accounts should be resolved after retry");
      assert.strictEqual(
        callCount,
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
      let callCount = 0;
      const mockRpc = {
        getMultipleAccounts: (_addresses: any, _opts: any) => ({
          send: async () => {
            callCount++;
            return { value: [null, null] };
          },
        }),
      } as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0], // 1 initial + 2 retries = 3 calls
      });

      const accounts = await service.fetchDrawAccounts(1, 999);
      assert.strictEqual(accounts, null);
      assert.strictEqual(
        callCount,
        3,
        "RPC should have been called 3 times (1 initial + 2 retries)"
      );
    });
  });

  describe("Vector 5: RPC Network Exception Handling", () => {
    it("should recover from transient network exception on first call and succeed on second call", async () => {
      const mockPayoutBuf = createMockPayoutRegistryBuffer({
        poolId: 1,
        cycleId: 2,
      });
      const mockCycleBuf = createMockDrawCycleBuffer({ poolId: 1, cycleId: 2 });

      let callCount = 0;
      const mockRpc = {
        getMultipleAccounts: (_addresses: any, _opts: any) => ({
          send: async () => {
            callCount++;
            if (callCount === 1) {
              throw new Error("HTTP 429 Too Many Requests");
            }
            return {
              value: [
                { data: [mockPayoutBuf.toString("base64"), "base64"] },
                { data: [mockCycleBuf.toString("base64"), "base64"] },
              ],
            };
          },
        }),
      } as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0],
      });

      const accounts = await service.fetchDrawAccounts(1, 2);
      assert.ok(
        accounts !== null,
        "Should recover after transient network exception"
      );
      assert.strictEqual(callCount, 2);
    });

    it("should re-throw when network exception persists across all retries", async () => {
      let callCount = 0;
      const mockRpc = {
        getMultipleAccounts: (_addresses: any, _opts: any) => ({
          send: async () => {
            callCount++;
            throw new Error("Connection Refused ECONNREFUSED");
          },
        }),
      } as unknown as SolanaRpcClient;

      const service = new PayoutHydratorService(mockRpc, {
        retryDelays: [0, 0],
      });

      await assert.rejects(async () => {
        await service.fetchDrawAccounts(1, 1);
      }, /Connection Refused ECONNREFUSED/);
      assert.strictEqual(
        callCount,
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
