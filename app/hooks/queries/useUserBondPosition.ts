"use client";

import { useQuery } from "@tanstack/react-query";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { address } from "@solana/kit";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import {
  findUserWinningsPda,
  findPrizePoolPda,
  parseUserWinnings,
  parsePrizePool,
  fetchUserRegistryEntrySlice,
  decodeAccountBase64Data,
} from "@/app/lib/bonds-sdk";
import {
  parseUserEntryFromSlice,
  resolveUserTickets,
  UNASSIGNED_REGISTRY_INDEX,
} from "@/app/lib/ticket-registry-helpers";

export interface UserBondPosition {
  activeTicketsCount: number;
  pendingTicketsCount: number;
  unclaimedWinnings: bigint;
  totalClaimed: bigint;
  totalReinvested: bigint;
  hasRegisteredEntry: boolean;
  registryEntryIndex: number;
}

export const EMPTY_USER_BOND_POSITION: Readonly<UserBondPosition> =
  Object.freeze({
    activeTicketsCount: 0,
    pendingTicketsCount: 0,
    unclaimedWinnings: 0n,
    totalClaimed: 0n,
    totalReinvested: 0n,
    hasRegisteredEntry: false,
    registryEntryIndex: UNASSIGNED_REGISTRY_INDEX,
  });

export function useUserBondPosition(poolId: PoolId = 1) {
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const { status, wallet } = useWalletConnection();
  const userAddress = wallet?.account.address.toString();

  return useQuery({
    queryKey: bondsKeys.userPosition(poolId, userAddress ?? "anonymous"),
    enabled: status === "connected" && !!userAddress,
    queryFn: async (): Promise<UserBondPosition> => {
      if (!userAddress) return EMPTY_USER_BOND_POSITION;

      const user = address(userAddress);
      const poolPda = await findPrizePoolPda(poolId);
      const userWinningsPda = await findUserWinningsPda(poolId, user);

      const accountsRes = await rpc
        .getMultipleAccounts([poolPda, userWinningsPda], {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send();

      const poolBytes = decodeAccountBase64Data(accountsRes.value[0]);
      const winningsBytes = decodeAccountBase64Data(accountsRes.value[1]);

      if (!poolBytes) return EMPTY_USER_BOND_POSITION;

      const poolInfo = parsePrizePool(poolBytes);
      const parsedWinnings = winningsBytes
        ? parseUserWinnings(winningsBytes)
        : null;

      const totalClaimed = parsedWinnings?.totalClaimed ?? 0n;
      const totalReinvested = parsedWinnings?.totalReinvested ?? 0n;

      if (
        !parsedWinnings ||
        parsedWinnings.registryEntryIndex === UNASSIGNED_REGISTRY_INDEX
      ) {
        return {
          ...EMPTY_USER_BOND_POSITION,
          unclaimedWinnings:
            parsedWinnings?.unclaimedNonReinvestedWinnings ?? 0n,
          totalClaimed,
          totalReinvested,
        };
      }

      // Fetch 64-byte slice from TicketRegistry
      const entryBytes = await fetchUserRegistryEntrySlice(
        rpc,
        poolInfo.ticketRegistry,
        parsedWinnings.registryEntryIndex
      );

      if (!entryBytes) {
        return {
          ...EMPTY_USER_BOND_POSITION,
          unclaimedWinnings: parsedWinnings.unclaimedNonReinvestedWinnings,
          totalClaimed,
          totalReinvested,
        };
      }

      const userEntry = parseUserEntryFromSlice(entryBytes);

      // Invariant check: ensure slot/reorg swap did not reassign this index to another user
      const validatedEntry =
        userEntry?.owner === userAddress ? userEntry : null;

      const { activeTicketsCount, pendingTicketsCount } = resolveUserTickets(
        validatedEntry,
        poolInfo.currentDrawCycleId,
        poolInfo.isFrozenForDraw ?? false
      );

      return {
        activeTicketsCount,
        pendingTicketsCount,
        unclaimedWinnings: parsedWinnings.unclaimedNonReinvestedWinnings,
        totalClaimed,
        totalReinvested,
        hasRegisteredEntry: true,
        registryEntryIndex: parsedWinnings.registryEntryIndex,
      };
    },
    staleTime: 15_000,
  });
}
