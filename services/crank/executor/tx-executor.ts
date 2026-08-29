import {
  Address,
  address,
  createSolanaRpc,
  IInstruction,
  TransactionSigner,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { parseTransactionError } from "../../../app/lib/errors";
import { CrankConfig } from "../config";
import { WorkerExecutionResult } from "../types";

export const COMPUTE_BUDGET_PROGRAM_ADDRESS = address(
  "ComputeBudget111111111111111111111111111111"
);

export function createSetComputeUnitLimitInstruction(
  units: number
): IInstruction {
  const data = new Uint8Array(5);
  data[0] = 2; // SetComputeUnitLimit opcode
  new DataView(data.buffer).setUint32(1, units, true);
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS,
    accounts: [],
    data,
  };
}

export function createSetComputeUnitPriceInstruction(
  microLamports: bigint | number
): IInstruction {
  const data = new Uint8Array(9);
  data[0] = 3; // SetComputeUnitPrice opcode
  new DataView(data.buffer).setBigUint64(1, BigInt(microLamports), true);
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS,
    accounts: [],
    data,
  };
}

export class TransactionExecutor {
  constructor(
    private readonly rpc: ReturnType<typeof createSolanaRpc>,
    private readonly config: CrankConfig
  ) {}

  async estimatePriorityFee(
    writableAccounts: Address[],
    tier: "low" | "medium" | "high" | "urgent" = "medium"
  ): Promise<bigint> {
    try {
      const feesRes = (await this.rpc
        .getRecentPrioritizationFees(
          writableAccounts as Parameters<
            typeof this.rpc.getRecentPrioritizationFees
          >[0]
        )
        .send()) as Array<{ prioritizationFee?: bigint | number }>;
      if (!Array.isArray(feesRes) || feesRes.length === 0) {
        return tier === "urgent" ? 50_000n : 10_000n;
      }

      const validFees = feesRes
        .map((f) => BigInt(f.prioritizationFee || 0))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      const len = validFees.length;
      if (tier === "low") {
        return validFees[Math.floor(len * 0.25)] || 1_000n;
      }
      if (tier === "medium") {
        return validFees[Math.floor(len * 0.5)] || 10_000n;
      }
      if (tier === "high") {
        return validFees[Math.floor(len * 0.75)] || 25_000n;
      }
      return validFees[Math.floor(len * 0.95)] || 100_000n;
    } catch {
      return 10_000n;
    }
  }

  async executeInstructions(
    workerName: string,
    instructions: IInstruction[],
    signer: TransactionSigner,
    options: {
      computeUnits: number;
      priorityFeeTier?: "low" | "medium" | "high" | "urgent";
      writableAccounts?: Address[];
    }
  ): Promise<WorkerExecutionResult> {
    if (this.config.dryRun) {
      console.log(
        `[DRY RUN] [${workerName}] Would execute ${instructions.length} instructions (CU limit: ${options.computeUnits})`
      );
      return {
        workerName,
        executed: true,
        reason: "Simulated in DRY_RUN mode",
        signature: "dry_run_mock_signature",
        computeUnitsUsed: options.computeUnits,
      };
    }

    try {
      const priorityMicroLamports = await this.estimatePriorityFee(
        options.writableAccounts || [],
        options.priorityFeeTier || "medium"
      );

      const cuLimitIx = createSetComputeUnitLimitInstruction(
        options.computeUnits
      );
      const cuPriceIx = createSetComputeUnitPriceInstruction(
        priorityMicroLamports
      );

      const fullInstructions = [cuLimitIx, cuPriceIx, ...instructions];

      const { value: latestBlockhash } = await this.rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send();

      let msg = createTransactionMessage({ version: 0 });
      msg = setTransactionMessageFeePayerSigner(signer, msg);
      msg = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg);
      msg = appendTransactionMessageInstructions(fullInstructions, msg);

      const signedTx = await signTransactionMessageWithSigners(msg);
      const wireTx = getBase64EncodedWireTransaction(signedTx);

      const signature = await this.rpc
        .sendTransaction(wireTx, {
          encoding: "base64",
          preflightCommitment: "confirmed",
        })
        .send();

      // Poll confirmation
      let confirmed = false;
      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const status = await this.rpc.getSignatureStatuses([signature]).send();
        if (status?.value?.[0]) {
          const s = status.value[0];
          if (s.err) {
            const parsed = parseTransactionError(s.err);
            throw new Error(
              `Transaction reverted on-chain: ${parsed.title} (${parsed.code || "unknown"})`
            );
          }
          if (
            s.confirmationStatus === "confirmed" ||
            s.confirmationStatus === "finalized"
          ) {
            confirmed = true;
            break;
          }
        }
      }

      if (!confirmed) {
        throw new Error(
          `Transaction confirmation timed out after 12s. Signature: ${signature}`
        );
      }

      return {
        workerName,
        executed: true,
        reason: "Confirmed successfully",
        signature,
        computeUnitsUsed: options.computeUnits,
      };
    } catch (err: unknown) {
      const parsed = parseTransactionError(err);
      return {
        workerName,
        executed: false,
        reason: `Failed to land transaction: ${parsed.title}`,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
