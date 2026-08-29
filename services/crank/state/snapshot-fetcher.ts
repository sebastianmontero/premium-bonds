import {
  Address,
  address,
  getBase64Encoder,
  createSolanaRpc,
} from "@solana/kit";
import {
  findPrizePoolPda,
  findDrawCyclePda,
  findPayoutRegistryPda,
  decodePrizePool,
  decodeDrawCycle,
  decodePayoutRegistry,
  parseTicketRegistry,
} from "../../../app/lib/bonds-sdk";
import { PoolStateSnapshot } from "../types";
import { classifyPoolState } from "./snapshot-classifier";

const base64Encoder = getBase64Encoder();

export async function fetchPoolStateSnapshot(
  rpc: ReturnType<typeof createSolanaRpc>,
  poolId: number
): Promise<PoolStateSnapshot | null> {
  const poolPda = await findPrizePoolPda(poolId);

  // 1. Initial fetch for PrizePool
  const poolAccountRes = await rpc
    .getAccountInfo(poolPda, {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();

  if (!poolAccountRes?.value?.data?.[0]) {
    return null;
  }

  const poolBytes = new Uint8Array(
    base64Encoder.encode(poolAccountRes.value.data[0])
  );
  const pool = decodePrizePool({ address: poolPda, data: poolBytes }).data;
  const ticketRegistryAddress = address(pool.ticketRegistry);

  const currentCycleId = pool.currentDrawCycleId;
  const currentDrawCyclePda = await findDrawCyclePda(poolId, currentCycleId);
  const currentPayoutPda = await findPayoutRegistryPda(poolId, currentCycleId);
  const prevPayoutPda =
    currentCycleId > 1
      ? await findPayoutRegistryPda(poolId, currentCycleId - 1)
      : null;

  // 2. Batched fetch for associated accounts and slot/blocktime
  const accountsToFetch: Address[] = [
    ticketRegistryAddress,
    currentDrawCyclePda,
    currentPayoutPda,
  ];
  if (prevPayoutPda) {
    accountsToFetch.push(prevPayoutPda);
  }

  const [accountsRes, slotRes] = await Promise.all([
    rpc
      .getMultipleAccounts(accountsToFetch, {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send(),
    rpc.getSlot({ commitment: "confirmed" }).send(),
  ]);

  const currentSlot = BigInt(slotRes);
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  // Parse Ticket Registry
  const ticketAcc = accountsRes?.value?.[0];
  if (!ticketAcc?.data?.[0]) {
    return null;
  }
  const ticketBytes = new Uint8Array(base64Encoder.encode(ticketAcc.data[0]));
  const ticketRegistry = parseTicketRegistry(ticketBytes);

  // Parse Draw Cycle
  let drawCycle = null;
  const drawAcc = accountsRes?.value?.[1];
  if (drawAcc?.data?.[0]) {
    try {
      const drawBytes = new Uint8Array(base64Encoder.encode(drawAcc.data[0]));
      drawCycle = decodeDrawCycle({
        address: currentDrawCyclePda,
        data: drawBytes,
      }).data;
    } catch {}
  }

  // Parse Payout Registry (prefer current, then previous)
  let payoutRegistryAddress = null;
  let payoutRegistry = null;

  const currentPayoutAcc = accountsRes?.value?.[2];
  if (currentPayoutAcc?.data?.[0]) {
    try {
      const payoutBytes = new Uint8Array(
        base64Encoder.encode(currentPayoutAcc.data[0])
      );
      payoutRegistry = decodePayoutRegistry({
        address: currentPayoutPda,
        data: payoutBytes,
      }).data;
      payoutRegistryAddress = currentPayoutPda;
    } catch {}
  }

  if (!payoutRegistry && prevPayoutPda) {
    const prevPayoutAcc = accountsRes?.value?.[3];
    if (prevPayoutAcc?.data?.[0]) {
      try {
        const payoutBytes = new Uint8Array(
          base64Encoder.encode(prevPayoutAcc.data[0])
        );
        payoutRegistry = decodePayoutRegistry({
          address: prevPayoutPda,
          data: payoutBytes,
        }).data;
        payoutRegistryAddress = prevPayoutPda;
      } catch {}
    }
  }

  return classifyPoolState({
    poolId,
    poolAddress: poolPda,
    pool,
    ticketRegistryAddress,
    ticketRegistry,
    drawCycle,
    payoutRegistryAddress,
    payoutRegistry,
    currentSlot,
    currentTimestamp,
  });
}
