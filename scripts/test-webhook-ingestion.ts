import assert from "node:assert/strict";
import {
  isTimingSafeAuthorized,
  isSuccessfulHeliusTransaction,
} from "../app/lib/webhook-auth";
import type { HeliusTransactionPayload } from "../app/lib/types/webhook";

console.log("--- Testing Webhook Ingestion Logic & Security ---");

// 1. Timing-Safe Auth Check
const SECRET = "secret_webhook_key_1234567890";
assert.strictEqual(
  isTimingSafeAuthorized("Bearer secret_webhook_key_1234567890", SECRET),
  true
);
assert.strictEqual(
  isTimingSafeAuthorized("secret_webhook_key_1234567890", SECRET),
  true
);
assert.strictEqual(
  isTimingSafeAuthorized("Bearer wrong_secret_with_len_ok", SECRET),
  false
);
assert.strictEqual(isTimingSafeAuthorized("Bearer short", SECRET), false);
assert.strictEqual(isTimingSafeAuthorized(null, SECRET), false);
assert.strictEqual(isTimingSafeAuthorized(undefined, SECRET), false);
assert.strictEqual(
  isTimingSafeAuthorized("Bearer secret_webhook_key_1234567891", SECRET),
  false
);

console.log("✓ Webhook timing-safe authentication tests passed");

// 2. Transaction Filter Logic
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

const validTransactions = samplePayload.filter(isSuccessfulHeliusTransaction);

assert.strictEqual(validTransactions.length, 2);
assert.strictEqual(validTransactions[0].signature, "sig1");
assert.strictEqual(validTransactions[1].signature, "sig5");

console.log("✓ Failed / reverted transaction filtering tests passed");
console.log("ALL WEBHOOK INGESTION TESTS PASSED");
