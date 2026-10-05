import {
  Address,
  address,
  createSolanaRpc,
  Instruction,
  KeyPairSigner,
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
  ANCHOR_ERROR__POOL_NOT_ACTIVE,
  ANCHOR_ERROR__CYCLE_NOT_ENDED,
  ANCHOR_ERROR__AWAITING_RANDOMNESS_FREEZE,
  ANCHOR_ERROR__ALREADY_CLAIMED,
  ANCHOR_ERROR__INVALID_DRAW_STATUS,
  ANCHOR_ERROR__INVALID_DRAW_STATE,
  ANCHOR_ERROR__RANDOMNESS_NOT_EXPIRED,
  ANCHOR_ERROR__POOL_NOT_FROZEN,
  ANCHOR_ERROR__POOL_PAUSED,
  ANCHOR_ERROR__POOL_CLOSED,
  ANCHOR_ERROR__DRAW_VOIDED,
  ANCHOR_ERROR__DRAW_ALREADY_VOIDED,
  ANCHOR_ERROR__PAYOUT_TIMELOCK_ACTIVE,
  ANCHOR_ERROR__PAYOUTS_PENDING,
} from "../../../app/lib/errors";
import { normalizeInstructionSigners } from "../../../app/lib/tx-utils";
import { CrankConfig } from "../config";
import {
  WorkerExecutionResult,
  WorkerDeferredOutcome,
  ExecuteInstructionsParams,
  PriorityFeeTier,
} from "../types";

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
  from: Address | KeyPairSigner;
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
const BENIGN_RACE_ERROR_CODES = new Set<number>([
  3000, // AccountAlreadyInitialized (0xbb8 - competing reveal or harvest init PDA race)
  3012, // AccountNotInitialized (0xbc4 - closed by competing crank or CLI)
  ANCHOR_ERROR__POOL_NOT_ACTIVE, // 6000 (0x1770)
  ANCHOR_ERROR__CYCLE_NOT_ENDED, // 6002 (0x1772 - competing harvest advanced cycle)
  ANCHOR_ERROR__AWAITING_RANDOMNESS_FREEZE, // 6007 (0x1777)
  ANCHOR_ERROR__ALREADY_CLAIMED, // 6008 (0x1778)
  ANCHOR_ERROR__INVALID_DRAW_STATUS, // 6015 (0x177f - admin force-unlocked/voided in flight)
  ANCHOR_ERROR__INVALID_DRAW_STATE, // 6016 (0x1780 - draw preparation cursor race)
  ANCHOR_ERROR__RANDOMNESS_NOT_EXPIRED, // 6031 (0x178f)
  ANCHOR_ERROR__POOL_NOT_FROZEN, // 6035 (0x1793 - draw concluded in flight)
  ANCHOR_ERROR__POOL_PAUSED, // 6039 (0x1797)
  ANCHOR_ERROR__POOL_CLOSED, // 6040 (0x1798)
  ANCHOR_ERROR__DRAW_VOIDED, // 6041 (0x1799)
  ANCHOR_ERROR__DRAW_ALREADY_VOIDED, // 6042 (0x179a)
  ANCHOR_ERROR__PAYOUT_TIMELOCK_ACTIVE, // 6044 (0x179c)
  ANCHOR_ERROR__PAYOUTS_PENDING, // 6063 (0x17af)
]);

const BENIGN_RACE_PATTERNS: readonly string[] = [
  "already claimed",
  "already prepared",
  "already revealed",
  "already harvested",
  "already processed",
  "already in use",
  "accountalreadyinitialized",
  "0xbb8",
  "accountnotinitialized",
  "0xbc4",
  "invaliddrawstate",
  "0x1780",
  "cyclenotended",
  "0x1772",
  "this draw has been voided",
  "drawvoided",
  "0x1799",
  "invalid draw status",
  "invaliddrawstatus",
  "0x177f",
  "pool is paused",
  "poolpaused",
  "0x1797",
  "pool is closed",
  "poolclosed",
  "0x1798",
  "poolnotfrozen",
  "0x1793",
  "payouttimelockactive",
  "0x179c",
  "payoutspending",
  "0x17af",
  "0x1778",
  "custom program error: 0x1778",
];

