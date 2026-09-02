import type { SelectOption } from "../components/common/CustomSelect";
import { DrawCycleInfo, PayoutRegistryInfo } from "./bonds-sdk";
import { deriveRandomIndex, formatSeedHex } from "./vrf-utils";
import type {
  DrawWinnerRecord,
  DrawCycleSummary,
  DrawStatusName,
  DrawStatusArchetype,
  PrizeHistoryEntry,
} from "../types";

/**
 * Single source of truth for canonical draw lifecycle priority order.
 */
export const CANONICAL_DRAW_STATUS_ORDER: readonly DrawStatusName[] = [
  "Complete",
  "AwaitingRandomness",
  "AwaitingYield",
  "Skipped",
  "ForceUnlocked",
  "Voided",
  "HaltedInsolvent",
  "HaltedYieldSpike",
] as const;

/**
 * Type guard for validating DrawStatusName at runtime.
 */
export function isDrawStatusName(val: unknown): val is DrawStatusName {
  return (
    typeof val === "string" &&
    CANONICAL_DRAW_STATUS_ORDER.includes(val as DrawStatusName)
  );
}

/**
 * Categorizes an on-chain DrawStatusName into one of 4 domain archetypes.
 */
export function getDrawArchetype(
  status: DrawStatusName | string
): DrawStatusArchetype {
  if (status === "Complete" || status === "Voided") return "payout-bearing";
  if (status === "Skipped") return "skipped";
  if (status === "AwaitingYield" || status === "AwaitingRandomness")
    return "in-flight";
  return "intervention";
}

/**
 * Determines whether a draw status can have an initialized on-chain PayoutRegistry PDA.
 */
export function hasPayoutRegistryPda(status: DrawStatusName | string): boolean {
  return status === "Complete" || status === "Voided";
}

/**
 * Checks whether a status represents a circuit breaker halt.
 */
export function isHaltedStatus(status: DrawStatusName | string): boolean {
  return status === "HaltedInsolvent" || status === "HaltedYieldSpike";
}

/**
 * Maps on-chain DrawStatusName to translation keys in messages/*.json under "DrawHistory".
 */
export const DRAW_STATUS_TRANSLATION_KEYS: Record<DrawStatusName, string> = {
  Complete: "statusComplete",
  AwaitingRandomness: "statusAwaitingVRF",
  AwaitingYield: "statusAwaitingYield",
  Skipped: "statusSkipped",
  ForceUnlocked: "statusForceUnlocked",
  Voided: "statusVoided",
  HaltedInsolvent: "statusHaltedInsolvent",
  HaltedYieldSpike: "statusHaltedYieldSpike",
};

/**
 * Resolves the translation key for any draw status with fallback.
 */
export function getDrawStatusTranslationKey(
  status: DrawStatusName | string
): string | undefined {
  return DRAW_STATUS_TRANSLATION_KEYS[status as DrawStatusName];
}

export type SkippedDrawReason = "zero-tickets" | "below-threshold";

/**
 * Determines whether a draw was skipped due to zero active tickets or insufficient yield.
 * Returns undefined if the draw status is explicitly provided and is not "Skipped".
 */
export function getSkippedDrawReason(draw?: {
  status?: DrawStatusName | string;
  lockedTicketCount?: number | bigint;
}): SkippedDrawReason | undefined {
  if (draw?.status !== undefined && draw.status !== "Skipped") {
    return undefined;
  }
  const count = Number(draw?.lockedTicketCount);
  if (!Number.isFinite(count) || count <= 0) {
    return "zero-tickets";
  }
  return "below-threshold";
}

/**
 * Resolves the translation key explaining why verifiable randomness was not requested or used.
 */
export function getNoRandomnessExplanationKey(draw?: {
  status?: DrawStatusName | string;
  lockedTicketCount?: number | bigint;
}):
  | "noRandomnessSkippedNoTicketsSub"
  | "noRandomnessSkippedSub"
  | "noRandomnessGeneralSub" {
  if (draw?.status === "Skipped") {
    const reason = getSkippedDrawReason(draw);
    return reason === "zero-tickets"
      ? "noRandomnessSkippedNoTicketsSub"
      : "noRandomnessSkippedSub";
  }
  return "noRandomnessGeneralSub";
}

/**
 * Dynamically builds status filter options with counts from a draws array,
 * canonically ordered and localized.
 */
