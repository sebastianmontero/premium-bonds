import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatActivityDescription,
  createOptimisticActivity,
  mergeActivityEntries,
  filterActivityEntries,
  matchesActivityFilter,
  type StoredOptimisticEntry,
} from "../activity-helpers";
import type { ActivityEntry } from "../../types";

describe("Activity Helpers & Optimistic Deduplication Suite", () => {
  describe("formatActivityDescription", () => {
    it("should format deposit activity description", () => {
      const desc = formatActivityDescription({
        activityType: "deposit",
        bonds: 5,
        amountUsdc: 50_000_000n,
      });
      assert.strictEqual(desc, "Deposited 50.00 USDC → +5 tickets");
    });

    it("should format withdraw activity description", () => {
      const desc = formatActivityDescription({
        activityType: "withdraw",
        bonds: 2,
        amountUsdc: 20_000_000,
      });
      assert.strictEqual(desc, "Sold 2 bonds (20.00 USDC) · Pending settle");
    });

    it("should format auto-reinvest activity description", () => {
      const desc = formatActivityDescription({
        activityType: "auto-reinvest",
        bonds: 3,
        amountUsdc: 30_000_000n,
        cycleId: 42,
      });
      assert.strictEqual(
        desc,
        "Draw #42 reinvested: +3 tickets from 30.00 USDC"
      );
    });

    it("should format win activity description", () => {
      const desc = formatActivityDescription({
        activityType: "win",
        amountUsdc: 15_500_000,
      });
      assert.strictEqual(
        desc,
        "Claimed accumulated winnings of 15.50 USDC · Pending settle"
      );
    });

    it("should format claim-redemption with specific redemption types", () => {
      const bondSale = formatActivityDescription({
        activityType: "claim-redemption",
        amountUsdc: 10_000_000,
        redemptionType: "bond_sale",
      });
      assert.strictEqual(
        bondSale,
        "Claimed settled bond principal of 10.00 USDC to wallet"
      );

      const feeWithdrawal = formatActivityDescription({
        activityType: "claim-redemption",
        amountUsdc: 2_500_000,
        redemptionType: "fee_withdrawal",
      });
      assert.strictEqual(
        feeWithdrawal,
        "Claimed settled fees of 2.50 USDC to wallet"
      );

      const prizeClaim = formatActivityDescription({
        activityType: "claim-redemption",
        amountUsdc: 50_000_000,
        redemptionType: "prize_claim",
      });
      assert.strictEqual(
        prizeClaim,
        "Claimed settled prize winnings of 50.00 USDC to wallet"
      );

      const fallback = formatActivityDescription({
        activityType: "claim-redemption",
        amountUsdc: 5_000_000,
      });
      assert.strictEqual(
        fallback,
        "Claimed settled redemption of 5.00 USDC to wallet"
      );
    });
  });

  describe("createOptimisticActivity", () => {
    it("should construct valid ActivityEntry with synthetic id, date, and description", () => {
      const entry = createOptimisticActivity({
        activityType: "deposit",
        bonds: 10,
        amountUsdc: 100_000_000n,
        txSignature: "5xYz1234MockSignature5678",
      });

      assert.strictEqual(entry.type, "deposit");
      assert.strictEqual(entry.amount, 100_000_000);
      assert.strictEqual(entry.txSignature, "5xYz1234MockSignature5678");
      assert.strictEqual(
        entry.description,
        "Deposited 100.00 USDC → +10 tickets"
      );
      assert.match(entry.id, /^act-deposit-\d+-[a-z0-9]+$/);
      assert.ok(!isNaN(Date.parse(entry.date)));
    });
  });

  describe("mergeActivityEntries", () => {
    const baseNow = 1_000_000;

    it("should prune local entry once on-chain entry with matching txSignature arrives", () => {
      const local: StoredOptimisticEntry[] = [
        {
          id: "act-dep-1",
          date: new Date(baseNow).toISOString(),
          type: "deposit",
          description: "Deposited 10 USDC",
          amount: 10_000_000,
          txSignature: "sig-deposit-1",
          createdAt: baseNow,
        },
      ];

      const api: ActivityEntry[] = [
        {
          id: "evt-deposit-sig-dep-0",
          date: new Date(baseNow + 1000).toISOString(),
          type: "deposit",
          description: "Deposited 10.00 USDC → +1 tickets",
          amount: 10_000_000,
          txSignature: "sig-deposit-1",
        },
      ];

      const merged = mergeActivityEntries(local, api, baseNow + 2000);
      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].id, "evt-deposit-sig-dep-0");
    });

    it("should preserve multiple distinct on-chain entries sharing the same txSignature", () => {
      const local: StoredOptimisticEntry[] = [];
      const api: ActivityEntry[] = [
        {
          id: "evt-auto-reinvest-sig-crank-0",
          date: new Date(baseNow).toISOString(),
          type: "auto-reinvest",
          description: "Draw #1 reinvested: +1 tickets",
          amount: 10_000_000,
          txSignature: "sig-crank-1",
        },
        {
          id: "evt-auto-reinvest-sig-crank-1",
          date: new Date(baseNow).toISOString(),
          type: "auto-reinvest",
          description: "Draw #1 reinvested: +2 tickets",
          amount: 20_000_000,
          txSignature: "sig-crank-1",
        },
      ];

      const merged = mergeActivityEntries(local, api, baseNow);
      assert.strictEqual(merged.length, 2);
      assert.strictEqual(merged[0].id, "evt-auto-reinvest-sig-crank-0");
      assert.strictEqual(merged[1].id, "evt-auto-reinvest-sig-crank-1");
    });

    it("should evict unconfirmed local entries older than 120s TTL", () => {
      const local: StoredOptimisticEntry[] = [
        {
          id: "act-dep-stale",
          date: new Date(baseNow - 125_000).toISOString(),
          type: "deposit",
          description: "Stale unindexed deposit",
          amount: 10_000_000,
          txSignature: "sig-stale",
          createdAt: baseNow - 125_000,
        },
        {
          id: "act-dep-fresh",
          date: new Date(baseNow - 10_000).toISOString(),
          type: "deposit",
          description: "Fresh deposit",
          amount: 10_000_000,
          txSignature: "sig-fresh",
          createdAt: baseNow - 10_000,
        },
      ];

      const api: ActivityEntry[] = [];

      const merged = mergeActivityEntries(local, api, baseNow, 120_000);
      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].id, "act-dep-fresh");
    });

    it("should position active local entries at the top before on-chain entries", () => {
      const local: StoredOptimisticEntry[] = [
        {
          id: "act-dep-recent",
          date: new Date(baseNow).toISOString(),
          type: "deposit",
          description: "Just deposited",
          amount: 10_000_000,
          txSignature: "sig-new",
          createdAt: baseNow,
        },
      ];

      const api: ActivityEntry[] = [
        {
          id: "evt-withdraw-old",
          date: new Date(baseNow - 50_000).toISOString(),
          type: "withdraw",
          description: "Old withdrawal",
          amount: 5_000_000,
          txSignature: "sig-old",
        },
      ];

      const merged = mergeActivityEntries(local, api, baseNow);
      assert.strictEqual(merged.length, 2);
      assert.strictEqual(merged[0].id, "act-dep-recent");
      assert.strictEqual(merged[1].id, "evt-withdraw-old");
    });

    it("should deduplicate apiEntries strictly by canonical item.id", () => {
      const local: StoredOptimisticEntry[] = [];
      const api: ActivityEntry[] = [
        {
          id: "evt-deposit-1",
          date: new Date(baseNow).toISOString(),
          type: "deposit",
          description: "Deposit",
          amount: 10_000_000,
          txSignature: "sig-1",
        },
        {
          id: "evt-deposit-1",
          date: new Date(baseNow).toISOString(),
          type: "deposit",
          description: "Duplicate Deposit",
          amount: 10_000_000,
          txSignature: "sig-1",
        },
      ];

      const merged = mergeActivityEntries(local, api, baseNow);
      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].id, "evt-deposit-1");
    });
  });

  describe("matchesActivityFilter and filterActivityEntries", () => {
    const sampleEntries: ActivityEntry[] = [
      {
        id: "evt-win-1",
        date: "2026-09-01T00:00:00.000Z",
        type: "win",
        description: "Draw #42 winnings of 50.00 USDC",
        amount: 50_000_000,
        txSignature: "5xYz1234abcd5678",
      },
      {
        id: "evt-deposit-2",
        date: "2026-09-02T00:00:00.000Z",
        type: "deposit",
        description: "Deposited 100.00 USDC → +10 tickets",
        amount: 100_000_000,
        txSignature: "3aBc9876efgh4321",
      },
      {
        id: "evt-reinvest-3",
        date: "2026-09-03T00:00:00.000Z",
        type: "auto-reinvest",
        description: "Draw #42 reinvested: +5 tickets from 25.00 USDC",
        amount: 25_000_000,
        txSignature: "7qWe1122iikl3344",
      },
    ];

    it("should match all entries when criteria is empty or type is 'all'", () => {
      assert.strictEqual(
        matchesActivityFilter(sampleEntries[0], { type: "all" }),
        true
      );
      assert.strictEqual(
        matchesActivityFilter(sampleEntries[0], { type: "win" }),
        true
      );
      assert.strictEqual(
        matchesActivityFilter(sampleEntries[0], { type: "deposit" }),
        false
      );
      const filtered = filterActivityEntries(sampleEntries, {
        type: "all",
        search: "",
      });
      assert.strictEqual(filtered.length, 3);
    });

    it("should filter by activity type", () => {
      const winOnly = filterActivityEntries(sampleEntries, { type: "win" });
      assert.strictEqual(winOnly.length, 1);
      assert.strictEqual(winOnly[0].type, "win");

      const depositOnly = filterActivityEntries(sampleEntries, {
        type: "deposit",
      });
      assert.strictEqual(depositOnly.length, 1);
      assert.strictEqual(depositOnly[0].type, "deposit");
    });

    it("should filter by search keyword matching description", () => {
      const filtered = filterActivityEntries(sampleEntries, {
        search: "tickets",
      });
      assert.strictEqual(filtered.length, 2);
    });

    it("should filter by numeric cycle search with # prefix", () => {
      const filtered = filterActivityEntries(sampleEntries, { search: "#42" });
      assert.strictEqual(filtered.length, 2);
    });

    it("should filter by transaction signature prefix", () => {
      const filtered = filterActivityEntries(sampleEntries, {
        search: "5xyz",
      });
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].id, "evt-win-1");
    });

    it("should return empty array when no entries match criteria", () => {
      const filtered = filterActivityEntries(sampleEntries, {
        type: "withdraw",
      });
      assert.strictEqual(filtered.length, 0);
    });
  });
});
