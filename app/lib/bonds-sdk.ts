import {
  address,
  Address,
  AccountRole,
  getProgramDerivedAddress,
  getBase58Decoder,
  getBase58Encoder,
} from "@solana/kit";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PROGRAM_ID = address(
  "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx"
);
export const HUMA_PROGRAM_ID = address(
  "ACQydQGziybxnN6dPAy3ssmYYbTp6K4rvwnBjjmh11Hj"
);
export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ATA_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
export const USDC_MINT = address(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

const textEncoder = new TextEncoder();
const base58Encoder = getBase58Encoder();
const base58Decoder = getBase58Decoder();

// ─── Binary Helper encoders ──────────────────────────────────────────────────

export function encodeU32(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, val, true);
  return buf;
}

export function encodeU64(val: bigint | number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(val), true);
  return buf;
}

// ─── PDA Derivations ─────────────────────────────────────────────────────────

export async function findGlobalConfigPda(): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("global_config")],
  });
  return addr;
}

export async function findPrizePoolPda(poolId: number): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("prize_pool"), encodeU32(poolId)],
  });
  return addr;
}

export async function findPoolVaultPda(poolId: number): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("pool_vault"), encodeU32(poolId)],
  });
  return addr;
}

export async function findPoolPstVaultPda(poolId: number): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [textEncoder.encode("pool_pst"), encodeU32(poolId)],
  });
  return addr;
}

export async function findUserWinningsPda(
  poolId: number,
  user: string
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("user_winnings"),
      encodeU32(poolId),
      base58Encoder.encode(address(user)),
    ],
  });
  return addr;
}

export async function findPendingRedemptionPda(
  poolId: number,
  redemptionId: bigint | number
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("pending_redemption"),
      encodeU32(poolId),
      encodeU64(redemptionId),
    ],
  });
  return addr;
}

export async function findHumaPoolAuthorityPda(
  poolState: string
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: HUMA_PROGRAM_ID,
    seeds: [
      textEncoder.encode("pool_authority"),
      base58Encoder.encode(address(poolState)),
    ],
  });
  return addr;
}

export async function findPayoutRegistryPda(
  poolId: number,
  cycleId: number
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("payout"),
      encodeU32(poolId),
      encodeU32(cycleId),
    ],
  });
  return addr;
}

export async function findDrawCyclePda(
  poolId: number,
  cycleId: number
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [
      textEncoder.encode("draw_cycle"),
      encodeU32(poolId),
      encodeU32(cycleId),
    ],
  });
  return addr;
}

export async function findAtaAddress(
  owner: string,
  mint: string
): Promise<Address> {
  const [addr] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM_ID,
    seeds: [
      base58Encoder.encode(address(owner)),
      base58Encoder.encode(TOKEN_PROGRAM_ID),
      base58Encoder.encode(address(mint)),
    ],
  });
  return addr;
}

// ─── Decoders ───────────────────────────────────────────────────────────────

export interface GlobalConfigInfo {
  admin: Address;
  jobsAccount: Address;
  maxTicketsPerBuy: number;
}

export interface PrizeTier {
  basisPoints: number;
  numWinners: number;
}

export interface PrizePoolInfo {
  poolId: number;
  tokenMint: Address;
  ticketRegistry: Address;
  feeWallet: Address;
  bondPrice: number;
  stakeCycleDurationHrs: number;
  feeBasisPoints: number;
  status: "Active" | "Paused" | "Closed";
  totalDepositedPrincipal: number;
  totalFeesCollected: number;
  currentCycleEndAt: number;
  isFrozenForDraw: boolean;
  currentDrawCycleId: number;
  prizeTiers: PrizeTier[];
  nextRedemptionId: number;
  totalFeesAccrued: bigint;
  totalFeesWithdrawn: bigint;
  totalPrizesAllocated: bigint;
  totalPendingRedemptions: bigint;
}

export interface DrawCycleInfo {
  poolId: number;
  cycleId: number;
  status: "AwaitingYield" | "AwaitingRandomness" | "Complete" | "Unknown";
  lockedTicketCount: number;
  randomnessSeed: Uint8Array;
  prizePot: bigint;
  cycleFeeCollected: bigint;
  randomnessAccount: Address;
  harvestSlot: bigint;
}

