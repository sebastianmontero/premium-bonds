import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isTimingSafeAuthorized,
  isSuccessfulHeliusTransaction,
} from "../app/lib/webhook-auth";
import type { HeliusTransactionPayload } from "../app/lib/types/webhook";

describe("Webhook Ingestion Logic & Timing-Safe Security Suite", () => {
  it("should evaluate timing-safe authorization tokens correctly", () => {
    const SECRET = "secret_webhook_key_1234567890";
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer secret_webhook_key_1234567890", SECRET),
      true,
      "Bearer auth header must match"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("secret_webhook_key_1234567890", SECRET),
      true,
      "Raw secret header must match"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer wrong_secret_with_len_ok", SECRET),
      false,
      "Wrong secret must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer short", SECRET),
      false,
      "Short secret must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized(null, SECRET),
      false,
      "Null header must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized(undefined, SECRET),
      false,
      "Undefined header must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer secret_webhook_key_1234567891", SECRET),
      false,
      "Secret with 1-character difference must be rejected"
    );
  });

  it("should filter failed, reverted, and malformed transactions cleanly", () => {
    const samplePayload: HeliusTransactionPayload[] = [
      {
        signature: "sig1",
        slot: 100,
        timestamp: 1000,
        err: null,
        meta: { err: null },
      },
      {
        signature: "sig2",
        slot: 101,
        timestamp: 1001,
        err: { InstructionError: [0, "Custom"] },
        meta: { err: null },
      },
      {
        signature: "sig3",
        slot: 102,
        timestamp: 1002,
        err: null,
        meta: { err: { InstructionError: [1, "Custom"] } },
      },
      {
        signature: "sig4",
        slot: 103,
        timestamp: 1003,
        transactionError: "TransactionFailed",
        meta: { err: null },
      },
      { signature: "", slot: 104, timestamp: 1004, err: null },
      {
        signature: "sig5",
        slot: 105,
        timestamp: 1005,
        err: null,
        meta: { err: null },
      },
    ];

    const validTransactions = samplePayload.filter(
      isSuccessfulHeliusTransaction
    );

    assert.strictEqual(
      validTransactions.length,
      2,
      "Expected exactly 2 valid successful transactions"
    );
    assert.strictEqual(validTransactions[0].signature, "sig1");
    assert.strictEqual(validTransactions[1].signature, "sig5");
  });
});
