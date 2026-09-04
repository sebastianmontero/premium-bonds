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

import type { PendingRedemption } from "@/app/types";

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
    onMutate: async ({ redemptionId }: ClaimRedemptionParams) => {
      if (!userAddress) return;
      const queryKey = bondsKeys.userRedemptions(poolId, userAddress);
      const idStr = String(redemptionId);
      await queryClient.cancelQueries({ queryKey });
      const previousRedemptions =
        queryClient.getQueryData<PendingRedemption[]>(queryKey);
      queryClient.setQueryData<PendingRedemption[]>(queryKey, (old) =>
        (old || []).filter((r) => r.redemptionId !== idStr)
      );
      return { previousRedemptions, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousRedemptions && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousRedemptions);
      }
    },
    onSuccess: () => {
      if (userAddress) {
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userTokenBalance(userAddress),
        });
      }
    },
  });
}
