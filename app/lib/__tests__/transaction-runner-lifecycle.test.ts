import test from "node:test";
import assert from "node:assert/strict";
import {
  delayWithAbort,
  MOCK_TX_PREFIX,
  type TransactionLifecycleReporter,
  type TransactionRunnerFn,
} from "../../hooks/useTransactionRunner";
import { createMockTransactionFn } from "../mock-transaction";
import { parseTransactionError, TransactionError } from "../errors";
import { pollSignatureConfirmation } from "../transaction-poller";
import {
  signature as toSignature,
  type Rpc,
  type GetSignatureStatusesApi,
} from "@solana/kit";
import { MockRpcBuilder } from "../test-harness";
import type { TransactionStage } from "../../components/dashboard/TransactionProgressModal";

const VALID_TEST_SIG = toSignature(
  "2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2"
);

/**
 * Headless transaction runner state machine engine replicating useTransactionRunner logic
 * for deterministic multi-case unit testing.
 */
class HeadlessTransactionRunner {
  public stage: TransactionStage = null;
  public txSignature: string | null = null;
  public error: unknown = null;
  private abortController: AbortController | null = null;
  public readonly stageTransitions: TransactionStage[] = [];

  constructor(private rpc: Rpc<GetSignatureStatusesApi>) {}

  private setStage(s: TransactionStage) {
    this.stage = s;
    this.stageTransitions.push(s);
  }

  public abort() {
    this.abortController?.abort();
  }

  public async runTransaction(
    txFn: TransactionRunnerFn,
    onSuccess?: (sig?: string) => void
  ): Promise<string> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    this.setStage("preparing");
    this.error = null;
    this.txSignature = null;

    try {
      let signingReported = false;
      const capturedSig = await txFn({
        onSigning: () => {
          if (!abortController.signal.aborted && !signingReported) {
            signingReported = true;
            this.setStage("signing");
          }
        },
      });

      if (!capturedSig) {
        throw new DOMException(
          "Transaction signature not returned",
          "AbortError"
        );
      }

      this.txSignature = capturedSig;
      this.setStage("broadcasting");

      const isMock = capturedSig.startsWith(MOCK_TX_PREFIX);
      const pollPromise = isMock
        ? delayWithAbort(50, abortController.signal)
        : pollSignatureConfirmation(this.rpc, toSignature(capturedSig), {
            timeoutMs: 5000,
            initialDelayMs: 10,
            maxDelayMs: 20,
            abortSignal: abortController.signal,
          });

      const earlyRejectionPromise = new Promise<never>((_, reject) => {
        pollPromise.catch(reject);
      });

      await Promise.race([
        delayWithAbort(30, abortController.signal),
        earlyRejectionPromise,
      ]);

      if (abortController.signal.aborted) {
        throw new DOMException("Transaction aborted", "AbortError");
      }

      const confirmingStartTime = Date.now();
      this.setStage("confirming");
      await pollPromise;

      const elapsed = Date.now() - confirmingStartTime;
      const remainingDwell = Math.max(0, 20 - elapsed);
      if (remainingDwell > 0) {
        await delayWithAbort(remainingDwell, abortController.signal);
      }

      if (abortController.signal.aborted) {
        throw new DOMException("Transaction aborted", "AbortError");
      }

      this.setStage("success");
      if (onSuccess) onSuccess(capturedSig);
      return capturedSig;
    } catch (err: unknown) {
      const errorRecord = err as Record<string, unknown> | null;
      if (
        abortController.signal.aborted ||
        errorRecord?.name === "AbortError"
      ) {
        this.setStage(null);
        throw err;
      }
      const parsed = parseTransactionError(err);
      this.error = parsed;
      this.setStage(parsed.isCancellation ? null : "error");
      throw new TransactionError(parsed, err);
    }
  }
}

test("delayWithAbort: resolves after delay when not aborted", async () => {
  const controller = new AbortController();
  const start = Date.now();
  await delayWithAbort(25, controller.signal);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 20, `Elapsed ${elapsed}ms should be at least 20ms`);
});

test("delayWithAbort: resolves immediately when already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const start = Date.now();
  await delayWithAbort(500, controller.signal);
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed < 50,
    `Elapsed ${elapsed}ms should be < 50ms for pre-aborted signal`
  );
});

test("delayWithAbort: resolves immediately when aborted mid-flight", async () => {
  const controller = new AbortController();
  const start = Date.now();
  const timer = setTimeout(() => controller.abort(), 20);
  await delayWithAbort(1000, controller.signal);
  clearTimeout(timer);
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed < 200,
    `Elapsed ${elapsed}ms should unblock quickly on abort`
  );
});

