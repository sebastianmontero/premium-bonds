import { formatErrorDetails, extractAllLogs, formatStackTrace } from "./utils";
import { parseTransactionError, matchAnchorError } from "../app/lib/errors";
import { DEFAULT_LIVE_YIELD_PRECISION } from "../app/lib/formatters";

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

  console.log("All unit tests completed successfully!");
}

runTests();
