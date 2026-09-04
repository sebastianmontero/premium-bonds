"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useWalletConnection,
  useSolanaClient,
  useSendTransaction,
} from "@solana/react-hooks";
import { address, signature as toSignature, type Address } from "@solana/kit";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { buildBuyBondsInstruction } from "@/app/lib/bonds-instruction-factory";
import { pollSignatureConfirmation } from "@/app/lib/transaction-poller";

export interface BuyBondsMutationParams {
  ticketsToBuy: number;
  ticketRegistry: Address;
  userTokenAccount: Address;
}

export function useBuyBonds(poolId: PoolId = 1) {
  const queryClient = useQueryClient();
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const { wallet } = useWalletConnection();
  const { send } = useSendTransaction();
  const userAddress = wallet?.account.address.toString();

  return useMutation({
    mutationFn: async ({
      ticketsToBuy,
      ticketRegistry,
      userTokenAccount,
    }: BuyBondsMutationParams) => {
      if (!userAddress) throw new Error("Wallet not connected");

      const ix = await buildBuyBondsInstruction({
        poolId,
        userAddress: address(userAddress),
        ticketsToBuy,
        ticketRegistry,
        userTokenAccount,
      });

      const signature = await send({ instructions: [ix] });
      await pollSignatureConfirmation(rpc, toSignature(signature.toString()), {
        timeoutMs: 60_000,
      });
      return signature.toString();
    },
    onSuccess: () => {
      if (userAddress) {
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userPosition(poolId, userAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userTokenBalance(userAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.poolState(poolId),
        });
      }
    },
  });
}
