"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useWalletConnection,
  useSolanaClient,
  useSendTransaction,
} from "@solana/react-hooks";
import { address, signature as toSignature } from "@solana/kit";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { buildClaimNonReinvestedWinningsInstruction } from "@/app/lib/bonds-instruction-factory";
import { pollSignatureConfirmation } from "@/app/lib/transaction-poller";
import { usePrizePool } from "../queries/usePrizePool";

export interface ClaimNonReinvestedWinningsMutationParams {
  nextRedemptionId?: number | bigint;
}

export function useClaimNonReinvestedWinnings(poolId: PoolId = 1) {
  const queryClient = useQueryClient();
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const { wallet } = useWalletConnection();
  const { send } = useSendTransaction();
  const { data: poolData } = usePrizePool(poolId);
  const userAddress = wallet?.account.address.toString();

  return useMutation({
    mutationFn: async ({
      nextRedemptionId,
    }: ClaimNonReinvestedWinningsMutationParams = {}) => {
      if (!userAddress) throw new Error("Wallet not connected");

      const resolvedRedemptionId =
        nextRedemptionId ?? poolData?.nextRedemptionId ?? 0;

      const ix = await buildClaimNonReinvestedWinningsInstruction({
        poolId,
        userAddress: address(userAddress),
        amount: 0, // Ignored by on-chain instruction (claims 100%)
        nextRedemptionId: resolvedRedemptionId,
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
          queryKey: bondsKeys.userRedemptions(poolId, userAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.poolState(poolId),
        });
      }
    },
  });
}
