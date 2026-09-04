import { formatTokenAmount, USDC_DECIMALS } from "./formatters";
import type { ActivityEntry, ActivityType } from "../types";

export type ActivityFormatParams =
  | {
      activityType: "deposit";
      amountUsdc: bigint | number;
      bonds?: number | null;
      decimals?: number;
    }
  | {
      activityType: "withdraw";
      amountUsdc: bigint | number;
      bonds?: number | null;
      decimals?: number;
    }
  | {
      activityType: "auto-reinvest";
      amountUsdc: bigint | number;
      bonds?: number | null;
      cycleId?: number | null;
      decimals?: number;
    }
  | {
      activityType: "win";
      amountUsdc: bigint | number;
      decimals?: number;
    }
  | {
      activityType: "claim-redemption";
      amountUsdc: bigint | number;
      redemptionType?: "bond_sale" | "fee_withdrawal" | "prize_claim";
      decimals?: number;
    }
  | {
      activityType: ActivityType | string;
      amountUsdc: bigint | number;
      bonds?: number | null;
      cycleId?: number | null;
      decimals?: number;
      redemptionType?: "bond_sale" | "fee_withdrawal" | "prize_claim";
    };

export function formatActivityDescription(
  params: ActivityFormatParams
): string {
  const numAmount =
    typeof params.amountUsdc === "bigint"
      ? Number(params.amountUsdc)
      : params.amountUsdc;
  const formatted = formatTokenAmount(
    numAmount,
    params.decimals ?? USDC_DECIMALS,
    2,
    2
  );

  switch (params.activityType) {
    case "deposit":
      return `Deposited ${formatted} USDC → +${params.bonds ?? 0} tickets`;
    case "withdraw":
      return `Sold ${params.bonds ?? 0} bonds (${formatted} USDC) · Pending settle`;
    case "auto-reinvest":
      return `Draw #${params.cycleId ?? 0} reinvested: +${params.bonds ?? 0} tickets from ${formatted} USDC`;
    case "win":
      return `Claimed accumulated winnings of ${formatted} USDC · Pending settle`;
    case "claim-redemption": {
      const label =
        params.redemptionType === "bond_sale"
          ? "bond principal"
          : params.redemptionType === "fee_withdrawal"
            ? "fees"
            : params.redemptionType === "prize_claim"
              ? "prize winnings"
              : "redemption";
      return `Claimed settled ${label} of ${formatted} USDC to wallet`;
    }
    default:
      return `${(params as { activityType: string }).activityType}: ${formatted} USDC`;
  }
}

export type CreateOptimisticActivityParams = ActivityFormatParams & {
  txSignature: string;
  customId?: string;
};

export function createOptimisticActivity(
  params: CreateOptimisticActivityParams
): ActivityEntry {
  const numAmount =
    typeof params.amountUsdc === "bigint"
      ? Number(params.amountUsdc)
      : params.amountUsdc;

  return {
    id:
      params.customId ??
      `act-${params.activityType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: new Date().toISOString(),
    type: params.activityType as ActivityType,
    description: formatActivityDescription(params),
    amount: numAmount,
    txSignature: params.txSignature,
  };
}

export interface StoredOptimisticEntry extends ActivityEntry {
  createdAt: number;
  txSignature: string;
}

export function mergeActivityEntries(
  localEntries: readonly StoredOptimisticEntry[],
  apiEntries: ActivityEntry[],
  now: number = Date.now(),
  ttlMs: number = 120_000
): ActivityEntry[] {
  const onChainSignatures = new Set(
    apiEntries.map((e) => e.txSignature).filter((s): s is string => Boolean(s))
  );

  // 1. Filter local entries: must not match on-chain sig and must not be expired by TTL
  const activeLocal = localEntries.filter(
    (entry) =>
      Boolean(entry.txSignature) &&
      !onChainSignatures.has(entry.txSignature) &&
      now - entry.createdAt < ttlMs
  );

  // 2. Deduplicate apiEntries strictly by canonical item.id
  const seenIds = new Set<string>();
  const dedupedApiEntries: ActivityEntry[] = [];
  for (const item of apiEntries) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      dedupedApiEntries.push(item);
    }
  }

  return [...activeLocal, ...dedupedApiEntries];
}
