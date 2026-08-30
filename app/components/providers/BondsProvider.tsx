"use client";

import React, { createContext, useContext } from "react";
import {
  useBondsContract,
  type UseBondsContractReturn,
} from "@/app/hooks/useBondsContract";

const BondsContext = createContext<UseBondsContractReturn | null>(null);

export function BondsProvider({
  poolId = 1,
  children,
}: {
  poolId?: number;
  children: React.ReactNode;
}) {
  const bondsState = useBondsContract(poolId);

  return (
    <BondsContext.Provider value={bondsState}>
      {children}
    </BondsContext.Provider>
  );
}

export function useBondsContext(): UseBondsContractReturn {
  const context = useContext(BondsContext);
  if (!context) {
    throw new Error("useBondsContext must be used within a <BondsProvider>");
  }
  return context;
}
