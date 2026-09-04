import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapDtoToPrizeHistoryEntry,
  mapDtoToRecentWinner,
  parseNumericBaseUnits,
  toPrizeHistoryEntryDto,
  type PrizeHistoryEntryDto,
} from "../indexer-mappers";
import { formatTokenAmount } from "../formatters";

describe("Prize History Mapper & Formatter Suite", () => {
  it("should map complete PrizeHistoryEntryDto to PrizeHistoryEntry domain model", () => {
    const dto: PrizeHistoryEntryDto = {
      poolId: 1,
      cycleId: 42,
      winnerIndex: 2,
      winnerAddress: "Winner1111111111111111111111111111111111111",
      tierIndex: 0,
      amountOwed: "100000000", // 100 USDC in base units
      winningTicketIdx: "987654",
      processed: true,
      bondsBought: "20",
      dustAccumulated: "0",
      claimSignature: "5KSignature...",
      revealedAt: 1772540000,
      vrfSeedHex: "0xdeadbeef12345678",
    };

    const entry = mapDtoToPrizeHistoryEntry(dto);

    assert.strictEqual(entry.drawCycleId, 42);
    assert.strictEqual(entry.winnerIndex, 2);
    assert.strictEqual(entry.tierIndex, 0);
    assert.strictEqual(entry.amount, 100_000_000);
    assert.strictEqual(entry.status, "reinvested");
    assert.strictEqual(entry.bondsBought, 20);
    assert.strictEqual(entry.reinvestedTickets, 20);
    assert.strictEqual(entry.dustAccumulated, undefined);
    assert.strictEqual(entry.winningTicket, "987654");
    assert.strictEqual(entry.txSignature, "5KSignature...");
    assert.strictEqual(entry.vrfSeed, "0xdeadbeef12345678");
    assert.strictEqual(entry.revealedAt, 1772540000);
    assert.strictEqual(entry.date, new Date(1772540000 * 1000).toISOString());
  });

  it("should map processing status and optional fields correctly", () => {
    const dto: PrizeHistoryEntryDto = {
      poolId: 1,
      cycleId: 10,
      winnerIndex: 0,
      winnerAddress: "PendingWinner11111111111111111111111111111",
      tierIndex: 1,
      amountOwed: "50000000",
      winningTicketIdx: null,
      processed: false,
      bondsBought: "0",
      dustAccumulated: "500000",
      claimSignature: null,
      revealedAt: 1772500000,
      vrfSeedHex: null,
    };

    const entry = mapDtoToPrizeHistoryEntry(dto);

    assert.strictEqual(entry.drawCycleId, 10);
    assert.strictEqual(entry.status, "processing");
    assert.strictEqual(entry.amount, 50_000_000);
    assert.strictEqual(entry.bondsBought, undefined);
    assert.strictEqual(entry.reinvestedTickets, undefined);
    assert.strictEqual(entry.dustAccumulated, 500_000);
    assert.strictEqual(entry.winningTicket, undefined);
    assert.strictEqual(entry.txSignature, undefined);
    assert.strictEqual(entry.vrfSeed, undefined);
  });

  it("should deterministically handle missing or 0 revealedAt timestamp without fabricating current date", () => {
    const dtoMissingTimestamp: PrizeHistoryEntryDto = {
      poolId: 1,
      cycleId: 5,
      winnerIndex: 1,
      winnerAddress: "WinnerAddress",
      tierIndex: 2,
      amountOwed: "10000000",
      winningTicketIdx: null,
      processed: false,
      bondsBought: "0",
      dustAccumulated: "0",
      claimSignature: null,
      revealedAt: 0,
    };

    const entry = mapDtoToPrizeHistoryEntry(dtoMissingTimestamp);

    assert.strictEqual(entry.date, new Date(0).toISOString());
    assert.strictEqual(entry.revealedAt, undefined);
  });

  it("should safely parse string base units with whitespace or scientific notation", () => {
    assert.strictEqual(parseNumericBaseUnits("  50000000  "), 50_000_000);
    assert.strictEqual(parseNumericBaseUnits("100000000"), 100_000_000);
    assert.strictEqual(parseNumericBaseUnits("1e6"), 1_000_000);
    assert.strictEqual(parseNumericBaseUnits(5000), 5000);
    assert.strictEqual(parseNumericBaseUnits(null), 0);
    assert.strictEqual(parseNumericBaseUnits(undefined), 0);
    assert.strictEqual(parseNumericBaseUnits(""), 0);
    assert.strictEqual(parseNumericBaseUnits("invalid_string"), 0);
    assert.strictEqual(parseNumericBaseUnits("NaN"), 0);
    assert.strictEqual(parseNumericBaseUnits(-500), 0);
  });

  it("should map PrizeHistoryEntryDto to RecentWinner with custom token symbol", () => {
    const dto: PrizeHistoryEntryDto = {
      poolId: 1,
      cycleId: 15,
      winnerIndex: 0,
      winnerAddress: "RecentWinner11111111111111111111111111111",
      tierIndex: 0,
      amountOwed: "250000000",
      winningTicketIdx: null,
      processed: true,
      bondsBought: "50",
      dustAccumulated: "0",
      claimSignature: null,
      revealedAt: 1772500000,
    };

    const recent = mapDtoToRecentWinner(dto, "USDC");

    assert.strictEqual(
      recent.address,
      "RecentWinner11111111111111111111111111111"
    );
    assert.strictEqual(recent.amount, 250_000_000);
    assert.strictEqual(recent.cycleId, 15);
    assert.strictEqual(recent.tierIndex, 0);
    assert.strictEqual(recent.tokenSymbol, "USDC");
  });

  it("should correctly populate vrfSeedHex in toPrizeHistoryEntryDto", () => {
    const mockRow = {
      id: 1,
      poolId: 1,
      cycleId: 8,
      winnerIndex: 0,
      winnerAddress: "Winner1111111111111111111111111111111111111",
      tierIndex: 1,
      amountOwed: BigInt(50_000_000),
      winningTicketIdx: BigInt(12345),
      processed: true,
      bondsBought: BigInt(10),
      dustAccumulated: BigInt(0),
      claimSignature: "sig123",
      revealedAt: 1772500000,
      claimedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const dto = toPrizeHistoryEntryDto(mockRow, "0xabcdef123456");
    assert.strictEqual(dto.vrfSeedHex, "0xabcdef123456");
    assert.strictEqual(dto.amountOwed, "50000000");
    assert.strictEqual(dto.winningTicketIdx, "12345");

    const dtoWithoutSeed = toPrizeHistoryEntryDto(mockRow);
    assert.strictEqual(dtoWithoutSeed.vrfSeedHex, null);
  });

  it("should guard formatTokenAmount against non-finite or undefined values", () => {
    // Standard valid amount
    assert.strictEqual(formatTokenAmount(50_000_000, 6), "50.00");
    assert.strictEqual(formatTokenAmount(5000000, 6), "5.00");

    // Defensive handling of non-finite inputs
    assert.strictEqual(
      formatTokenAmount(undefined as unknown as number, 6),
      "0.00"
    );
    assert.strictEqual(formatTokenAmount(null as unknown as number, 6), "0.00");
    assert.strictEqual(formatTokenAmount(NaN, 6), "0.00");
    assert.strictEqual(
      formatTokenAmount("50000000" as unknown as number, 6),
      "50.00"
    );
  });
});
