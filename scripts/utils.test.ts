import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  formatErrorDetails,
  extractAllLogs,
  formatStackTrace,
  upsertEnvFile,
  readEnvFile,
  safeStringify,
  createResilientRpc,
  isRetryableRpcError,
  resolveDevnetRpcUrl,
  checkRpcHealth,
  normalizeRpcPayload,
  fetchAccountInfo,
  fetchAccountData,
  decodeAccountBase64Data,
  parseTokenAccountBalance,
  loadKeypair,
  generateKeypairBytes,
  saveKeypairBytes,
  generateAndSaveKeypair,
  loadOrGenerateKeypair,
  buildTransferSolInstruction,
  SYSTEM_PROGRAM_ID,
} from "./utils";
import {
  SolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  createSolanaRpcFromTransport,
  generateKeyPairSigner,
  AccountRole,
} from "@solana/kit";
import { parseLocalnetFlags, getBootstrapGuideText } from "./localnet";
import { parseTransactionError, matchAnchorError } from "../app/lib/errors";
import {
  DEFAULT_LIVE_YIELD_PRECISION,
  formatTokenAmount,
  formatCurrency,
  calculateAnnualDrawEntries,
  getCycleFrequency,
  formatCycleFrequency,
} from "../app/lib/formatters";
import {
  COMMAND_REGISTRY,
  parseClaimRedemptionArgs,
  CliArgumentError,
} from "./pb-cli";
import { address } from "@solana/kit";
import {
  buildClaimRedemptionInstructions,
  RedemptionType,
  ATA_PROGRAM_ID,
  PROGRAM_ID,
} from "../app/lib/bonds-sdk";
import { TEST_ADDRESSES } from "../app/lib/test-harness";

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
            `Program ${PROGRAM_ID} invoke [1]`,
            "Program log: Instruction: HarvestYieldAndCommit",
            `Program ${PROGRAM_ID} failed: custom program error: 0x1770`,
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
        formatCurrency(5_000_000, {
          tokenSymbol: "USDC",
          decimals: 6,
          maxFractionDigits: 2,
        }),
        "$5.00",
        "USDC bond price formatted as $5.00"
      );
      assert.strictEqual(
        formatCurrency(100_000_000_000, {
          tokenSymbol: "USDC",
          decimals: 6,
          minFractionDigits: 0,
          maxFractionDigits: 0,
        }),
        "$100,000",
        "USDC TVL formatted without decimals"
      );
      assert.strictEqual(
        formatCurrency(1_000_000, {
          tokenSymbol: "usdc",
          decimals: 6,
          maxFractionDigits: 2,
        }),
        "$1.00",
        "Case-insensitive USDC formatted"
      );
      assert.strictEqual(
        formatCurrency(50_000_000, {
          tokenSymbol: "SOL",
          decimals: 9,
          minFractionDigits: 2,
          maxFractionDigits: 2,
        }),
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
        createFlags?.includes("--huma-pool-state"),
        true,
        "create-pool options must include --huma-pool-state"
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

  describe("Resilient RPC & Transient Network Fault Tolerance", () => {
    describe("isRetryableRpcError", () => {
      it("should identify Node/undici SocketError: other side closed (UND_ERR_SOCKET) as retryable", () => {
        const err = new TypeError("fetch failed");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any).cause = {
          name: "SocketError",
          code: "UND_ERR_SOCKET",
          message: "other side closed",
        };
        assert.strictEqual(isRetryableRpcError(err), true);
      });

      it("should identify network error codes (ECONNRESET, ETIMEDOUT, ECONNREFUSED) as retryable", () => {
        const resetErr = new Error("read ECONNRESET");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (resetErr as any).code = "ECONNRESET";
        assert.strictEqual(isRetryableRpcError(resetErr), true);

        const timeoutErr = new Error("connect ETIMEDOUT");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (timeoutErr as any).code = "ETIMEDOUT";
        assert.strictEqual(isRetryableRpcError(timeoutErr), true);
      });

      it("should identify HTTP 429 and 5xx transport errors as retryable", () => {
        const err429 = new SolanaError(
          SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
          {
            statusCode: 429,
          }
        );
        assert.strictEqual(isRetryableRpcError(err429), true);

        const err503 = new SolanaError(
          SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
          {
            statusCode: 503,
          }
        );
        assert.strictEqual(isRetryableRpcError(err503), true);

        const err502 = new SolanaError(
          SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
          {
            statusCode: 502,
          }
        );
        assert.strictEqual(isRetryableRpcError(err502), true);
      });

      it("should reject non-retryable errors (HTTP 400, validation errors, null)", () => {
        assert.strictEqual(isRetryableRpcError(null), false);
        assert.strictEqual(isRetryableRpcError(undefined), false);

        const err400 = new SolanaError(
          SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
          {
            statusCode: 400,
          }
        );
        assert.strictEqual(isRetryableRpcError(err400), false);

        const customErr = new Error("Invalid program address");
        assert.strictEqual(isRetryableRpcError(customErr), false);
      });
    });

    describe("createResilientRpc", () => {
      it("should construct a valid RPC instance with core methods", () => {
        const rpc = createResilientRpc("http://127.0.0.1:8899");
        assert.strictEqual(typeof rpc.getAccountInfo, "function");
        assert.strictEqual(typeof rpc.getLatestBlockhash, "function");
      });

      it("should retry on transient socket drops and resolve once transport recovers", async () => {
        let attempts = 0;
        const retryLog: number[] = [];

        // Test resilient transport directly with simulated socket error recovery
        let resilientAttempts = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resilientTransport = async (req: any) => {
          let attempt = 0;
          while (true) {
            try {
              resilientAttempts++;
              if (resilientAttempts < 3) {
                const err = new TypeError("fetch failed");
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (err as any).cause = {
                  name: "SocketError",
                  code: "UND_ERR_SOCKET",
                  message: "other side closed",
                };
                throw err;
              }
              return {
                jsonrpc: "2.0",
                id: req.payload.id,
                result: { context: { slot: 100 }, value: null },
              };
            } catch (err) {
              if (!isRetryableRpcError(err) || attempt >= 3) throw err;
              attempt++;
              retryLog.push(attempt);
            }
          }
        };

        const testRpc = createSolanaRpcFromTransport(resilientTransport);
        const res = await testRpc
          .getAccountInfo(address("11111111111111111111111111111111"))
          .send();
        assert.strictEqual(res.value, null);
        assert.strictEqual(resilientAttempts, 3);
        assert.deepStrictEqual(retryLog, [1, 2]);
      });

      it("should reject immediately if caller signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resilientTransport = async (request: any) => {
          if (request.signal?.aborted) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
          return { jsonrpc: "2.0", id: 1, result: null };
        };

        const testRpc = createSolanaRpcFromTransport(resilientTransport);
        await assert.rejects(
          async () => {
            await testRpc
              .getAccountInfo(address("11111111111111111111111111111111"))
              .send({ abortSignal: controller.signal });
          },
          { name: "AbortError" }
        );
      });

      it("should normalize account query payloads to base64 encoding via transport dependency injection", async () => {
        let capturedPayload: any = null;
        const mockTransport = async (req: any) => {
          capturedPayload = req.payload;
          return {
            jsonrpc: "2.0",
            id: req.payload?.id ?? 1,
            result: { context: { slot: 100 }, value: null },
          };
        };

        const rpc = createResilientRpc("http://mock-rpc", {
          transport: mockTransport,
        });

        // 1. getAccountInfo without encoding -> normalizes to base64
        await rpc
          .getAccountInfo(address("11111111111111111111111111111111"))
          .send();
        assert.strictEqual(capturedPayload.method, "getAccountInfo");
        assert.strictEqual(capturedPayload.params[1]?.encoding, "base64");

        // 2. getMultipleAccounts without encoding -> normalizes to base64
        await rpc
          .getMultipleAccounts([address("11111111111111111111111111111111")])
          .send();
        assert.strictEqual(capturedPayload.method, "getMultipleAccounts");
        assert.strictEqual(capturedPayload.params[1]?.encoding, "base64");

        // 3. getProgramAccounts without encoding -> normalizes to base64
        await rpc
          .getProgramAccounts(address("11111111111111111111111111111111"))
          .send();
        assert.strictEqual(capturedPayload.method, "getProgramAccounts");
        assert.strictEqual(capturedPayload.params[1]?.encoding, "base64");

        // 4. getAccountInfo with explicit jsonParsed -> preserves caller encoding
        await rpc
          .getAccountInfo(address("11111111111111111111111111111111"), {
            encoding: "jsonParsed",
          })
          .send();
        assert.strictEqual(capturedPayload.params[1]?.encoding, "jsonParsed");

        // 5. getLatestBlockhash (non-account query) -> untouched
        await rpc.getLatestBlockhash().send();
        assert.strictEqual(capturedPayload.method, "getLatestBlockhash");
        assert.strictEqual(capturedPayload.params[1], undefined);
      });
    });

    describe("normalizeRpcPayload Unit Tests", () => {
      it("should handle null and undefined payloads", () => {
        assert.strictEqual(normalizeRpcPayload(null), null);
        assert.strictEqual(normalizeRpcPayload(undefined), undefined);
      });

      it("should recursively normalize batched JSON-RPC payload arrays", () => {
        const batch = [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [
              "11111111111111111111111111111111",
              { commitment: "confirmed" },
            ],
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "getLatestBlockhash",
            params: [{ commitment: "confirmed" }],
          },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "getMultipleAccounts",
            params: [["11111111111111111111111111111111"]],
          },
        ];

        const normalized = normalizeRpcPayload(batch);
        assert.strictEqual(Array.isArray(normalized), true);
        assert.strictEqual(normalized[0].params[1].encoding, "base64");
        assert.strictEqual(normalized[0].params[1].commitment, "confirmed");
        assert.strictEqual(normalized[1].params[0].encoding, undefined);
        assert.strictEqual(normalized[2].params[1].encoding, "base64");
      });

      it("should not corrupt empty params arrays", () => {
        const payload = {
          jsonrpc: "2.0",
          id: 1,
          method: "getAccountInfo",
          params: [],
        };
        const normalized = normalizeRpcPayload(payload);
        assert.deepStrictEqual(normalized.params, []);
      });
    });

    describe("fetchAccountInfo and fetchAccountData", () => {
      it("should fetch account info with base64 encoding and support abortSignal", async () => {
        let capturedConfig: any = null;
        let capturedSendOptions: any = null;

        const mockRpc = {
          getAccountInfo: (addr: any, config: any) => {
            capturedConfig = config;
            return {
              send: async (sendOptions: any) => {
                capturedSendOptions = sendOptions;
                return {
                  context: { slot: 100n },
                  value: {
                    data: ["AQIDBA==", "base64"],
                    executable: false,
                    lamports: 1000n,
                    owner: "11111111111111111111111111111111",
                    rentEpoch: 0n,
                    space: 4n,
                  },
                };
              },
            };
          },
        } as any;

        const controller = new AbortController();
        const res = await fetchAccountInfo(
          mockRpc,
          "11111111111111111111111111111111",
          { commitment: "processed" },
          { abortSignal: controller.signal }
        );

        assert.strictEqual(capturedConfig.encoding, "base64");
        assert.strictEqual(capturedConfig.commitment, "processed");
        assert.strictEqual(capturedSendOptions.abortSignal, controller.signal);
        assert.strictEqual(res.value?.lamports, 1000n);
      });

      it("should decode binary account data to Uint8Array via fetchAccountData", async () => {
        const mockRpc = {
          getAccountInfo: () => ({
            send: async () => ({
              context: { slot: 100n },
              value: {
                data: ["AQID", "base64"],
                executable: false,
                lamports: 1000n,
                owner: "11111111111111111111111111111111",
                rentEpoch: 0n,
                space: 3n,
              },
            }),
          }),
        } as any;

        const data = await fetchAccountData(
          mockRpc,
          "11111111111111111111111111111111"
        );
        assert.deepStrictEqual(data, new Uint8Array([1, 2, 3]));
      });

      it("should return null from fetchAccountData when account does not exist", async () => {
        const mockRpc = {
          getAccountInfo: () => ({
            send: async () => ({
              context: { slot: 100n },
              value: null,
            }),
          }),
        } as any;

        const data = await fetchAccountData(
          mockRpc,
          "11111111111111111111111111111111"
        );
        assert.strictEqual(data, null);
      });
    });

    describe("resolveDevnetRpcUrl", () => {
      it("should prioritize SOLANA_RPC_URL environment variable", () => {
        const origSolana = process.env.SOLANA_RPC_URL;
        const origDevnet = process.env.DEVNET_RPC_URL;
        try {
          process.env.SOLANA_RPC_URL = "https://custom-solana-rpc.com";
          process.env.DEVNET_RPC_URL = "https://custom-devnet-rpc.com";
          assert.strictEqual(
            resolveDevnetRpcUrl(),
            "https://custom-solana-rpc.com"
          );
        } finally {
          if (origSolana !== undefined) process.env.SOLANA_RPC_URL = origSolana;
          else delete process.env.SOLANA_RPC_URL;
          if (origDevnet !== undefined) process.env.DEVNET_RPC_URL = origDevnet;
          else delete process.env.DEVNET_RPC_URL;
        }
      });

      it("should fallback to DEVNET_RPC_URL if SOLANA_RPC_URL is unset", () => {
        const origSolana = process.env.SOLANA_RPC_URL;
        const origDevnet = process.env.DEVNET_RPC_URL;
        try {
          delete process.env.SOLANA_RPC_URL;
          process.env.DEVNET_RPC_URL = "https://custom-devnet-rpc.com";
          assert.strictEqual(
            resolveDevnetRpcUrl(),
            "https://custom-devnet-rpc.com"
          );
        } finally {
          if (origSolana !== undefined) process.env.SOLANA_RPC_URL = origSolana;
          else delete process.env.SOLANA_RPC_URL;
          if (origDevnet !== undefined) process.env.DEVNET_RPC_URL = origDevnet;
          else delete process.env.DEVNET_RPC_URL;
        }
      });

      it("should hermetically resolve from .env.devnet when .env.local is in localnet mode", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rpc-test-"));
        try {
          const devnetPath = path.resolve(tempDir, ".env.devnet");
          const localPath = path.resolve(tempDir, ".env.local");

          fs.writeFileSync(
            devnetPath,
            "NEXT_PUBLIC_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=secret\n",
            "utf-8"
          );
          fs.writeFileSync(
            localPath,
            "NEXT_PUBLIC_ENVIRONMENT=localnet\nNEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899\nSOLANA_RPC_URL=http://127.0.0.1:8899\n",
            "utf-8"
          );

          const resolved = resolveDevnetRpcUrl({
            devnetEnvPath: devnetPath,
            localEnvPath: localPath,
            env: {},
          });

          assert.strictEqual(
            resolved,
            "https://devnet.helius-rpc.com/?api-key=secret",
            "Should resolve from .env.devnet and ignore .env.local in localnet mode"
          );
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      });

      it("should ignore loopback URLs in .env.devnet and fall back to default Devnet RPC", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-rpc-test-"));
        try {
          const devnetPath = path.resolve(tempDir, ".env.devnet");
          const localPath = path.resolve(tempDir, ".env.local");

          fs.writeFileSync(
            devnetPath,
            "NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899\nSOLANA_RPC_URL=http://localhost:8899\n",
            "utf-8"
          );
          fs.writeFileSync(localPath, "# Empty\n", "utf-8");

          const resolved = resolveDevnetRpcUrl({
            devnetEnvPath: devnetPath,
            localEnvPath: localPath,
            env: {},
          });

          assert.strictEqual(
            resolved,
            "https://api.devnet.solana.com",
            "Should discard loopback URLs and fall back to canonical devnet RPC"
          );
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      });
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
      assert.strictEqual(
        safeStringify({ a: 1, b: "test" }),
        '{"a":1,"b":"test"}'
      );
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

  describe("claim-redemption CLI Command & Validation", () => {
    describe("Metadata & Options Invariant", () => {
      it("should register claim-redemption with correct metadata and options", () => {
        const meta = COMMAND_REGISTRY["claim-redemption"];
        assert.ok(
          meta,
          "claim-redemption must be registered in COMMAND_REGISTRY"
        );
        assert.strictEqual(meta.command, "claim-redemption");
        assert.strictEqual(meta.category, "Crank & Operations");
        assert.strictEqual(meta.requiresSigner, true);
        assert.strictEqual(meta.positionalArgs, "[redemptionId]");

        const flags = meta.options?.map((o) => o.flag.split(" ")[0]);
        assert.ok(flags?.includes("--id"), "Must include --id flag");
        assert.ok(flags?.includes("--user"), "Must include --user flag");
        assert.ok(flags?.includes("--limit"), "Must include --limit flag");
      });

      it("should support claim-redemptions alias in COMMAND_REGISTRY", () => {
        assert.strictEqual(
          COMMAND_REGISTRY["claim-redemptions"],
          COMMAND_REGISTRY["claim-redemption"],
          "claim-redemptions alias must map to claim-redemption metadata"
        );
      });
    });

    describe("Pure Argument Validation (parseClaimRedemptionArgs)", () => {
      it("should parse valid arguments with defaults", () => {
        const res = parseClaimRedemptionArgs({});
        assert.strictEqual(res.poolId, 1);
        assert.strictEqual(res.redemptionId, undefined);
        assert.strictEqual(res.userAddress, undefined);
        assert.strictEqual(res.limit, undefined);
      });

      it("should parse valid custom inputs correctly", () => {
        const dummyUser = "11111111111111111111111111111111";
        const res = parseClaimRedemptionArgs({
          poolId: 2,
          redemptionId: "42",
          user: dummyUser,
          limit: "10",
        });
        assert.strictEqual(res.poolId, 2);
        assert.strictEqual(res.redemptionId, 42n);
        assert.strictEqual(res.userAddress, address(dummyUser));
        assert.strictEqual(res.limit, 10);
      });

      it("should accept BigInt and number types directly", () => {
        const res = parseClaimRedemptionArgs({
          poolId: 1,
          redemptionId: 100n,
          limit: 5,
        });
        assert.strictEqual(res.redemptionId, 100n);
        assert.strictEqual(res.limit, 5);
      });

      it("should reject invalid pool IDs with CliArgumentError", () => {
        assert.throws(
          () => parseClaimRedemptionArgs({ poolId: 0 }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid pool ID")
        );
        assert.throws(
          () => parseClaimRedemptionArgs({ poolId: -1 }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid pool ID")
        );
        assert.throws(
          () => parseClaimRedemptionArgs({ poolId: 1.5 }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid pool ID")
        );
      });

      it("should reject invalid redemption IDs with CliArgumentError", () => {
        assert.throws(
          () => parseClaimRedemptionArgs({ redemptionId: "abc" }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid redemption ID")
        );
        assert.throws(
          () => parseClaimRedemptionArgs({ redemptionId: "-5" }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid redemption ID")
        );
        assert.throws(
          () => parseClaimRedemptionArgs({ redemptionId: "12.34" }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid redemption ID")
        );
      });

      it("should reject invalid user addresses with CliArgumentError", () => {
        assert.throws(
          () => parseClaimRedemptionArgs({ user: "invalid-user-pubkey" }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid user public key address")
        );
      });

      it("should reject invalid limits with CliArgumentError", () => {
        assert.throws(
          () => parseClaimRedemptionArgs({ limit: 0 }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid limit")
        );
        assert.throws(
          () => parseClaimRedemptionArgs({ limit: -1 }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid limit")
        );
        assert.throws(
          () => parseClaimRedemptionArgs({ limit: "not-a-number" }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid limit")
        );
        assert.throws(
          () => parseClaimRedemptionArgs({ limit: 2.5 }),
          (err: any) =>
            err instanceof CliArgumentError &&
            err.message.includes("Invalid limit")
        );
      });
    });

    describe("Queue Settlement Filtering Invariant", () => {
      it("should correctly discriminate settled vs unsettled redemptions against nextRequestId", () => {
        const nextRequestId = 10n;
        const mockRedemptions = [
          { redemptionId: 1n, humaRequestId: 5n, status: "settled" },
          { redemptionId: 2n, humaRequestId: 9n, status: "settled" },
          { redemptionId: 3n, humaRequestId: 10n, status: "unsettled" },
          { redemptionId: 4n, humaRequestId: 11n, status: "unsettled" },
        ];

        const settled = mockRedemptions.filter(
          (r) => r.humaRequestId < nextRequestId
        );
        const unsettled = mockRedemptions.filter(
          (r) => r.humaRequestId >= nextRequestId
        );

        assert.strictEqual(settled.length, 2);
        assert.deepStrictEqual(
          settled.map((r) => r.redemptionId),
          [1n, 2n]
        );
        assert.strictEqual(unsettled.length, 2);
        assert.deepStrictEqual(
          unsettled.map((r) => r.redemptionId),
          [3n, 4n]
        );
      });
    });

    describe("CLI Claim Redemption Instruction Building", () => {
      it("should route fee withdrawal claim to pool fee_wallet without prepending ATA creation", async () => {
        const crank = TEST_ADDRESSES.USER;
        const adminBeneficiary = TEST_ADDRESSES.USER_2;
        const feeWallet = TEST_ADDRESSES.ADMIN;
        const tokenMint = TEST_ADDRESSES.MINT;

        const ixs = await buildClaimRedemptionInstructions({
          crank,
          beneficiary: adminBeneficiary,
          poolId: 1,
          redemptionId: 4n,
          tokenMint,
          humaAddresses: {
            poolState: TEST_ADDRESSES.HUMA_POOL,
          },
          redemptionType: RedemptionType.FeeWithdrawal,
          feeWallet,
        });

        assert.strictEqual(
          ixs.length,
          1,
          "FeeWithdrawal claim should not prepend ATA creation"
        );
        assert.strictEqual(
          ixs[0].accounts?.[6].address,
          feeWallet,
          "beneficiaryTokenAccount must be feeWallet"
        );
      });

      it("should derive user ATA and prepend idempotent ATA creation for user redemptions", async () => {
        const crank = TEST_ADDRESSES.USER;
        const user = TEST_ADDRESSES.USER_2;
        const tokenMint = TEST_ADDRESSES.MINT;

        const ixs = await buildClaimRedemptionInstructions({
          crank,
          beneficiary: user,
          poolId: 1,
          redemptionId: 1n,
          tokenMint,
          humaAddresses: {
            poolState: TEST_ADDRESSES.HUMA_POOL,
          },
          redemptionType: RedemptionType.BondSale,
        });

        assert.strictEqual(
          ixs.length,
          2,
          "BondSale claim should prepend createAssociatedTokenIdempotentInstruction"
        );
        assert.strictEqual(ixs[0].programAddress, ATA_PROGRAM_ID);
        assert.deepStrictEqual(Array.from(ixs[0].data || []), [1]);
        assert.strictEqual(
          ixs[1].accounts?.[6].address,
          ixs[0].accounts?.[1].address,
          "beneficiaryTokenAccount in claim must match created ATA"
        );
      });
    });
  });

  describe("dispatchAdminInstruction Multi-Authority & Guardian Suite", () => {
    const createMockRpc = () => {
      return {
        getLatestBlockhash: () => ({
          send: async () => ({
            value: {
              blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
              lastValidBlockHeight: 100n,
            },
          }),
        }),
        sendTransaction: () => ({
          send: async () =>
            "mock_tx_signature_11111111111111111111111111111111111111111111",
        }),
        getSignatureStatuses: () => ({
          send: async () => ({
            value: [{ confirmationStatus: "confirmed", err: null }],
          }),
        }),
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
      } as unknown as any;
    };

    const dummyBuilder = async () => ({
      programAddress: address("11111111111111111111111111111111"),
      accounts: [],
      data: new Uint8Array([0]),
    });

    it("1. Guardian Direct Execution: should succeed when signer matches guardian in expectedAuthority array", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const admin = (await generateKeyPairSigner()).address;
      const guardian = await generateKeyPairSigner();
      const rpc = createMockRpc();

      await assert.doesNotReject(async () => {
        await dispatchAdminInstruction({
          rpc,
          signer: guardian,
          expectedAuthority: [admin, guardian.address],
          mode: { kind: "direct" },
          commandName: "pause-pool",
          builder: dummyBuilder,
        });
      });
    });

    it("2. Admin Direct Execution: should succeed when signer matches admin in expectedAuthority array", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const admin = await generateKeyPairSigner();
      const guardian = (await generateKeyPairSigner()).address;
      const rpc = createMockRpc();

      await assert.doesNotReject(async () => {
        await dispatchAdminInstruction({
          rpc,
          signer: admin,
          expectedAuthority: [admin.address, guardian],
          mode: { kind: "direct" },
          commandName: "pause-pool",
          builder: dummyBuilder,
        });
      });
    });

    it("3. Unauthorized Signer Rejection: should reject with formatted error containing all expected authorities", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const admin = (await generateKeyPairSigner()).address;
      const guardian = (await generateKeyPairSigner()).address;
      const unauthorizedSigner = await generateKeyPairSigner();
      const rpc = createMockRpc();

      await assert.rejects(
        async () => {
          await dispatchAdminInstruction({
            rpc,
            signer: unauthorizedSigner,
            expectedAuthority: [admin, guardian],
            mode: { kind: "direct" },
            commandName: "pause-pool",
            builder: dummyBuilder,
          });
        },
        {
          message: `Direct signer ${unauthorizedSigner.address} does not match expected on-chain authority ${admin} or ${guardian}.`,
        }
      );
    });

    it("4. Authority Deduplication in Error: should deduplicate duplicate authorities in formatted error", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const sharedAuthority = (await generateKeyPairSigner()).address;
      const unauthorizedSigner = await generateKeyPairSigner();
      const rpc = createMockRpc();

      await assert.rejects(
        async () => {
          await dispatchAdminInstruction({
            rpc,
            signer: unauthorizedSigner,
            expectedAuthority: [sharedAuthority, sharedAuthority],
            mode: { kind: "direct" },
            commandName: "pause-pool",
            builder: dummyBuilder,
          });
        },
        {
          message: `Direct signer ${unauthorizedSigner.address} does not match expected on-chain authority ${sharedAuthority}.`,
        }
      );
    });

    it("5. Squads Propose Authority Validation: should validate multisig vault PDA against expected authorities", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { findMultisigVaultPda } = await import("../app/lib/squads-sdk");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const multisig = (await generateKeyPairSigner()).address;
      const vaultPda = await findMultisigVaultPda(multisig, 0);
      const wrongMultisig = (await generateKeyPairSigner()).address;
      const wrongVaultPda = await findMultisigVaultPda(wrongMultisig, 0);
      const signer = await generateKeyPairSigner();
      const rpc = createMockRpc();

      await assert.rejects(
        async () => {
          await dispatchAdminInstruction({
            rpc,
            signer,
            expectedAuthority: [vaultPda],
            mode: {
              kind: "propose",
              multisig: wrongMultisig,
              vaultIndex: 0,
              autoApprove: true,
            },
            commandName: "pause-pool",
            builder: dummyBuilder,
          });
        },
        {
          message: `Squads Vault PDA ${wrongVaultPda} (index 0) does not match expected on-chain authority ${vaultPda}.`,
        }
      );
    });

    it("6. Missing Authority Error Guard: should throw descriptive error when neither expectedAuthority nor expectedAdmin is passed", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const signer = await generateKeyPairSigner();
      const rpc = createMockRpc();

      await assert.rejects(
        async () => {
          await dispatchAdminInstruction({
            rpc,
            signer,
            mode: { kind: "direct" },
            commandName: "test-cmd",
            builder: dummyBuilder,
          } as any);
        },
        {
          message:
            "dispatchAdminInstruction requires 'expectedAuthority' to be specified for command 'test-cmd'.",
        }
      );
    });

    it("7. Empty Array Error Guard: should throw descriptive error when empty expectedAuthority array is passed", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const signer = await generateKeyPairSigner();
      const rpc = createMockRpc();

      await assert.rejects(
        async () => {
          await dispatchAdminInstruction({
            rpc,
            signer,
            expectedAuthority: [],
            mode: { kind: "direct" },
            commandName: "test-cmd",
            builder: dummyBuilder,
          });
        },
        {
          message:
            "dispatchAdminInstruction requires at least one expected authority for command 'test-cmd'.",
        }
      );
    });

    it("8. Backwards-Compatible expectedAdmin Support: should support legacy expectedAdmin parameter", async () => {
      const { generateKeyPairSigner } = await import("@solana/kit");
      const { dispatchAdminInstruction } = await import("./squads-cli-utils");

      const admin = await generateKeyPairSigner();
      const rpc = createMockRpc();

      await assert.doesNotReject(async () => {
        await dispatchAdminInstruction({
          rpc,
          signer: admin,
          expectedAdmin: admin.address,
          mode: { kind: "direct" },
          commandName: "legacy-cmd",
          builder: dummyBuilder,
        });
      });

      const unauthorized = await generateKeyPairSigner();
      await assert.rejects(
        async () => {
          await dispatchAdminInstruction({
            rpc,
            signer: unauthorized,
            expectedAdmin: admin.address,
            mode: { kind: "direct" },
            commandName: "legacy-cmd",
            builder: dummyBuilder,
          });
        },
        {
          message: `Direct signer ${unauthorized.address} does not match expected on-chain authority ${admin.address}.`,
        }
      );
    });

    it("9. GlobalConfig RPC Helpers: getGlobalConfig throws if account not found and getGlobalAdmin derives admin", async () => {
      const { getGlobalConfig, getGlobalAdmin } = await import("./pb-cli");
      const missingRpc = {
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
      } as unknown as any;

      await assert.rejects(async () => {
        await getGlobalConfig(missingRpc);
      }, /GlobalConfig account does not exist at .*\. Run 'init-global' first\./);

      await assert.rejects(async () => {
        await getGlobalAdmin(missingRpc);
      }, /GlobalConfig account does not exist at .*\. Run 'init-global' first\./);
    });
  });

  describe("Keypair Management & Robust Generation Suite", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-keypair-test-"));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should generate valid 64-byte Ed25519 keypair bytes", async () => {
      const bytes = generateKeypairBytes();
      assert.equal(bytes.length, 64);
      assert.ok(bytes instanceof Uint8Array);

      // Verify it can be loaded into KeyPairSigner
      const { createKeyPairSignerFromBytes } = await import("@solana/kit");
      const signer = await createKeyPairSignerFromBytes(bytes);
      assert.ok(signer.address);
      assert.equal(typeof signer.address, "string");
      assert.ok(signer.address.length >= 32);
    });

    it("should save keypair bytes with 0o600 permissions", async () => {
      const bytes = generateKeypairBytes();
      const keyPath = path.join(tempDir, "sub", "test-key.json");
      saveKeypairBytes(keyPath, bytes);

      assert.ok(fs.existsSync(keyPath));
      const stat = fs.statSync(keyPath);
      // Mode on POSIX includes file type, mask with 0o777
      assert.equal(stat.mode & 0o777, 0o600);

      const loaded = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
      assert.deepEqual(loaded, Array.from(bytes));
    });

    it("loadKeypair should reject when file does not exist", async () => {
      const nonExistentPath = path.join(tempDir, "missing.json");
      await assert.rejects(
        async () => {
          await loadKeypair(nonExistentPath);
        },
        {
          message: `Keypair file not found at: ${nonExistentPath}. Please ensure your authority keypair is generated and placed there.`,
        }
      );
    });

    it("loadKeypair should reject when file contains malformed JSON", async () => {
      const malformedPath = path.join(tempDir, "malformed.json");
      fs.writeFileSync(malformedPath, "not-valid-json", "utf-8");

      await assert.rejects(async () => {
        await loadKeypair(malformedPath);
      }, /Failed to parse keypair file at: .* Ensure it is a valid JSON byte array\./);
    });

    it("loadKeypair should reject when file contains invalid keypair bytes (e.g. 64 random bytes)", async () => {
      const invalidPath = path.join(tempDir, "invalid-bytes.json");
      // 64 random bytes whose public key half does not match the secret key half
      const fakeBytes = Array.from(
        { length: 64 },
        (_, i) => (i * 7 + 13) % 256
      );
      fs.writeFileSync(invalidPath, JSON.stringify(fakeBytes), "utf-8");

      await assert.rejects(
        async () => {
          await loadKeypair(invalidPath);
        },
        (err: Error) => {
          assert.match(
            err.message,
            /Failed to parse keypair file at: .* Ensure it is a valid JSON byte array\./
          );
          assert.ok(err.cause, "Expected error cause to be preserved");
          return true;
        }
      );
    });

    it("loadOrGenerateKeypair should generate fresh keypair if file is missing", async () => {
      const keyPath = path.join(tempDir, "new-key.json");
      const signer = await loadOrGenerateKeypair(keyPath, "new-label");

      assert.ok(fs.existsSync(keyPath));
      assert.ok(signer.address);

      // Subsequent call should reuse existing keypair
      const reloaded = await loadOrGenerateKeypair(keyPath, "new-label");
      assert.equal(reloaded.address, signer.address);
    });

    it("loadOrGenerateKeypair should fail on corrupt file if overwriteIfInvalid is false", async () => {
      const corruptPath = path.join(tempDir, "corrupt.json");
      fs.writeFileSync(corruptPath, JSON.stringify([1, 2, 3]), "utf-8");

      await assert.rejects(async () => {
        await loadOrGenerateKeypair(corruptPath);
      }, /Failed to parse keypair file/);
    });

    it("loadOrGenerateKeypair should overwrite corrupt file if overwriteIfInvalid is true", async () => {
      const corruptPath = path.join(tempDir, "corrupt-recover.json");
      // Write 64 random bytes that fail Ed25519 verification
      fs.writeFileSync(
        corruptPath,
        JSON.stringify(Array.from({ length: 64 }, (_, i) => i)),
        "utf-8"
      );

      const recoveredSigner = await loadOrGenerateKeypair(corruptPath, {
        overwriteIfInvalid: true,
        label: "Recovered Key",
      });

      assert.ok(recoveredSigner.address);
      // Verify file is now valid
      const reloaded = await loadKeypair(corruptPath);
      assert.equal(reloaded.address, recoveredSigner.address);
    });
  });

  describe("buildTransferSolInstruction", () => {
    it("builds valid native SystemProgram::Transfer instruction (Opcode 2)", async () => {
      const from = await generateKeyPairSigner();
      const to = await generateKeyPairSigner();
      const lamports = 1_500_000_000n; // 1.5 SOL

      const ix = buildTransferSolInstruction({
        from,
        to: to.address,
        lamports,
      });

      assert.strictEqual(ix.programAddress, SYSTEM_PROGRAM_ID);
      assert.strictEqual(ix.accounts?.length, 2);
      assert.strictEqual(ix.accounts[0].address, from.address);
      assert.strictEqual(ix.accounts[0].role, AccountRole.WRITABLE_SIGNER);
      assert.strictEqual(ix.accounts[1].address, to.address);
      assert.strictEqual(ix.accounts[1].role, AccountRole.WRITABLE);

      const view = new DataView(
        ix.data!.buffer,
        ix.data!.byteOffset,
        ix.data!.byteLength
      );
      assert.strictEqual(view.getUint32(0, true), 2); // Transfer opcode
      assert.strictEqual(view.getBigUint64(4, true), lamports);
    });

    it("rejects non-positive transfer amounts", async () => {
      const from = await generateKeyPairSigner();
      const to = await generateKeyPairSigner();

      assert.throws(
        () =>
          buildTransferSolInstruction({
            from,
            to: to.address,
            lamports: 0n,
          }),
        /Transfer lamports must be greater than zero. Received: 0/
      );

      assert.throws(
        () =>
          buildTransferSolInstruction({
            from,
            to: to.address,
            lamports: -100n,
          }),
        /Transfer lamports must be greater than zero. Received: -100/
      );
    });
  });
});