test("createMockTransactionFn: invokes onSigning and returns demo signature", async () => {
  const mockFn = createMockTransactionFn(10);
  let onSigningCalled = false;
  const reporter: TransactionLifecycleReporter = {
    onSigning: () => {
      onSigningCalled = true;
    },
  };
  const sig = await mockFn(reporter);
  assert.equal(onSigningCalled, true);
  assert.ok(
    sig?.startsWith(MOCK_TX_PREFIX),
    `Signature ${sig} should start with ${MOCK_TX_PREFIX}`
  );
});

test("lifecycle: full happy-path transitions through preparing -> signing -> broadcasting -> confirming -> success", async () => {
  const rpcBuilder = new MockRpcBuilder().withSignatureStatusesSequence(
    VALID_TEST_SIG,
    [null, { confirmationStatus: "confirmed", err: null }]
  );
  const mockRpc = rpcBuilder.build() as unknown as Rpc<GetSignatureStatusesApi>;
  const runner = new HeadlessTransactionRunner(mockRpc);

  let successCallbackCalled = false;
  const sig = await runner.runTransaction(
    async ({ onSigning }) => {
      // Simulate build/validation phase in "preparing"
      await new Promise((resolve) => setTimeout(resolve, 10));
      onSigning();
      // Simulate wallet prompt in "signing"
      await new Promise((resolve) => setTimeout(resolve, 15));
      return VALID_TEST_SIG;
    },
    (capturedSig) => {
      assert.equal(capturedSig, VALID_TEST_SIG);
      successCallbackCalled = true;
    }
  );

  assert.equal(sig, VALID_TEST_SIG);
  assert.equal(successCallbackCalled, true);
  assert.deepEqual(runner.stageTransitions, [
    "preparing",
    "signing",
    "broadcasting",
    "confirming",
    "success",
  ]);
  assert.equal(runner.stage, "success");
  assert.equal(runner.txSignature, VALID_TEST_SIG);
  assert.equal(runner.error, null);
});

test("lifecycle: preparation error transitions directly from preparing to error with zero signing flash", async () => {
  const mockRpc =
    new MockRpcBuilder().build() as unknown as Rpc<GetSignatureStatusesApi>;
  const runner = new HeadlessTransactionRunner(mockRpc);

  await assert.rejects(
    async () => {
      await runner.runTransaction(async () => {
        // Validation fails before onSigning() is ever called
        throw new Error("Missing required Huma pool account");
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof TransactionError);
      return true;
    }
  );

  assert.deepEqual(runner.stageTransitions, ["preparing", "error"]);
  assert.equal(runner.stage, "error");
});

test("lifecycle: early RPC failure during broadcast pacing window rejects immediately to error, skipping confirming", async () => {
  const rpcBuilder = new MockRpcBuilder().withSignatureStatusesSequence(
    VALID_TEST_SIG,
    [
      {
        confirmationStatus: "processed",
        err: { InstructionError: [0, { Custom: 6007 }] },
      },
    ]
  );
  const mockRpc = rpcBuilder.build() as unknown as Rpc<GetSignatureStatusesApi>;
  const runner = new HeadlessTransactionRunner(mockRpc);

  await assert.rejects(
    async () => {
      await runner.runTransaction(async ({ onSigning }) => {
        onSigning();
        return VALID_TEST_SIG;
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof TransactionError);
      return true;
    }
  );

  assert.deepEqual(runner.stageTransitions, [
    "preparing",
    "signing",
    "broadcasting",
    "error",
  ]);
  assert.equal(runner.stage, "error");
});

test("lifecycle: quiet cancellation (wallet user rejection 4001) resets stage to null without error screen", async () => {
  const mockRpc =
    new MockRpcBuilder().build() as unknown as Rpc<GetSignatureStatusesApi>;
  const runner = new HeadlessTransactionRunner(mockRpc);

  await assert.rejects(
    async () => {
      await runner.runTransaction(async ({ onSigning }) => {
        onSigning();
        // User rejects prompt in wallet (standard code 4001)
        const err = new Error("User rejected the transaction");
        (err as unknown as Record<string, unknown>).code = 4001;
        throw err;
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof TransactionError);
      assert.equal((err as TransactionError).parsed.isCancellation, true);
      return true;
    }
  );

  assert.deepEqual(runner.stageTransitions, ["preparing", "signing", null]);
  assert.equal(runner.stage, null);
});

test("lifecycle: demo/mock signature flow executes smoothly without throwing or hanging", async () => {
  const mockRpc =
    new MockRpcBuilder().build() as unknown as Rpc<GetSignatureStatusesApi>;
  const runner = new HeadlessTransactionRunner(mockRpc);

  const mockTxFn = createMockTransactionFn(20);
  let successCalled = false;
  const sig = await runner.runTransaction(mockTxFn, () => {
    successCalled = true;
  });

  assert.ok(sig.startsWith(MOCK_TX_PREFIX));
  assert.equal(successCalled, true);
  assert.deepEqual(runner.stageTransitions, [
    "preparing",
    "signing",
    "broadcasting",
    "confirming",
    "success",
  ]);
  assert.equal(runner.stage, "success");
});
