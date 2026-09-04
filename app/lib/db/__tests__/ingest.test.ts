import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeForJsonb,
  foldPendingRedemptionRows,
  foldDrawHistoryRows,
  foldWinnerUpdateRows,
  updateDrawWinnersTx,
  WinnerUpdateRow,
  toUnixTimestampSeconds,
  TERMINAL_DRAW_STATUSES,
} from "../ingest";
import { drawHistory } from "../schema";
import { resolveEventMetadata, ParsedProgramEvent } from "../../anchor-events";
import {
  mapDtoToPendingRedemption,
  isPendingRedemptionStatus,
} from "../../indexer-mappers";
import { address } from "@solana/kit";

const userAddr = address("11111111111111111111111111111111");
const randAddr = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("Database Ingestion & Event Metadata Resolution", () => {
  it("should convert BigInts to string recursively in sanitizeForJsonb", () => {
    const input = {
      amount: 1000000n,
      nested: {
        fee: 250n,
        items: [10n, 20n, { count: 50n }],
      },
      normalNumber: 42,
      str: "hello",
    };

    const output = sanitizeForJsonb(input) as {
      amount: string;
      nested: { fee: string; items: unknown[] };
      normalNumber: number;
      str: string;
    };
    assert.strictEqual(output.amount, "1000000", "Top-level BigInt sanitized");
    assert.strictEqual(output.nested.fee, "250", "Nested BigInt sanitized");
    assert.deepStrictEqual(
      output.nested.items,
      ["10", "20", { count: "50" }],
      "Array BigInts sanitized"
    );
    assert.strictEqual(output.normalNumber, 42, "Regular numbers preserved");
    assert.strictEqual(output.str, "hello", "Strings preserved");
  });

  describe("toUnixTimestampSeconds", () => {
    it("should return seconds for valid positive bigint and number", () => {
      assert.strictEqual(
        toUnixTimestampSeconds(1700000000n, 1690000000),
        1700000000
      );
      assert.strictEqual(
        toUnixTimestampSeconds(1700000050, 1690000000),
        1700000050
      );
    });

    it("should fallback to blockTime when timestamp is zero, null, or undefined", () => {
      assert.strictEqual(toUnixTimestampSeconds(0n, 1690000000), 1690000000);
      assert.strictEqual(toUnixTimestampSeconds(0, 1690000000), 1690000000);
      assert.strictEqual(
        toUnixTimestampSeconds(undefined, 1690000000),
        1690000000
      );
      assert.strictEqual(toUnixTimestampSeconds(null, 1690000000), 1690000000);
    });

    it("should return 0 when both on-chain timestamp and fallback are invalid", () => {
      assert.strictEqual(toUnixTimestampSeconds(undefined, 0), 0);
      assert.strictEqual(toUnixTimestampSeconds(-100n, -50), 0);
      assert.strictEqual(toUnixTimestampSeconds(NaN, 0), 0);
    });
  });

  describe("Event Metadata Resolution per Event Type", () => {
    it("should resolve metadata for BondsPurchased", () => {
      const buyEvent: ParsedProgramEvent = {
        type: "BondsPurchased",
        data: {
          user: userAddr,
          poolId: 1,
          bonds: 10,
          amount: 50000000n,
        },
      };
      const meta = resolveEventMetadata(buyEvent);
      assert.strictEqual(meta.scope, "pool");
      assert.deepStrictEqual(meta.scopes, ["pool", "user", "activity"]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for BondsSold", () => {
      const sellEvent: ParsedProgramEvent = {
        type: "BondsSold",
        data: {
          user: userAddr,
          poolId: 1,
          bonds: 5,
          principal: 25000000n,
          redemptionId: 100n,
        },
      };
      const meta = resolveEventMetadata(sellEvent);
      assert.strictEqual(meta.scope, "pool");
      assert.deepStrictEqual(meta.scopes, [
        "pool",
        "user",
        "redemptions",
        "activity",
      ]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for WinningsReinvested", () => {
      const reinvestEvent: ParsedProgramEvent = {
        type: "WinningsReinvested",
        data: {
          winner: userAddr,
          poolId: 1,
          cycleId: 3,
          winnerIndex: 0,
          bondsBought: 2,
          amountReinvested: 10000000n,
        },
      };
      const meta = resolveEventMetadata(reinvestEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, [
        "draws",
        "user",
        "pool",
        "activity",
      ]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for WinningsClaimed", () => {
      const winClaimEvent: ParsedProgramEvent = {
        type: "WinningsClaimed",
        data: {
          user: userAddr,
          poolId: 1,
          amount: 15000000n,
          redemptionId: 101n,
        },
      };
      const meta = resolveEventMetadata(winClaimEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, [
        "draws",
        "user",
        "pool",
        "redemptions",
        "activity",
      ]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for RedemptionClaimed", () => {
      const redClaimEvent: ParsedProgramEvent = {
        type: "RedemptionClaimed",
        data: {
          user: userAddr,
          poolId: 1,
          amount: 25000000n,
          redemptionId: 100n,
        },
      };
      const meta = resolveEventMetadata(redClaimEvent);
      assert.strictEqual(meta.scope, "pool");
      assert.deepStrictEqual(meta.scopes, [
        "pool",
        "user",
        "redemptions",
        "activity",
      ]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for YieldHarvested", () => {
      const harvestEvent: ParsedProgramEvent = {
        type: "YieldHarvested",
        data: {
          poolId: 2,
          cycleId: 5,
          rawYield: 10000000n,
          fee: 250000n,
          prizePot: 9750000n,
          lockedTicketCount: 500,
          randomnessAccount: randAddr,
        },
      };
      const meta = resolveEventMetadata(harvestEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool", "clock"]);
      assert.strictEqual(meta.poolId, 2);
    });

    it("should resolve metadata for DrawCompleted", () => {
      const drawEvent: ParsedProgramEvent = {
        type: "DrawCompleted",
        data: {
          poolId: 1,
          cycleId: 4,
          prizePot: 250000000n,
          winnersCount: 3,
        },
      };
      const meta = resolveEventMetadata(drawEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool"]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, undefined);
    });

    it("should resolve metadata for DrawForceUnlocked", () => {
      const forceUnlockEvent: ParsedProgramEvent = {
        type: "DrawForceUnlocked",
        data: {
          poolId: 1,
          cycleId: 4,
          admin: userAddr,
          prizePot: 250000000n,
          cycleFeeCollected: 5000000n,
        },
      };
      const meta = resolveEventMetadata(forceUnlockEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool"]);
      assert.strictEqual(meta.poolId, 1);
    });

    it("should resolve metadata for DrawVoided", () => {
      const voidEvent: ParsedProgramEvent = {
        type: "DrawVoided",
        data: {
          poolId: 1,
          cycleId: 4,
          admin: userAddr,
          prizesReversed: 250000000n,
          feesReversed: 5000000n,
        },
      };
      const meta = resolveEventMetadata(voidEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool"]);
      assert.strictEqual(meta.poolId, 1);
    });

    it("should resolve metadata for DrawSkipped", () => {
      const skipEvent: ParsedProgramEvent = {
        type: "DrawSkipped",
        data: {
          poolId: 1,
          cycleId: 6,
          rawYield: 100n,
          threshold: 1000000n,
        },
      };
      const meta = resolveEventMetadata(skipEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool", "clock"]);
      assert.strictEqual(meta.poolId, 1);
    });

    it("should resolve metadata for DrawPreparationProgress", () => {
      const prepEvent: ParsedProgramEvent = {
        type: "DrawPreparationProgress",
        data: {
          poolId: 1,
          cycleId: 7,
          batchStart: 0,
          batchEnd: 50,
          userCount: 50,
          isComplete: false,
        },
      };
      const meta = resolveEventMetadata(prepEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws"]);
      assert.strictEqual(meta.poolId, 1);
    });
  });

  describe("foldPendingRedemptionRows & DTO Mappers", () => {
    it("should correctly fold rows with pstSharesLocked and humaRequestId including 0n", () => {
      const rows = [
        {
          poolId: 1,
          redemptionId: 100n,
          userAddress: "user1",
          redemptionType: "bond_sale",
          amountUsdc: 1_000_000n,
          pstSharesLocked: 0n,
          humaRequestId: "0",
          status: "settling",
          requestSignature: "sig1",
          requestedAt: 1700000000,
        },
        {
          poolId: 1,
          redemptionId: 100n,
          userAddress: "user1",
          redemptionType: "bond_sale",
          amountUsdc: 1_000_000n,
          pstSharesLocked: 500_000n,
          humaRequestId: "1180591620717411303424",
          status: "ready",
          requestSignature: "sig1",
          requestedAt: 1700000000,
        },
      ];

      const folded = foldPendingRedemptionRows(rows);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(folded[0].status, "ready");
      assert.strictEqual(folded[0].pstSharesLocked, 500_000n);
      assert.strictEqual(folded[0].humaRequestId, "1180591620717411303424");
    });

    it("should validate isPendingRedemptionStatus type guard correctly", () => {
      assert.strictEqual(isPendingRedemptionStatus("ready"), true);
      assert.strictEqual(isPendingRedemptionStatus("settling"), true);
      assert.strictEqual(isPendingRedemptionStatus("claimed"), false);
      assert.strictEqual(isPendingRedemptionStatus("unknown"), false);
    });

    it("should map DTO to PendingRedemption correctly for ready and settling", () => {
      const readyDto = {
        poolId: 1,
        redemptionId: "100",
        userAddress: "user1",
        redemptionType: "bond_sale",
        amountUsdc: "1000000",
        pstSharesLocked: "500000",
        humaRequestId: "1180591620717411303424",
        status: "ready",
        requestSignature: "sig1",
        claimSignature: null,
        requestedAt: 1700000000,
        claimedAt: null,
      };

      const readyModel = mapDtoToPendingRedemption(readyDto);
      assert.notStrictEqual(readyModel, null);
      assert.strictEqual(readyModel?.redemptionId, "100");
      assert.strictEqual(readyModel?.amount, 1000000);
      assert.strictEqual(readyModel?.status, "ready");
      assert.strictEqual(readyModel?.type, "bond_sale");
      assert.strictEqual(readyModel?.pstSharesLocked, "500000");
      assert.strictEqual(readyModel?.humaRequestId, "1180591620717411303424");

      const settlingDto = {
        ...readyDto,
        redemptionId: "101",
        status: "settling",
      };
      const settlingModel = mapDtoToPendingRedemption(settlingDto);
      assert.notStrictEqual(settlingModel, null);
      assert.strictEqual(settlingModel?.redemptionId, "101");
      assert.strictEqual(settlingModel?.status, "settling");
    });

    it("should return null when mapping non-pending DTO (claimed or invalid)", () => {
      const claimedDto = {
        poolId: 1,
        redemptionId: "102",
        userAddress: "user1",
        redemptionType: "bond_sale",
        amountUsdc: "1000000",
        pstSharesLocked: "500000",
        humaRequestId: "1180591620717411303424",
        status: "claimed",
        requestSignature: "sig1",
        claimSignature: "sig2",
        requestedAt: 1700000000,
        claimedAt: 1700001000,
      };

      const claimedModel = mapDtoToPendingRedemption(claimedDto);
      assert.strictEqual(claimedModel, null);

      const invalidDto = {
        ...claimedDto,
        status: "random_status",
      };
      const invalidModel = mapDtoToPendingRedemption(invalidDto);
      assert.strictEqual(invalidModel, null);
    });
  });

  describe("foldDrawHistoryRows & Draw State Machine", () => {
    it("should fold YieldHarvested + DrawCompleted in order", () => {
      const harvestRow = {
        poolId: 1,
        cycleId: 10,
        status: "AwaitingRandomness",
        prizePot: 500_000_000n,
        cycleFeeCollected: 50_000_000n,
        lockedTicketCount: 1_000n,
        harvestSlot: 1050,
        randomnessAccount: "randAccount1",
        signature: "sig1",
        blockTime: 1700000000,
      };

      const completeRow = {
        poolId: 1,
        cycleId: 10,
        status: "Complete",
        prizePot: 500_000_000n,
        winnersCount: 3,
        totalDistributed: 450_000_000n,
        winnersSynced: false,
        completedAt: 1700000100,
        signature: "sig2",
        blockTime: 1700000100,
      };

      const folded = foldDrawHistoryRows([
        harvestRow as never,
        completeRow as never,
      ]);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(folded[0].status, "Complete");
      assert.strictEqual(
        folded[0].harvestSlot,
        1050,
        "Retains harvestSlot from YieldHarvested"
      );
      assert.strictEqual(folded[0].prizePot, 500_000_000n);
      assert.strictEqual(folded[0].cycleFeeCollected, 50_000_000n);
      assert.strictEqual(folded[0].lockedTicketCount, 1_000n);
      assert.strictEqual(folded[0].randomnessAccount, "randAccount1");
      assert.strictEqual(folded[0].winnersCount, 3);
      assert.strictEqual(folded[0].totalDistributed, 450_000_000n);
      assert.strictEqual(folded[0].winnersSynced, false);
      assert.strictEqual(folded[0].completedAt, 1700000100);
      assert.strictEqual(folded[0].blockTime, 1700000100);
    });

    it("should protect Complete status from out-of-order YieldHarvested downgrade", () => {
      const completeRow = {
        poolId: 1,
        cycleId: 10,
        status: "Complete",
        prizePot: 500_000_000n,
        winnersCount: 3,
        totalDistributed: 450_000_000n,
        winnersSynced: false,
        completedAt: 1700000100,
        signature: "sig2",
        blockTime: 1700000100,
      };

      const harvestRow = {
        poolId: 1,
        cycleId: 10,
        status: "AwaitingRandomness",
        prizePot: 500_000_000n,
        cycleFeeCollected: 50_000_000n,
        lockedTicketCount: 1_000n,
        harvestSlot: 1050,
        randomnessAccount: "randAccount1",
        signature: "sig1",
        blockTime: 1700000000,
      };

      const folded = foldDrawHistoryRows([
        completeRow as never,
        harvestRow as never,
      ]);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(
        folded[0].status,
        "Complete",
        "Status must stay Complete, not revert to AwaitingRandomness"
      );
      assert.strictEqual(
        folded[0].harvestSlot,
        1050,
        "Slot populated even when harvest event arrived second"
      );
      assert.strictEqual(folded[0].winnersCount, 3);
      assert.strictEqual(
        folded[0].blockTime,
        1700000100,
        "Block time remains maximum"
      );
    });

    it("should allow transition from Complete to Voided (Admin Void)", () => {
      const completeRow = {
        poolId: 1,
        cycleId: 10,
        status: "Complete",
        prizePot: 500_000_000n,
        winnersCount: 3,
        totalDistributed: 450_000_000n,
        winnersSynced: false,
        completedAt: 1700000100,
        signature: "sig2",
        blockTime: 1700000100,
      };

      const voidRow = {
        poolId: 1,
        cycleId: 10,
        status: "Voided",
        prizePot: 0n,
        winnersSynced: true,
        signature: "sig3",
        blockTime: 1700000200,
      };

      const folded = foldDrawHistoryRows([
        completeRow as never,
        voidRow as never,
      ]);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(
        folded[0].status,
        "Voided",
        "Complete must transition to Voided upon admin void"
      );
      assert.strictEqual(folded[0].winnersSynced, true);
      assert.strictEqual(folded[0].blockTime, 1700000200);
    });

    it("should enforce immutability for terminal statuses (Voided, Skipped, ForceUnlocked)", () => {
      for (const terminalStatus of TERMINAL_DRAW_STATUSES) {
        const terminalRow = {
          poolId: 1,
          cycleId: 10,
          status: terminalStatus,
          prizePot: 0n,
          winnersSynced: true,
          signature: "sigTerminal",
          blockTime: 1700000000,
        };

        const lateHarvest = {
          poolId: 1,
          cycleId: 10,
          status: "AwaitingRandomness",
          prizePot: 500_000_000n,
          harvestSlot: 1050,
          signature: "sigHarvest",
          blockTime: 1700000050,
        };

        const folded = foldDrawHistoryRows([
          terminalRow as never,
          lateHarvest as never,
        ]);
        assert.strictEqual(folded.length, 1);
        assert.strictEqual(
          folded[0].status,
          terminalStatus,
          `${terminalStatus} must remain immutable`
        );
      }
    });

    it("should preserve winnersSynced monotonicity (true never degrades to false)", () => {
      const rowSynced = {
        poolId: 1,
        cycleId: 10,
        status: "Complete",
        prizePot: 500_000_000n,
        winnersSynced: true,
        signature: "sig1",
        blockTime: 1700000100,
      };

      const rowNotSynced = {
        poolId: 1,
        cycleId: 10,
        status: "Complete",
        prizePot: 500_000_000n,
        winnersSynced: false,
        signature: "sig2",
        blockTime: 1700000150,
      };

      const folded = foldDrawHistoryRows([
        rowSynced as never,
        rowNotSynced as never,
      ]);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(
        folded[0].winnersSynced,
        true,
        "winnersSynced must remain true"
      );
    });

    it("should keep distinct poolId and cycleId records isolated", () => {
      const draw1 = {
        poolId: 1,
        cycleId: 1,
        status: "Complete",
        prizePot: 100n,
        signature: "sig1",
        blockTime: 1700000000,
      };
      const draw2 = {
        poolId: 1,
        cycleId: 2,
        status: "AwaitingRandomness",
        prizePot: 200n,
        signature: "sig2",
        blockTime: 1700000100,
      };
      const draw3 = {
        poolId: 2,
        cycleId: 1,
        status: "Complete",
        prizePot: 300n,
        signature: "sig3",
        blockTime: 1700000200,
      };

      const folded = foldDrawHistoryRows([
        draw1 as never,
        draw2 as never,
        draw3 as never,
      ]);
      assert.strictEqual(folded.length, 3);
      assert.strictEqual(folded[0].cycleId, 1);
      assert.strictEqual(folded[1].cycleId, 2);
      assert.strictEqual(folded[2].poolId, 2);
    });

    it("should retain initiatedAt when folding YieldHarvested + DrawCompleted in order", () => {
      const harvestRow = {
        poolId: 1,
        cycleId: 10,
        status: "AwaitingRandomness",
        initiatedAt: 1700000000,
        prizePot: 500_000_000n,
        signature: "sig1",
        blockTime: 1700000000,
      };
      const completeRow = {
        poolId: 1,
        cycleId: 10,
        status: "Complete",
        prizePot: 500_000_000n,
        winnersCount: 3,
        completedAt: 1700000100,
        signature: "sig2",
        blockTime: 1700000100,
      };

      const folded = foldDrawHistoryRows([
        harvestRow as never,
        completeRow as never,
      ]);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(folded[0].status, "Complete");
      assert.strictEqual(folded[0].initiatedAt, 1700000000);
      assert.strictEqual(folded[0].completedAt, 1700000100);
    });

    it("should preserve YieldHarvested initiatedAt even when DrawCompleted arrives first", () => {
      const completeRow = {
        poolId: 1,
        cycleId: 10,
        status: "Complete",
        prizePot: 500_000_000n,
        winnersCount: 3,
        completedAt: 1700000100,
        signature: "sig2",
        blockTime: 1700000100,
      };
      const harvestRow = {
        poolId: 1,
        cycleId: 10,
        status: "AwaitingRandomness",
        initiatedAt: 1700000000,
        prizePot: 500_000_000n,
        signature: "sig1",
        blockTime: 1700000000,
      };

      const folded = foldDrawHistoryRows([
        completeRow as never,
        harvestRow as never,
      ]);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(folded[0].status, "Complete");
      assert.strictEqual(folded[0].initiatedAt, 1700000000);
      assert.strictEqual(folded[0].completedAt, 1700000100);
    });

    it("should fold DrawSkipped with both initiatedAt and completedAt", () => {
      const skippedRow = {
        poolId: 1,
        cycleId: 11,
        status: "Skipped",
        prizePot: 0n,
        winnersSynced: true,
        initiatedAt: 1700000000,
        completedAt: 1700000000,
        signature: "sigSkip",
        blockTime: 1700000000,
      };

      const folded = foldDrawHistoryRows([skippedRow as never]);
      assert.strictEqual(folded.length, 1);
      assert.strictEqual(folded[0].status, "Skipped");
      assert.strictEqual(folded[0].initiatedAt, 1700000000);
      assert.strictEqual(folded[0].completedAt, 1700000000);
      assert.strictEqual(folded[0].winnersSynced, true);
    });

    it("should fold DrawForceUnlocked and DrawVoided with completedAt", () => {
      const unlockRow = {
        poolId: 1,
        cycleId: 12,
        status: "ForceUnlocked",
        prizePot: 500_000_000n,
        cycleFeeCollected: 50_000_000n,
        winnersSynced: true,
        completedAt: 1700000500,
        signature: "sigUnlock",
        blockTime: 1700000500,
      };
      const voidRow = {
        poolId: 1,
        cycleId: 13,
        status: "Voided",
        prizePot: 0n,
        winnersSynced: true,
        completedAt: 1700000600,
        signature: "sigVoid",
        blockTime: 1700000600,
      };

      const foldedUnlock = foldDrawHistoryRows([unlockRow as never]);
      assert.strictEqual(foldedUnlock[0].completedAt, 1700000500);

      const foldedVoid = foldDrawHistoryRows([voidRow as never]);
      assert.strictEqual(foldedVoid[0].completedAt, 1700000600);
    });

    it("should preserve revealedAt and vrfSeedHex during folding", () => {
      const harvestRow = {
        poolId: 1,
        cycleId: 14,
        status: "AwaitingRandomness",
        initiatedAt: 1700000000,
        prizePot: 500_000_000n,
        signature: "sigHarvest",
        blockTime: 1700000000,
      };
      const revealRow = {
        poolId: 1,
        cycleId: 14,
        status: "Complete",
        prizePot: 500_000_000n,
        revealedAt: 1700000050,
        vrfSeedHex: "abcd1234abcd1234",
        completedAt: 1700000100,
        signature: "sigComplete",
        blockTime: 1700000100,
      };

      const folded = foldDrawHistoryRows([
        harvestRow as never,
        revealRow as never,
      ]);
      assert.strictEqual(folded[0].revealedAt, 1700000050);
      assert.strictEqual(folded[0].vrfSeedHex, "abcd1234abcd1234");
      assert.strictEqual(folded[0].initiatedAt, 1700000000);
      assert.strictEqual(folded[0].completedAt, 1700000100);
    });

    it("should allow inferInsert omitting initiatedAt due to DEFAULT 0", () => {
      const insertRow: typeof drawHistory.$inferInsert = {
        poolId: 1,
        cycleId: 15,
        status: "Complete",
        prizePot: 100n,
        signature: "sigInsert",
        blockTime: 1700000000,
      };
      assert.strictEqual(insertRow.poolId, 1);
      assert.strictEqual(insertRow.initiatedAt, undefined);
    });
  });

  describe("foldWinnerUpdateRows & updateDrawWinnersTx", () => {
    it("should fold winner update rows targeting the same winner into one record with max bonds", () => {
      const rows: WinnerUpdateRow[] = [
        {
          poolId: 1,
          cycleId: 3,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 0n,
          claimSignature: "sig_first",
        },
        {
          poolId: 1,
          cycleId: 3,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 4n,
          claimSignature: "sig_second",
        },
        {
          poolId: 1,
          cycleId: 3,
          winnerIndex: 1,
          winnerAddress: randAddr,
          bondsBought: 2n,
          claimSignature: "sig_winner1",
        },
      ];

      const folded = foldWinnerUpdateRows(rows);
      assert.strictEqual(
        folded.length,
        2,
        "Expected 2 distinct folded winners"
      );

      const winner0 = folded.find((w) => w.winnerIndex === 0);
      assert.ok(winner0);
      assert.strictEqual(
        winner0.bondsBought,
        4n,
        "Should pick greatest bondsBought"
      );
      assert.strictEqual(
        winner0.claimSignature,
        "sig_first",
        "Should preserve first non-empty claimSignature"
      );

      const winner1 = folded.find((w) => w.winnerIndex === 1);
      assert.ok(winner1);
      assert.strictEqual(winner1.bondsBought, 2n);
      assert.strictEqual(winner1.claimSignature, "sig_winner1");
    });

    it("should return empty unhydratedDraws when updates array is empty", async () => {
      const mockTx = {};
      const result = await updateDrawWinnersTx(
        mockTx as unknown as Parameters<typeof updateDrawWinnersTx>[0],
        []
      );
      assert.deepStrictEqual(result, { unhydratedDraws: [] });
    });

    it("should detect and report unhydrated draws when updating missing rows", async () => {
      const updates: WinnerUpdateRow[] = [
        {
          poolId: 1,
          cycleId: 99,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 5n,
          claimSignature: "sig_unhydrated",
        },
      ];

      // Mock tx where .returning() returns empty array (row did not exist)
      const mockTx = {
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => [],
            }),
          }),
        }),
      };

      const result = await updateDrawWinnersTx(
        mockTx as unknown as Parameters<typeof updateDrawWinnersTx>[0],
        updates
      );
      assert.strictEqual(result.unhydratedDraws.length, 1);
      assert.deepStrictEqual(result.unhydratedDraws[0], {
        poolId: 1,
        cycleId: 99,
      });
    });

    it("should succeed with empty unhydratedDraws when rows are found and updated", async () => {
      const updates: WinnerUpdateRow[] = [
        {
          poolId: 1,
          cycleId: 5,
          winnerIndex: 0,
          winnerAddress: userAddr,
          bondsBought: 3n,
          claimSignature: "sig_found",
        },
      ];

      // Mock tx where .returning() returns updated row
      const mockTx = {
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => [{ winnerIndex: 0 }],
            }),
          }),
        }),
      };

      const result = await updateDrawWinnersTx(
        mockTx as unknown as Parameters<typeof updateDrawWinnersTx>[0],
        updates
      );
      assert.deepStrictEqual(result, { unhydratedDraws: [] });
    });
  });
});