export function buildDrawStatusOptions(
  draws: Pick<DrawCycleSummary, "status">[],
  t: (key: string) => string
): SelectOption<string>[] {
  const totalCount = draws.length;
  const counts = new Map<string, number>();

  for (const d of draws) {
    counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
  }

  const options: SelectOption<string>[] = [
    {
      value: "all",
      label: `${t("allStatuses")} (${totalCount})`,
    },
  ];

  // Canonical priority sort with deterministic alphabetical fallback for unknown statuses
  const distinctStatuses = Array.from(counts.keys()).sort((a, b) => {
    const idxA = CANONICAL_DRAW_STATUS_ORDER.indexOf(a as DrawStatusName);
    const idxB = CANONICAL_DRAW_STATUS_ORDER.indexOf(b as DrawStatusName);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  for (const status of distinctStatuses) {
    const count = counts.get(status) ?? 0;
    const translationKey = getDrawStatusTranslationKey(status);
    const statusLabel = translationKey ? t(translationKey) : status;

    options.push({
      value: status,
      label: `${statusLabel} (${count})`,
    });
  }

  return options;
}

/**
 * Normalizes a DrawCycle account and optional PayoutRegistry account into a DrawCycleSummary.
 */
export function formatDrawCycleSummary(
  drawCycle: DrawCycleInfo,
  payout?: PayoutRegistryInfo
): DrawCycleSummary {
  const winnersCount = payout ? payout.winnersCount : 0;
  const payoutsCompleted = payout ? payout.payoutsCompleted : 0;

  // Handle both bigint and number for revealedAt
  const revealedAtNum =
    payout && payout.revealedAt !== undefined
      ? typeof payout.revealedAt === "bigint"
        ? payout.revealedAt > 0n
          ? Number(payout.revealedAt)
          : undefined
        : payout.revealedAt > 0
          ? Number(payout.revealedAt)
          : undefined
      : undefined;

  const initiatedAtNum =
    drawCycle.initiatedAt !== undefined
      ? typeof drawCycle.initiatedAt === "bigint"
        ? drawCycle.initiatedAt > 0n
          ? Number(drawCycle.initiatedAt)
          : undefined
        : drawCycle.initiatedAt > 0
          ? Number(drawCycle.initiatedAt)
          : undefined
      : undefined;

  const completedAtNum =
    drawCycle.completedAt !== undefined
      ? typeof drawCycle.completedAt === "bigint"
        ? drawCycle.completedAt > 0n
          ? Number(drawCycle.completedAt)
          : undefined
        : drawCycle.completedAt > 0
          ? Number(drawCycle.completedAt)
          : undefined
      : undefined;

  return {
    poolId: drawCycle.poolId,
    cycleId: drawCycle.cycleId,
    status: drawCycle.status,
    prizePot: Number(drawCycle.prizePot),
    cycleFeeCollected: Number(drawCycle.cycleFeeCollected),
    lockedTicketCount: drawCycle.lockedTicketCount,
    harvestSlot: Number(drawCycle.harvestSlot),
    randomnessAccount: drawCycle.randomnessAccount.toString(),
    randomnessSeed: drawCycle.randomnessSeed,
    vrfSeedHex: formatSeedHex(drawCycle.randomnessSeed),
    revealedAt: revealedAtNum,
    initiatedAt: initiatedAtNum,
    completedAt: completedAtNum,
    winnersCount,
    payoutsCompleted,
    hasPayoutRegistry: Boolean(payout),
  };
}

/**
 * Parses winner entries from PayoutRegistry and calculates derived winning ticket indices
 * matching on-chain derive_random_index(seed, tier_idx, slot_in_tier, cycle_id, locked_tickets).
 */
export async function parseWinnersWithVrf(
  payout: PayoutRegistryInfo,
  drawCycle: DrawCycleInfo
): Promise<DrawWinnerRecord[]> {
  const winners: DrawWinnerRecord[] = [];
  const tierWinnerCounts: Record<number, number> = {};

  for (let wi = 0; wi < payout.winnersCount; wi++) {
    const w = payout.winners[wi];
    const slotInTier = tierWinnerCounts[w.tierIndex] ?? 0;
    tierWinnerCounts[w.tierIndex] = slotInTier + 1;

    let winningTicketIndex: number | undefined;
    const allZero = drawCycle.randomnessSeed.every((b) => b === 0);
    if (!allZero && drawCycle.lockedTicketCount > 0) {
      try {
        winningTicketIndex = await deriveRandomIndex(
          drawCycle.randomnessSeed,
          w.tierIndex,
          slotInTier,
          drawCycle.cycleId,
          drawCycle.lockedTicketCount
        );
      } catch {
        // VRF index calculation non-fatal fallback
      }
    }

    winners.push({
      winnerIndex: wi,
      slotInTier,
      winnerAddress: w.winner ? w.winner.toString() : "Unknown",
      amountOwed: Number(w.amountOwed),
      bondsBought: w.bondsBought ?? 0,
      processed: Boolean(w.processed),
      tierIndex: w.tierIndex,
      winningTicketIndex,
    });
  }

  return winners;
}

/**
 * Resolves the effective timestamp (in seconds) and whether the date is estimated for a draw cycle.
 * Prioritizes on-chain revealedAt / completedAt, then initiatedAt, and falls back to cycle end estimation.
 */
export function resolveDrawCycleTimestamp(
  draw: {
    revealedAt?: number;
    completedAt?: number;
    initiatedAt?: number;
    cycleId?: number;
  },
  poolContext?: {
    currentCycleEndAt?: number;
    currentCycleId?: number;
    stakeCycleDurationHrs?: number;
  }
): { timestamp: number; isEstimated: boolean } {
  // 1. Authoritative completed timestamp (revealedAt or completedAt)
  if (draw.revealedAt && draw.revealedAt > 0) {
    return { timestamp: draw.revealedAt, isEstimated: false };
  }
  if (draw.completedAt && draw.completedAt > 0) {
    return { timestamp: draw.completedAt, isEstimated: false };
  }

  // 2. In-flight draw harvest/initiated timestamp
  if (draw.initiatedAt && draw.initiatedAt > 0) {
    return { timestamp: draw.initiatedAt, isEstimated: false };
  }

  // 3. Fallback to estimation based on pool cycle metadata
  const cycleDurationSeconds =
    (poolContext?.stakeCycleDurationHrs ?? 168) * 3600;
  if (
    poolContext?.currentCycleEndAt &&
    poolContext.currentCycleEndAt > 0 &&
    poolContext.currentCycleId !== undefined &&
    draw.cycleId !== undefined
  ) {
    const estimated =
      poolContext.currentCycleEndAt -
      (poolContext.currentCycleId - draw.cycleId) * cycleDurationSeconds;
    return { timestamp: Math.max(0, estimated), isEstimated: true };
  }

  return { timestamp: Math.floor(Date.now() / 1000), isEstimated: true };
}

/**
 * Formats a draw cycle's display date string with optional estimation prefix, UTC formatting,
 * and optional time inclusion.
 */
export function formatDrawDisplayDate(
  draw: {
    revealedAt?: number;
    completedAt?: number;
    initiatedAt?: number;
    cycleId?: number;
  },
  poolContext?: {
    currentCycleEndAt?: number;
    currentCycleId?: number;
    stakeCycleDurationHrs?: number;
  },
  options?: {
    estimatedPrefix?: string;
    includeTime?: boolean;
    locale?: string;
  }
): string {
  const { timestamp, isEstimated } = resolveDrawCycleTimestamp(
    draw,
    poolContext
  );
  const locale = options?.locale ?? "en-US";
  const dateObj = new Date(timestamp * 1000);

  const formatOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...(options?.includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      : {}),
  };

  const formattedDate = dateObj.toLocaleDateString(locale, formatOptions);
  const prefix =
    isEstimated && options?.estimatedPrefix
      ? `${options.estimatedPrefix} `
      : "";
  return `${prefix}${formattedDate}`;
}

/**
 * Backward compatibility wrapper for getDrawDateTimestamp.
 */
export function getDrawDateTimestamp(
  revealedAt?: number,
  currentCycleEndAt?: number,
  currentCycleId?: number,
  cycleId?: number,
  cycleDurationSeconds: number = 604800
): number {
  return resolveDrawCycleTimestamp(
    { revealedAt, cycleId },
    {
      currentCycleEndAt,
      currentCycleId,
      stakeCycleDurationHrs: cycleDurationSeconds / 3600,
    }
  ).timestamp;
}

/**
 * Checks whether a draw cycle utilized Switchboard VRF randomness for picking winners.
 * Returns false for Skipped, Halted, ForceUnlocked, uncompleted draws, or draws with all-zero seeds.
 */
export function hasDrawVrfRandomness(draw?: {
  status?: DrawStatusName | string;
  randomnessSeed?: Uint8Array;
  lockedTicketCount?: number;
}): boolean {
  if (!draw || draw.status !== "Complete") return false;
  if (!draw.randomnessSeed || draw.randomnessSeed.every((b) => b === 0))
    return false;
  if (!draw.lockedTicketCount || draw.lockedTicketCount <= 0) return false;
  return true;
}

/**
 * Calculates the amount of previously accumulated dust applied to purchase bonus bonds.
 */
export function calculatePriorDustApplied(
  bondsBought: number,
  amountWon: number,
  bondPrice: number = 5_000_000,
  usedPriorDust?: number
): number {
  if (usedPriorDust !== undefined && usedPriorDust > 0) return usedPriorDust;
  if (bondsBought <= 0 || bondPrice <= 0) return 0;
  return Math.max(0, bondsBought * bondPrice - amountWon);
}

/**
 * Encapsulates the complete settlement timelock state for a draw cycle or winner payout.
 */
export interface PayoutTimelockState {
  /** Whether the settlement timelock is currently active */
  isTimelocked: boolean;
  /** Unix timestamp (in seconds) when the timelock window expires */
  timelockExpiresAt: number;
  /** Remaining duration in seconds until crank settlement is permitted */
  remainingSeconds: number;
  /** Percentage (0-100) of the timelock window that has elapsed */
  progressPercent: number;
  /** Formatted countdown string (e.g. "04:12" or "1h 15m") */
  formattedRemaining: string;
  /** Formatted time string when the settlement unlocks */
  formattedUnlockTime: string;
}

/**
 * Calculates the live Payout Settlement Timelock state from on-chain timestamps.
 *
 * @param revealedAt - Unix timestamp (in seconds) when reveal_and_pick_winners was finalized.
 * @param payoutTimelockSeconds - Configured timelock duration in seconds (default: 300).
 * @param currentUnixTimestamp - Current Solana on-chain or local unix timestamp in seconds.
 * @returns PayoutTimelockState object.
 */
export function getPayoutTimelockState(
  revealedAt: number | undefined,
  payoutTimelockSeconds: number = 300,
  currentUnixTimestamp: number = Math.floor(Date.now() / 1000)
): PayoutTimelockState {
  if (!revealedAt || revealedAt <= 0 || payoutTimelockSeconds <= 0) {
    return {
      isTimelocked: false,
      timelockExpiresAt: 0,
      remainingSeconds: 0,
      progressPercent: 100,
      formattedRemaining: "00:00",
      formattedUnlockTime: "—",
    };
  }

  const timelockExpiresAt = revealedAt + payoutTimelockSeconds;
  const remainingSeconds = Math.max(
    0,
    timelockExpiresAt - currentUnixTimestamp
  );
  const isTimelocked = remainingSeconds > 0;
  const elapsed = payoutTimelockSeconds - remainingSeconds;
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((elapsed / payoutTimelockSeconds) * 100))
  );

  let formattedRemaining: string;
  if (remainingSeconds >= 3600) {
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    formattedRemaining = `${hours}h ${minutes}m`;
  } else {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    formattedRemaining = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  const unlockDate = new Date(timelockExpiresAt * 1000);
  const formattedUnlockTime = unlockDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return {
    isTimelocked,
    timelockExpiresAt,
    remainingSeconds,
    progressPercent,
    formattedRemaining,
    formattedUnlockTime,
  };
}

