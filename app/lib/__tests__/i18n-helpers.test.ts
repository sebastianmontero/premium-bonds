import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderLocalizedActivityDescription,
  type ActivityTranslationFn,
} from "../i18n-helpers";
import type { ActivityEntry } from "@/app/types";

// Mock translation function recording key and parameters
function createMockTranslator(): {
  t: ActivityTranslationFn;
  calls: Array<{ key: string; values?: Record<string, string | number> }>;
} {
  const calls: Array<{
    key: string;
    values?: Record<string, string | number>;
  }> = [];

  const t: ActivityTranslationFn = (key, values) => {
    calls.push({ key, values });
    if (key === "descriptions.deposit") {
      const b = values?.bonds ?? 0;
      return `Deposited ${values?.amount} (${b} bond${b === 1 ? "" : "s"})`;
    }
    if (key === "descriptions.withdraw") {
      const b = values?.bonds ?? 0;
      return `Sold ${b} bond${b === 1 ? "" : "s"} (${values?.amount})`;
    }
    if (key === "descriptions.autoReinvest") {
      const b = values?.bonds ?? 0;
      return `Draw #${values?.cycleId} reinvested: +${b} ticket${b === 1 ? "" : "s"} from ${values?.amount}`;
    }
    if (key === "descriptions.autoReinvestWithClaimable") {
      const b = values?.bonds ?? 0;
      return `Draw #${values?.cycleId} reinvested: +${b} ticket${b === 1 ? "" : "s"} from ${values?.amount} (${values?.claimable} claimable balance)`;
    }
    if (key === "descriptions.autoReinvestDustOnly") {
      return `Draw #${values?.cycleId} prize: ${values?.amount} credited to claimable balance`;
    }
    if (key === "descriptions.autoReinvestWithUsedDust") {
      const b = values?.bonds ?? 0;
      return `Draw #${values?.cycleId} reinvested: +${b} ticket${b === 1 ? "" : "s"} (${values?.amount} prize + ${values?.usedDust} claimable used)`;
    }
    if (key === "descriptions.autoReinvestWithUsedDustAndRemaining") {
      const b = values?.bonds ?? 0;
      return `Draw #${values?.cycleId} reinvested: +${b} ticket${b === 1 ? "" : "s"} (${values?.amount} prize + ${values?.usedDust} claimable used · ${values?.remaining} remaining)`;
    }
    if (key === "descriptions.autoReinvestPureDustCompound") {
      const b = values?.bonds ?? 0;
      return `Draw #${values?.cycleId} reinvested: +${b} ticket${b === 1 ? "" : "s"} from ${values?.usedDust} claimable balance`;
    }
    if (key === "descriptions.win") {
      return `Won ${values?.amount}`;
    }
    if (key === "descriptions.claimedBondPrincipal") {
      return `Claimed settled bond principal of ${values?.amount} to wallet`;
    }
    if (key === "descriptions.claimedFees") {
      return `Claimed settled fees of ${values?.amount} to wallet`;
    }
    if (key === "descriptions.claimedPrizeWinnings") {
      return `Claimed settled prize winnings of ${values?.amount} to wallet`;
    }
    if (key === "descriptions.claimedRedemption") {
      return `Claimed settled redemption of ${values?.amount} to wallet`;
    }
    return key;
  };

  return { t, calls };
}