export function matchesBenignPattern(text: string): boolean {
  const lower = text.toLowerCase();
  return BENIGN_RACE_PATTERNS.some((pattern) => lower.includes(pattern));
}

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
    if (matchesBenignPattern(String(err))) {
      return true;
    }
  }
  if (logs && logs.length > 0) {
    const matchedLog = matchAnchorError(logs);
    if (matchedLog && BENIGN_RACE_ERROR_CODES.has(matchedLog.code)) {
      return true;
    }
    if (matchesBenignPattern(logs.join(" "))) {
      return true;
    }
  }
  return false;
}

export function isVenueLiquidityDeficit(
  err: unknown,
  logs?: readonly string[]
): boolean {
  if (!err && (!logs || logs.length === 0)) return false;
  if (err) {
    const matched = matchAnchorError(err);
    if (matched && matched.code === 6066) {
      return true;
    }
    const str = String(err).toLowerCase();
    if (
      str.includes("insufficientvaultbalance") ||
      str.includes("insufficient balance to settle redemption") ||
      str.includes("0x17b2") ||
      str.includes("custom program error: 0x17b2") ||
      str.includes("error code: 6066") ||
      str.includes("error number: 6066")
    ) {
      return true;
    }
  }
  if (logs && logs.length > 0) {
    const matchedLog = matchAnchorError(logs);
    if (matchedLog && matchedLog.code === 6066) {
      return true;
    }
    const fullLogs = logs.join(" ").toLowerCase();
    if (
      fullLogs.includes("insufficientvaultbalance") ||
      fullLogs.includes("insufficient balance to settle redemption") ||
      fullLogs.includes("0x17b2") ||
      fullLogs.includes("custom program error: 0x17b2") ||
      fullLogs.includes("error code: 6066") ||
      fullLogs.includes("error number: 6066")
    ) {
      return true;
    }
  }
  return false;
}

export function classifyDeferral(
  err: unknown,
  logs?: readonly string[]
): WorkerDeferredOutcome | null {
  if (isBenignConcurrencyRace(err, logs)) {
    return {
      status: "CONCURRENCY_RACE_LOST",
      reason: "State already progressed by competing replica",
    };
  }

  if (isVenueLiquidityDeficit(err, logs)) {
    const mutableLogs = logs ? [...logs] : undefined;
    const parsed = parseTransactionError(err, mutableLogs);
    const numericCode =
      typeof parsed.code === "number"
        ? parsed.code
        : typeof parsed.code === "string"
          ? parseInt(parsed.code, 10) || 6066
          : 6066;
    return {
      status: "VENUE_LIQUIDITY_DEFICIT",
      reason:
        parsed.message ||
        "Pool vault has insufficient balance to settle redemption",
      code: numericCode,
      logs,
    };
  }

  return null;
}

export function buildFailureResult(
  workerName: string,
  err: unknown,
  logs?: readonly string[],
  fallbackPrefix?: string
): WorkerExecutionResult {
  const deferral = classifyDeferral(err, logs);
  if (deferral) {
    return {
      workerName,
      executed: false,
      reason: deferral.reason,
      outcome: deferral,
    };
  }

  const mutableLogs = logs ? [...logs] : undefined;
  const parsed = parseTransactionError(err, mutableLogs);
  const codeStr = parsed.code !== undefined ? ` (${parsed.code})` : "";
  const prefix = fallbackPrefix ? `${fallbackPrefix}: ` : "";
  const reason = `${prefix}${parsed.title}${codeStr} - ${parsed.message}`;
  return {
    workerName,
    executed: false,
    reason,
    outcome: {
      status: "ERROR",
      reason,
      parsedError: parsed,
      logs,
      error: err instanceof Error ? err : new Error(reason),
    },
    error: err instanceof Error ? err : new Error(reason),
  };
}

export class TransactionExecutor {
  constructor(
    private readonly rpc: ReturnType<typeof createSolanaRpc>,
    private readonly config: CrankConfig
  ) {}