/**
 * Standard trailing RPC consensus grace period in milliseconds.
 */
export const RPC_PROPAGATION_GRACE_PERIOD_MS = 1200;

/**
 * Single source of truth for composite winner key formatting.
 */
export function getWinnerKey(drawCycleId: number, winnerIndex: number): string {
  return `${drawCycleId}-${winnerIndex}`;
}

/**
 * Breakdown of on-chain reinvestment bond purchasing and dust accounting.
 */
export interface ReinvestmentBreakdown {
  bondsBought: number;
  usedPriorDust: number;
  dustAccumulated: number;
  totalAvailable: number;
}

/**
 * Computes reinvestment bonds and dust accounting matching Anchor smart contract parity (reinvest_winnings.rs).
 *
 * @param amountWon - Current claimable prize amount owed in base units.
 * @param unclaimedDust - Previously accumulated unclaimed non-reinvested dust in base units.
 * @param bondPrice - Cost of 1 bond in base units (defaults to 5_000_000 / 5 USDC).
 * @param explicitBondsBought - Explicit count of bonds bought if known from on-chain event/data.
 */
export function calculateReinvestmentBreakdown(
  amountWon: number,
  unclaimedDust: number = 0,
  bondPrice: number = 5_000_000,
  explicitBondsBought?: number
): ReinvestmentBreakdown {
  const price = bondPrice > 0 ? bondPrice : 5_000_000;
  const totalAvailable = amountWon + (unclaimedDust > 0 ? unclaimedDust : 0);
  const bondsBought =
    explicitBondsBought !== undefined
      ? explicitBondsBought
      : Math.floor(totalAvailable / price);
  const totalCost = bondsBought * price;
  const usedPriorDust = totalCost > amountWon ? totalCost - amountWon : 0;
  const dustAccumulated = totalCost < amountWon ? amountWon - totalCost : 0;

  return {
    bondsBought,
    usedPriorDust,
    dustAccumulated,
    totalAvailable,
  };
}

