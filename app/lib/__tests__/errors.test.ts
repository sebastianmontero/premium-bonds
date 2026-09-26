import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTransactionError,
  matchAnchorError,
  matchSplTokenError,
  isParsedTransactionError,
  TransactionError,
  sanitizeErrorMessage,
  getErrorCategoryTheme,
  SPL_TOKEN_ERRORS,
  SplTokenErrorCode,
  safeJsonStringify,
} from "../errors";
import { PROGRAM_ID } from "../bonds-sdk";

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

  it("should parse Anchor custom error 6046 (ZeroSharesMinted)", () => {
    const rawErr = new Error("Simulation failed: custom program error: 0x179e");
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_custom");
    assert.strictEqual(parsed.code, 6046);
    assert.strictEqual(parsed.title, "Program Error: ZeroSharesMinted");
    assert.strictEqual(
      parsed.message,
      "Huma deposit produced zero PST shares."
    );
    assert.strictEqual(
      parsed.actionableStep,
      "Increase your bond purchase amount to exceed the minimum share conversion threshold on Huma Finance."
    );
  });

  it("should parse Anchor custom error 6065 (InvalidBatchSize)", () => {
    const rawErr = new Error("Simulation failed: custom program error: 0x17b1");
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_custom");
    assert.strictEqual(parsed.code, 6065);
    assert.strictEqual(parsed.title, "Program Error: InvalidBatchSize");
    assert.strictEqual(
      parsed.message,
      "Draw preparation batch size must be greater than 0."
    );
    assert.strictEqual(
      parsed.actionableStep,
      "Please specify a batch size greater than zero."
    );
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
              `Program ${PROGRAM_ID} invoke [1]`,
              `Program ${PROGRAM_ID} failed: custom program error: 0xbbd`,
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

  it("should disambiguate SPL Token InsufficientFunds (0x1) from System Program (0x1)", () => {
    const splErr = new Error(
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1"
    );
    const parsed = parseTransactionError(splErr);
    assert.strictEqual(parsed.layer, "spl");
    assert.strictEqual(parsed.category, "insufficient_tokens");
    assert.strictEqual(parsed.code, 1);
    assert.strictEqual(parsed.title, "Token Error: InsufficientFunds");
    assert.strictEqual(
      parsed.message,
      SPL_TOKEN_ERRORS[SplTokenErrorCode.InsufficientFunds].message
    );
  });

  it("should parse exact verbatim devnet logs with OwnerMismatch (0x4)", () => {
    const logs = [
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]",
      "Program log: Error: owner does not match",
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x4",
    ];
    const rawErr = new Error(
      "Transaction simulation failed: Error processing Instruction 1: custom program error: 0x4"
    );
    const parsed = parseTransactionError(rawErr, logs);
    assert.strictEqual(parsed.layer, "spl");
    assert.strictEqual(parsed.category, "spl_token");
    assert.strictEqual(parsed.code, 4);
    assert.strictEqual(parsed.title, "Token Error: OwnerMismatch");
    assert.strictEqual(
      parsed.message,
      SPL_TOKEN_ERRORS[SplTokenErrorCode.OwnerMismatch].message
    );
    assert.strictEqual(
      parsed.actionableStep,
      SPL_TOKEN_ERRORS[SplTokenErrorCode.OwnerMismatch].actionable
    );
  });

  it("should parse SPL Token MintMismatch (0x3)", () => {
    const rawErr = new Error(
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x3"
    );
    const parsed = parseTransactionError(rawErr);
    assert.strictEqual(parsed.layer, "spl");
    assert.strictEqual(parsed.category, "spl_token");
    assert.strictEqual(parsed.code, 3);
    assert.strictEqual(parsed.title, "Token Error: MintMismatch");
    assert.strictEqual(
      parsed.message,
      SPL_TOKEN_ERRORS[SplTokenErrorCode.MintMismatch].message
    );
  });

  it("should support Token-2022 compatibility for errors 0x1, 0x3, and 0x4", () => {
    const token2022Insufficient = new Error(
      "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x1"
    );
    const parsedInsufficient = parseTransactionError(token2022Insufficient);
    assert.strictEqual(parsedInsufficient.layer, "spl");
    assert.strictEqual(parsedInsufficient.category, "insufficient_tokens");
    assert.strictEqual(parsedInsufficient.code, 1);
    assert.strictEqual(
      parsedInsufficient.title,
      "Token Error: InsufficientFunds"
    );

    const token2022MintMismatch = new Error(
      "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x3"
    );
    const parsedMintMismatch = parseTransactionError(token2022MintMismatch);
    assert.strictEqual(parsedMintMismatch.layer, "spl");
    assert.strictEqual(parsedMintMismatch.category, "spl_token");
    assert.strictEqual(parsedMintMismatch.code, 3);
    assert.strictEqual(parsedMintMismatch.title, "Token Error: MintMismatch");

    const token2022OwnerMismatch = new Error(
      "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x4"
    );
    const parsedOwnerMismatch = parseTransactionError(token2022OwnerMismatch);
    assert.strictEqual(parsedOwnerMismatch.layer, "spl");
    assert.strictEqual(parsedOwnerMismatch.category, "spl_token");
    assert.strictEqual(parsedOwnerMismatch.code, 4);
    assert.strictEqual(parsedOwnerMismatch.title, "Token Error: OwnerMismatch");
  });

  it("should support direct object and numeric matching via matchSplTokenError", () => {
    const matchedNumber = matchSplTokenError(4);
    assert.ok(matchedNumber !== null);
    assert.strictEqual(matchedNumber?.code, 4);
    assert.strictEqual(matchedNumber?.info.name, "OwnerMismatch");

    const matchedInstructionError = matchSplTokenError(
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: InstructionError: [1, {"Custom": 18}]'
    );
    assert.ok(matchedInstructionError !== null);
    assert.strictEqual(matchedInstructionError?.code, 18);
    assert.strictEqual(
      matchedInstructionError?.info.name,
      "MintDecimalsMismatch"
    );
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

    const splTheme = getErrorCategoryTheme("spl_token");
    assert.strictEqual(splTheme.icon, "🪙");
    assert.strictEqual(splTheme.titleColor, "text-amber-300");

    const contractTheme = getErrorCategoryTheme("anchor_custom");
    assert.strictEqual(contractTheme.icon, "⚠️");
    assert.strictEqual(contractTheme.titleColor, "text-red-400");

    const cancelTheme = getErrorCategoryTheme("wallet_cancellation");
    assert.strictEqual(cancelTheme.icon, "✕");

    const defaultTheme = getErrorCategoryTheme("unknown");
    assert.strictEqual(defaultTheme.icon, "⚠️");
  });

  it("should parse SolanaError 7618003 wrapping JSON-RPC -32603 wallet error", () => {
    const kitPlanErr = {
      message:
        "The provided transaction plan failed to execute. See the transactionPlanResult attribute for more details.",
      context: { __code: 7618003 },
      transactionPlanResult: {
        results: [
          {
            error: {
              code: -32603,
              message: "Unexpected error during transaction simulation",
            },
          },
        ],
      },
    };

    const parsed = parseTransactionError(kitPlanErr);
    assert.strictEqual(parsed.category, "network_rpc");
    assert.strictEqual(parsed.code, -32603);
    assert.strictEqual(parsed.title, "Wallet Simulation or Network Error");
    assert.ok(
      parsed.actionableStep?.includes("unlocked") ||
        parsed.actionableStep?.includes("network")
    );
  });

  it("should prioritize inner Anchor domain errors over outer JSON-RPC -32603", () => {
    const rpcErrWithAnchorLogs = {
      code: -32603,
      message: "Internal JSON-RPC simulation error",
      data: {
        logs: [
          `Program ${PROGRAM_ID} invoke [1]`,
          "Program log: AnchorError thrown in programs/yield_bonds/src/instructions/claim_redemption.rs:42. Error Code: HumaRedemptionNotSettled. Error Number: 6020. Error Message: Huma redemption request is not yet settled or approved.",
          `Program ${PROGRAM_ID} failed: custom program error: 0x1784`,
        ],
      },
    };

    const parsed = parseTransactionError(rpcErrWithAnchorLogs);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_custom");
    assert.strictEqual(parsed.code, 6020);
    assert.strictEqual(parsed.title, "Program Error: HumaRedemptionNotSettled");
  });

  it("should disambiguate -32002 between duplicate transaction and non-duplicate simulation failure", () => {
    // 1. Duplicate transaction with AlreadyProcessed
    const dupErr = {
      code: -32002,
      message: "Transaction simulation failed",
      data: { err: "AlreadyProcessed" },
    };
    const parsedDup = parseTransactionError(dupErr);
    assert.strictEqual(parsedDup.category, "duplicate_transaction");
    assert.strictEqual(parsedDup.code, -32002);
    assert.strictEqual(parsedDup.title, "Transaction Already Processed");

    // 2. Non-duplicate simulation failure with generic logs
    const simFailErr = {
      code: -32002,
      message: "Transaction simulation failed: invalid instruction parameters",
      data: {
        logs: [
          "Program 11111111111111111111111111111111 invoke [1]",
          "Program 11111111111111111111111111111111 failed: invalid instruction parameters",
        ],
      },
    };
    const parsedSim = parseTransactionError(simFailErr);
    assert.strictEqual(parsedSim.category, "network_rpc");
    assert.strictEqual(parsedSim.code, -32002);
    assert.strictEqual(parsedSim.title, "Transaction Simulation Failed");
    assert.strictEqual(parsedSim.logs?.length, 2);
  });

  it("should detect deeply nested wallet rejection code 4001 via graph traversal", () => {
    const deepNestedRejection = {
      name: "TransactionExecutionError",
      message: "Transaction plan execution failed",
      cause: {
        name: "SendTransactionError",
        cause: {
          error: {
            code: 4001,
            message: "User rejected the request from wallet UI.",
          },
        },
      },
    };

    const parsed = parseTransactionError(deepNestedRejection);
    assert.strictEqual(parsed.isCancellation, true);
    assert.strictEqual(parsed.layer, "wallet");
    assert.strictEqual(parsed.code, 4001);
    assert.strictEqual(parsed.title, "Transaction Cancelled");
  });

  it("should disambiguate Mock Huma error 6005 (InvalidAccountOwner) away from YieldBonds RegistryTooSmall", () => {
    const mockHumaErr = new Error(
      "AnchorError caused by account: lender_state. Error Code: InvalidAccountOwner. Error Number: 6005. Error Message: MockHuma: Account has an invalid owner."
    );

    const parsed = parseTransactionError(mockHumaErr);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_custom");
    assert.strictEqual(parsed.code, 6005);
    assert.strictEqual(parsed.title, "Program Error: InvalidAccountOwner");
    assert.strictEqual(
      parsed.message,
      "MockHuma: Account has an invalid owner."
    );
    assert.strictEqual(
      parsed.actionableStep,
      "Check and verify account: lender_state"
    );
  });

  it("should preserve YieldBonds error 6005 (RegistryTooSmall) when YieldBonds log is present", () => {
    const yieldBondsErr = new Error(
      "AnchorError thrown in programs/yield_bonds/src/state.rs:100. Error Code: RegistryTooSmall. Error Number: 6005. Error Message: Ticket registry is too small."
    );

    const parsed = parseTransactionError(yieldBondsErr);
    assert.strictEqual(parsed.layer, "anchor");
    assert.strictEqual(parsed.category, "anchor_custom");
    assert.strictEqual(parsed.code, 6005);
    assert.strictEqual(parsed.title, "Program Error: RegistryTooSmall");
    assert.strictEqual(
      parsed.message,
      "The ticket registry account pre-allocation is too small."
    );
  });

  describe("safeJsonStringify Suite", () => {
    it("should serialize BigInts, Error instances, and preserve custom properties", () => {
      const customErr = new Error("Custom error message") as Error & {
        code: number;
        logs: string[];
      };
      customErr.code = 6042;
      customErr.logs = ["Program log: Instruction failed"];
      customErr.cause = new Error("Inner cause");

      const jsonStr = safeJsonStringify({ error: customErr, count: 100n });
      assert.ok(jsonStr.includes('"name":"Error"'));
      assert.ok(jsonStr.includes('"message":"Custom error message"'));
      assert.ok(jsonStr.includes('"code":6042'));
      assert.ok(jsonStr.includes('"logs":["Program log: Instruction failed"]'));
      assert.ok(jsonStr.includes('"message":"Inner cause"'));
      assert.ok(jsonStr.includes('"count":"100"'));
    });

    it("should safely handle circular error graphs without exceeding maximum call stack", () => {
      const recursiveErr = new Error("Recursive error");
      recursiveErr.cause = recursiveErr;

      const jsonStr = safeJsonStringify(recursiveErr);
      assert.ok(jsonStr.includes('"name":"Error"'));
      assert.ok(jsonStr.includes('"message":"Recursive error"'));
      assert.ok(jsonStr.includes('"cause":"[Circular]"'));
    });

    it("should return string values for undefined, null, and primitive values", () => {
      assert.strictEqual(safeJsonStringify(undefined), "undefined");
      assert.strictEqual(safeJsonStringify(null), "null");
      assert.strictEqual(safeJsonStringify("hello"), '"hello"');
      assert.strictEqual(safeJsonStringify(12345n), '"12345"');
    });
  });
});
