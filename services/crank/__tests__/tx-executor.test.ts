import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isBenignConcurrencyRace,
  isVenueLiquidityDeficit,
  classifyDeferral,
  buildFailureResult,
  JITO_TIP_ACCOUNTS,
  createSystemTransferInstruction,
} from "../executor/tx-executor";
import { generateKeyPairSigner } from "@solana/kit";

describe("TxExecutor Unit Tests", () => {
  it("should classify Anchor race error codes as benign concurrency race", () => {
    // 6008 = AlreadyClaimed
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6008 }],
      }),
      true
    );

    // 6000 = PoolClosed
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6000 }],
      }),
      true
    );

    // 6001 = PoolPaused
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6001 }],
      }),
      true
    );

    // Error messages with standard Anchor race strings
    assert.strictEqual(
      isBenignConcurrencyRace(new Error("custom program error: 0x1778")),
      true
    );
    assert.strictEqual(
      isBenignConcurrencyRace(
        new Error("State already revealed by competitor")
      ),
      true
    );

    // Non-benign errors should return false
    assert.strictEqual(
      isBenignConcurrencyRace(new Error("Account not found")),
      false
    );
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0, { Custom: 6009 }], // MathOverflow
      }),
      false
    );
  });

  it("should classify BigInt error codes and logs as benign concurrency race", () => {
    // BigInt 6008n = AlreadyClaimed
    assert.strictEqual(
      isBenignConcurrencyRace({
        InstructionError: [0n, { Custom: 6008n }],
      }),
      true
    );

    // Matching in logs
    assert.strictEqual(
      isBenignConcurrencyRace({}, [
        "Program 4ZJJemMiVfNzwwoz8BedkWZ8ZKCkx1ya6iA59JS6baGG invoke [1]",
        "Program log: AnchorError Error Code: AlreadyClaimed. Error Number: 6008.",
      ]),
      true
    );
  });

  it("should classify InsufficientVaultBalance (6066 / 0x17b2) as venue liquidity deficit", () => {
    // Custom error 6066
    assert.strictEqual(
      isVenueLiquidityDeficit({
        InstructionError: [0, { Custom: 6066 }],
      }),
      true
    );

    // BigInt 6066n
    assert.strictEqual(
      isVenueLiquidityDeficit({
        InstructionError: [0n, { Custom: 6066n }],
      }),
      true
    );

    // Hex 0x17b2 in error string
    assert.strictEqual(
      isVenueLiquidityDeficit(new Error("custom program error: 0x17b2")),
      true
    );

    // Error name string
    assert.strictEqual(
      isVenueLiquidityDeficit(new Error("InsufficientVaultBalance")),
      true
    );

    // Matching from simulation logs
    assert.strictEqual(
      isVenueLiquidityDeficit({}, [
        "Program 4ZJJemMiVfNzwwoz8BedkWZ8ZKCkx1ya6iA59JS6baGG invoke [1]",
        "Program log: AnchorError thrown in programs/anchor/src/instructions/user/claim_redemption.rs:213. Error Code: InsufficientVaultBalance. Error Number: 6066.",
      ]),
      true
    );

    // Unrelated error should return false
    assert.strictEqual(
      isVenueLiquidityDeficit(new Error("InsufficientFunds")),
      false
    );
  });

  it("classifyDeferral should correctly categorize benign races and liquidity deficits", () => {
    // Benign race
    const raceOutcome = classifyDeferral({
      InstructionError: [0, { Custom: 6008 }],
    });
    assert.ok(raceOutcome);
    assert.strictEqual(raceOutcome.status, "CONCURRENCY_RACE_LOST");

    // Liquidity deficit
    const deficitOutcome = classifyDeferral({
      InstructionError: [0, { Custom: 6066 }],
    });
    assert.ok(deficitOutcome);
    assert.strictEqual(deficitOutcome.status, "VENUE_LIQUIDITY_DEFICIT");
    if (deficitOutcome.status === "VENUE_LIQUIDITY_DEFICIT") {
      assert.strictEqual(deficitOutcome.code, 6066);
    }

    // Regular error returns null
    const regularOutcome = classifyDeferral(
      new Error("Random network failure")
    );
    assert.strictEqual(regularOutcome, null);
  });

  it("buildFailureResult should construct unified result objects", () => {
    // Deferral result
    const deferralResult = buildFailureResult("DisburseSentinelWorker", {
      InstructionError: [0, { Custom: 6066 }],
    });
    assert.strictEqual(deferralResult.executed, false);
    assert.strictEqual(
      deferralResult.outcome.status,
      "VENUE_LIQUIDITY_DEFICIT"
    );

    // Hard error result
    const hardErrorResult = buildFailureResult(
      "HarvestYieldWorker",
      new Error("Invalid fee account"),
      undefined,
      "Simulation failed"
    );
    assert.strictEqual(hardErrorResult.executed, false);
    assert.strictEqual(hardErrorResult.outcome.status, "ERROR");
    assert.match(hardErrorResult.reason, /Simulation failed/);
  });

  it("should construct valid SystemProgram transfer tip instruction", async () => {
    const signer = await generateKeyPairSigner();
    const tipAccount = JITO_TIP_ACCOUNTS[0];
    const tipLamports = 10_000n;

    const ix = createSystemTransferInstruction({
      from: signer,
      to: tipAccount,
      lamports: tipLamports,
    });

    assert.strictEqual(ix.programAddress, "11111111111111111111111111111111");
    assert.strictEqual(ix.accounts?.length, 2);
    assert.strictEqual(ix.accounts?.[0]?.address, signer.address);
    assert.strictEqual(ix.accounts?.[1]?.address, tipAccount);
    assert.strictEqual(ix.data?.length, 12);
  });

  it("TransactionExecutor should execute instructions in DRY RUN mode with additional signers", async () => {
    const { TransactionExecutor } = await import("../executor/tx-executor");
    const { createResilientRpc } = await import("@/app/lib/rpc-transport");
    const signer = await generateKeyPairSigner();
    const additionalSigner = await generateKeyPairSigner();

    const rpc = createResilientRpc("http://127.0.0.1:8899");
    const executor = new TransactionExecutor(rpc, {
      rpcUrl: "http://127.0.0.1:8899",
      wsUrl: "ws://127.0.0.1:8899",
      poolIds: [1],
      pollIntervalMs: 15000,
      activeWindowPollIntervalMs: 1000,
      metricsPort: 0,
      enableAutoDisburse: false,
      maxPrepareBatchSize: 500,
      maxReinvestBatchSize: 5,
      instanceIndex: 0,
      instanceJitterMs: 0,
      jitoEnabled: false,
      jitoTipLamports: 10000n,
      maxJitoTipLamports: 100000n,
      dryRun: true,
    });

    const result = await executor.executeInstructions({
      workerName: "RebindRandomnessWorker",
      instructions: [],
      signer,
      computeUnits: 375_000,
      additionalSigners: [additionalSigner],
    });

    assert.strictEqual(result.executed, true);
    assert.strictEqual(result.outcome.status, "EXECUTED");
    assert.strictEqual(result.computeUnitsUsed, 375_000);
  });
});
