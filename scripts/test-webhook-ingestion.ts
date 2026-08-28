import assert from "node:assert/strict";
import crypto from "crypto";

console.log("--- Testing Webhook Ingestion Logic & Security ---");

// 1. Timing-Safe Auth Check
function isAuthorized(
  authHeader: string | null,
  expectedSecret: string
): boolean {
  if (!authHeader) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (token.length !== expectedSecret.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expectedSecret)
  );
}

const SECRET = "secret_webhook_key_1234567890";
assert.strictEqual(
  isAuthorized("Bearer secret_webhook_key_1234567890", SECRET),
  true
);
assert.strictEqual(isAuthorized("secret_webhook_key_1234567890", SECRET), true);
assert.strictEqual(isAuthorized("Bearer wrong_secret", SECRET), false);
assert.strictEqual(isAuthorized(null, SECRET), false);
assert.strictEqual(
  isAuthorized("Bearer secret_webhook_key_1234567891", SECRET),
  false
);

console.log("✓ Webhook timing-safe authentication tests passed");

// 2. Transaction Filter Logic
const samplePayload = [
  { signature: "sig1", slot: 100, err: null, meta: { err: null } },
  {
    signature: "sig2",
    slot: 101,
    err: { InstructionError: [0, "Custom"] },
    meta: { err: null },
  },
  {
    signature: "sig3",
    slot: 102,
    err: null,
    meta: { err: { InstructionError: [1, "Custom"] } },
  },
  {
    signature: "sig4",
    slot: 103,
    transactionError: "TransactionFailed",
    meta: { err: null },
  },
  { signature: null, slot: 104, err: null },
  { signature: "sig5", slot: 105, err: null, meta: { err: null } },
];

const validTransactions = samplePayload.filter((tx) => {
  if (!tx?.signature) return false;
  if (
    tx.err != null ||
    (tx.meta && tx.meta.err != null) ||
    (tx as any).transactionError != null
  )
    return false;
  return true;
});

assert.strictEqual(validTransactions.length, 2);
assert.strictEqual(validTransactions[0].signature, "sig1");
assert.strictEqual(validTransactions[1].signature, "sig5");

console.log("✓ Failed / reverted transaction filtering tests passed");
console.log("ALL WEBHOOK INGESTION TESTS PASSED");
