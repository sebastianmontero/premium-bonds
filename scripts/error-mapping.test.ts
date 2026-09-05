import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTransactionError, ANCHOR_CUSTOM_ERRORS } from "../app/lib/errors";
import {
  ANCHOR_ERROR__POOL_NOT_ACTIVE,
  ANCHOR_ERROR__INVALID_POOL_STATUS,
  getAnchorErrorMessage,
} from "../app/lib/generated/yield-bonds/src/generated/errors";

describe("Codama Error Mapping & Transaction Error Sanitization", () => {
  it("should have complete 52 custom Anchor error definitions in ANCHOR_CUSTOM_ERRORS", () => {
    // There are 52 errors defined from 6000 to 6051 inclusive
    for (let code = 6000; code <= 6051; code++) {
      const mapped = ANCHOR_CUSTOM_ERRORS[code];
      assert.ok(
        mapped,
        `ANCHOR_CUSTOM_ERRORS must contain definition for error code ${code}`
      );
      assert.ok(
        mapped.name && mapped.name.length > 0,
        `Error code ${code} must have a non-empty name`
      );
      assert.ok(
        mapped.message && mapped.message.length > 0,
        `Error code ${code} must have a non-empty message`
      );
    }
  });

  it("should verify Codama generated error constants and messages", () => {
    assert.strictEqual(
      ANCHOR_ERROR__POOL_NOT_ACTIVE,
      6000,
      "ANCHOR_ERROR__POOL_NOT_ACTIVE must equal 6000"
    );
    assert.strictEqual(
      ANCHOR_ERROR__INVALID_POOL_STATUS,
      6001,
      "ANCHOR_ERROR__INVALID_POOL_STATUS must equal 6001"
    );

    const poolNotActiveMsg = getAnchorErrorMessage(
      ANCHOR_ERROR__POOL_NOT_ACTIVE
    );
    assert.ok(
      poolNotActiveMsg.includes("prize pool is not currently active"),
      `Expected message containing 'prize pool is not currently active', got: ${poolNotActiveMsg}`
    );
  });

  it("should parse transaction errors by error message code and name", () => {
    const parsedByCode = parseTransactionError({
      message:
        "Transaction simulation failed: AnchorError occurred. Error Code: PoolNotActive. Error Number: 6000.",
    });

    assert.strictEqual(
      parsedByCode.category,
      "anchor_custom",
      "Parsed error category must be anchor_custom"
    );
    assert.strictEqual(
      parsedByCode.code,
      6000,
      "Parsed error code must be 6000"
    );
    assert.strictEqual(
      parsedByCode.title,
      "Program Error: PoolNotActive",
      "Parsed title must reflect program error name"
    );
    assert.strictEqual(
      parsedByCode.message,
      "The prize pool is not currently active.",
      "Parsed message must match protocol description"
    );
    assert.strictEqual(
      parsedByCode.actionableStep,
      "Please wait for the administrator to activate this pool.",
      "Actionable step must guide the user"
    );
  });

  it("should parse hex error code from program logs", () => {
    const parsedByHexLog = parseTransactionError({
      logs: [
        "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx invoke [1]",
        "Program log: Custom error: 0x1770",
        "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx failed: custom program error: 0x1770",
      ],
    });

    assert.strictEqual(
      parsedByHexLog.category,
      "anchor_custom",
      "Hex log error must resolve to anchor_custom"
    );
    assert.strictEqual(
      parsedByHexLog.code,
      6000,
      "Hex 0x1770 must map to decimal 6000"
    );
  });

  it("should parse wallet user cancellation 4001", () => {
    const parsedCancellation = parseTransactionError({
      code: 4001,
      message: "User rejected the request.",
    });
    assert.strictEqual(
      parsedCancellation.isCancellation,
      true,
      "Error 4001 must be recognized as cancellation"
    );
    assert.strictEqual(
      parsedCancellation.category,
      "wallet_cancellation",
      "Category must be wallet_cancellation"
    );
  });
});
