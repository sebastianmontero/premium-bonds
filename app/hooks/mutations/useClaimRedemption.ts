"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useWalletConnection,
  useSolanaClient,
  useSendTransaction,
} from "@solana/react-hooks";
import { address, signature as toSignature, type Address } from "@solana/kit";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { buildClaimRedemptionInstruction } from "@/app/lib/bonds-instruction-factory";
import { pollSignatureConfirmation } from "@/app/lib/transaction-poller";

export interface ClaimRedemptionParams {
  redemptionId: number | bigint;
  userTokenAccount: Address;
}

export function useClaimRedemption(poolId: PoolId = 1) {
  const queryClient = useQueryClient();
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const { wallet } = useWalletConnection();
  const { send } = useSendTransaction();
  const userAddress = wallet?.account.address.toString();

  return useMutation({
    mutationFn: async ({
      redemptionId,
      userTokenAccount,
    }: ClaimRedemptionParams) => {
      if (!userAddress) throw new Error("Wallet not connected");

      const ix = await buildClaimRedemptionInstruction({
        poolId,
        userAddress: address(userAddress),
        redemptionId,
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
          queryKey: bondsKeys.userRedemptions(poolId, userAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userTokenBalance(userAddress),
        });
      }
    },
  });
}
