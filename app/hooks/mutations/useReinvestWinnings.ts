"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useWalletConnection,
  useSolanaClient,
  useSendTransaction,
} from "@solana/react-hooks";
import { address, signature as toSignature, type Address } from "@solana/kit";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { buildReinvestWinningsInstruction } from "@/app/lib/bonds-instruction-factory";
import { pollSignatureConfirmation } from "@/app/lib/transaction-poller";

export interface ReinvestWinningsMutationParams {
  cycleId: number;
  winnerIndex: number;
  ticketRegistry: Address;
  winnerAddress?: Address;
}

export function useReinvestWinnings(poolId: PoolId = 1) {
  const queryClient = useQueryClient();
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const { wallet } = useWalletConnection();
  const { send } = useSendTransaction();
  const userAddress = wallet?.account.address.toString();

  return useMutation({
    mutationFn: async ({
      cycleId,
      winnerIndex,
      ticketRegistry,
      winnerAddress,
    }: ReinvestWinningsMutationParams) => {
      if (!userAddress) throw new Error("Wallet not connected");

      const ix = await buildReinvestWinningsInstruction({
        poolId,
        userAddress: address(userAddress),
        cycleId,
        winnerIndex,
        ticketRegistry,
        winnerAddress,
      });

      const signature = await send({ instructions: [ix] });
      await pollSignatureConfirmation(rpc, toSignature(signature.toString()), {
        timeoutMs: 60_000,
      });
      return signature.toString();
    },
    onSuccess: (_sig, variables) => {
      const targetUser = variables.winnerAddress?.toString() ?? userAddress;
      if (targetUser) {
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userPosition(poolId, targetUser),
        });
      }
      if (userAddress && targetUser !== userAddress) {
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userPosition(poolId, userAddress),
        });
      }
      queryClient.invalidateQueries({
        queryKey: bondsKeys.drawDetails(poolId, variables.cycleId),
      });
      queryClient.invalidateQueries({
        queryKey: bondsKeys.draws(poolId),
      });
      queryClient.invalidateQueries({
        queryKey: bondsKeys.poolState(poolId),
      });
    },
  });
}
