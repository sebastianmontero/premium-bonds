import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatErrorDetails,
  extractAllLogs,
  formatStackTrace,
  upsertEnvFile,
  readEnvFile,
  safeStringify,
} from "./utils";
import { parseLocalnetFlags, getBootstrapGuideText } from "./localnet";
import { parseTransactionError, matchAnchorError } from "../app/lib/errors";
import {
  DEFAULT_LIVE_YIELD_PRECISION,
  formatTokenAmount,
  formatCurrencyAmount,
  calculateAnnualDrawEntries,
  getCycleFrequency,
  formatCycleFrequency,
} from "../app/lib/formatters";
import { COMMAND_REGISTRY } from "./pb-cli";

describe("CLI, Formatting & Error Utilities (utils.test.ts)", () => {
  describe("Anchor Error Decoding", () => {
    it("should match custom Anchor errors (6000 PoolNotActive)", () => {
      const matched = matchAnchorError(
        '{"InstructionError":[0,{"Custom":6000}]}'
      );
      assert.notStrictEqual(matched, null, "Should match Custom: 6000");
      assert.strictEqual(matched?.code, 6000, "Code should be 6000");
      assert.strictEqual(
        matched?.info.name,
        "PoolNotActive",
        "Name should be PoolNotActive"
      );
    });

    it("should match framework Anchor errors (3005 AccountNotEnoughKeys / 0xbbd)", () => {
      const matchedFw = matchAnchorError("custom program error: 0xbbd");
      assert.notStrictEqual(matchedFw, null, "Should match 0xbbd");
      assert.strictEqual(
        matchedFw?.code,
        3005,
        `Code should be 3005, got ${matchedFw?.code}`
      );
      assert.strictEqual(
        matchedFw?.info.name,
        "AccountNotEnoughKeys",
        `Name should be AccountNotEnoughKeys, got ${matchedFw?.info.name}`
      );
    });
  });

  describe("Log Extraction & Error Details Formatting", () => {
    it("should extract context logs from @solana/kit error structures", () => {
      const mockSolanaError = {
        message: "Simulation failed",
        context: {
          logs: [
            "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx invoke [1]",
            "Program log: Instruction: HarvestYieldAndCommit",
            "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx failed: custom program error: 0x1770",
          ],
        },
      };

      const logs = extractAllLogs(mockSolanaError);
      assert.strictEqual(logs.length, 3, `Expected 3 logs, got ${logs.length}`);
      assert.ok(
        logs[0].includes("invoke [1]"),
        "Log 0 must match first instruction"
      );
    });

    it("should format error details with context title and transaction logs", () => {
      const mockTxError = new Error(
        "Transaction failed: AnchorError 6000 (PoolNotActive): The prize pool is not currently active."
      );
      (mockTxError as any).signature =
        "5K3xV819Wq18293n182390182390182390182390182390128390";
      (mockTxError as any).context = {
        logs: ["Program log: AnchorError thrown"],
      };

      const formatted = formatErrorDetails(mockTxError, "Test Context");
      assert.ok(
        formatted.includes("[Test Context]"),
        "Should include context title"
      );
      assert.ok(
        formatted.includes("PoolNotActive"),
        "Should include error name"
      );
      assert.ok(
        formatted.includes("Transaction Logs:"),
        "Should include logs section"
      );
    });

    it("should filter out node internals in formatStackTrace", () => {
      const rawStack =
        "Error: Simulated\n    at main (scripts/localnet.ts:42:15)\n    at run (scripts/pb-cli.ts:100:5)\n    at Module._compile (node:internal/modules/cjs/loader:1256:14)";
      const filtered = formatStackTrace(rawStack);
      assert.ok(
        !filtered.includes("node:internal"),
        "Should filter out node:internal lines"
      );
      assert.ok(filtered.includes("pb-cli.ts"), "Should retain pb-cli.ts");
      assert.ok(filtered.includes("localnet.ts"), "Should retain localnet.ts");
    });

    it("should parse transaction errors with JSON InstructionError", () => {
      const errObj = new Error(
        'Transaction failed: {"InstructionError":[0,{"Custom":6004}]}'
      );
      const parsed = parseTransactionError(errObj);
      assert.strictEqual(parsed.layer, "anchor", "Layer should be anchor");
      assert.strictEqual(
        parsed.category,
        "anchor_custom",
        "Category should be anchor_custom"
      );
      assert.strictEqual(parsed.code, 6004, "Code should be 6004");
      assert.strictEqual(
        parsed.title,
        "Program Error: RegistryFull",
        `Title mismatch, got: ${parsed.title}`
      );
    });
  });

  describe("Number & Currency Formatters", () => {
    it("should format live yield with DEFAULT_LIVE_YIELD_PRECISION (6 decimals)", () => {
      assert.strictEqual(
        DEFAULT_LIVE_YIELD_PRECISION,
        6,
        `Expected DEFAULT_LIVE_YIELD_PRECISION to be 6, got ${DEFAULT_LIVE_YIELD_PRECISION}`
      );

      const formatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: DEFAULT_LIVE_YIELD_PRECISION,
        maximumFractionDigits: DEFAULT_LIVE_YIELD_PRECISION,
      });

      assert.strictEqual(
        formatter.format(0),
        "0.000000",
        "0 formatted with 6 decimals"
      );
      assert.strictEqual(
        formatter.format(1234.567891),
        "1,234.567891",
        "Yield formatted with thousands separator and 6 decimals"
      );
      assert.strictEqual(
        formatter.format(0.000025),
        "0.000025",
        "Sub-cent formatted with 6 decimals"
      );
    });

    it("should reconcile portfolio value and format token amounts", () => {
      const investedAmount = 650_000_000; // $650.00
      const redeemingAmount = 500_000; // $0.50
      const unclaimedAmount = 810_000; // $0.81
      const netWorth = investedAmount + redeemingAmount + unclaimedAmount; // 651_310_000 ($651.31)

      assert.strictEqual(
        formatTokenAmount(investedAmount, 6),
        "650.00",
        "Invested amount formatted"
      );
      assert.strictEqual(
        formatTokenAmount(redeemingAmount, 6),
        "0.50",
        "Redeeming amount formatted"
      );
      assert.strictEqual(
        formatTokenAmount(unclaimedAmount, 6),
        "0.81",
        "Unclaimed amount formatted"
      );
      assert.strictEqual(
        formatTokenAmount(netWorth, 6),
        "651.31",
        "Total net worth formatted"
      );
    });

    it("should format currency amounts token-aware with explicit en-US formatting", () => {
      assert.strictEqual(
        formatCurrencyAmount(5_000_000, "USDC", 6, 2),
        "$5.00",
        "USDC bond price formatted as $5.00"
      );
      assert.strictEqual(
        formatCurrencyAmount(100_000_000_000, "USDC", 6, 0),
        "$100,000",
        "USDC TVL formatted without decimals"
      );
      assert.strictEqual(
        formatCurrencyAmount(1_000_000, "usdc", 6, 2),
        "$1.00",
        "Case-insensitive USDC formatted"
      );
      assert.strictEqual(
        formatCurrencyAmount(50_000_000, "SOL", 9, 2),
        "0.05 SOL",
        "SOL token formatted with suffix"
      );
    });

    it("should calculate annual draw entries accurately across pool durations", () => {
      // 0 tickets
      const zeroRes = calculateAnnualDrawEntries(0, 168);
      assert.strictEqual(
        zeroRes.drawsPerYear,
        52,
        "Expected 52 draws/yr for weekly pool"
      );
      assert.strictEqual(
        zeroRes.annualEntries,
        0,
        "Expected 0 entries for 0 tickets"
      );

      // Weekly pool (168h): 110 tickets
      const weeklyRes = calculateAnnualDrawEntries(110, 168);
      assert.strictEqual(weeklyRes.drawsPerYear, 52);
      assert.strictEqual(weeklyRes.annualEntries, 5720);

      // Daily pool (24h): 10 tickets
      const dailyRes = calculateAnnualDrawEntries(10, 24);
      assert.strictEqual(dailyRes.drawsPerYear, 365);
      assert.strictEqual(dailyRes.annualEntries, 3650);

      // Fallback when duration is 0, negative, or invalid
      const zeroDurRes = calculateAnnualDrawEntries(10, 0);
      assert.strictEqual(zeroDurRes.drawsPerYear, 52);
      assert.strictEqual(zeroDurRes.annualEntries, 520);

      const negDurRes = calculateAnnualDrawEntries(10, -100);
      assert.strictEqual(negDurRes.drawsPerYear, 52);
      assert.strictEqual(negDurRes.annualEntries, 520);

      // Undefined duration (defaults to 168)
      const undefDurRes = calculateAnnualDrawEntries(5);
      assert.strictEqual(undefDurRes.drawsPerYear, 52);
      assert.strictEqual(undefDurRes.annualEntries, 260);
    });

    it("should categorize and format cycle frequencies dynamically", () => {
      assert.strictEqual(getCycleFrequency(24), "daily");
      assert.strictEqual(getCycleFrequency(12), "daily");
      assert.strictEqual(getCycleFrequency(168), "weekly");
      assert.strictEqual(getCycleFrequency(720), "monthly");
      assert.strictEqual(getCycleFrequency(48), "custom");

      // Mock translation function
      const mockT = (key: string, values?: Record<string, any>) => {
        if (key === "freqDaily") return "Daily";
        if (key === "freqWeekly") return "Weekly";
        if (key === "freqMonthly") return "Monthly";
        if (key === "freqHours") return `${values?.hours}h`;
        return key;
      };

      assert.strictEqual(formatCycleFrequency(24, mockT), "Daily");
      assert.strictEqual(formatCycleFrequency(168, mockT), "Weekly");
      assert.strictEqual(formatCycleFrequency(720, mockT), "Monthly");
      assert.strictEqual(formatCycleFrequency(48, mockT), "48h");
    });
  });

  describe("Localnet CLI Flags & Documentation Verification", () => {
    it("should parse localnet flags and aliases accurately", () => {
      const flags1 = parseLocalnetFlags([
        "--bootstrap-only",
        "--db",
        "testdb",
        "--snapshot",
        "snap.json",
      ]);
      assert.strictEqual(
        flags1.bootstrapOnly,
        true,
        "Expected bootstrapOnly to be true"
      );
      assert.strictEqual(flags1.dbName, "testdb", "Expected dbName 'testdb'");
      assert.strictEqual(
        flags1.snapshotInput,
        "snap.json",
        "Expected snapshotInput 'snap.json'"
      );

      const flags2 = parseLocalnetFlags(["--pre-global", "-d=customdb"]);
      assert.strictEqual(flags2.bootstrapOnly, true);
      assert.strictEqual(flags2.dbName, "customdb");

      const flags3 = parseLocalnetFlags(["--setup-base"]);
      assert.strictEqual(flags3.bootstrapOnly, true);

      const flags4 = parseLocalnetFlags(["init", "--base"]);
      assert.strictEqual(flags4.bootstrapOnly, true);
      assert.strictEqual(flags4.positionals[0], "init");
    });

    it("should verify pb-cli COMMAND_REGISTRY flags for create-pool and update-pool-config", () => {
      const createPoolMeta = COMMAND_REGISTRY["create-pool"];
      assert.notStrictEqual(
        createPoolMeta,
        undefined,
        "create-pool should exist in COMMAND_REGISTRY"
      );
      const createFlags = createPoolMeta.options?.map(
        (o) => o.flag.split(" ")[0]
      );
      assert.strictEqual(
        createFlags?.includes("--min-yield-threshold"),
        true,
        "create-pool options must include --min-yield-threshold"
      );
      assert.strictEqual(
        createFlags?.includes("--payout-timelock"),
        true,
        "create-pool options must include --payout-timelock"
      );
      assert.strictEqual(
        createFlags?.includes("--tiers"),
        true,
        "create-pool options must include --tiers"
      );
      assert.strictEqual(
        createFlags?.includes("--timelock"),
        false,
        "create-pool options must not contain deprecated --timelock"
      );

      const updatePoolMeta = COMMAND_REGISTRY["update-pool-config"];
      assert.notStrictEqual(
        updatePoolMeta,
        undefined,
        "update-pool-config should exist in COMMAND_REGISTRY"
      );
      const updateFlags = updatePoolMeta.options?.map(
        (o) => o.flag.split(" ")[0]
      );
      assert.strictEqual(
        updateFlags?.includes("--min-yield-threshold"),
        true,
        "update-pool-config options must include --min-yield-threshold"
      );
      assert.strictEqual(
        updateFlags?.includes("--payout-timelock"),
        true,
        "update-pool-config options must include --payout-timelock"
      );
      assert.strictEqual(
        updateFlags?.includes("--timelock"),
        false,
        "update-pool-config options must not contain deprecated --timelock"
      );
      assert.strictEqual(
        updatePoolMeta.examples?.every((ex) => !ex.includes("--timelock")),
        true,
        "update-pool-config examples must not contain deprecated --timelock"
      );
      assert.strictEqual(
        updatePoolMeta.examples?.some((ex) => ex.includes("--payout-timelock")),
        true,
        "update-pool-config examples must contain --payout-timelock"
      );
    });

    it("should document create-pool and update-pool-config parameters in localnet bootstrap guide", () => {
      const guideText = getBootstrapGuideText();
      assert.ok(
        guideText.includes("--token-mint") &&
          guideText.includes("--pst-mint") &&
          guideText.includes("--fee-wallet"),
        "Guide must document optional account overrides: --token-mint, --pst-mint, --fee-wallet"
      );
      assert.ok(
        guideText.includes("--min-yield-threshold") &&
          guideText.includes("--max-yield-bps") &&
          guideText.includes("--payout-timelock") &&
          guideText.includes("--stake-duration") &&
          guideText.includes("--bond-price") &&
          guideText.includes("--fee-bps") &&
          guideText.includes('--tiers "1:10000"') &&
          guideText.includes('--tiers "1:5000,2:1500,5:400"'),
        "Guide must document pool configuration parameters including default and custom --tiers"
      );
      assert.ok(
        guideText.includes("Update Prize Tiers (Optional"),
        "Guide must document that prize tier configuration is optional after pool creation"
      );
      assert.ok(
        !guideText.includes("--timelock 0"),
        "Guide must not contain deprecated --timelock flag in update-pool-config"
      );
    });

    it("should re-export environment utilities from utils.ts", () => {
      assert.strictEqual(
        typeof upsertEnvFile,
        "function",
        "upsertEnvFile should be exported from utils"
      );
      assert.strictEqual(
        typeof readEnvFile,
        "function",
        "readEnvFile should be exported from utils"
      );
    });
  });

  describe("Signer Normalization & Transaction Deduplication", () => {
    it("should normalize distinct NoopSigner instances matching payerSigner.address to canonical KeyPairSigner", async () => {
      const {
        generateKeyPairSigner,
        createNoopSigner,
        AccountRole,
        createTransactionMessage,
        setTransactionMessageFeePayerSigner,
        appendTransactionMessageInstructions,
        signTransactionMessageWithSigners,
      } = await import("@solana/kit");
      const { normalizeInstructionSigners } = await import("./utils");

      const payer = await generateKeyPairSigner();
      const otherKey = (await generateKeyPairSigner()).address;

      // Instruction where payer has role WRITABLE_SIGNER with a distinct NoopSigner
      const dummyIx = {
        programAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as any,
        accounts: [
          {
            address: payer.address,
            role: AccountRole.WRITABLE_SIGNER,
            signer: createNoopSigner(payer.address),
          },
          {
            address: otherKey,
            role: AccountRole.READONLY,
          },
        ],
        data: new Uint8Array([1, 2, 3]),
      };

      const normalized = normalizeInstructionSigners([dummyIx], payer);

      assert.strictEqual(
        normalized[0].accounts?.[0].signer,
        payer,
        "Account signer must be normalized to canonical payer KeyPairSigner"
      );
      assert.strictEqual(
        normalized[0].accounts?.[1].address,
        otherKey,
        "Other accounts must remain unchanged"
      );

      // Verify that signTransactionMessageWithSigners succeeds without throwing duplicate signer error
      let msg = createTransactionMessage({ version: 0 });
      msg = setTransactionMessageFeePayerSigner(payer, msg);
      msg = appendTransactionMessageInstructions(normalized, msg);

      const signed = await signTransactionMessageWithSigners(msg);
      assert.ok(
        signed.signatures[payer.address],
        "Transaction must be signed by payer"
      );
    });

    it("should leave non-matching signer accounts intact", async () => {
      const { generateKeyPairSigner, createNoopSigner, AccountRole } =
        await import("@solana/kit");
      const { normalizeInstructionSigners } = await import("./utils");

      const payer = await generateKeyPairSigner();
      const secondarySigner = await generateKeyPairSigner();

      const dummyIx = {
        programAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as any,
        accounts: [
          {
            address: secondarySigner.address,
            role: AccountRole.READONLY_SIGNER,
            signer: secondarySigner,
          },
        ],
        data: new Uint8Array([0]),
      };

      const normalized = normalizeInstructionSigners([dummyIx], payer);
      assert.strictEqual(
        normalized[0].accounts?.[0].signer,
        secondarySigner,
        "Secondary signer should not be replaced"
      );
    });
  });

  describe("safeStringify BigInt & Circular Serialization", () => {
    it("should stringify primitives and standard objects", () => {
      assert.strictEqual(safeStringify(null), "null");
      assert.strictEqual(safeStringify("hello"), '"hello"');
      assert.strictEqual(safeStringify(123), "123");
      assert.strictEqual(safeStringify(true), "true");
      assert.strictEqual(safeStringify({ a: 1, b: "test" }), '{"a":1,"b":"test"}');
    });

    it("should serialize top-level and nested BigInt values without throwing TypeError", () => {
      const singleBigInt = 1000000000000000000n;
      assert.strictEqual(safeStringify(singleBigInt), '"1000000000000000000"');

      const complexObj = {
        id: 1,
        poolYield: 999999999999999999999999n,
        nested: {
          balances: [10n, 20n, 30n],
          label: "yield",
        },
      };
      const result = safeStringify(complexObj);
      assert.strictEqual(
        result,
        '{"id":1,"poolYield":"999999999999999999999999","nested":{"balances":["10","20","30"],"label":"yield"}}'
      );
    });

    it("should handle circular references gracefully without throw", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const circularObj: any = { name: "root" };
      circularObj.self = circularObj;

      const result = safeStringify(circularObj);
      assert.strictEqual(result, '{"name":"root","self":"[Circular]"}');
    });

    it("should format output with custom indentation when space is provided", () => {
      const obj = { key: 42n };
      const formatted = safeStringify(obj, 2);
      assert.strictEqual(formatted, '{\n  "key": "42"\n}');
    });

    it("should safely stringify Error objects and RPC error payloads", () => {
      const rpcErr = {
        code: -32603,
        message: "Internal error",
        data: { logs: ["Program log: Instruction failed"] },
      };
      const stringified = safeStringify(rpcErr);
      assert.ok(stringified.includes("-32603"));
      assert.ok(stringified.includes("Internal error"));
    });
  });
});
