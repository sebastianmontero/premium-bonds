import { formatErrorDetails, extractAllLogs, formatStackTrace } from "./utils";
import { parseLocalnetFlags, getBootstrapGuideText } from "./localnet";
import { parseTransactionError, matchAnchorError } from "../app/lib/errors";
import {
  DEFAULT_LIVE_YIELD_PRECISION,
  formatTokenAmount,
} from "../app/lib/formatters";
import { COMMAND_REGISTRY } from "./pb-cli";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log("Running scripts/utils.test.ts unit tests...\n");

  // Test 1: Anchor Custom & Framework Error Decoding
  {
    console.log("Test 1: Anchor Custom Error Decoding (6000 PoolNotActive)");
    const matched = matchAnchorError(
      '{"InstructionError":[0,{"Custom":6000}]}'
    );
    assert(matched !== null, "Should match Custom: 6000");
    assert(matched?.code === 6000, "Code should be 6000");
    assert(
      matched?.info.name === "PoolNotActive",
      "Name should be PoolNotActive"
    );
    console.log("✓ Passed Test 1a\n");

    console.log(
      "Test 1b: Anchor Framework Error Decoding (3005 RequireGteViolated / 0xbbd)"
    );
    const matchedFw = matchAnchorError("custom program error: 0xbbd");
    assert(matchedFw !== null, "Should match 0xbbd");
    assert(
      matchedFw?.code === 3005,
      `Code should be 3005, got ${matchedFw?.code}`
    );
    assert(
      matchedFw?.info.name === "RequireGteViolated",
      `Name should be RequireGteViolated, got ${matchedFw?.info.name}`
    );
    console.log("✓ Passed Test 1b\n");
  }

  // Test 2: @solana/kit Context Logs Extraction
  {
    console.log("Test 2: @solana/kit Context Logs Extraction");
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
    assert(logs.length === 3, `Expected 3 logs, got ${logs.length}`);
    assert(logs[0].includes("invoke [1]"), "Log 0 mismatch");
    console.log("✓ Passed Test 2\n");
  }

  // Test 3: formatErrorDetails Output Structure
  {
    console.log("Test 3: formatErrorDetails Output Structure");
    const mockTxError = new Error(
      "Transaction failed: AnchorError 6000 (PoolNotActive): The prize pool is not currently active."
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockTxError as any).signature =
      "5K3xV819Wq18293n182390182390182390182390182390128390";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockTxError as any).context = {
      logs: ["Program log: AnchorError thrown"],
    };

    const formatted = formatErrorDetails(mockTxError, "Test Context");
    assert(
      formatted.includes("[Test Context]"),
      "Should include context title"
    );
    assert(formatted.includes("PoolNotActive"), "Should include error name");
    assert(
      formatted.includes("Transaction Logs:"),
      "Should include logs section"
    );
    assert(
      formatted.includes("Signature:"),
      "Should include signature section"
    );
    assert(formatted.includes("Stack Trace:"), "Should include stack trace");
    console.log("✓ Passed Test 3\n");
  }

  // Test 4: Stack Trace Filtering
  {
    console.log("Test 4: Stack Trace Filtering");
    const rawStack = `Error: Test
    at executeHarvest (/home/user/project/scripts/pb-cli.ts:752:9)
    at Module._compile (node:internal/modules/cjs/loader:1376:14)
    at Object.Module._extensions..js (node:internal/modules/cjs/loader:1435:10)
    at main (/home/user/project/scripts/localnet.ts:250:5)`;

    const filtered = formatStackTrace(rawStack);
    assert(
      !filtered.includes("node:internal"),
      "Should filter out node:internal lines"
    );
    assert(filtered.includes("pb-cli.ts"), "Should retain pb-cli.ts");
    assert(filtered.includes("localnet.ts"), "Should retain localnet.ts");
    console.log("✓ Passed Test 4\n");
  }

  // Test 5: parseTransactionError with JSON InstructionError
  {
    console.log("Test 5: parseTransactionError with JSON InstructionError");
    const errObj = new Error(
      'Transaction failed: {"InstructionError":[0,{"Custom":6004}]}'
    );
    const parsed = parseTransactionError(errObj);
    assert(parsed.layer === "anchor", "Layer should be anchor");
    assert(
      parsed.category === "anchor_custom",
      "Category should be anchor_custom"
    );
    assert(parsed.code === 6004, "Code should be 6004");
    assert(
      parsed.title === "Program Error: RegistryFull",
      `Title mismatch, got: ${parsed.title}`
    );
    console.log("✓ Passed Test 5\n");
  }

  // Test 6: DEFAULT_LIVE_YIELD_PRECISION & 6-decimal Intl formatting
  {
    console.log(
      "Test 6: DEFAULT_LIVE_YIELD_PRECISION & 6-decimal Intl formatting"
    );
    assert(
      DEFAULT_LIVE_YIELD_PRECISION === 6,
      `Expected DEFAULT_LIVE_YIELD_PRECISION to be 6, got ${DEFAULT_LIVE_YIELD_PRECISION}`
    );

    const formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: DEFAULT_LIVE_YIELD_PRECISION,
      maximumFractionDigits: DEFAULT_LIVE_YIELD_PRECISION,
    });

    const formattedZero = formatter.format(0);
    assert(
      formattedZero === "0.000000",
      `Expected '0.000000', got '${formattedZero}'`
    );

    const formattedYield = formatter.format(1234.567891);
    assert(
      formattedYield === "1,234.567891",
      `Expected '1,234.567891', got '${formattedYield}'`
    );

    const formattedSubCent = formatter.format(0.000025);
    assert(
      formattedSubCent === "0.000025",
      `Expected '0.000025', got '${formattedSubCent}'`
    );
    console.log("✓ Passed Test 6\n");
  }

  // Test 7: Portfolio Value Reconciliation and formatTokenAmount
  {
    console.log("Test 7: Portfolio Value Reconciliation and formatTokenAmount");
    const investedAmount = 650_000_000; // $650.00
    const redeemingAmount = 500_000; // $0.50
    const unclaimedAmount = 810_000; // $0.81
    const netWorth = investedAmount + redeemingAmount + unclaimedAmount; // 651_310_000 ($651.31)

    const formattedInvested = formatTokenAmount(investedAmount, 6);
    const formattedRedeeming = formatTokenAmount(redeemingAmount, 6);
    const formattedUnclaimed = formatTokenAmount(unclaimedAmount, 6);
    const formattedNetWorth = formatTokenAmount(netWorth, 6);

    assert(
      formattedInvested === "650.00",
      `Expected '650.00', got '${formattedInvested}'`
    );
    assert(
      formattedRedeeming === "0.50",
      `Expected '0.50', got '${formattedRedeeming}'`
    );
    assert(
      formattedUnclaimed === "0.81",
      `Expected '0.81', got '${formattedUnclaimed}'`
    );
    assert(
      formattedNetWorth === "651.31",
      `Expected '651.31', got '${formattedNetWorth}'`
    );
    console.log("✓ Passed Test 7\n");
  }

  // Test 8: parseLocalnetFlags parsing and aliases
  {
    console.log("Test 8: parseLocalnetFlags parsing and aliases");
    const flags1 = parseLocalnetFlags([
      "--bootstrap-only",
      "--db",
      "testdb",
      "--snapshot",
      "snap.json",
    ]);
    assert(flags1.bootstrapOnly === true, "Expected bootstrapOnly to be true");
    assert(
      flags1.dbName === "testdb",
      `Expected dbName 'testdb', got '${flags1.dbName}'`
    );
    assert(
      flags1.snapshotInput === "snap.json",
      `Expected snapshotInput 'snap.json', got '${flags1.snapshotInput}'`
    );

    const flags2 = parseLocalnetFlags(["--pre-global", "-d=customdb"]);
    assert(
      flags2.bootstrapOnly === true,
      "Expected --pre-global to set bootstrapOnly"
    );
    assert(
      flags2.dbName === "customdb",
      `Expected dbName 'customdb', got '${flags2.dbName}'`
    );

    const flags3 = parseLocalnetFlags(["--setup-base"]);
    assert(
      flags3.bootstrapOnly === true,
      "Expected --setup-base to set bootstrapOnly"
    );

    const flags4 = parseLocalnetFlags(["init", "--base"]);
    assert(
      flags4.bootstrapOnly === true,
      "Expected --base to set bootstrapOnly"
    );
    assert(flags4.positionals[0] === "init", "Expected positional 'init'");

    console.log("✓ Passed Test 8\n");
  }

  // Test 9: pb-cli COMMAND_REGISTRY options for create-pool and update-pool-config
  {
    console.log("Test 9: pb-cli COMMAND_REGISTRY flags verification");
    const createPoolMeta = COMMAND_REGISTRY["create-pool"];
    assert(
      createPoolMeta !== undefined,
      "create-pool should exist in COMMAND_REGISTRY"
    );
    const createFlags = createPoolMeta.options?.map(
      (o) => o.flag.split(" ")[0]
    );
    assert(
      createFlags?.includes("--min-yield-threshold") === true,
      "create-pool options must include --min-yield-threshold"
    );
    assert(
      createFlags?.includes("--payout-timelock") === true,
      "create-pool options must include --payout-timelock"
    );
    assert(
      createFlags?.includes("--timelock") === false,
      "create-pool options must not contain deprecated --timelock"
    );

    const updatePoolMeta = COMMAND_REGISTRY["update-pool-config"];
    assert(
      updatePoolMeta !== undefined,
      "update-pool-config should exist in COMMAND_REGISTRY"
    );
    const updateFlags = updatePoolMeta.options?.map(
      (o) => o.flag.split(" ")[0]
    );
    assert(
      updateFlags?.includes("--min-yield-threshold") === true,
      "update-pool-config options must include --min-yield-threshold"
    );
    assert(
      updateFlags?.includes("--payout-timelock") === true,
      "update-pool-config options must include --payout-timelock"
    );
    assert(
      updateFlags?.includes("--timelock") === false,
      "update-pool-config options must not contain deprecated --timelock"
    );
    assert(
      updatePoolMeta.examples?.every((ex) => !ex.includes("--timelock")) ===
        true,
      "update-pool-config examples must not contain deprecated --timelock"
    );
    assert(
      updatePoolMeta.examples?.some((ex) =>
        ex.includes("--payout-timelock")
      ) === true,
      "update-pool-config examples must contain --payout-timelock"
    );
    console.log("✓ Passed Test 9\n");
  }

  // Test 10: Localnet bootstrap guide contains updated create-pool flags and options
  {
    console.log("Test 10: Localnet bootstrap guide create-pool documentation");
    const guideText = getBootstrapGuideText();
    assert(
      guideText.includes("--token-mint") &&
        guideText.includes("--pst-mint") &&
        guideText.includes("--fee-wallet"),
      "Guide must document optional account overrides: --token-mint, --pst-mint, --fee-wallet"
    );
    assert(
      guideText.includes("--min-yield-threshold") &&
        guideText.includes("--max-yield-bps") &&
        guideText.includes("--payout-timelock") &&
        guideText.includes("--stake-duration") &&
        guideText.includes("--bond-price") &&
        guideText.includes("--fee-bps"),
      "Guide must document pool configuration parameters"
    );
    assert(
      !guideText.includes("--timelock 0"),
      "Guide must not contain deprecated --timelock flag in update-pool-config"
    );
    console.log("✓ Passed Test 10\n");
  }

  console.log("All unit tests completed successfully!");
}

runTests();
