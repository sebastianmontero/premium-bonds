import { formatCurrency, USDC_DECIMALS } from "./formatters";
import type { ActivityEntry, ActivityType, PrizeHistoryEntry } from "../types";
import type { ReinvestmentBreakdown } from "./draw-helpers";

export type ReinvestScenario =
  | "dust_only"
  | "pure_dust_compound"
  | "compounded_with_remaining"
  | "compounded_exact"
  | "leftover_dust"
  | "pure_reinvestment";

export function classifyReinvestScenario(params: {
  bonds?: number | null;
  amountUsdc?: number | bigint | null;
  usedPriorDustUsdc?: number | bigint | null;
  claimableUsdc?: number | bigint | null;
}): ReinvestScenario {
  const bonds = Number(params.bonds ?? 0);
  const amount = Number(params.amountUsdc ?? 0);
  const usedDust = Number(params.usedPriorDustUsdc ?? 0);
  const claimable = Number(params.claimableUsdc ?? 0);

  if (bonds <= 0) return "dust_only";
  if (usedDust > 0) {
    if (amount <= 0) return "pure_dust_compound";
    return claimable > 0 ? "compounded_with_remaining" : "compounded_exact";
  }
  if (claimable > 0) return "leftover_dust";
  return "pure_reinvestment";
}

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
      claimableUsdc?: bigint | number | null;
      usedPriorDustUsdc?: bigint | number | null;
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
      claimableUsdc?: bigint | number | null;
      usedPriorDustUsdc?: bigint | number | null;
    };

export function formatActivityDescription(
  params: ActivityFormatParams
): string {
  const formatted = formatCurrency(params.amountUsdc, {
    decimals: params.decimals ?? USDC_DECIMALS,
    style: "standard",
  });

  switch (params.activityType) {
    case "deposit":
      return `Deposited ${formatted} → +${params.bonds ?? 0} tickets`;
    case "withdraw":
      return `Sold ${params.bonds ?? 0} bonds (${formatted}) · Pending settle`;
    case "auto-reinvest": {
      const claimableNum =
        params.claimableUsdc != null
          ? typeof params.claimableUsdc === "bigint"
            ? Number(params.claimableUsdc)
            : params.claimableUsdc
          : 0;
      const usedDustNum =
        params.usedPriorDustUsdc != null
          ? typeof params.usedPriorDustUsdc === "bigint"
            ? Number(params.usedPriorDustUsdc)
            : params.usedPriorDustUsdc
          : 0;

      const hasClaimable = claimableNum > 0;
      const hasUsedDust = usedDustNum > 0;

      const claimableFormatted = hasClaimable
        ? formatCurrency(claimableNum, {
            decimals: params.decimals ?? USDC_DECIMALS,
            style: "standard",
          })
        : null;

      const usedDustFormatted = hasUsedDust
        ? formatCurrency(usedDustNum, {
            decimals: params.decimals ?? USDC_DECIMALS,
            style: "standard",
          })
        : null;

      const bondsCount = params.bonds ?? 0;
      const ticketText =
        bondsCount === 1 ? "1 ticket" : `${bondsCount} tickets`;
      const scenario = classifyReinvestScenario(params);
      switch (scenario) {
        case "dust_only":
          return `Draw #${params.cycleId ?? 0} prize: ${formatted} credited to claimable balance`;
        case "pure_dust_compound":
          return `Draw #${params.cycleId ?? 0} reinvested: +${ticketText} from ${usedDustFormatted} claimable balance`;
        case "compounded_with_remaining":
          return `Draw #${params.cycleId ?? 0} reinvested: +${ticketText} (${formatted} prize + ${usedDustFormatted} claimable used · ${claimableFormatted} remaining)`;
        case "compounded_exact":
          return `Draw #${params.cycleId ?? 0} reinvested: +${ticketText} (${formatted} prize + ${usedDustFormatted} claimable used)`;
        case "leftover_dust":
          return `Draw #${params.cycleId ?? 0} reinvested: +${ticketText} from ${formatted} (${claimableFormatted} claimable balance)`;
        case "pure_reinvestment":
          return `Draw #${params.cycleId ?? 0} reinvested: +${ticketText} from ${formatted}`;
      }
    }
    case "win":
      return `Claimed accumulated winnings of ${formatted} · Pending settle`;
    case "claim-redemption": {
      const label =
        params.redemptionType === "bond_sale"
          ? "bond principal"
          : params.redemptionType === "fee_withdrawal"
            ? "fees"
            : params.redemptionType === "prize_claim"
              ? "prize winnings"
              : "redemption";
      return `Claimed settled ${label} of ${formatted} to wallet`;
    }
    default:
      return `${(params as { activityType: string }).activityType}: ${formatted}`;
  }
}