export function parseGlobalConfig(data: Uint8Array): GlobalConfigInfo {
  if (data.length < 76) {
    throw new Error(`GlobalConfig data too short (${data.length} bytes)`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const admin = base58Decoder.decode(data.slice(8, 8 + 32)) as Address;
  const jobsAccount = base58Decoder.decode(data.slice(40, 40 + 32)) as Address;
  const maxTicketsPerBuy = view.getUint32(72, true);

  return { admin, jobsAccount, maxTicketsPerBuy };
}

export function parsePrizePool(data: Uint8Array): PrizePoolInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = view.getUint32(9, true);
  const tokenMint = base58Decoder.decode(data.slice(13, 13 + 32)) as Address;
  const ticketRegistry = base58Decoder.decode(
    data.slice(45, 45 + 32)
  ) as Address;
  const feeWallet = base58Decoder.decode(data.slice(77, 77 + 32)) as Address;
  const bondPrice = Number(view.getBigUint64(109, true));
  const stakeCycleDurationHrs = Number(view.getBigInt64(117, true));
  const feeBasisPoints = view.getUint16(125, true);

  const statusVal = view.getUint8(127);
  let status: PrizePoolInfo["status"] = "Active";
  if (statusVal === 1) status = "Paused";
  else if (statusVal === 2) status = "Closed";

  const totalDepositedPrincipal = Number(view.getBigUint64(128, true));
  const totalFeesCollected = Number(view.getBigUint64(136, true));
  const currentCycleEndAt = Number(view.getBigInt64(144, true));
  const isFrozenForDraw = view.getUint8(152) !== 0;
  const currentDrawCycleId = view.getUint32(153, true);

  const tiersLength = view.getUint32(157, true);
  const prizeTiers: PrizeTier[] = [];
  for (let i = 0; i < tiersLength; i++) {
    const offset = 161 + i * 6;
    if (offset + 6 > data.byteLength) break;
    const basisPoints = view.getUint16(offset, true);
    const numWinners = view.getUint32(offset + 2, true);
    prizeTiers.push({ basisPoints, numWinners });
  }

  const nextRedemptionIdOffset = 161 + tiersLength * 6;
  let nextRedemptionId = BigInt(0);
  let totalFeesAccrued = BigInt(0);
  let totalFeesWithdrawn = BigInt(0);
  let totalPrizesAllocated = BigInt(0);
  let totalPendingRedemptions = BigInt(0);

  if (nextRedemptionIdOffset + 8 <= data.byteLength) {
    nextRedemptionId = view.getBigUint64(nextRedemptionIdOffset, true);
  }
  if (nextRedemptionIdOffset + 16 <= data.byteLength) {
    totalFeesAccrued = view.getBigUint64(nextRedemptionIdOffset + 8, true);
  }
  if (nextRedemptionIdOffset + 24 <= data.byteLength) {
    totalFeesWithdrawn = view.getBigUint64(nextRedemptionIdOffset + 16, true);
  }
  if (nextRedemptionIdOffset + 32 <= data.byteLength) {
    totalPrizesAllocated = view.getBigUint64(nextRedemptionIdOffset + 24, true);
  }
  if (nextRedemptionIdOffset + 40 <= data.byteLength) {
    totalPendingRedemptions = view.getBigUint64(
      nextRedemptionIdOffset + 32,
      true
    );
  }

  return {
    poolId,
    tokenMint,
    ticketRegistry,
    feeWallet,
    bondPrice,
    stakeCycleDurationHrs,
    feeBasisPoints,
    status,
    totalDepositedPrincipal,
    totalFeesCollected,
    currentCycleEndAt,
    isFrozenForDraw,
    currentDrawCycleId,
    prizeTiers,
    nextRedemptionId: Number(nextRedemptionId),
    totalFeesAccrued,
    totalFeesWithdrawn,
    totalPrizesAllocated,
    totalPendingRedemptions,
  };
}

export function parseDrawCycle(data: Uint8Array): DrawCycleInfo {
  if (data.length < 109) {
    throw new Error(`DrawCycle data too short (${data.length} bytes)`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = view.getUint32(8, true);
  const cycleId = view.getUint32(12, true);
  const statusVal = view.getUint8(16);
  let status: DrawCycleInfo["status"] = "Unknown";
  if (statusVal === 0) status = "AwaitingYield";
  else if (statusVal === 1) status = "AwaitingRandomness";
  else if (statusVal === 2) status = "Complete";

  const lockedTicketCount = view.getUint32(17, true);
  const randomnessSeed = new Uint8Array(data.slice(21, 21 + 32));
  const prizePot = view.getBigUint64(53, true);
  const cycleFeeCollected = view.getBigUint64(61, true);
  const randomnessAccount = base58Decoder.decode(data.slice(69, 69 + 32)) as Address;
  const harvestSlot = view.getBigUint64(101, true);

  return {
    poolId,
    cycleId,
    status,
    lockedTicketCount,
    randomnessSeed,
    prizePot,
    cycleFeeCollected,
    randomnessAccount,
    harvestSlot,
  };
}

export interface WinnerInfo {
  winnerPubkey: Address;
  amountOwed: bigint;
  processed: boolean;
  tierIndex: number;
  amountReinvested: bigint;
}

export interface PayoutRegistryInfo {
  poolId: number;
  cycleId: number;
  winnersCount: number;
  payoutsCompleted: number;
  winners: WinnerInfo[];
}

export function parsePayoutRegistry(data: Uint8Array): PayoutRegistryInfo {
  if (data.length < 28) {
    throw new Error(`PayoutRegistry data too short (${data.length} bytes)`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = view.getUint32(8, true);
  const cycleId = view.getUint32(12, true);
  const winnersCount = view.getUint32(16, true);
  const payoutsCompleted = view.getUint32(20, true);

  const winnersLength = view.getUint32(24, true);
  const winners: WinnerInfo[] = [];

  for (let i = 0; i < winnersLength; i++) {
    const offset = 28 + i * 50;
    if (offset + 50 > data.byteLength) {
      break;
    }
    const winnerPubkey = base58Decoder.decode(
      data.slice(offset, offset + 32)
    ) as Address;
    const amountOwed = view.getBigUint64(offset + 32, true);
    const processed = view.getUint8(offset + 40) !== 0;
    const tierIndex = view.getUint8(offset + 41);
    const amountReinvested = view.getBigUint64(offset + 42, true);

    winners.push({
      winnerPubkey,
      amountOwed,
      processed,
      tierIndex,
      amountReinvested,
    });
  }

  return {
    poolId,
    cycleId,
    winnersCount,
    payoutsCompleted,
    winners,
  };
}

export interface UserWinningsInfo {
  poolId: number;
  user: Address;
  unclaimedNonReinvestedWinnings: bigint;
  totalClaimed: bigint;
  totalReinvested: bigint;
  bump: number;
}

export function parseUserWinnings(data: Uint8Array): UserWinningsInfo {
  if (data.length < 69) {
    throw new Error(`UserWinnings data too short (${data.length} bytes)`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = view.getUint32(8, true);
  const user = base58Decoder.decode(data.slice(12, 12 + 32)) as Address;
  const unclaimedNonReinvestedWinnings = view.getBigUint64(44, true);
  const totalClaimed = view.getBigUint64(52, true);
  const totalReinvested = view.getBigUint64(60, true);
  const bump = view.getUint8(68);

  return {
    poolId,
    user,
    unclaimedNonReinvestedWinnings,
    totalClaimed,
    totalReinvested,
    bump,
  };
}

export interface PendingRedemptionInfo {
  poolId: number;
  redemptionId: bigint;
  user: Address;
  amount: bigint;
  pstSharesLocked: bigint;
  requestedAt: bigint;
  humaRequestId: bigint;
  bump: number;
}

export function parsePendingRedemption(
  data: Uint8Array
): PendingRedemptionInfo {
  if (data.length < 93) {
    throw new Error(`PendingRedemption data too short (${data.length} bytes)`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = view.getUint32(8, true);
  const redemptionId = view.getBigUint64(12, true);
  const user = base58Decoder.decode(data.slice(20, 20 + 32)) as Address;
  const amount = view.getBigUint64(52, true);
  const pstSharesLocked = view.getBigUint64(60, true);
  const requestedAt = view.getBigInt64(68, true);

  const low = view.getBigUint64(76, true);
  const high = view.getBigUint64(76 + 8, true);
  const humaRequestId = (high << BigInt(64)) | low;

  const bump = view.getUint8(92);

  return {
    poolId,
    redemptionId,
    user,
    amount,
    pstSharesLocked,
    requestedAt,
    humaRequestId,
    bump,
  };
}

export interface TicketRegistryInfo {
  poolId: number;
  capacity: number;
  activeTicketsCount: number;
  pendingTicketsCount: number;
  tickets: Address[];
}

export function parseTicketRegistry(data: Uint8Array): TicketRegistryInfo {
  if (data.length < 24) {
    throw new Error(`TicketRegistry data too short (${data.length} bytes)`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const poolId = view.getUint32(8, true);
  const capacity = view.getUint32(12, true);
  const activeTicketsCount = view.getUint32(16, true);
  const pendingTicketsCount = view.getUint32(20, true);

  const ticketsCount = activeTicketsCount + pendingTicketsCount;
  const tickets: Address[] = [];

  for (let i = 0; i < ticketsCount; i++) {
    const offset = 24 + i * 32;
    if (offset + 32 > data.byteLength) {
      break;
    }
    const ticketOwner = base58Decoder.decode(
      data.slice(offset, offset + 32)
    ) as Address;
    tickets.push(ticketOwner);
  }

  return {
    poolId,
    capacity,
    activeTicketsCount,
    pendingTicketsCount,
    tickets,
  };
}

// ─── Instruction Builders ────────────────────────────────────────────────────

export interface HarvestInstructionParams {
  crank: Address;
  poolId: number;
  ticketRegistry: Address;
  currentDrawCycleId: number;
  pstMint: Address;
  humaPoolState: Address;
  randomnessAccount: Address;
}

export async function buildHarvestYieldAndCommitInstruction(
  params: HarvestInstructionParams
) {
  const globalConfig = await findGlobalConfigPda();
  const pool = await findPrizePoolPda(params.poolId);
  const poolPstVault = await findPoolPstVaultPda(params.poolId);
  const drawCycle = await findDrawCyclePda(
    params.poolId,
    params.currentDrawCycleId
  );

  const discriminator = new Uint8Array([120, 243, 237, 229, 49, 117, 139, 107]);

  const accounts = [
    { address: params.crank, role: AccountRole.WRITABLE_SIGNER },
    { address: globalConfig, role: AccountRole.READONLY },
    { address: pool, role: AccountRole.WRITABLE },
    { address: params.ticketRegistry, role: AccountRole.WRITABLE },
    { address: drawCycle, role: AccountRole.WRITABLE },
    { address: poolPstVault, role: AccountRole.READONLY },
    { address: params.pstMint, role: AccountRole.READONLY },
    { address: params.humaPoolState, role: AccountRole.READONLY },
    { address: params.randomnessAccount, role: AccountRole.READONLY },
    { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
    { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
  ];

  return {
    programAddress: PROGRAM_ID,
    accounts,
    data: discriminator,
  };
}

export interface RevealInstructionParams {
  crank: Address;
  poolId: number;
  currentDrawCycleId: number;
  ticketRegistry: Address;
  randomnessAccount: Address;
}

export async function buildRevealAndPickWinnersInstruction(
  params: RevealInstructionParams
) {
  const globalConfig = await findGlobalConfigPda();
  const pool = await findPrizePoolPda(params.poolId);
  const drawCycle = await findDrawCyclePda(
    params.poolId,
    params.currentDrawCycleId
  );
  const payoutRegistry = await findPayoutRegistryPda(
    params.poolId,
    params.currentDrawCycleId
  );

  const discriminator = new Uint8Array([70, 108, 21, 126, 214, 41, 209, 144]);

  const accounts = [
    { address: params.crank, role: AccountRole.WRITABLE_SIGNER },
    { address: globalConfig, role: AccountRole.READONLY },
    { address: drawCycle, role: AccountRole.WRITABLE },
    { address: pool, role: AccountRole.WRITABLE },
    { address: params.ticketRegistry, role: AccountRole.READONLY },
    { address: params.randomnessAccount, role: AccountRole.READONLY },
    { address: payoutRegistry, role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
  ];

  return {
    programAddress: PROGRAM_ID,
    accounts,
    data: discriminator,
  };
}

export interface ReinvestWinningsInstructionParams {
  crank: Address;
  winner: Address;
  poolId: number;
  cycleId: number;
  winnerIndex: number;
  maxBonds: number;
  ticketRegistry: Address;
}

export async function buildReinvestWinningsInstruction(
  params: ReinvestWinningsInstructionParams
) {
  const pool = await findPrizePoolPda(params.poolId);
  const payoutRegistry = await findPayoutRegistryPda(
    params.poolId,
    params.cycleId
  );
  const userWinnings = await findUserWinningsPda(params.poolId, params.winner);

  const data = new Uint8Array(8 + 4 + 4 + 4);
  const discriminator = [29, 223, 229, 116, 101, 111, 58, 26];
  for (let i = 0; i < 8; i++) {
    data[i] = discriminator[i];
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint32(8, params.cycleId, true);
  view.setUint32(12, params.winnerIndex, true);
  view.setUint32(16, params.maxBonds, true);

  const accounts = [
    { address: params.crank, role: AccountRole.WRITABLE_SIGNER },
    { address: params.winner, role: AccountRole.READONLY },
    { address: payoutRegistry, role: AccountRole.WRITABLE },
    { address: pool, role: AccountRole.WRITABLE },
    { address: userWinnings, role: AccountRole.WRITABLE },
    { address: params.ticketRegistry, role: AccountRole.WRITABLE },
    { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
  ];

  return {
    programAddress: PROGRAM_ID,
    accounts,
    data,
  };
}
