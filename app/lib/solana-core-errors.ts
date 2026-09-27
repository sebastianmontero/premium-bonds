import {
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  SOLANA_ERROR__INSTRUCTION_ERROR__COMPUTATIONAL_BUDGET_EXCEEDED,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT,
  SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS,
} from "@solana/kit";
import type { ErrorCategory, ErrorLayer } from "./errors";
import { toNumericCode } from "./errors";

export interface SolanaCoreErrorInfo {
  readonly name: string;
  readonly category: ErrorCategory;
  readonly layer: ErrorLayer;
  readonly title: string;
  readonly message: string;
  readonly actionableStep?: string;
  readonly displayCode?: string | number;
}

export const SOLANA_CORE_ERRORS: Readonly<Record<number, SolanaCoreErrorInfo>> =
  Object.freeze({
    [SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED]: {
      name: "BlockHeightExceeded",
      category: "blockhash_expired",
      layer: "rpc",
      title: "Request Timed Out",
      message:
        "The network was busy and the transaction could not be confirmed in time.",
      actionableStep:
        "Click retry to submit a fresh transaction with an updated blockhash.",
      displayCode: "EXPIRED_BLOCKHASH",
    },
    [SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND]: {
      name: "BlockhashNotFound",
      category: "blockhash_expired",
      layer: "rpc",
      title: "Request Timed Out",
      message:
        "Wallet approval took longer than 60 seconds and the transaction expired.",
      actionableStep: "Click retry and approve the wallet prompt promptly.",
      displayCode: "EXPIRED_BLOCKHASH",
    },
    [SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME]: {
      name: "ExpectedBlockhashLifetime",
      category: "blockhash_expired",
      layer: "rpc",
      title: "Request Timed Out",
      message: "The transaction blockhash lifetime expired.",
      actionableStep:
        "Click retry to send a fresh transaction and approve the prompt in your wallet.",
      displayCode: "EXPIRED_BLOCKHASH",
    },
    [SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED]: {
      name: "AlreadyProcessed",
      category: "duplicate_transaction",
      layer: "rpc",
      title: "Transaction Already Processed",
      message:
        "This transaction was already submitted and processed by the network.",
      actionableStep:
        "If retrying, create a fresh transaction with a new blockhash.",
      displayCode: -32002,
    },
    [SOLANA_ERROR__INSTRUCTION_ERROR__COMPUTATIONAL_BUDGET_EXCEEDED]: {
      name: "ComputeBudgetExceeded",
      category: "network_rpc",
      layer: "rpc",
      title: "Compute Budget Exceeded",
      message:
        "Transaction execution ran out of compute units before completing.",
      actionableStep:
        "Retry the transaction with higher priority fees or a larger compute budget.",
      displayCode: "COMPUTE_BUDGET_EXCEEDED",
    },
    [SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE]: {
      name: "InsufficientFundsForFee",
      category: "insufficient_sol",
      layer: "system",
      title: "Insufficient SOL",
      message: "Your wallet balance is too low to cover network gas fees.",
      actionableStep: "Add SOL to your wallet to pay for transaction fees.",
      displayCode: "0x1",
    },
    [SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT]: {
      name: "InsufficientFundsForRent",
      category: "insufficient_sol",
      layer: "system",
      title: "Insufficient SOL",
      message:
        "Your wallet balance is too low to cover minimum rent exemption for new accounts.",
      actionableStep: "Add SOL to your wallet to pay for account rent.",
      displayCode: "0x1",
    },
    [SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS]: {
      name: "InsufficientFunds",
      category: "insufficient_sol",
      layer: "system",
      title: "Insufficient SOL",
      message:
        "The instruction failed due to insufficient lamports in the account.",
      actionableStep:
        "Add SOL to your wallet to pay for transaction fees or account balance.",
      displayCode: "0x1",
    },
  });

export function matchSolanaCoreError(
  codes: readonly (number | string)[]
): { readonly code: number; readonly info: SolanaCoreErrorInfo } | null {
  for (const rawCode of codes) {
    const code = toNumericCode(rawCode);
    if (code !== null && SOLANA_CORE_ERRORS[code]) {
      return { code, info: SOLANA_CORE_ERRORS[code] };
    }
  }
  return null;
}