describe("Activity Feed i18n Helpers Unit Tests", () => {
  describe("renderLocalizedActivityDescription with structured metadata", () => {
    it("should render deposit with singular bond count", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-1",
        type: "deposit",
        description: "Deposited $5.00 → +1 ticket",
        date: new Date().toISOString(),
        metadata: {
          bonds: 1,
          amountUsdc: 5_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.deposit");
      assert.deepStrictEqual(calls[0].values, { amount: "$5.00", bonds: 1 });
      assert.strictEqual(result, "Deposited $5.00 (1 bond)");
    });

    it("should render deposit with plural bond count", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-2",
        type: "deposit",
        description: "Deposited $50.00 → +10 tickets",
        date: new Date().toISOString(),
        metadata: {
          bonds: 10,
          amountUsdc: 50_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.deposit");
      assert.deepStrictEqual(calls[0].values, { amount: "$50.00", bonds: 10 });
      assert.strictEqual(result, "Deposited $50.00 (10 bonds)");
    });

    it("should render withdraw with singular bond count", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-3",
        type: "withdraw",
        description: "Sold 1 bond ($5.00) · Pending settle",
        date: new Date().toISOString(),
        metadata: {
          bonds: 1,
          amountUsdc: 5_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.withdraw");
      assert.deepStrictEqual(calls[0].values, { amount: "$5.00", bonds: 1 });
      assert.strictEqual(result, "Sold 1 bond ($5.00)");
    });

    it("should render withdraw with plural bond count", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-4",
        type: "withdraw",
        description: "Sold 3 bonds ($15.00) · Pending settle",
        date: new Date().toISOString(),
        metadata: {
          bonds: 3,
          amountUsdc: 15_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.withdraw");
      assert.deepStrictEqual(calls[0].values, { amount: "$15.00", bonds: 3 });
      assert.strictEqual(result, "Sold 3 bonds ($15.00)");
    });

    it("should render auto-reinvest with cycleId and bonds count (pure reinvestment)", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-5",
        type: "auto-reinvest",
        description: "Draw #42 reinvested: +2 tickets from $10.00",
        date: new Date().toISOString(),
        metadata: {
          cycleId: 42,
          bonds: 2,
          amountUsdc: 10_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.autoReinvest");
      assert.deepStrictEqual(calls[0].values, {
        amount: "$10.00",
        bonds: 2,
        cycleId: 42,
        usedDust: undefined,
        remaining: undefined,
        claimable: undefined,
      });
      assert.strictEqual(result, "Draw #42 reinvested: +2 tickets from $10.00");
    });

    it("should render auto-reinvest for dust-only scenario", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-dust",
        type: "auto-reinvest",
        description: "Draw #42 prize: $2.50 credited to claimable balance",
        date: new Date().toISOString(),
        metadata: {
          cycleId: 42,
          bonds: 0,
          amountUsdc: 2_500_000,
          claimableUsdc: 2_500_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.autoReinvestDustOnly");
      assert.deepStrictEqual(calls[0].values, {
        amount: "$2.50",
        bonds: 0,
        cycleId: 42,
        usedDust: undefined,
        remaining: "$2.50",
        claimable: "$2.50",
      });
      assert.strictEqual(
        result,
        "Draw #42 prize: $2.50 credited to claimable balance"
      );
    });

    it("should render auto-reinvest for compounded with remaining", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-comp-rem",
        type: "auto-reinvest",
        description: "",
        date: new Date().toISOString(),
        metadata: {
          cycleId: 42,
          bonds: 2,
          amountUsdc: 8_000_000,
          usedPriorDustUsdc: 2_000_000,
          claimableUsdc: 2_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].key,
        "descriptions.autoReinvestWithUsedDustAndRemaining"
      );
      assert.deepStrictEqual(calls[0].values, {
        amount: "$8.00",
        bonds: 2,
        cycleId: 42,
        usedDust: "$2.00",
        remaining: "$2.00",
        claimable: "$2.00",
      });
      assert.strictEqual(
        result,
        "Draw #42 reinvested: +2 tickets ($8.00 prize + $2.00 claimable used · $2.00 remaining)"
      );
    });

    it("should render auto-reinvest for compounded exact", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-comp-exact",
        type: "auto-reinvest",
        description: "",
        date: new Date().toISOString(),
        metadata: {
          cycleId: 42,
          bonds: 2,
          amountUsdc: 8_000_000,
          usedPriorDustUsdc: 2_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.autoReinvestWithUsedDust");
      assert.deepStrictEqual(calls[0].values, {
        amount: "$8.00",
        bonds: 2,
        cycleId: 42,
        usedDust: "$2.00",
        remaining: undefined,
        claimable: undefined,
      });
      assert.strictEqual(
        result,
        "Draw #42 reinvested: +2 tickets ($8.00 prize + $2.00 claimable used)"
      );
    });

    it("should render auto-reinvest for pure dust compound", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-pure-dust",
        type: "auto-reinvest",
        description: "",
        date: new Date().toISOString(),
        metadata: {
          cycleId: 42,
          bonds: 1,
          amountUsdc: 0,
          usedPriorDustUsdc: 5_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].key,
        "descriptions.autoReinvestPureDustCompound"
      );
      assert.deepStrictEqual(calls[0].values, {
        amount: "$0.00",
        bonds: 1,
        cycleId: 42,
        usedDust: "$5.00",
        remaining: undefined,
        claimable: undefined,
      });
      assert.strictEqual(
        result,
        "Draw #42 reinvested: +1 ticket from $5.00 claimable balance"
      );
    });

    it("should render auto-reinvest for leftover dust", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-leftover",
        type: "auto-reinvest",
        description: "",
        date: new Date().toISOString(),
        metadata: {
          cycleId: 42,
          bonds: 2,
          amountUsdc: 12_500_000,
          claimableUsdc: 2_500_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        calls[0].key,
        "descriptions.autoReinvestWithClaimable"
      );
      assert.deepStrictEqual(calls[0].values, {
        amount: "$12.50",
        bonds: 2,
        cycleId: 42,
        usedDust: undefined,
        remaining: "$2.50",
        claimable: "$2.50",
      });
      assert.strictEqual(
        result,
        "Draw #42 reinvested: +2 tickets from $12.50 ($2.50 claimable balance)"
      );
    });

    it("should render win description with amount", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-6",
        type: "win",
        description: "Won $1,250.00",
        date: new Date().toISOString(),
        metadata: {
          amountUsdc: 1_250_000_000,
        },
      };

      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].key, "descriptions.win");
      assert.deepStrictEqual(calls[0].values, { amount: "$1,250.00" });
      assert.strictEqual(result, "Won $1,250.00");
    });

    it("should route claim-redemption to specific sub-keys based on redemptionType", () => {
      const { t, calls } = createMockTranslator();

      // bond_sale
      renderLocalizedActivityDescription(
        {
          id: "r-1",
          type: "claim-redemption",
          description: "",
          date: new Date().toISOString(),
          metadata: { redemptionType: "bond_sale", amountUsdc: 50_000_000 },
        },
        t
      );
      assert.strictEqual(calls[0].key, "descriptions.claimedBondPrincipal");
      assert.deepStrictEqual(calls[0].values, { amount: "$50.00" });

      // fee_withdrawal
      renderLocalizedActivityDescription(
        {
          id: "r-2",
          type: "claim-redemption",
          description: "",
          date: new Date().toISOString(),
          metadata: { redemptionType: "fee_withdrawal", amountUsdc: 5_000_000 },
        },
        t
      );
      assert.strictEqual(calls[1].key, "descriptions.claimedFees");
      assert.deepStrictEqual(calls[1].values, { amount: "$5.00" });

      // prize_claim
      renderLocalizedActivityDescription(
        {
          id: "r-3",
          type: "claim-redemption",
          description: "",
          date: new Date().toISOString(),
          metadata: { redemptionType: "prize_claim", amountUsdc: 25_000_000 },
        },
        t
      );
      assert.strictEqual(calls[2].key, "descriptions.claimedPrizeWinnings");
      assert.deepStrictEqual(calls[2].values, { amount: "$25.00" });

      // undefined / other
      renderLocalizedActivityDescription(
        {
          id: "r-4",
          type: "claim-redemption",
          description: "",
          date: new Date().toISOString(),
          metadata: { amountUsdc: 100_000_000 },
        },
        t
      );
      assert.strictEqual(calls[3].key, "descriptions.claimedRedemption");
      assert.deepStrictEqual(calls[3].values, { amount: "$100.00" });
    });

    it("should allow custom formatAmount function injection", () => {
      const { t, calls } = createMockTranslator();
      const entry: ActivityEntry = {
        id: "tx-custom",
        type: "deposit",
        description: "",
        date: new Date().toISOString(),
        metadata: {
          bonds: 5,
          amountUsdc: 25_000_000,
        },
      };

      const customFormatter = (base: number) => `$${base / 1_000_000}`;
      renderLocalizedActivityDescription(entry, t, customFormatter);
      assert.deepStrictEqual(calls[0].values, { amount: "$25", bonds: 5 });
    });
  });

  describe("renderLocalizedActivityDescription fallback without metadata", () => {
    it("should return raw description when metadata is undefined", () => {
      const { t } = createMockTranslator();
      const raw = "Custom unstructured protocol notice";
      const entry: ActivityEntry = {
        id: "tx-raw",
        type: "deposit",
        description: raw,
        date: new Date().toISOString(),
      };
      const result = renderLocalizedActivityDescription(entry, t);
      assert.strictEqual(result, raw);
    });
  });
});
