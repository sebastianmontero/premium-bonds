"use client";

import { useBalanceSync } from "@/app/hooks/useBalanceSync";

export function BalanceSyncListener() {
  useBalanceSync();
  return null;
}
