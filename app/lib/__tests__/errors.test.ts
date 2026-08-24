import {
  parseTransactionError,
  matchAnchorError,
  isParsedTransactionError,
  TransactionError,
  sanitizeErrorMessage,
  getErrorCategoryTheme,
  SPL_TOKEN_ERRORS,
} from "../errors";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log("Running app/lib/__tests__/errors.test.ts unit tests...\n");

  // Test 1: Anchor Framework Error 0xbbd (3005 AccountNotEnoughKeys)
  {
    console.log("Test 1: Framework Error 0xbbd parsing");
    const rawErr = new Error(
      "Aug 06 15:35:59.835 ERROR Transaction simulation failed: Error processing Instruction 1: custom program error: 0xbbd"
    );
    const parsed = parseTransactionError(rawErr);
    assert(
      parsed.layer === "anchor",
      `Expected layer anchor, got ${parsed.layer}`
    );
    assert(
      parsed.category === "anchor_constraint",
      `Expected category anchor_constraint, got ${parsed.category}`
    );
    assert(parsed.code === 3005, `Expected code 3005, got ${parsed.code}`);
    assert(
      parsed.title === "Constraint Error: AccountNotEnoughKeys",
      `Expected title Constraint Error: AccountNotEnoughKeys, got ${parsed.title}`
    );
    console.log("✓ Passed Test 1\n");
  }

  // Test 2: Anchor Custom Error 6000 (PoolNotActive)
  {
    console.log("Test 2: Custom Error 6000 parsing");
    const rawErr = new Error("Simulation failed: custom program error: 0x1770");
    const parsed = parseTransactionError(rawErr);
    assert(
      parsed.layer === "anchor",
      `Expected layer anchor, got ${parsed.layer}`
    );
    assert(
      parsed.category === "anchor_custom",
      `Expected category anchor_custom, got ${parsed.category}`
    );
    assert(parsed.code === 6000, `Expected code 6000, got ${parsed.code}`);
    assert(
      parsed.title === "Program Error: PoolNotActive",
      `Expected title Program Error: PoolNotActive, got ${parsed.title}`
    );
    console.log("✓ Passed Test 2\n");
  }

  // Test 3: @solana/kit wrapped TransactionPlanError with embedded 0xbbd
  {
    console.log(
      "Test 3: @solana/kit wrapped TransactionPlanError containing 0xbbd"
    );
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
    assert(
      parsed.layer === "anchor",
      `Expected layer anchor, got ${parsed.layer}`
    );
    assert(
      parsed.category === "anchor_constraint",
      `Expected category anchor_constraint, got ${parsed.category}`
    );
    assert(parsed.code === 3005, `Expected code 3005, got ${parsed.code}`);
    assert(
      parsed.title === "Constraint Error: AccountNotEnoughKeys",
      `Expected title Constraint Error: AccountNotEnoughKeys, got ${parsed.title}`
    );
    console.log("✓ Passed Test 3\n");
  }

  // Test 4: True Blockhash Expiration Error
  {
    console.log("Test 4: True Blockhash Expiration Error");
    const expErr = new Error(
      "Transaction failed: BlockheightExceeded. Blockhash expired."
    );
    const parsed = parseTransactionError(expErr);
    assert(parsed.layer === "rpc", `Expected layer rpc, got ${parsed.layer}`);
    assert(
      parsed.category === "blockhash_expired",
      `Expected category blockhash_expired, got ${parsed.category}`
    );
    assert(
      parsed.title === "Request Timed Out",
      `Expected title Request Timed Out, got ${parsed.title}`
    );
    console.log("✓ Passed Test 4\n");
  }

  // Test 5: Wallet User Cancellation (4001)
  {
    console.log("Test 5: Wallet Cancellation 4001");
    const walletErr = { code: 4001, message: "User rejected the request." };
    const parsed = parseTransactionError(walletErr);
    assert(parsed.isCancellation === true, "Should be cancellation");
    assert(parsed.code === 4001, `Expected code 4001, got ${parsed.code}`);
    assert(
      parsed.title === "Transaction Cancelled",
      `Expected title Transaction Cancelled, got ${parsed.title}`
    );
    console.log("✓ Passed Test 5\n");
  }

  // Test 6: Direct object code inspection in matchAnchorError
  {
    console.log("Test 6: Direct object code inspection in matchAnchorError");
    const errWithCode = { context: { code: 3013 } };
    const matched = matchAnchorError(errWithCode);
    assert(matched !== null, "Should match code 3013");
    assert(matched?.code === 3013, `Expected code 3013, got ${matched?.code}`);
    assert(
      matched?.info.name === "AccountNotProgramData",
      `Expected name AccountNotProgramData, got ${matched?.info.name}`
    );
    console.log("✓ Passed Test 6\n");
  }

  // Test 7: Uppercase prefix blockhash expiration (ERROR Transaction simulation failed: Blockhash not found)
  {
    console.log("Test 7: Uppercase prefix blockhash expiration parsing");
    const rawErr = new Error(
      "ERROR Transaction simulation failed: Blockhash not found"
    );
    const parsed = parseTransactionError(rawErr);
    assert(parsed.layer === "rpc", `Expected layer rpc, got ${parsed.layer}`);
    assert(
      parsed.category === "blockhash_expired",
      `Expected category blockhash_expired, got ${parsed.category}`
    );
    assert(
      parsed.title === "Request Timed Out",
      `Expected title Request Timed Out, got ${parsed.title}`
    );
    console.log("✓ Passed Test 7\n");
  }

  // Test 8: @solana/kit object-wrapped error containing Blockhash not found
  {
    console.log("Test 8: @solana/kit object-wrapped Blockhash not found error");
    const kitObjErr = {
      message: "The provided transaction plan failed to execute.",
      transactionPlanResult: {
        error: {
          message: "Transaction simulation failed: Blockhash not found",
        },
      },
    };
    const parsed = parseTransactionError(kitObjErr);
    assert(
      parsed.category === "blockhash_expired",
      `Expected category blockhash_expired, got ${parsed.category}`
    );
    assert(
      parsed.title === "Request Timed Out",
      `Expected title Request Timed Out, got ${parsed.title}`
    );
    console.log("✓ Passed Test 8\n");
  }

  // Test 9: American spelling cancellation (canceled)
  {
    console.log("Test 9: American spelling cancellation parsing (canceled)");
    const cancelErr = { message: "User canceled the request in Phantom." };
    const parsed = parseTransactionError(cancelErr);
    assert(parsed.isCancellation === true, "Should be marked cancellation");
    assert(
      parsed.category === "wallet_cancellation",
      `Expected wallet_cancellation, got ${parsed.category}`
    );
    console.log("✓ Passed Test 9\n");
  }

  // Test 10: Confirmation timeout error string
  {
    console.log("Test 10: Confirmation timeout parsing");
    const timeoutErr = new Error(
      "Transaction was not confirmed in 60.00 seconds. Check your RPC."
    );
    const parsed = parseTransactionError(timeoutErr);
    assert(
      parsed.category === "blockhash_expired",
      `Expected category blockhash_expired, got ${parsed.category}`
    );
    assert(
      parsed.title === "Request Timed Out",
      `Expected title Request Timed Out, got ${parsed.title}`
    );
    console.log("✓ Passed Test 10\n");
  }

  // Test 11: Generic error message wrapper with nested blockhash expiration cause
  {
    console.log(
      "Test 11: Generic wrapper with nested cause containing Blockhash not found"
    );
    const nestedErr = new Error("Transaction execution failed", {
      cause: new Error("Transaction simulation failed: Blockhash not found"),
    });
    const parsed = parseTransactionError(nestedErr);
    assert(
      parsed.category === "blockhash_expired",
      `Expected category blockhash_expired, got ${parsed.category}`
    );
    assert(
      parsed.title === "Request Timed Out",
      `Expected title Request Timed Out, got ${parsed.title}`
    );
    console.log("✓ Passed Test 11\n");
  }

  // Test 12: Duplicate transaction error string
  {
    console.log("Test 12: Duplicate transaction error string parsing");
    const dupErr = new Error(
      'Transaction verification failed for transaction Internal error: "Transaction error: This transaction has already been processed"'
    );
    const parsed = parseTransactionError(dupErr);
    assert(parsed.layer === "rpc", `Expected layer rpc, got ${parsed.layer}`);
    assert(
      parsed.category === "duplicate_transaction",
      `Expected category duplicate_transaction, got ${parsed.category}`
    );
    assert(
      parsed.title === "Transaction Already Processed",
      `Expected title Transaction Already Processed, got ${parsed.title}`
    );
    console.log("✓ Passed Test 12\n");
  }

  // Test 13: @solana/errors uncaught TypeError on -32002 without data
  {
    console.log("Test 13: @solana/errors destructuring TypeError parsing");
    const typeErr = new TypeError(
      "Cannot destructure property 'err' of 'data' as it is undefined."
    );
    const parsed = parseTransactionError(typeErr);
    assert(parsed.layer === "rpc", `Expected layer rpc, got ${parsed.layer}`);
    assert(
      parsed.category === "duplicate_transaction",
      `Expected category duplicate_transaction, got ${parsed.category}`
    );
    assert(
      parsed.title === "Transaction Already Processed",
      `Expected title Transaction Already Processed, got ${parsed.title}`
    );
    console.log("✓ Passed Test 13\n");
  }

  // Test 14: isParsedTransactionError type guard
  {
    console.log("Test 14: isParsedTransactionError type guard");
    const rawParsed = parseTransactionError(
      new Error("custom program error: 0x1770")
    );
    assert(
      isParsedTransactionError(rawParsed) === true,
      "Should recognize parsed transaction error"
    );
    assert(
      isParsedTransactionError(null) === false,
      "null is not parsed error"
    );
    assert(
      isParsedTransactionError({}) === false,
      "empty object is not parsed error"
    );
    assert(
      isParsedTransactionError(new Error("fail")) === false,
      "Error instance is not parsed error"
    );
    console.log("✓ Passed Test 14\n");
  }

  // Test 15: TransactionError class creation and inheritance
  {
    console.log("Test 15: TransactionError class instantiation and prototype");
    const parsed = parseTransactionError(
      new Error("custom program error: 0x1770")
    );
    const rawCause = new Error("Underlying RPC failure");
    const txErr = new TransactionError(parsed, rawCause);

    assert(txErr instanceof Error, "TransactionError must be instanceof Error");
    assert(
      txErr instanceof TransactionError,
      "TransactionError must be instanceof TransactionError"
    );
    assert(
      txErr.name === "TransactionError",
      `Expected name TransactionError, got ${txErr.name}`
    );
    assert(
      txErr.message === parsed.message,
      `Expected message ${parsed.message}, got ${txErr.message}`
    );
    assert(
      txErr.parsed === parsed,
      "TransactionError must expose parsed payload"
    );
    assert(txErr.cause === rawCause, "TransactionError must preserve cause");
    console.log("✓ Passed Test 15\n");
  }

  // Test 16: parseTransactionError idempotency with TransactionError and ParsedTransactionError
  {
    console.log("Test 16: parseTransactionError idempotency");
    const initialParsed = parseTransactionError(
      new Error("custom program error: 0x1770")
    );
    const reParsed = parseTransactionError(initialParsed);
    assert(
      reParsed === initialParsed,
      "Re-parsing ParsedTransactionError must be strictly idempotent"
    );

    const txErr = new TransactionError(initialParsed);
    const parsedFromTxErr = parseTransactionError(txErr);
    assert(
      parsedFromTxErr === initialParsed,
      "Parsing TransactionError must cleanly unwrap .parsed"
    );
    console.log("✓ Passed Test 16\n");
  }

  // Test 17: System Program Insufficient Funds (0x1)
  {
    console.log("Test 17: System Program Insufficient Funds (0x1)");
    const rawErr = new Error(
      "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1"
    );
    const parsed = parseTransactionError(rawErr);
    assert(
      parsed.layer === "system",
      `Expected layer system, got ${parsed.layer}`
    );
    assert(
      parsed.category === "insufficient_sol",
      `Expected category insufficient_sol, got ${parsed.category}`
    );
    assert(parsed.code === "0x1", `Expected code 0x1, got ${parsed.code}`);
    assert(
      parsed.title === "Insufficient SOL",
      `Expected title Insufficient SOL, got ${parsed.title}`
    );
    console.log("✓ Passed Test 17\n");
  }

  // Test 18: SPL Token Insufficient Funds (0x3)
  {
    console.log("Test 18: SPL Token Insufficient Funds (0x3)");
    const rawErr = new Error(
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x3"
    );
    const parsed = parseTransactionError(rawErr);
    assert(parsed.layer === "spl", `Expected layer spl, got ${parsed.layer}`);
    assert(
      parsed.category === "insufficient_tokens",
      `Expected category insufficient_tokens, got ${parsed.category}`
    );
    assert(parsed.code === 3, `Expected code 3, got ${parsed.code}`);
    assert(
      parsed.title === "Token Error: InsufficientFunds",
      `Expected title Token Error: InsufficientFunds, got ${parsed.title}`
    );
    assert(
      parsed.message === SPL_TOKEN_ERRORS[3].message,
      `Expected message from SPL_TOKEN_ERRORS, got ${parsed.message}`
    );
    console.log("✓ Passed Test 18\n");
  }

  // Test 19: SPL Token Mint Mismatch (0x4)
  {
    console.log("Test 19: SPL Token Mint Mismatch (0x4)");
    const rawErr = new Error(
      "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x4"
    );
    const parsed = parseTransactionError(rawErr);
    assert(parsed.layer === "spl", `Expected layer spl, got ${parsed.layer}`);
    assert(parsed.code === 4, `Expected code 4, got ${parsed.code}`);
    assert(
      parsed.title === "Token Error: MintMismatch",
      `Expected title Token Error: MintMismatch, got ${parsed.title}`
    );
    console.log("✓ Passed Test 19\n");
  }

  // Test 20: RPC Rate Limit 429
  {
    console.log("Test 20: RPC Rate Limit 429");
    const rawErr = new Error(
      "429 Too Many Requests: rate limit exceeded on RPC cluster"
    );
    const parsed = parseTransactionError(rawErr);
    assert(parsed.layer === "rpc", `Expected layer rpc, got ${parsed.layer}`);
    assert(
      parsed.category === "network_rpc",
      `Expected category network_rpc, got ${parsed.category}`
    );
    assert(parsed.code === "429", `Expected code 429, got ${parsed.code}`);
    assert(
      parsed.title === "Network Busy",
      `Expected title Network Busy, got ${parsed.title}`
    );
    console.log("✓ Passed Test 20\n");
  }

  // Test 21: Network FETCH_FAILED
  {
    console.log("Test 21: Network FETCH_FAILED");
    const rawErr = new Error("TypeError: Failed to fetch");
    const parsed = parseTransactionError(rawErr);
    assert(parsed.layer === "rpc", `Expected layer rpc, got ${parsed.layer}`);
    assert(
      parsed.category === "network_rpc",
      `Expected category network_rpc, got ${parsed.category}`
    );
    assert(
      parsed.code === "FETCH_FAILED",
      `Expected code FETCH_FAILED, got ${parsed.code}`
    );
    assert(
      parsed.title === "Connection Error",
      `Expected title Connection Error, got ${parsed.title}`
    );
    console.log("✓ Passed Test 21\n");
  }

  // Test 22: Compute Unit (CU) Budget Exhaustion
  {
    console.log("Test 22: Compute Unit Budget Exhaustion");
    const rawErr = new Error(
      "Program failed to complete: exceeded maximum number of instructions allowed"
    );
    const parsed = parseTransactionError(rawErr);
    assert(parsed.layer === "rpc", `Expected layer rpc, got ${parsed.layer}`);
    assert(
      parsed.category === "network_rpc",
      `Expected category network_rpc, got ${parsed.category}`
    );
    assert(
      parsed.code === "COMPUTE_BUDGET_EXCEEDED",
      `Expected code COMPUTE_BUDGET_EXCEEDED, got ${parsed.code}`
    );
    assert(
      parsed.title === "Compute Budget Exceeded",
      `Expected title Compute Budget Exceeded, got ${parsed.title}`
    );
    console.log("✓ Passed Test 22\n");
  }

  // Test 23: sanitizeErrorMessage URL scrubbing & ANSI color codes
  {
    console.log("Test 23: sanitizeErrorMessage URL scrubbing & ANSI cleaning");
    const technicalRaw =
      "\u001b[31mError\u001b[0m: Connection refused to https://api.devnet.solana.com/rpc/v1 at line 42:10";
    const sanitized = sanitizeErrorMessage(technicalRaw);
    assert(
      !sanitized.includes("https://api.devnet.solana.com"),
      "Should redact raw RPC endpoint URL"
    );
    assert(
      sanitized.includes("[RPC Endpoint]"),
      "Should replace URL with [RPC Endpoint]"
    );
    assert(
      !sanitized.includes("\u001b[31m"),
      "Should strip ANSI escape sequences"
    );
    console.log("✓ Passed Test 23\n");
  }

  // Test 24: getErrorCategoryTheme theme mapping validation
  {
    console.log("Test 24: getErrorCategoryTheme theme mapping validation");
    const timeoutTheme = getErrorCategoryTheme("blockhash_expired");
    assert(timeoutTheme.icon === "⏱️", `Expected ⏱️, got ${timeoutTheme.icon}`);
    assert(
      timeoutTheme.titleColor === "text-sky-300",
      `Expected text-sky-300, got ${timeoutTheme.titleColor}`
    );

    const fundsTheme = getErrorCategoryTheme("insufficient_sol");
    assert(fundsTheme.icon === "⛽", `Expected ⛽, got ${fundsTheme.icon}`);
    assert(
      fundsTheme.titleColor === "text-amber-300",
      `Expected text-amber-300, got ${fundsTheme.titleColor}`
    );

    const contractTheme = getErrorCategoryTheme("anchor_custom");
    assert(
      contractTheme.icon === "⚠️",
      `Expected ⚠️, got ${contractTheme.icon}`
    );
    assert(
      contractTheme.titleColor === "text-red-400",
      `Expected text-red-400, got ${contractTheme.titleColor}`
    );

    const cancelTheme = getErrorCategoryTheme("wallet_cancellation");
    assert(cancelTheme.icon === "✕", `Expected ✕, got ${cancelTheme.icon}`);

    const defaultTheme = getErrorCategoryTheme("unknown");
    assert(defaultTheme.icon === "⚠️", `Expected ⚠️, got ${defaultTheme.icon}`);
    console.log("✓ Passed Test 24\n");
  }

  console.log(
    "All app/lib/__tests__/errors.test.ts tests completed successfully!"
  );
}

runTests();
