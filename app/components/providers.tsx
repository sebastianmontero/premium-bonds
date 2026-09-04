"use client";

import { SolanaProvider } from "@solana/react-hooks";
import { PropsWithChildren } from "react";

import { autoDiscover, createClient } from "@solana/client";
import { resolveClientSolanaRpcUrl } from "@/app/lib/network";

const client = createClient({
  endpoint: resolveClientSolanaRpcUrl(),
  walletConnectors: autoDiscover(),
});

import { QueryProvider } from "./providers/QueryProvider";

export function Providers({ children }: PropsWithChildren) {
  return (
    <QueryProvider>
      <SolanaProvider client={client}>{children}</SolanaProvider>
    </QueryProvider>
  );
}
