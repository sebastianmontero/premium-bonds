import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTransactionError,
  matchAnchorError,
  isParsedTransactionError,
  TransactionError,
  sanitizeErrorMessage,
  getErrorCategoryTheme,
  SPL_TOKEN_ERRORS,
} from "../errors";

describe("Transaction Error Parser & Sanitization Suite", () => {
  it("should parse Anchor framework error 0xbbd (3005 AccountNotEnoughKeys)", () => {
    const rawErr = new Error(
      "Aug 06 15:35:59.835 ERROR Transaction simulation failed: Error processing Instruction 1: custom program error: 0xbbd"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_constraint");
    assert.strictEqual(parsed.code, 3005);
    assert.strictEqual(parsed.title, "Constraint Error: AccountNotEnoughKeys");
  });

  it("should parse Anchor custom error 6000 (PoolNotActive)", () => {
    const rawErr = new Error("Simulation failed: custom program error: 0x1770");
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_custom");
    assert.strictEqual(parsed.code, 6000);
    assert.strictEqual(parsed.title, "Program Error: PoolNotActive");
  });

  it("should parse @solana/kit wrapped TransactionPlanError containing 0xbbd", () => {
    const kitErr = {
      message:
        "The provided transaction plan failed to execute. See the transactionPlanResult attribute for more details.",
      transactionPlanResult: {
        results: [
          {
            error:
              "Transaction simulation failed: Error processing Instruction 1: custom program error: 0xbbd",
            logs: [
              "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx invoke [1]",
              "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx failed: custom program error: 0xbbd",
            ],
          },
        ],
      },
    };

    const parsed = parseTransactionError(kitErr);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_constraint");
    assert.strictEqual(parsed.code, 3005);
    assert.strictEqual(parsed.title, "Constraint Error: AccountNotEnoughKeys");
  });

  it("should parse true blockhash expiration error", () => {
    const expErr = new Error(
      "Transaction failed: BlockheightExceeded. Blockhash expired."
    );
    const parsed = parseTransactionError(expErr);
    assert.strictEqual(parsed.layer, "rpc");
    assert.strictEqual(parsed.category, "blockhash_expired");
    assert.strictEqual(parsed.title, "Request Timed Out");
  });

  it("should parse wallet user cancellation 4001", () => {
    const walletErr = { code: 4001, message: "User rejected the request." };
    const parsed = parseTransactionError(walletErr);
    assert.strictEqual(parsed.isCancellation, true);
    assert.strictEqual(parsed.code, 4001);
    assert.strictEqual(parsed.title, "Transaction Cancelled");
  });

  it("should support direct object code inspection in matchAnchorError", () => {
    const errWithCode = { context: { code: 3013 } };
    const matched = matchAnchorError(errWithCode);
    assert.ok(matched !== null, "Should match code 3013");
    assert.strictEqual(matched?.code, 3013);
    assert.strictEqual(matched?.info.name, "AccountNotProgramData");
  });

  it("should parse uppercase prefix blockhash expiration error", () => {
    const rawErr = new Error(
      "ERROR Transaction simulation failed: Blockhash not found"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "rpc");
    assert.strictEqual(parsed.category, "blockhash_expired");
    assert.strictEqual(parsed.title, "Request Timed Out");
  });

  it("should parse @solana/kit object-wrapped blockhash not found error", () => {
    const kitObjErr = {
      message: "The provided transaction plan failed to execute.",
      transactionPlanResult: {
        error: {
          message: "Transaction simulation failed: Blockhash not found",
        },
      },
    };
    const parsed = parseTransactionError(kitObjErr);
    assert.strictEqual(parsed.category, "blockhash_expired");
    assert.strictEqual(parsed.title, "Request Timed Out");
  });

  it("should parse American spelling cancellation (canceled)", () => {
    const cancelErr = { message: "User canceled the request in Phantom." };
    const parsed = parseTransactionError(cancelErr);
    assert.strictEqual(parsed.isCancellation, true);
    assert.strictEqual(parsed.category, "wallet_cancellation");
  });

  it("should parse confirmation timeout error string", () => {
    const timeoutErr = new Error(
      "Transaction was not confirmed in 60.00 seconds. Check your RPC."
    );
    const parsed = parseTransactionError(timeoutErr);
    assert.strictEqual(parsed.category, "blockhash_expired");
    assert.strictEqual(parsed.title, "Request Timed Out");
  });

  it("should parse generic wrapper with nested cause containing blockhash expiration", () => {
    const nestedErr = new Error("Transaction execution failed", {
      cause: new Error("Transaction simulation failed: Blockhash not found"),
    });
    const parsed = parseTransactionError(nestedErr);
    assert.strictEqual(parsed.category, "blockhash_expired");
    assert.strictEqual(parsed.title, "Request Timed Out");
  });

  it("should parse duplicate transaction error string", () => {
    const dupErr = new Error(
      'Transaction verification failed for transaction Internal error: "Transaction error: This transaction has already been processed"'
    );
    const parsed = parseTransactionError(dupErr);
    assert.strictEqual(parsed.layer, "rpc");
    assert.strictEqual(parsed.category, "duplicate_transaction");
    assert.strictEqual(parsed.title, "Transaction Already Processed");
  });

  it("should parse @solana/errors destructuring TypeError (-32002 without data)", () => {
    const typeErr = new TypeError(
      "Cannot destructure property 'err' of 'data' as it is undefined."
    );
    const parsed = parseTransactionError(typeErr);
    assert.strictEqual(parsed.layer, "rpc");
    assert.strictEqual(parsed.category, "duplicate_transaction");
    assert.strictEqual(parsed.title, "Transaction Already Processed");
  });

  it("should correctly identify parsed transaction errors with isParsedTransactionError", () => {
    const rawParsed = parseTransactionError(
      new Error("custom program error: 0x1770")
    );
    assert.strictEqual(isParsedTransactionError(rawParsed), true);
    assert.strictEqual(isParsedTransactionError(null), false);
    assert.strictEqual(isParsedTransactionError({}), false);
    assert.strictEqual(isParsedTransactionError(new Error("fail")), false);
  });

  it("should instantiate TransactionError class preserving prototype, payload, and cause", () => {
    const parsed = parseTransactionError(
      new Error("custom program error: 0x1770")
    );
    const rawCause = new Error("Underlying RPC failure");
    const txErr = new TransactionError(parsed, rawCause);

    assert.ok(txErr instanceof Error);
    assert.ok(txErr instanceof TransactionError);
    assert.strictEqual(txErr.name, "TransactionError");
    assert.strictEqual(txErr.message, parsed.message);
    assert.strictEqual(txErr.parsed, parsed);
    assert.strictEqual(txErr.cause, rawCause);
  });

  it("should maintain strict parseTransactionError idempotency", () => {
    const initialParsed = parseTransactionError(
      new Error("custom program error: 0x1770")
    );
    const reParsed = parseTransactionError(initialParsed);
    assert.strictEqual(
      reParsed,
      initialParsed,
      "Re-parsing ParsedTransactionError must be strictly idempotent"
    );

    const txErr = new TransactionError(initialParsed);
    const parsedFromTxErr = parseTransactionError(txErr);
    assert.strictEqual(
      parsedFromTxErr,
      initialParsed,
      "Parsing TransactionError must cleanly unwrap .parsed"
    );
  });

  it("should parse System Program insufficient funds (0x1)", () => {
    const rawErr = new Error(
      "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "system");
    assert.strictEqual(parsed.category, "insufficient_sol");
    assert.strictEqual(parsed.code, "0x1");
    assert.strictEqual(parsed.title, "Insufficient SOL");
  });

  it("should parse SPL Token insufficient funds (0x3)", () => {
    const rawErr = new Error(
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x3"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "spl");
    assert.strictEqual(parsed.category, "insufficient_tokens");
    assert.strictEqual(parsed.code, 3);
    assert.strictEqual(parsed.title, "Token Error: InsufficientFunds");
    assert.strictEqual(parsed.message, SPL_TOKEN_ERRORS[3].message);
  });

  it("should parse SPL Token mint mismatch (0x4)", () => {
    const rawErr = new Error(
      "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x4"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "spl");
    assert.strictEqual(parsed.code, 4);
    assert.strictEqual(parsed.title, "Token Error: MintMismatch");
  });

  it("should parse RPC rate limit 429", () => {
    const rawErr = new Error(
      "429 Too Many Requests: rate limit exceeded on RPC cluster"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "rpc");
    assert.strictEqual(parsed.category, "network_rpc");
    assert.strictEqual(parsed.code, "429");
    assert.strictEqual(parsed.title, "Network Busy");
  });

  it("should parse network FETCH_FAILED error", () => {
    const rawErr = new Error("TypeError: Failed to fetch");
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "rpc");
    assert.strictEqual(parsed.category, "network_rpc");
    assert.strictEqual(parsed.code, "FETCH_FAILED");
    assert.strictEqual(parsed.title, "Connection Error");
  });

  it("should parse Compute Unit budget exhaustion", () => {
    const rawErr = new Error(
      "Program failed to complete: exceeded maximum number of instructions allowed"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "rpc");
    assert.strictEqual(parsed.category, "network_rpc");
    assert.strictEqual(parsed.code, "COMPUTE_BUDGET_EXCEEDED");
    assert.strictEqual(parsed.title, "Compute Budget Exceeded");
  });

  it("should scrub URLs and strip ANSI escape sequences in sanitizeErrorMessage", () => {
    const technicalRaw =
      "\u001b[31mError\u001b[0m: Connection refused to https://api.devnet.solana.com/rpc/v1 at line 42:10";
    const sanitized = sanitizeErrorMessage(technicalRaw);
    assert.strictEqual(
      sanitized.includes("https://api.devnet.solana.com"),
      false
    );
    assert.strictEqual(sanitized.includes("[RPC Endpoint]"), true);
    assert.strictEqual(sanitized.includes("\u001b[31m"), false);
  });

  it("should validate getErrorCategoryTheme category theme mappings", () => {
    const timeoutTheme = getErrorCategoryTheme("blockhash_expired");
    assert.strictEqual(timeoutTheme.icon, "⏱️");
    assert.strictEqual(timeoutTheme.titleColor, "text-sky-300");

    const fundsTheme = getErrorCategoryTheme("insufficient_sol");
    assert.strictEqual(fundsTheme.icon, "⛽");
    assert.strictEqual(fundsTheme.titleColor, "text-amber-300");

    const contractTheme = getErrorCategoryTheme("anchor_custom");
    assert.strictEqual(contractTheme.icon, "⚠️");
    assert.strictEqual(contractTheme.titleColor, "text-red-400");

    const cancelTheme = getErrorCategoryTheme("wallet_cancellation");
    assert.strictEqual(cancelTheme.icon, "✕");

    const defaultTheme = getErrorCategoryTheme("unknown");
    assert.strictEqual(defaultTheme.icon, "⚠️");
  });
});
