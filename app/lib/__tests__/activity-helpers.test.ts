import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatActivityDescription,
  createOptimisticActivity,
  mergeActivityEntries,
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
});
