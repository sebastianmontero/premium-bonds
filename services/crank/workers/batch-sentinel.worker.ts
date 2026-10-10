import { address, type Address } from "@solana/kit";
import {
  findRedemptionBatchPda,
  parseRedemptionBatch,
  decodeAccountBase64Data,
  fetchHumaQueueNextRequestId,
  buildCrankSubmitRedemptionBatchInstruction,
  buildSettleRedemptionBatchInstruction,
  buildCrankCloseRedemptionBatchInstruction,
  type RedemptionBatch,
  type HumaPoolAddresses,
} from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
  WorkerDeferredOutcome,
} from "../types";
import {
  classifyBatchAction,
  createHumaPoolSnapshot,
  hasSubmittedBatch,
  type HumaPoolSnapshot,
} from "../state/batch-classifier";
import { CrankConfig } from "../config";

export class BatchSentinelWorker implements ICrankTask {
  readonly name = "BatchSentinelWorker";

  constructor(private readonly config?: CrankConfig) {}

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return snapshot.state !== "POOL_CLOSED";
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    const pool = snapshot.pool;
    const poolId = snapshot.poolId;

    const hasSubmitted = hasSubmittedBatch(pool.submittedBatchId);

    // Build PDAs for batch accounts to fetch
    const accumulatingBatchPda = await findRedemptionBatchPda(
      poolId,
      pool.accumulatingRedemptionBatchId
    );

    const pdasToFetch: Address[] = [accumulatingBatchPda];
    let submittedBatchPda: Address | null = null;
    if (hasSubmitted) {
      submittedBatchPda = await findRedemptionBatchPda(
        poolId,
        pool.submittedBatchId!
      );
      pdasToFetch.push(submittedBatchPda);
    }

    let accumulatingBatch: RedemptionBatch | null = null;
    let submittedBatch: RedemptionBatch | null = null;

    try {
      let accounts: Array<{
        data?: [string, string] | string | Uint8Array | null;
      } | null> = [];
      if (typeof context.rpc.getMultipleAccounts === "function") {
        const res = await context.rpc
          .getMultipleAccounts(pdasToFetch, { encoding: "base64" })
          .send();
        accounts = res?.value ?? [];
      } else {
        accounts = await Promise.all(
          pdasToFetch.map(async (pda) => {
            const single = await context.rpc
              .getAccountInfo(pda, { encoding: "base64" })
              .send();
            return single?.value;
          })
        );
      }

      if (accounts[0]) {
        const rawBytes = decodeAccountBase64Data(accounts[0]);
        if (rawBytes) {
          accumulatingBatch = parseRedemptionBatch(rawBytes);
        }
      }

      if (hasSubmitted && accounts[1]) {
        const rawBytes = decodeAccountBase64Data(accounts[1]);
        if (rawBytes) {
          submittedBatch = parseRedemptionBatch(rawBytes);
        }
      }
    } catch (err) {
      return {
        shouldExecute: false,
        reason: `[BatchSentinelWorker] Failed to query redemption batch accounts for Pool #${poolId}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Fetch Huma queue snapshot if needed for settlement check
    let humaSnapshot: HumaPoolSnapshot | null = null;
    if (hasSubmitted && submittedBatch) {
      try {
        const humaPoolAddr =
          this.config?.humaPoolState ?? address(pool.humaPoolState);
        if (humaPoolAddr) {
          const nextReqId = await fetchHumaQueueNextRequestId(
            context.rpc,
            humaPoolAddr
          );
          if (nextReqId !== null) {
            humaSnapshot = createHumaPoolSnapshot(nextReqId);
          }
        }
      } catch (err) {
        console.warn(
          `[BatchSentinelWorker] [Pool #${poolId}] Failed to query Huma queue nextRequestId: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const action = classifyBatchAction({
      poolId,
      pool,
      accumulatingBatch,
      submittedBatch,
      humaSnapshot,
      currentTimestamp: snapshot.currentTimestamp,
    });

    if (action.type === "NONE") {
      return {
        shouldExecute: false,
        reason: action.reason,
      };
    }

    const humaAddresses: Partial<HumaPoolAddresses> = {
      config: this.config?.humaConfig,
      poolConfig: this.config?.humaPoolConfig,
      poolState: this.config?.humaPoolState ?? address(pool.humaPoolState),
      modeConfig: this.config?.humaModeConfig,
      modeMint: this.config?.pstMint,
      redemptionRequest: this.config?.humaRedemptionRequest,
      lenderState:
        this.config?.poolHumaLenderStates?.[poolId] ??
        this.config?.humaLenderState,
      poolModeToken: this.config?.humaPoolModeToken,
      poolUnderlyingToken: this.config?.humaPoolUnderlyingToken,
    };

    if (action.type === "SETTLE") {
      const ix = await buildSettleRedemptionBatchInstruction({
        caller: context.signer,
        poolId,
        batchId: action.batchId,
        tokenMint: address(pool.tokenMint),
        humaAddresses,
        humaProgram: this.config?.humaProgram,
      });

      const batchPda = await findRedemptionBatchPda(poolId, action.batchId);

      return {
        shouldExecute: true,
        reason: action.reason,
        instructions: [ix],
        computeUnitLimit: 400_000,
        priorityFeeTier: "high",
        writableAccounts: [snapshot.poolAddress, batchPda],
      };
    }

    if (action.type === "SUBMIT") {
      const ix = await buildCrankSubmitRedemptionBatchInstruction({
        crank: context.signer,
        poolId,
        batchId: action.batchId,
        nextBatchId: action.nextBatchId,
        humaAddresses,
        humaProgram: this.config?.humaProgram,
      });

      const batchPda = await findRedemptionBatchPda(poolId, action.batchId);
      const nextBatchPda = await findRedemptionBatchPda(
        poolId,
        action.nextBatchId
      );

      return {
        shouldExecute: true,
        reason: action.reason,
        instructions: [ix],
        computeUnitLimit: 400_000,
        priorityFeeTier: "high",
        writableAccounts: [snapshot.poolAddress, batchPda, nextBatchPda],
      };
    }

    if (action.type === "CLOSE") {
      const ix = await buildCrankCloseRedemptionBatchInstruction({
        crank: context.signer,
        poolId,
        batchId: action.batchId,
        tokenMint: address(pool.tokenMint),
        feeWallet: address(pool.feeWallet),
      });

      const batchPda = await findRedemptionBatchPda(poolId, action.batchId);

      return {
        shouldExecute: true,
        reason: action.reason,
        instructions: [ix],
        computeUnitLimit: 200_000,
        priorityFeeTier: "medium",
        writableAccounts: [snapshot.poolAddress, batchPda],
      };
    }

    return {
      shouldExecute: false,
      reason: "Unrecognized batch action",
    };
  }

  onDeferred(poolId: number, outcome: WorkerDeferredOutcome): void {
    if (outcome.status === "CONCURRENCY_RACE_LOST") {
      console.log(
        `[BatchSentinelWorker] Concurrency race lost on Pool #${poolId}, will re-evaluate next tick.`
      );
    }
  }
}
