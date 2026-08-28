import { formatTokenAmount, USDC_DECIMALS } from "./formatters";

export interface ActivityFormatParams {
  activityType: string;
  bonds?: number | null;
  amountUsdc: bigint | number;
  cycleId?: number | null;
  decimals?: number;
}

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
    case "claim-redemption":
      return `Claimed settled redemption of ${formatted} USDC to wallet`;
    default:
      return `${params.activityType}: ${formatted} USDC`;
  }
}
