import { buildAtomicRevealAndPickWinnersInstructions } from "../../../app/lib/bonds-sdk";
import {
  ESTIMATED_SLOT_DURATION_MS,
  MAX_RPC_MISMATCH_RETRIES,
  MIN_CRANK_BACKOFF_MS,
  RPC_PROPAGATION_RETRY_MS,
  VRF_FRESHNESS_WINDOW_SLOTS,
} from "../constants";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
  PoolId,
  toSlot,
} from "../types";
import { IVrfProvider } from "../vrf/randomness-provider";

export class AtomicRevealWorker implements ICrankTask {
  readonly name = "AtomicRevealWorker";
  private readonly mismatchRetries = new Map<PoolId, number>();

  constructor(private readonly vrfProvider: IVrfProvider) {}

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return snapshot.state === "READY_TO_DRAW";
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    if (snapshot.state !== "READY_TO_DRAW") {
      return {
        shouldExecute: false,
        reason: `State is not READY_TO_DRAW (current: ${snapshot.state})`,
      };
    }

    const revealResult = await this.vrfProvider.prepareReveal({
      randomnessAccount: snapshot.randomnessAccount,
      committedSeedSlot: toSlot(snapshot.vrfSeedSlot),
      currentSlot: toSlot(snapshot.currentSlot),
    });

    switch (revealResult.status) {
      case "pending_oracle":
        return {
          shouldExecute: false,
          reason: `Awaiting oracle proof: ${revealResult.reason}`,
          retryAfterMs: revealResult.retryAfterMs ?? 2000,
        };
      case "uncommitted": {
        return {
          shouldExecute: false,
          reason: `Randomness uncommitted: ${revealResult.reason}`,
          retryAfterMs: RPC_PROPAGATION_RETRY_MS,
        };
      }
      case "mismatch": {
        const retries = (this.mismatchRetries.get(snapshot.poolId) ?? 0) + 1;
        this.mismatchRetries.set(snapshot.poolId, retries);
        if (retries <= MAX_RPC_MISMATCH_RETRIES) {
          return {
            shouldExecute: false,
            reason: `Randomness seed_slot mismatch (retry ${retries}/${MAX_RPC_MISMATCH_RETRIES}): ${revealResult.reason}`,
            retryAfterMs: RPC_PROPAGATION_RETRY_MS,
          };
        }
        const deltaSlots =
          snapshot.vrfSeedSlot +
          VRF_FRESHNESS_WINDOW_SLOTS +
          1n -
          snapshot.currentSlot;
        const backoffMs = Math.max(
          MIN_CRANK_BACKOFF_MS,
          Number(deltaSlots) * ESTIMATED_SLOT_DURATION_MS
        );
        console.warn(
          `[AtomicRevealWorker] [Pool #${snapshot.poolId}] Persistent randomness seed_slot mismatch after ${retries} retries. Backing off for ${deltaSlots} slots (~${Math.round(backoffMs / 1000)}s) until rebind eligible.`
        );
        return {
          shouldExecute: false,
          reason: `Persistent randomness mismatch: ${revealResult.reason}`,
          retryAfterMs: backoffMs,
        };
      }
      case "expired":
        this.mismatchRetries.delete(snapshot.poolId);
        return {
          shouldExecute: false,
          reason: `Randomness expired (${revealResult.elapsedSlots} slots elapsed): ${revealResult.reason}`,
        };
      case "ready":
        this.mismatchRetries.delete(snapshot.poolId);
        break;
      default: {
        const _exhaustive: never = revealResult;
        throw new Error(
          `Unhandled VRF reveal status: ${JSON.stringify(_exhaustive)}`
        );
      }
    }

    const instructions = await buildAtomicRevealAndPickWinnersInstructions({
      crank: context.signer,
      poolId: snapshot.poolId,
      currentDrawCycleId: snapshot.cycleId,
      ticketRegistry: snapshot.ticketRegistryAddress,
      randomnessAccount: snapshot.randomnessAccount,
      switchboardRevealInstruction: revealResult.revealInstruction,
    });

    return {
      shouldExecute: true,
      reason: `Cycle #${snapshot.cycleId} prepared and ready for atomic reveal & winner selection`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(),
      priorityFeeTier: "high",
      writableAccounts: [
        snapshot.poolAddress,
        snapshot.ticketRegistryAddress,
        snapshot.randomnessAccount,
      ],
    };
  }

  getComputeUnitLimit(): number {
    return 800_000;
  }
}
