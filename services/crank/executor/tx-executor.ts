import {
  Address,
  address,
  createSolanaRpc,
  Instruction,
  TransactionSigner,
  AccountRole,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
  createSetComputeUnitLimitInstruction,
  createSetComputeUnitPriceInstruction,
} from "../../../app/lib/bonds-sdk";
import {
  parseTransactionError,
  matchAnchorError,
} from "../../../app/lib/errors";
import { CrankConfig } from "../config";
import { WorkerExecutionResult } from "../types";

export const JITO_TIP_ACCOUNTS: readonly Address[] = [
  address("96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"),
  address("HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe"),
  address("Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY"),
  address("ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49"),
  address("DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh"),
  address("ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt"),
  address("DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL"),
  address("3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"),
];

export function getRandomJitoTipAccount(): Address {
  const idx = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return JITO_TIP_ACCOUNTS[idx];
}

export function createSystemTransferInstruction(params: {
  from: Address | TransactionSigner;
  to: Address;
  lamports: bigint | number;
}): Instruction {
  const fromAddr =
    typeof params.from === "string" ? params.from : params.from.address;
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // SystemProgram.transfer instruction index = 2
  view.setBigUint64(4, BigInt(params.lamports), true);

  return {
    programAddress: address("11111111111111111111111111111111"),
    accounts: [
      { address: fromAddr, role: AccountRole.WRITABLE_SIGNER },
      { address: params.to, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

/**
 * Known benign concurrency race error codes & messages.
 * When a competing replica progresses state first, simulation fails with these errors.
 */
const BENIGN_RACE_ERROR_CODES = new Set([
  6008, // AlreadyClaimed
  6000, // PoolClosed
  6001, // PoolPaused
  6003, // InvalidState
  6021, // DrawAlreadyPrepared
  6022, // RandomnessAlreadyRevealed
  6023, // CycleAlreadyHarvested
  6024, // WinnersAlreadyPicked
]);

export function isBenignConcurrencyRace(
  err: unknown,
  logs?: readonly string[]
): boolean {
  if (!err && (!logs || logs.length === 0)) return false;
  if (err) {
    const matched = matchAnchorError(err);
    if (matched && BENIGN_RACE_ERROR_CODES.has(matched.code)) {
      return true;
    }
    const str = String(err).toLowerCase();
    if (
      str.includes("already claimed") ||
      str.includes("already prepared") ||
      str.includes("already revealed") ||
      str.includes("already harvested") ||
      str.includes("already processed") ||
      str.includes("0x1778") || // 6008 in hex
      str.includes("custom program error: 0x1778")
    ) {
      return true;
    }
  }
  if (logs && logs.length > 0) {
    const matchedLog = matchAnchorError(logs);
    if (matchedLog && BENIGN_RACE_ERROR_CODES.has(matchedLog.code)) {
      return true;
    }
    const fullLogs = logs.join(" ").toLowerCase();
    if (
      fullLogs.includes("already claimed") ||
      fullLogs.includes("already prepared") ||
      fullLogs.includes("already revealed") ||
      fullLogs.includes("already harvested") ||
      fullLogs.includes("already processed") ||
      fullLogs.includes("0x1778") ||
      fullLogs.includes("custom program error: 0x1778")
    ) {
      return true;
    }
  }
  return false;
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
        .send()) as unknown as Array<{ prioritizationFee?: bigint | number }>;
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
    instructions: Instruction[],
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
        outcome: {
          status: "EXECUTED",
          signature: "dry_run_mock_signature",
          computeUnitsUsed: options.computeUnits,
        },
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

      // Jito Tip appending if enabled
      if (this.config.jitoEnabled) {
        const rawTip = this.config.jitoTipLamports;
        const maxTip = this.config.maxJitoTipLamports;
        const effectiveTip = rawTip > maxTip ? maxTip : rawTip;
        const tipAccount = getRandomJitoTipAccount();
        const tipIx = createSystemTransferInstruction({
          from: signer,
          to: tipAccount,
          lamports: effectiveTip,
        });
        fullInstructions.push(tipIx);
      }

      const { value: latestBlockhash } = await this.rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send();

      const msg = appendTransactionMessageInstructions(
        fullInstructions,
        setTransactionMessageLifetimeUsingBlockhash(
          latestBlockhash,
          setTransactionMessageFeePayerSigner(
            signer,
            createTransactionMessage({ version: 0 })
          )
        )
      );

      const signedTx = await signTransactionMessageWithSigners(msg);
      const wireTx = getBase64EncodedWireTransaction(signedTx);

      // Mandatory Preflight Simulation
      const simRes = await this.rpc
        .simulateTransaction(wireTx, {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send();

      if (simRes?.value?.err) {
        const logs = (simRes.value.logs as string[] | undefined) || [];
        if (isBenignConcurrencyRace(simRes.value.err, logs)) {
          console.log(
            `[TxExecutor] [${workerName}] Preflight simulation benign concurrency race lost: state already progressed.`
          );
          return {
            workerName,
            executed: false,
            reason: "State already progressed by competing replica",
            outcome: {
              status: "CONCURRENCY_RACE_LOST",
              reason: "State already progressed by competing replica",
            },
          };
        }

        const parsed = parseTransactionError(simRes.value.err, logs);
        const codeStr = parsed.code !== undefined ? ` (${parsed.code})` : "";
        const reason = `Simulation failed: ${parsed.title}${codeStr} - ${parsed.message}`;
        console.error(`[TxExecutor] [${workerName}] ${reason}`, logs);
        return {
          workerName,
          executed: false,
          reason,
          outcome: {
            status: "ERROR",
            reason,
            parsedError: parsed,
            logs,
            error: new Error(reason),
          },
        };
      }

      // Jito Bundle Submission or RPC Broadcast
      let signature: string | null = null;

      if (this.config.jitoEnabled && this.config.jitoBlockEngineUrl) {
        try {
          await fetch(`${this.config.jitoBlockEngineUrl}/api/v1/bundles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "sendBundle",
              params: [[wireTx]],
            }),
            signal: AbortSignal.timeout(4000),
          });
        } catch {
          // Fall back to standard RPC broadcast
        }
      }

      // Standard Send & Rebroadcast Loop
      signature = await this.rpc
        .sendTransaction(wireTx, {
          encoding: "base64",
          preflightCommitment: "confirmed",
          skipPreflight: true,
        })
        .send();

      // Poll confirmation for up to 15s with 2s active rebroadcast loop
      let confirmed = false;
      const startTime = Date.now();

      while (Date.now() - startTime < 15_000) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const status = await this.rpc
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .getSignatureStatuses([signature as any])
          .send();
        if (status?.value?.[0]) {
          const s = status.value[0];
          if (s.err) {
            if (isBenignConcurrencyRace(s.err)) {
              return {
                workerName,
                executed: false,
                reason: "State already progressed on-chain",
                outcome: {
                  status: "CONCURRENCY_RACE_LOST",
                  reason: "State already progressed on-chain",
                },
              };
            }
            const parsed = parseTransactionError(s.err);
            const codeStr =
              parsed.code !== undefined ? ` (${parsed.code})` : "";
            const reason = `Transaction reverted on-chain: ${parsed.title}${codeStr} - ${parsed.message}`;
            console.error(`[TxExecutor] [${workerName}] ${reason}`);
            return {
              workerName,
              executed: false,
              reason,
              outcome: {
                status: "ERROR",
                reason,
                parsedError: parsed,
                error: new Error(reason),
              },
            };
          }
          if (
            s.confirmationStatus === "confirmed" ||
            s.confirmationStatus === "finalized"
          ) {
            confirmed = true;
            break;
          }
        }

        // Active rebroadcast every 2s
        if ((Date.now() - startTime) % 2000 < 1000) {
          this.rpc
            .sendTransaction(wireTx, {
              encoding: "base64",
              skipPreflight: true,
            })
            .send()
            .catch(() => {});
        }
      }

      if (!confirmed) {
        const reason = `Transaction confirmation timed out after 15s. Signature: ${signature}`;
        console.error(`[TxExecutor] [${workerName}] ${reason}`);
        return {
          workerName,
          executed: false,
          reason,
          signature: signature || undefined,
          outcome: {
            status: "ERROR",
            reason,
            parsedError: parseTransactionError(new Error(reason)),
            error: new Error(reason),
          },
        };
      }

      return {
        workerName,
        executed: true,
        reason: "Confirmed successfully",
        signature,
        computeUnitsUsed: options.computeUnits,
        outcome: {
          status: "EXECUTED",
          signature,
          computeUnitsUsed: options.computeUnits,
        },
      };
    } catch (err: unknown) {
      if (isBenignConcurrencyRace(err)) {
        return {
          workerName,
          executed: false,
          reason: "State already progressed by competing replica",
          outcome: {
            status: "CONCURRENCY_RACE_LOST",
            reason: "State already progressed by competing replica",
          },
        };
      }

      const parsed = parseTransactionError(err);
      const codeStr = parsed.code !== undefined ? ` (${parsed.code})` : "";
      const reason = `Failed to land transaction: ${parsed.title}${codeStr} - ${parsed.message}`;
      console.error(`[TxExecutor] [${workerName}] ${reason}`);
      return {
        workerName,
        executed: false,
        reason,
        outcome: {
          status: "ERROR",
          reason,
          parsedError: parsed,
          error: err instanceof Error ? err : new Error(String(err)),
        },
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
