import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderLocalizedActivityDescription,
  fallbackRegexFormat,
  formatLocalizedActivityDescription,
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

    it("should render auto-reinvest with cycleId and bonds count", () => {
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
      });
      assert.strictEqual(result, "Draw #42 reinvested: +2 tickets from $10.00");
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

  describe("fallbackRegexFormat for legacy unstructured descriptions", () => {
    it("should parse deposit descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Deposited 100.00 USDC → +20 tickets";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.deposit");
      assert.deepStrictEqual(calls[0].values, { amount: "100.00", bonds: 20 });
    });

    it("should parse withdraw descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Sold 4 bonds (20.00 USDC) · Pending settle";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.withdraw");
      assert.deepStrictEqual(calls[0].values, { amount: "20.00", bonds: 4 });
    });

    it("should parse auto-reinvest descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Draw #7 reinvested: +5 tickets from 25.00 USDC";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.autoReinvest");
      assert.deepStrictEqual(calls[0].values, {
        cycleId: 7,
        bonds: 5,
        amount: "25.00",
      });
    });

    it("should parse win descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Claimed accumulated winnings of 50.00 USDC · Pending settle";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.win");
      assert.deepStrictEqual(calls[0].values, { amount: "50.00" });
    });

    it("should parse claim settled bond principal descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Claimed settled bond principal of 30.00 USDC to wallet";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.claimedBondPrincipal");
      assert.deepStrictEqual(calls[0].values, { amount: "30.00" });
    });

    it("should parse claim settled fees descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Claimed settled fees of 3.50 USDC to wallet";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.claimedFees");
      assert.deepStrictEqual(calls[0].values, { amount: "3.50" });
    });

    it("should parse claim settled prize winnings descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Claimed settled prize winnings of 75.00 USDC to wallet";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.claimedPrizeWinnings");
      assert.deepStrictEqual(calls[0].values, { amount: "75.00" });
    });

    it("should parse claim settled redemption descriptions accurately", () => {
      const { t, calls } = createMockTranslator();
      const raw = "Claimed settled redemption of 40.00 USDC to wallet";
      fallbackRegexFormat(raw, t);
      assert.strictEqual(calls[0].key, "descriptions.claimedRedemption");
      assert.deepStrictEqual(calls[0].values, { amount: "40.00" });
    });

    it("should return empty string on empty input", () => {
      const { t } = createMockTranslator();
      assert.strictEqual(fallbackRegexFormat("", t), "");
    });

    it("should return unchanged description when no regex pattern matches", () => {
      const { t } = createMockTranslator();
      const unknown = "Arbitrary custom protocol notice";
      assert.strictEqual(fallbackRegexFormat(unknown, t), unknown);
    });
  });

  describe("formatLocalizedActivityDescription (deprecated fallback helper)", () => {
    it("should return English text unchanged if locale is 'en'", () => {
      const text = "Deposited 50.00 USDC → +10 tickets";
      assert.strictEqual(formatLocalizedActivityDescription(text, "en"), text);
    });

    it("should translate keywords if locale is 'es'", () => {
      const text = "Deposited 50.00 USDC → +10 tickets";
      const result = formatLocalizedActivityDescription(text, "es");
      assert.ok(result.includes("Depositó"));
      assert.ok(result.includes("bonos"));
    });

    it("should translate updated financial and status terms if locale is 'es'", () => {
      const sellText = "Sold 1 bond (5.00 USDC) · Pending settle";
      const sellResult = formatLocalizedActivityDescription(sellText, "es");
      assert.ok(sellResult.includes("Vendió"));
      assert.ok(sellResult.includes("Pendiente de liquidación"));

      const claimText =
        "Claimed settled bond principal of 30.00 USDC to wallet";
      const claimResult = formatLocalizedActivityDescription(claimText, "es");
      assert.ok(claimResult.includes("capital de bonos"));

      const jackpotText = "Won 100.00 USDC Jackpot";
      const jackpotResult = formatLocalizedActivityDescription(
        jackpotText,
        "es"
      );
      assert.ok(jackpotResult.includes("Gran Premio"));
    });

    it("should translate dust and remainder terminology if locale is 'es'", () => {
      const dustClaimText =
        "Claimed accumulated dust winnings of 0.45 USDC to wallet";
      const dustResult = formatLocalizedActivityDescription(
        dustClaimText,
        "es"
      );
      assert.ok(
        dustResult.includes("Reclamó ganancias restantes acumuladas de")
      );
      assert.ok(dustResult.includes("a la billetera"));

      const autoDustText =
        "Auto-reinvested 1 bond from 1.00 USDC (prior dust: 0.50 USDC)";
      const autoDustResult = formatLocalizedActivityDescription(
        autoDustText,
        "es"
      );
      assert.ok(autoDustResult.includes("saldo restante anterior"));
    });
  });
});