/**
 * Machine-readable reason why an action is disabled.
 */
export type ActionDisabledReason =
  | "frozen_for_draw"
  | "timelocked"
  | "zero_amount"
  | "in_progress"
  | "not_connected";

/**
 * Complete capability state for a user or crank action button/banner.
 */
export interface ActionCapability {
  /** Whether the user can actively execute the transaction */
  canExecute: boolean;
  /** Machine-readable reason for disabled state if canExecute is false */
  disabledReason?: ActionDisabledReason;
  /** Translation key under Unclaimed.* or Ledger.* for the button text */
  buttonLabelKey: string;
  /** Optional translation key for rich status or tooltip explanation */
  tooltipKey?: string;
  /** Optional inline status notice key (e.g. 'Unclaimed.frozenNotice') */
  statusBadgeKey?: string;
}

/**
 * Evaluates the execution capability for claiming non-reinvested winnings.
 */
export function getClaimWinningsCapability(params: {
  pool?: { isFrozenForDraw?: boolean } | null;
  unclaimedAmount: number | bigint;
  isClaiming?: boolean;
}): ActionCapability {
  const { pool, unclaimedAmount, isClaiming } = params;
  const hasAmount =
    typeof unclaimedAmount === "bigint"
      ? unclaimedAmount > 0n
      : unclaimedAmount > 0;

  if (isClaiming) {
    return {
      canExecute: false,
      disabledReason: "in_progress",
      buttonLabelKey: "claiming",
    };
  }

  if (pool?.isFrozenForDraw) {
    return {
      canExecute: false,
      disabledReason: "frozen_for_draw",
      buttonLabelKey: "claimingPaused",
      statusBadgeKey: "frozenNotice",
      tooltipKey: "frozenTooltip",
    };
  }

  if (!hasAmount) {
    return {
      canExecute: false,
      disabledReason: "zero_amount",
      buttonLabelKey: "claimNow",
    };
  }

  return {
    canExecute: true,
    buttonLabelKey: "claimNow",
  };
}