export type CreateOptimisticActivityParams = ActivityFormatParams & {
  txSignature: string;
  customId?: string;
};

export interface CreateOptimisticReinvestParams {
  entry: Pick<PrizeHistoryEntry, "amount" | "drawCycleId">;
  breakdown: ReinvestmentBreakdown;
  txSignature: string;
  decimals?: number;
  customId?: string;
}

/**
 * Cohesive factory eliminating Data Clumps across useCrankPrize and dashboard/page.tsx.
 */
export function createOptimisticReinvestActivity({
  entry,
  breakdown,
  txSignature,
  decimals,
  customId,
}: CreateOptimisticReinvestParams): ActivityEntry {
  return createOptimisticActivity({
    activityType: "auto-reinvest",
    bonds: breakdown.bondsBought,
    amountUsdc: entry.amount,
    claimableUsdc: breakdown.remainingDust,
    usedPriorDustUsdc: breakdown.usedPriorDust,
    cycleId: entry.drawCycleId,
    decimals,
    txSignature,
    customId,
  });
}

export function createOptimisticActivity(
  params: CreateOptimisticActivityParams
): ActivityEntry {
  const numAmount =
    typeof params.amountUsdc === "bigint"
      ? Number(params.amountUsdc)
      : params.amountUsdc;

  const bonds = "bonds" in params ? params.bonds : undefined;
  const cycleId = "cycleId" in params ? params.cycleId : undefined;
  const redemptionType =
    "redemptionType" in params ? params.redemptionType : undefined;
  const rawClaimable =
    "claimableUsdc" in params ? params.claimableUsdc : undefined;
  const claimableUsdc =
    rawClaimable != null
      ? typeof rawClaimable === "bigint"
        ? Number(rawClaimable)
        : rawClaimable
      : undefined;
  const rawUsedDust =
    "usedPriorDustUsdc" in params ? params.usedPriorDustUsdc : undefined;
  const usedPriorDustUsdc =
    rawUsedDust != null
      ? typeof rawUsedDust === "bigint"
        ? Number(rawUsedDust)
        : rawUsedDust
      : undefined;

  return {
    id:
      params.customId ??
      `act-${params.activityType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: new Date().toISOString(),
    type: params.activityType as ActivityType,
    description: formatActivityDescription(params),
    amount: numAmount,
    txSignature: params.txSignature,
    metadata: {
      bonds,
      cycleId,
      redemptionType,
      amountUsdc: numAmount,
      claimableUsdc,
      usedPriorDustUsdc,
    },
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

export interface ActivityFilterCriteria {
  type?: string;
  search?: string;
}

export function matchesActivityFilter(
  entry: ActivityEntry,
  criteria: ActivityFilterCriteria
): boolean {
  if (
    criteria.type &&
    criteria.type !== "all" &&
    entry.type !== criteria.type
  ) {
    return false;
  }

  if (criteria.search) {
    const term = criteria.search.trim().toLowerCase();
    if (term) {
      const cleanNumeric = term.replace(/^#/, "").trim();
      const matchesDescription = entry.description.toLowerCase().includes(term);
      const matchesId = entry.id.toLowerCase().includes(term);
      const matchesSig = Boolean(
        entry.txSignature?.toLowerCase().includes(term)
      );
      const matchesNum =
        cleanNumeric !== "" &&
        !isNaN(Number(cleanNumeric)) &&
        entry.description.includes(cleanNumeric);

      if (!matchesDescription && !matchesId && !matchesSig && !matchesNum) {
        return false;
      }
    }
  }

  return true;
}

export function filterActivityEntries<T extends ActivityEntry>(
  entries: readonly T[],
  criteria: ActivityFilterCriteria
): T[] {
  return entries.filter((entry) => matchesActivityFilter(entry, criteria));
}
