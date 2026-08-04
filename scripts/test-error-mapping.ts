import assert from "assert";
import fs from "fs";
import path from "path";
import { parseTransactionError, ANCHOR_CUSTOM_ERRORS } from "../app/lib/errors";
import {
  ANCHOR_ERROR__POOL_NOT_ACTIVE,
  ANCHOR_ERROR__INVALID_POOL_STATUS,
  getAnchorErrorMessage,
} from "../app/lib/generated/yield-bonds/src/generated/errors";

console.log("Running Codama error mapping verification tests...");

// 1. Verify Rust error.rs enum variants match ANCHOR_CUSTOM_ERRORS
{
  const errorRsPath = path.resolve(
    __dirname,
    "../anchor/programs/anchor/src/error.rs"
  );
  const errorRsContent = fs.readFileSync(errorRsPath, "utf-8");

  // Extract enum variants from error.rs
  const enumMatch = errorRsContent.match(
    /pub enum PremiumBondsError \{([\s\S]*?)\}/
  );
  assert.ok(enumMatch, "Could not find PremiumBondsError enum in error.rs");

  const enumBody = enumMatch[1];
  const variantRegex = /^\s*([A-Z][a-zA-Z0-9]+)\s*,?/gm;
  const rustVariants: string[] = [];
  let match;

  while ((match = variantRegex.exec(enumBody)) !== null) {
    // Exclude doc comments or attributes if matched
    if (match[1] !== "msg" && match[1] !== "error_code") {
      rustVariants.push(match[1]);
    }
  }

  assert.ok(
    rustVariants.length > 0,
    "No error variants extracted from error.rs"
  );

  // Check each variant matches ANCHOR_CUSTOM_ERRORS code (6000 + index) and name
  rustVariants.forEach((variantName, index) => {
    const expectedCode = 6000 + index;
    const mappedInfo = ANCHOR_CUSTOM_ERRORS[expectedCode];

    assert.ok(
      mappedInfo,
      `Missing error mapping in ANCHOR_CUSTOM_ERRORS for code ${expectedCode} (${variantName})`
    );
    assert.strictEqual(
      mappedInfo.name,
      variantName,
      `Name mismatch for error code ${expectedCode}: expected ${variantName}, got ${mappedInfo.name}`
    );
  });

  console.log(
    `✓ Verified all ${rustVariants.length} Rust error.rs variants are in sync with ANCHOR_CUSTOM_ERRORS`
  );
}

// 2. Verify Codama generated error constants
{
  assert.strictEqual(ANCHOR_ERROR__POOL_NOT_ACTIVE, 6000);
  assert.strictEqual(ANCHOR_ERROR__INVALID_POOL_STATUS, 6001);

  const poolNotActiveMsg = getAnchorErrorMessage(ANCHOR_ERROR__POOL_NOT_ACTIVE);
  assert.ok(
    poolNotActiveMsg.includes("prize pool is not currently active"),
    `Unexpected message: ${poolNotActiveMsg}`
  );
  console.log("✓ Codama generated error constants and messages verified");
}

// 3. Test parseTransactionError with Codama Anchor errors
{
  const parsedByCode = parseTransactionError({
    message:
      "Transaction simulation failed: AnchorError occurred. Error Code: PoolNotActive. Error Number: 6000.",
  });

  assert.strictEqual(parsedByCode.category, "anchor_custom");
  assert.strictEqual(parsedByCode.code, 6000);
  assert.strictEqual(parsedByCode.title, "Program Error: PoolNotActive");
  assert.strictEqual(
    parsedByCode.message,
    "The prize pool is not currently active."
  );
  assert.strictEqual(
    parsedByCode.actionableStep,
    "Please wait for the administrator to activate this pool."
  );

  // Test hex error in logs
  const parsedByHexLog = parseTransactionError({
    logs: [
      "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx invoke [1]",
      "Program log: Custom error: 0x1770",
      "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx failed: custom program error: 0x1770",
    ],
  });

  assert.strictEqual(parsedByHexLog.category, "anchor_custom");
  assert.strictEqual(parsedByHexLog.code, 6000);

  // Test wallet cancellation
  const parsedCancellation = parseTransactionError({
    code: 4001,
    message: "User rejected the request.",
  });
  assert.strictEqual(parsedCancellation.isCancellation, true);
  assert.strictEqual(parsedCancellation.category, "wallet_cancellation");

  console.log("✓ parseTransactionError verification tests passed");
}

console.log(
  "All Codama error mapping verification tests completed successfully!"
);