/**
 * Evaluates the execution capability for settling/cranking prize entries.
 */
export function getCrankActionCapability(params: {
  pool?: { isFrozenForDraw?: boolean } | null;
  isTimelocked: boolean;
  isCranking?: boolean;
}): ActionCapability {
  const { pool, isTimelocked, isCranking } = params;

  if (isCranking) {
    return {
      canExecute: false,
      disabledReason: "in_progress",
      buttonLabelKey: "processing",
    };
  }

  if (pool?.isFrozenForDraw) {
    return {
      canExecute: false,
      disabledReason: "frozen_for_draw",
      buttonLabelKey: "claimingPaused",
      tooltipKey: "frozenCrankTooltip",
    };
  }

  if (isTimelocked) {
    return {
      canExecute: false,
      disabledReason: "timelocked",
      buttonLabelKey: "reinvest",
    };
  }

  return {
    canExecute: true,
    buttonLabelKey: "reinvest",
  };
}

/**
 * Canonical comparator for PrizeHistoryEntry:
 * 1. Draw cycle descending (newest draw first)
 * 2. Tier with biggest prizes first (Tier 0 Grand Prize > Tier 1 Runner-up > Tier 2 Consolation)
 * 3. Prize amount descending (biggest amount first)
 * 4. Winner index ascending (deterministic tie-breaker)
 */
export function comparePrizeHistoryEntries(
  a: PrizeHistoryEntry,
  b: PrizeHistoryEntry
): number {
  return (
    (b.drawCycleId ?? 0) - (a.drawCycleId ?? 0) ||
    (a.tierIndex ?? 0) - (b.tierIndex ?? 0) ||
    (b.amount ?? 0) - (a.amount ?? 0) ||
    (a.winnerIndex ?? 0) - (b.winnerIndex ?? 0)
  );
}

/**
 * Returns a new array of PrizeHistoryEntry sorted by draw and tier (biggest prizes first).
 */
export function sortPrizeHistoryEntries(
  entries: PrizeHistoryEntry[]
): PrizeHistoryEntry[] {
  return [...entries].sort(comparePrizeHistoryEntries);
}
