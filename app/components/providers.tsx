"use client";

import { SolanaProvider } from "@solana/react-hooks";
import { PropsWithChildren } from "react";
import { autoDiscover, createClient } from "@solana/client";
import {
  resolveClientSolanaRpcUrl,
  resolveClientSolanaWebSocketUrl,
} from "@/app/lib/network";
import { QueryProvider } from "./providers/QueryProvider";
import { BalanceSyncListener } from "./providers/BalanceSyncListener";

const client = createClient({
  endpoint: resolveClientSolanaRpcUrl(),
  websocket: resolveClientSolanaWebSocketUrl(),
  walletConnectors: autoDiscover(),
});

export function Providers({ children }: PropsWithChildren) {
  return (
    <QueryProvider>
      <SolanaProvider client={client}>
        <BalanceSyncListener />
        {children}
      </SolanaProvider>
    </QueryProvider>
  );
}