  async estimatePriorityFee(
    writableAccounts: readonly Address[],
    tier: PriorityFeeTier = "medium"
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
    params: ExecuteInstructionsParams
  ): Promise<WorkerExecutionResult>;
  async executeInstructions(
    workerName: string,
    instructions: readonly Instruction[],
    signer: KeyPairSigner,
    options?: {
      computeUnits: number;
      priorityFeeTier?: PriorityFeeTier;
      writableAccounts?: readonly Address[];
      additionalSigners?: readonly KeyPairSigner[];
    }
  ): Promise<WorkerExecutionResult>;
  async executeInstructions(
    arg1: string | ExecuteInstructionsParams,
    arg2?: readonly Instruction[],
    arg3?: KeyPairSigner,
    arg4?: {
      computeUnits: number;
      priorityFeeTier?: PriorityFeeTier;
      writableAccounts?: readonly Address[];
      additionalSigners?: readonly KeyPairSigner[];
    }
  ): Promise<WorkerExecutionResult> {
    const params: ExecuteInstructionsParams =
      typeof arg1 === "string"
        ? {
            workerName: arg1,
            instructions: arg2 || [],
            signer: arg3!,
            computeUnits: arg4?.computeUnits || 200_000,
            priorityFeeTier: arg4?.priorityFeeTier || "medium",
            writableAccounts: arg4?.writableAccounts,
            additionalSigners: arg4?.additionalSigners,
          }
        : arg1;

    const {
      workerName,
      instructions,
      signer,
      computeUnits,
      priorityFeeTier,
      writableAccounts,
      additionalSigners,
    } = params;

    if (this.config.dryRun) {
      console.log(
        `[DRY RUN] [${workerName}] Would execute ${instructions.length} instructions (CU limit: ${computeUnits})`
      );
      return {
        workerName,
        executed: true,
        reason: "Simulated in DRY_RUN mode",
        signature: "dry_run_mock_signature",
        computeUnitsUsed: computeUnits,
        outcome: {
          status: "EXECUTED",
          signature: "dry_run_mock_signature",
          computeUnitsUsed: computeUnits,
        },
      };
    }

    try {
      const priorityMicroLamports = await this.estimatePriorityFee(
        writableAccounts || [],
        priorityFeeTier || "medium"
      );

      const cuLimitIx = createSetComputeUnitLimitInstruction(computeUnits);
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

      const allSigners = [signer, ...(additionalSigners || [])];
      const normalizedInstructions = normalizeInstructionSigners(
        fullInstructions,
        allSigners
      );

      const { value: latestBlockhash } = await this.rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send();

      const msg = appendTransactionMessageInstructions(
        normalizedInstructions,
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
        const failure = buildFailureResult(
          workerName,
          simRes.value.err,
          logs,
          "Simulation failed"
        );
        if (failure.outcome.status === "CONCURRENCY_RACE_LOST") {
          console.log(
            `[TxExecutor] [${workerName}] Preflight simulation benign concurrency race lost: state already progressed.`
          );
        } else if (failure.outcome.status === "VENUE_LIQUIDITY_DEFICIT") {
          console.warn(
            `[TxExecutor] [${workerName}] Preflight simulation deferred due to venue liquidity deficit: ${failure.reason}`
          );
        } else {
          console.error(`[TxExecutor] [${workerName}] ${failure.reason}`, logs);
        }
        return failure;
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
            const failure = buildFailureResult(
              workerName,
              s.err,
              undefined,
              "Transaction reverted on-chain"
            );
            if (failure.outcome.status === "CONCURRENCY_RACE_LOST") {
              console.log(
                `[TxExecutor] [${workerName}] State already progressed on-chain.`
              );
            } else if (failure.outcome.status === "VENUE_LIQUIDITY_DEFICIT") {
              console.warn(
                `[TxExecutor] [${workerName}] Transaction deferred due to venue liquidity deficit: ${failure.reason}`
              );
            } else {
              console.error(`[TxExecutor] [${workerName}] ${failure.reason}`);
            }
            return failure;
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
        computeUnitsUsed: computeUnits,
        outcome: {
          status: "EXECUTED",
          signature,
          computeUnitsUsed: computeUnits,
        },
      };
    } catch (err: unknown) {
      const failure = buildFailureResult(
        workerName,
        err,
        undefined,
        "Failed to land transaction"
      );
      if (failure.outcome.status === "CONCURRENCY_RACE_LOST") {
        console.log(
          `[TxExecutor] [${workerName}] State already progressed by competing replica.`
        );
      } else if (failure.outcome.status === "VENUE_LIQUIDITY_DEFICIT") {
        console.warn(
          `[TxExecutor] [${workerName}] Deferred due to venue liquidity deficit: ${failure.reason}`
        );
      } else {
        console.error(`[TxExecutor] [${workerName}] ${failure.reason}`);
      }
      return failure;
    }
  }
}
