"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  useWalletConnection,
  useSendTransaction,
  useSolanaClient,
} from "@solana/react-hooks";
import {
  address,
  getBase64Encoder,
  AccountRole,
  Base58EncodedBytes,
  Address,
} from "@solana/kit";
import {
  PROGRAM_ID,
  HUMA_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  findPrizePoolPda,
  findPoolVaultPda,
  findPoolPstVaultPda,
  findUserWinningsPda,
  findPendingRedemptionPda,
  findHumaPoolAuthorityPda,
  findEventAuthorityPda,
  findAtaAddress,
  parsePrizePool,
  parseUserWinnings,
  parseTicketRegistry,
  parseRegistryEntry,
  resolveUserTickets,
  parsePendingRedemption,
  parseMockHumaPoolState,
  calculatePoolYield,
  fetchPoolYieldOnChainState,
  buildReinvestWinningsInstruction,
  resolveWinnerAddress,
  fetchUserAtaBalance,
  RedemptionType,
  UserWinningsInfo,
} from "../lib/bonds-sdk";
import {
  notifyBalanceUpdate,
  PB_BALANCE_UPDATE_EVENT,
} from "./useUserTokenBalance";
import { PoolInfo, UserTicketInfo, PendingRedemption } from "../types";
import { sanitizeErrorMessage } from "../lib/errors";
import { formatTokenAmount } from "../lib/formatters";

type WindowWithDebug = Window & { __DEBUG_YIELD__?: boolean };

// ─── Extended Types ──────────────────────────────────────────────────────────

interface ExtendedPoolInfo extends PoolInfo {
  ticketRegistry?: string;
  nextRedemptionId?: number;
  totalFeesAccrued?: bigint;
  totalFeesWithdrawn?: bigint;
  totalPrizesAllocated?: bigint;
  totalPendingRedemptions?: bigint;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Load configuration with fallbacks for devnet/localnet testing
export const HUMA_CONFIG = address(
  process.env.NEXT_PUBLIC_HUMA_CONFIG || "11111111111111111111111111111111"
);
export const HUMA_POOL_CONFIG = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_CONFIG || "11111111111111111111111111111111"
);
export const HUMA_POOL_STATE = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_STATE || "11111111111111111111111111111111"
);
export const HUMA_MODE_CONFIG = address(
  process.env.NEXT_PUBLIC_HUMA_MODE_CONFIG || "11111111111111111111111111111111"
);
export const HUMA_LENDER_STATE = address(
  process.env.NEXT_PUBLIC_HUMA_LENDER_STATE ||
    "11111111111111111111111111111111"
);
export const HUMA_POOL_UNDERLYING_TOKEN = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN ||
    "11111111111111111111111111111111"
);
export const HUMA_MODE_MINT = address(
  process.env.NEXT_PUBLIC_HUMA_MODE_MINT || "11111111111111111111111111111111"
);

export const HUMA_POOL_MODE_TOKEN = address(
  process.env.NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN ||
    "11111111111111111111111111111111"
);
export const HUMA_REDEMPTION_REQUEST = address(
  process.env.NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST ||
    "11111111111111111111111111111111"
);

const base64Encoder = getBase64Encoder();

// ─── Main Hook ───────────────────────────────────────────────────────────────

/**
 * React hook to manage on-chain state queries, wallet balance tracking,
 * and transaction submissions for the YieldBonds program.
 *
 * Interacts directly with Solana via `@solana/react-hooks` and `@solana/kit`.
 * Handles Huma Finance lending interactions transparently for user deposits/withdrawals.
 *
 * @param poolId - The unique ID of the pool to connect to (defaults to 1).
 * @returns An object containing the pool state, user tickets, user winnings, pending redemptions, wallet balance, loading status, error status, and a dictionary of transaction action methods.
 */
export function useBondsContract(poolId: number = 1) {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();
  const { send } = useSendTransaction();

  const [pool, setPool] = useState<ExtendedPoolInfo | null>(null);
  const [userTickets, setUserTickets] = useState<UserTicketInfo | null>(null);
  const [userWinnings, setUserWinnings] = useState<UserWinningsInfo | null>(
    null
  );
  const [pendingRedemptions, setPendingRedemptions] = useState<
    PendingRedemption[]
  >([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [hasUserWinningsAccount, setHasUserWinningsAccount] =
    useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const userAddress = wallet?.account.address.toString();

  const hasLoadedRef = useRef<boolean>(false);
  const fetchIdRef = useRef<number>(0);
  const lastUserAddressRef = useRef<string | undefined>(userAddress);
  const lastPoolIdRef = useRef<number>(poolId);

  useEffect(() => {
    if (
      lastUserAddressRef.current !== userAddress ||
      lastPoolIdRef.current !== poolId
    ) {
      lastUserAddressRef.current = userAddress;
      lastPoolIdRef.current = poolId;
      hasLoadedRef.current = false;
      setPool(null);
      setUserTickets(null);
      setUserWinnings(null);
      setHasUserWinningsAccount(false);
      setPendingRedemptions([]);
      setWalletBalance(0);
    }
  }, [userAddress, poolId]);

  const refetch = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const poolPda = await findPrizePoolPda(poolId);
      const rpc = client.runtime.rpc;

      // 1. Fetch Prize Pool account
      let poolInfo: ExtendedPoolInfo | null = null;
      let cachedRegistryBytes: Uint8Array | null = null;
      try {
        const poolAcc = await rpc
          .getAccountInfo(poolPda, { encoding: "base64" })
          .send();
        if (poolAcc && poolAcc.value) {
          const bytes = new Uint8Array(
            base64Encoder.encode(poolAcc.value.data[0])
          );
          const parsed = parsePrizePool(bytes);
          const currentPool: ExtendedPoolInfo = {
            ...parsed,
            tokenSymbol: "USDC",
            tokenDecimals: 6,
            estimatedPrizePot: 0,
            ticketRegistry: parsed.ticketRegistry.toString(),
            totalUsers: 0,
          };

          // Fetch TicketRegistry account once to read user_count (totalUsers) & cache for user tickets
          if (currentPool.ticketRegistry) {
            try {
              const registryAcc = await rpc
                .getAccountInfo(address(currentPool.ticketRegistry), {
                  encoding: "base64",
                })
                .send();
              if (registryAcc && registryAcc.value) {
                cachedRegistryBytes = new Uint8Array(
                  base64Encoder.encode(registryAcc.value.data[0])
                );
                const regView = new DataView(
                  cachedRegistryBytes.buffer,
                  cachedRegistryBytes.byteOffset,
                  cachedRegistryBytes.byteLength
                );
                // user_count is located at offset 16 in the TicketRegistry header
                if (cachedRegistryBytes.byteLength >= 20) {
                  currentPool.totalUsers = regView.getUint32(16, true);
                }
              }
            } catch (err) {
              console.warn(
                "Could not fetch ticket registry for pool totalUsers:",
                err
              );
            }
          }

          // Fetch estimated prize pot using on-chain PST yield accounting
          try {
            const { humaTotalAssets, pstSupply, poolPstBalance, humaModeApy } =
              await fetchPoolYieldOnChainState(rpc, {
                poolId,
                humaPoolStateAddress: HUMA_POOL_STATE,
                pstMintAddress: HUMA_MODE_MINT,
                humaModeConfigAddress: HUMA_MODE_CONFIG,
              });

            const yieldCalc = calculatePoolYield({
              poolPstBalance,
              pstSupply,
              humaTotalAssets,
              totalDepositedPrincipal: currentPool.totalDepositedPrincipal,
              totalFeesAccrued: currentPool.totalFeesAccrued,
              totalFeesWithdrawn: currentPool.totalFeesWithdrawn,
              totalPrizesAllocated: currentPool.totalPrizesAllocated,
              feeBasisPoints: currentPool.feeBasisPoints,
            });

            currentPool.estimatedPrizePot = yieldCalc.estimatedPrizePot;
            currentPool.grossYield = Number(yieldCalc.grossYield);
            currentPool.protocolFeeAmount = Number(yieldCalc.protocolFee);
            currentPool.minYieldThreshold = Number(parsed.minYieldThreshold);
            currentPool.underlyingApy = humaModeApy ?? 0.085;

            const isDev = process.env.NODE_ENV === "development";
            const isDebugEnabled =
              isDev &&
              (typeof window === "undefined" ||
                (window as WindowWithDebug).__DEBUG_YIELD__ !== false);

            if (isDebugEnabled) {
              console.log(
                `[PrizePool: ${currentPool.tokenSymbol ?? poolId}] On-Chain Base Prize Pot Calculation:`,
                {
                  formula:
                    "currentValue = (poolPstBalance * humaTotalAssets) / pstSupply; grossYield = max(0, currentValue - bookValue); netYield = grossYield - fee",
                  valuesRaw: {
                    poolPstBalance: yieldCalc.poolPstBalance.toString(),
                    pstSupply: yieldCalc.pstSupply.toString(),
                    humaTotalAssets: yieldCalc.humaTotalAssets.toString(),
                    currentValue: yieldCalc.currentValue.toString(),
                    bookValue: yieldCalc.bookValue.toString(),
                    grossYield: yieldCalc.grossYield.toString(),
                    protocolFee: yieldCalc.protocolFee.toString(),
                    netYield: yieldCalc.netYield.toString(),
                    estimatedPrizePotRaw: currentPool.estimatedPrizePot,
                  },
                  valuesFormatted: {
                    poolPstBalanceUi: `${formatTokenAmount(Number(yieldCalc.poolPstBalance))} PST`,
                    pstSupplyUi: `${formatTokenAmount(Number(yieldCalc.pstSupply))} PST`,
                    humaTotalAssetsUi: `${formatTokenAmount(Number(yieldCalc.humaTotalAssets))} USDC`,
                    currentValueUi: `${formatTokenAmount(Number(yieldCalc.currentValue))} USDC`,
                    bookValueUi: `${formatTokenAmount(Number(yieldCalc.bookValue))} USDC`,
                    grossYieldUi: `${formatTokenAmount(Number(yieldCalc.grossYield))} USDC`,
                    protocolFeeUi: `${formatTokenAmount(Number(yieldCalc.protocolFee))} USDC`,
                    netYieldUi: `${formatTokenAmount(Number(yieldCalc.netYield))} USDC`,
                    estimatedPrizePotUi: `${formatTokenAmount(currentPool.estimatedPrizePot)} USDC`,
                  },
                  bookValueBreakdown: {
                    totalPrincipal: `${yieldCalc.totalDepositedPrincipal.toString()} (${formatTokenAmount(Number(yieldCalc.totalDepositedPrincipal))} USDC)`,
                    feesInVault: `${yieldCalc.feesInVault.toString()} (${formatTokenAmount(Number(yieldCalc.feesInVault))} USDC)`,
                    totalPrizesAllocated: `${yieldCalc.totalPrizesAllocated.toString()} (${formatTokenAmount(Number(yieldCalc.totalPrizesAllocated))} USDC)`,
                  },
                  explanations: {
                    poolPstBalance: "Pool PST vault token balance",
                    pstSupply: "Total PST token mint supply across Huma",
                    humaTotalAssets:
                      "Total assets held in underlying Huma lending pool state",
                    currentValue: "Underlying USDC value of pool PST holdings",
                    bookValue:
                      "Protocol liabilities to active depositors + fees + prizes",
                    grossYield:
                      "Unadjusted surplus yield (currentValue - bookValue)",
                    protocolFee: "Protocol fee cut from gross yield",
                    netYield:
                      "Net prize pot allocated for draws (grossYield - protocolFee)",
                    estimatedPrizePot: "Live base prize pot in UI",
                  },
                }
              );
            }
          } catch (err) {
            const isDev = process.env.NODE_ENV === "development";
            if (
              isDev &&
              (typeof window === "undefined" ||
                (window as WindowWithDebug).__DEBUG_YIELD__ !== false)
            ) {
              console.warn(
                `[PrizePool: ${poolId}] Huma pool state fetch failed or unavailable. Defaulting estimatedPrizePot to 0:`,
                err
              );
            }
            currentPool.estimatedPrizePot = 0;
          } finally {
            currentPool.lastSyncedAt = Date.now() / 1000;
          }
          poolInfo = currentPool;
        }
      } catch (err) {
        console.warn("PrizePool not found on-chain.", err);
      }
      setPool(poolInfo);

      // 2. Fetch User state if connected
      if (userAddress) {
        const userWinningsPda = await findUserWinningsPda(poolId, userAddress);

        // Fetch User's USDC wallet balance using shared helper
        try {
          const balance = await fetchUserAtaBalance(rpc, userAddress, USDC_MINT);
          setWalletBalance(balance);
        } catch (err) {
          console.warn(
            "User USDC ATA not found, defaulting balance to 0.",
            err
          );
          setWalletBalance(0);
        }

        let registryEntryIndex = 0xffffffff;
        // Fetch UserWinnings account
        try {
          const winningsAcc = await rpc
            .getAccountInfo(userWinningsPda, { encoding: "base64" })
            .send();
          if (winningsAcc && winningsAcc.value) {
            const bytes = new Uint8Array(
              base64Encoder.encode(winningsAcc.value.data[0])
            );
            const parsed = parseUserWinnings(bytes);
            setUserWinnings(parsed);
            setHasUserWinningsAccount(true);
            registryEntryIndex = parsed.registryEntryIndex;
          } else {
            setHasUserWinningsAccount(false);
            setUserWinnings({
              discriminator: new Uint8Array([
                226, 146, 3, 214, 100, 252, 221, 32,
              ]),
              poolId,
              user: address(userAddress),
              unclaimedNonReinvestedWinnings: 0n,
              totalClaimed: 0n,
              totalReinvested: 0n,
              bump: 0,
              registryEntryIndex: 0xffffffff,
              version: 1,
              reserved: new Uint8Array(32),
            });
          }
        } catch (err) {
          console.warn("UserWinnings account not found, defaulting.", err);
          setUserWinnings({
            discriminator: new Uint8Array([
              226, 146, 3, 214, 100, 252, 221, 32,
            ]),
            poolId,
            user: address(userAddress),
            unclaimedNonReinvestedWinnings: 0n,
            totalClaimed: 0n,
            totalReinvested: 0n,
            bump: 0,
            registryEntryIndex: 0xffffffff,
            version: 1,
            reserved: new Uint8Array(32),
          });
        }

        // Fetch user tickets from TicketRegistry
        try {
          const registryAddrStr = poolInfo?.ticketRegistry;
          if (registryAddrStr && registryEntryIndex !== 0xffffffff) {
            let bytes = cachedRegistryBytes;
            if (!bytes) {
              const registryPda = address(registryAddrStr);
              const registryAcc = await rpc
                .getAccountInfo(registryPda, { encoding: "base64" })
                .send();
              if (registryAcc && registryAcc.value) {
                bytes = new Uint8Array(
                  base64Encoder.encode(registryAcc.value.data[0])
                );
              }
            }

            if (bytes) {
              const view = new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength
              );

              const currentCycle = view.getUint32(28, true);
              const userEntry = parseRegistryEntry(bytes, registryEntryIndex);
              const isFrozen = poolInfo?.isFrozenForDraw ?? false;

              const { activeTicketsCount, pendingTicketsCount } =
                resolveUserTickets(
                  userEntry?.owner === userAddress ? userEntry : null,
                  currentCycle,
                  isFrozen
                );

              setUserTickets({
                poolId,
                activeTicketsCount,
                pendingTicketsCount,
              });
            } else {
              setUserTickets({
                poolId,
                activeTicketsCount: 0,
                pendingTicketsCount: 0,
              });
            }
          } else {
            setUserTickets({
              poolId,
              activeTicketsCount: 0,
              pendingTicketsCount: 0,
            });
          }
        } catch (err) {
          console.warn("Failed to parse ticket registry, defaulting.", err);
          setUserTickets({
            poolId,
            activeTicketsCount: 0,
            pendingTicketsCount: 0,
          });
        }

        // Fetch User's Pending Redemptions on-chain
        try {
          const redemptions = await rpc
            .getProgramAccounts(PROGRAM_ID, {
              filters: [
                { dataSize: BigInt(159) },
                {
                  memcmp: {
                    offset: BigInt(56),
                    bytes: userAddress as unknown as Base58EncodedBytes,
                    encoding: "base58",
                  },
                },
              ],
              encoding: "base64",
            })
            .send();

          // Get next request ID from Huma pool state to check claimability status
          let nextHumaRequestId = BigInt(0);
          try {
            const humaAcc = await rpc
              .getAccountInfo(HUMA_POOL_STATE, { encoding: "base64" })
              .send();
            if (humaAcc && humaAcc.value) {
              const humaBytes = new Uint8Array(
                base64Encoder.encode(humaAcc.value.data[0])
              );
              const humaState = parseMockHumaPoolState(humaBytes);
              nextHumaRequestId = humaState.nextRequestId;
            }
          } catch (err) {
            console.warn(
              "Could not fetch Huma next_request_id, redemptions status might default to settling.",
              err
            );
          }

          const parsedRedemptions: PendingRedemption[] = redemptions.map(
            (r) => {
              const bytes = new Uint8Array(
                base64Encoder.encode(r.account.data[0])
              );
              const parsed = parsePendingRedemption(bytes);
              const status: "settling" | "ready" =
                nextHumaRequestId > parsed.humaRequestId ? "ready" : "settling";
              const isPrizeClaim =
                parsed.redemptionType === RedemptionType.PrizeClaim;
              return {
                redemptionId: parsed.redemptionId.toString(),
                amount: Number(parsed.amount),
                status,
                requestedAt: new Date(
                  Number(parsed.requestedAt) * 1000
                ).toISOString(),
                type: isPrizeClaim ? "prize_claim" : "bond_sale",
              };
            }
          );
          setPendingRedemptions(parsedRedemptions);
        } catch (err) {
          console.warn(
            "Failed to fetch pending redemptions, using empty array.",
            err
          );
          setPendingRedemptions([]);
        }
      } else {
        setUserTickets(null);
        setUserWinnings(null);
        setPendingRedemptions([]);
        setWalletBalance(0);
      }
    } catch (err) {
      console.error("Error fetching bonds contract data:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(sanitizeErrorMessage(errMsg) || "Failed to load contract data.");
    } finally {
      if (fetchId === fetchIdRef.current) {
        hasLoadedRef.current = true;
        setIsLoading(false);
      }
    }
  }, [poolId, userAddress, client]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Synchronize wallet balance upon protocol balance update events
  useEffect(() => {
    const handleBalanceUpdate = async () => {
      if (userAddress) {
        try {
          const rpc = client.runtime.rpc;
          const balance = await fetchUserAtaBalance(rpc, userAddress, USDC_MINT);
          setWalletBalance(balance);
        } catch {
          // ignore transient balance fetch error
        }
      }
    };

    window.addEventListener(PB_BALANCE_UPDATE_EVENT, handleBalanceUpdate);
    return () => {
      window.removeEventListener(PB_BALANCE_UPDATE_EVENT, handleBalanceUpdate);
    };
  }, [userAddress, client]);

  // ─── Transaction actions ───────────────────────────────────────────────────

  /**
   * Submits a transaction to deposit USDC and purchase tickets.
   *
   * @param ticketsToBuy - Number of tickets to purchase.
   * @returns The transaction signature.
   * @throws {Error} If wallet is not connected or pool is not loaded.
   */
  const buyBonds = useCallback(
    async (ticketsToBuy: number) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool) throw new Error("Pool state not loaded");
      if (pool.status !== "Active") {
        throw new Error(
          pool.status === "Paused"
            ? "Pool is paused due to emergency circuit breaker"
            : "Pool is closed permanently"
        );
      }

      const poolPda = await findPrizePoolPda(poolId);
      const poolVault = await findPoolVaultPda(poolId);
      const poolPstVault = await findPoolPstVaultPda(poolId);
      const userWinningsPda = await findUserWinningsPda(poolId, userAddress);
      const userTokenAccount = await findAtaAddress(userAddress, USDC_MINT);
      const humaPoolAuthority = await findHumaPoolAuthorityPda(HUMA_POOL_STATE);
      const eventAuthorityPda = await findEventAuthorityPda();

      const registryAddr = pool.ticketRegistry
        ? address(pool.ticketRegistry)
        : poolPda;

      // Build BuyBonds instruction data
      const ixData = new Uint8Array(12);
      ixData.set([49, 229, 149, 142, 90, 12, 43, 92], 0);
      const view = new DataView(ixData.buffer);
      view.setUint32(8, ticketsToBuy, true);

      const accounts = [
        { address: address(userAddress), role: AccountRole.WRITABLE_SIGNER },
        { address: userWinningsPda, role: AccountRole.WRITABLE },
        { address: poolPda, role: AccountRole.WRITABLE },
        { address: registryAddr, role: AccountRole.WRITABLE },
        { address: userTokenAccount, role: AccountRole.WRITABLE },
        { address: USDC_MINT, role: AccountRole.READONLY },
        { address: poolVault, role: AccountRole.WRITABLE },
        { address: poolPstVault, role: AccountRole.WRITABLE },
        { address: HUMA_PROGRAM_ID, role: AccountRole.READONLY },
        { address: HUMA_CONFIG, role: AccountRole.READONLY },
        { address: HUMA_POOL_CONFIG, role: AccountRole.READONLY },
        { address: HUMA_POOL_STATE, role: AccountRole.WRITABLE },
        { address: HUMA_MODE_CONFIG, role: AccountRole.READONLY },
        { address: HUMA_MODE_MINT, role: AccountRole.WRITABLE },
        { address: humaPoolAuthority, role: AccountRole.READONLY },
        { address: HUMA_POOL_UNDERLYING_TOKEN, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
        { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY }, // pst_token_program
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
        { address: eventAuthorityPda, role: AccountRole.READONLY },
        { address: PROGRAM_ID, role: AccountRole.READONLY },
      ];

      const signature = await send({
        instructions: [
          {
            programAddress: PROGRAM_ID,
            accounts,
            data: ixData,
          },
        ],
      });

      // Refresh state after transaction
      await refetch();
      notifyBalanceUpdate();
      return signature;
    },
    [userAddress, pool, poolId, send, refetch]
  );

  /**
   * Submits a transaction to initiate the sale of tickets.
   *
   * @param amount - The USDC amount equivalent of tickets to sell.
   * @returns The transaction signature.
   * @throws {Error} If wallet not connected or ticket balance is insufficient.
   */
  const sellBonds = useCallback(
    async (amount: number) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool) throw new Error("Pool state not loaded");
      if (pool.status === "Paused") {
        throw new Error("Pool is currently paused");
      }
      if (pool.isFrozenForDraw) {
        throw new Error("Pool is frozen while draw is being resolved");
      }

      const rpc = client.runtime.rpc;
      const registryAddrStr = pool.ticketRegistry;
      if (!registryAddrStr)
        throw new Error("Ticket registry address not loaded");

      // 1. Fetch user winnings PDA to get registry index
      const userWinningsPda = await findUserWinningsPda(poolId, userAddress);
      let registryEntryIndex = 0xffffffff;

      const winningsAcc = await rpc
        .getAccountInfo(userWinningsPda, { encoding: "base64" })
        .send();

      if (winningsAcc && winningsAcc.value) {
        const winningsBytes = base64Encoder.encode(winningsAcc.value.data[0]);
        const winnings = parseUserWinnings(new Uint8Array(winningsBytes));
        registryEntryIndex = winnings.registryEntryIndex;
      }

      // 2. Fetch registry details
      const registryAcc = await rpc
        .getAccountInfo(address(registryAddrStr), { encoding: "base64" })
        .send();
      if (!registryAcc || !registryAcc.value)
        throw new Error("Ticket registry account not found on-chain");

      const bytes = base64Encoder.encode(registryAcc.value.data[0]);
      const registry = parseTicketRegistry(new Uint8Array(bytes));

      const entry =
        registryEntryIndex !== 0xffffffff &&
        registryEntryIndex < registry.userCount
          ? registry.entries[registryEntryIndex]
          : null;

      const {
        activeTicketsCount: activeOwned,
        pendingTicketsCount: pendingOwned,
      } = resolveUserTickets(
        entry && entry.owner === userAddress ? entry : null,
        registry.drawCycleId,
        pool.isFrozenForDraw
      );

      // Number of bonds to sell
      const bondsToSell = Math.floor(amount / pool.bondPrice);
      if (bondsToSell <= 0)
        throw new Error("Amount is too small to sell any bonds");
      if (activeOwned + pendingOwned < bondsToSell) {
        throw new Error(
          `Insufficient tickets owned to sell. Owned: ${activeOwned + pendingOwned}, Required: ${bondsToSell}`
        );
      }

      // Distribute bonds to sell: prioritize pending, then active
      const pendingToSell = Math.min(pendingOwned, bondsToSell);
      const activeToSell = bondsToSell - pendingToSell;

      const executeTx = async (pToSell: number, aToSell: number) => {
        const willExit = activeOwned === aToSell && pendingOwned === pToSell;
        const lastEntryIdx = registry.userCount - 1;

        let swappedUserWinningsPda: Address | null = null;
        if (
          willExit &&
          registryEntryIndex !== lastEntryIdx &&
          lastEntryIdx >= 0
        ) {
          const lastEntry = registry.entries[lastEntryIdx];
          if (lastEntry) {
            swappedUserWinningsPda = await findUserWinningsPda(
              poolId,
              lastEntry.owner
            );
          }
        }

        const poolPda = await findPrizePoolPda(poolId);
        const poolPstVault = await findPoolPstVaultPda(poolId);
        const humaPoolAuthority =
          await findHumaPoolAuthorityPda(HUMA_POOL_STATE);
        const eventAuthorityPda = await findEventAuthorityPda();

        const nextRedemptionId = pool.nextRedemptionId || 0;
        const pendingRedemptionPda = await findPendingRedemptionPda(
          poolId,
          nextRedemptionId
        );

        const ixData = new Uint8Array(16);
        ixData.set([205, 139, 46, 24, 50, 76, 182, 76], 0);

        const viewIx = new DataView(ixData.buffer);
        viewIx.setUint32(8, aToSell, true);
        viewIx.setUint32(12, pToSell, true);

        const accounts = [
          { address: address(userAddress), role: AccountRole.WRITABLE_SIGNER },
          { address: userWinningsPda, role: AccountRole.WRITABLE },
          { address: poolPda, role: AccountRole.WRITABLE },
          { address: address(registryAddrStr), role: AccountRole.WRITABLE },
          { address: USDC_MINT, role: AccountRole.READONLY },
          { address: poolPstVault, role: AccountRole.WRITABLE },
          { address: pendingRedemptionPda, role: AccountRole.WRITABLE },
          { address: HUMA_PROGRAM_ID, role: AccountRole.READONLY },
          { address: HUMA_CONFIG, role: AccountRole.READONLY },
          { address: HUMA_POOL_CONFIG, role: AccountRole.READONLY },
          { address: HUMA_POOL_STATE, role: AccountRole.WRITABLE },
          { address: HUMA_MODE_CONFIG, role: AccountRole.READONLY },
          { address: HUMA_MODE_MINT, role: AccountRole.WRITABLE },
          { address: HUMA_REDEMPTION_REQUEST, role: AccountRole.WRITABLE },
          { address: HUMA_LENDER_STATE, role: AccountRole.WRITABLE },
          { address: humaPoolAuthority, role: AccountRole.READONLY },
          { address: HUMA_POOL_MODE_TOKEN, role: AccountRole.WRITABLE },
          { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
          { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
          { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
          { address: eventAuthorityPda, role: AccountRole.READONLY },
          { address: PROGRAM_ID, role: AccountRole.READONLY },
        ];

        if (swappedUserWinningsPda) {
          accounts.push({
            address: swappedUserWinningsPda,
            role: AccountRole.WRITABLE,
          });
        }

        return await send({
          instructions: [
            { programAddress: PROGRAM_ID, accounts, data: ixData },
          ],
        });
      };

      try {
        const signature = await executeTx(pendingToSell, activeToSell);
        await refetch();
        notifyBalanceUpdate();
        return signature;
      } catch (err: unknown) {
        // Concurrency Auto-Recovery: Catch InsufficientPendingTickets
        const errorMsg = String(err);
        if (
          errorMsg.includes("InsufficientPendingTickets") ||
          errorMsg.includes("0x1776")
        ) {
          console.warn(
            "Sell pending failed due to harvest concurrency. Retrying with active..."
          );
          const totalToSell = pendingToSell + activeToSell;
          const retrySignature = await executeTx(0, totalToSell);
          await refetch();
          notifyBalanceUpdate();
          return retrySignature;
        }
        throw err;
      }
    },
    [userAddress, pool, poolId, client, send, refetch]
  );

  /**
   * Submits a transaction to disburse a settled redemption request.
   *
   * @param redemptionId - Sequential ID of the pending redemption.
   * @returns The transaction signature.
   */
  const claimRedemption = useCallback(
    async (redemptionId: string) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (pool && pool.status === "Paused") {
        throw new Error("Pool is currently paused");
      }

      const poolPda = await findPrizePoolPda(poolId);
      const poolVault = await findPoolVaultPda(poolId);
      const userTokenAccount = await findAtaAddress(userAddress, USDC_MINT);
      const humaPoolAuthority = await findHumaPoolAuthorityPda(HUMA_POOL_STATE);
      const eventAuthorityPda = await findEventAuthorityPda();
      const pendingRedemptionPda = await findPendingRedemptionPda(
        poolId,
        BigInt(redemptionId)
      );

      const ixData = new Uint8Array(8);
      ixData.set([109, 110, 9, 188, 195, 217, 112, 83], 0);

      const accounts = [
        { address: address(userAddress), role: AccountRole.WRITABLE_SIGNER },
        { address: poolPda, role: AccountRole.WRITABLE },
        { address: pendingRedemptionPda, role: AccountRole.WRITABLE },
        { address: USDC_MINT, role: AccountRole.READONLY },
        { address: poolVault, role: AccountRole.WRITABLE },
        { address: userTokenAccount, role: AccountRole.WRITABLE },
        { address: HUMA_PROGRAM_ID, role: AccountRole.READONLY },
        { address: HUMA_CONFIG, role: AccountRole.READONLY },
        { address: HUMA_POOL_CONFIG, role: AccountRole.READONLY },
        { address: HUMA_POOL_STATE, role: AccountRole.WRITABLE },
        { address: HUMA_MODE_CONFIG, role: AccountRole.READONLY },
        { address: HUMA_LENDER_STATE, role: AccountRole.WRITABLE },
        { address: humaPoolAuthority, role: AccountRole.READONLY },
        { address: HUMA_POOL_UNDERLYING_TOKEN, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
        { address: eventAuthorityPda, role: AccountRole.READONLY },
        { address: PROGRAM_ID, role: AccountRole.READONLY },
      ];

      const signature = await send({
        instructions: [
          {
            programAddress: PROGRAM_ID,
            accounts,
            data: ixData,
          },
        ],
      });

      await refetch();
      notifyBalanceUpdate();
      return signature;
    },
    [userAddress, pool, poolId, send, refetch]
  );

  /**
   * Submits a transaction to claim non-reinvested prize winnings.
   *
   * @returns The transaction signature.
   */
  const claimNonReinvestedWinnings = useCallback(async () => {
    if (!userAddress) throw new Error("Wallet not connected");
    if (!pool) throw new Error("Pool state not loaded");
    if (pool.status === "Paused") {
      throw new Error("Pool is currently paused");
    }

    const poolPda = await findPrizePoolPda(poolId);
    const poolPstVault = await findPoolPstVaultPda(poolId);
    const userWinningsPda = await findUserWinningsPda(poolId, userAddress);
    const humaPoolAuthority = await findHumaPoolAuthorityPda(HUMA_POOL_STATE);
    const eventAuthorityPda = await findEventAuthorityPda();

    const nextRedemptionId = pool.nextRedemptionId || 0;
    const pendingRedemptionPda = await findPendingRedemptionPda(
      poolId,
      nextRedemptionId
    );

    const ixData = new Uint8Array(8);
    ixData.set([223, 101, 207, 14, 47, 145, 239, 61], 0);

    const accounts = [
      { address: address(userAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: poolPda, role: AccountRole.WRITABLE },
      { address: userWinningsPda, role: AccountRole.WRITABLE },
      { address: poolPstVault, role: AccountRole.WRITABLE },
      { address: pendingRedemptionPda, role: AccountRole.WRITABLE },
      { address: HUMA_PROGRAM_ID, role: AccountRole.READONLY },
      { address: HUMA_CONFIG, role: AccountRole.READONLY },
      { address: HUMA_POOL_CONFIG, role: AccountRole.READONLY },
      { address: HUMA_POOL_STATE, role: AccountRole.WRITABLE },
      { address: HUMA_MODE_CONFIG, role: AccountRole.READONLY },
      { address: HUMA_MODE_MINT, role: AccountRole.WRITABLE },
      { address: HUMA_REDEMPTION_REQUEST, role: AccountRole.WRITABLE },
      { address: HUMA_LENDER_STATE, role: AccountRole.WRITABLE },
      { address: humaPoolAuthority, role: AccountRole.READONLY },
      { address: HUMA_POOL_MODE_TOKEN, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ID, role: AccountRole.READONLY }, // pst_token_program
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: eventAuthorityPda, role: AccountRole.READONLY },
      { address: PROGRAM_ID, role: AccountRole.READONLY },
    ];

    const signature = await send({
      instructions: [
        {
          programAddress: PROGRAM_ID,
          accounts,
          data: ixData,
        },
      ],
    });

    await refetch();
    notifyBalanceUpdate();
    return signature;
  }, [userAddress, pool, poolId, send, refetch]);

  /**
   * Submits a transaction to manually reinvest won prizes into bonds.
   *
   * @param cycleId - The draw cycle ID where the prize was won.
   * @param winnerIndex - Winner index inside the payout registry.
   * @param winnerAddress - Optional winner address. If omitted, resolved via on-chain PayoutRegistry.
   * @returns The transaction signature.
   */
  const reinvestWinnings = useCallback(
    async (
      cycleId: number,
      winnerIndex: number,
      winnerAddress?: Address | string
    ) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool) throw new Error("Pool state not loaded");

      const targetWinner = await resolveWinnerAddress(
        client.runtime.rpc,
        poolId,
        cycleId,
        winnerIndex,
        winnerAddress,
        userAddress
      );

      const poolPda = await findPrizePoolPda(poolId);
      const registryAddr = pool.ticketRegistry
        ? address(pool.ticketRegistry)
        : poolPda;

      const ix = await buildReinvestWinningsInstruction({
        crank: address(userAddress),
        winner: targetWinner,
        poolId,
        cycleId,
        winnerIndex,
        ticketRegistry: registryAddr,
      });

      const signature = await send({
        instructions: [ix],
      });

      await refetch();
      notifyBalanceUpdate();
      return signature;
    },
    [userAddress, pool, poolId, send, refetch, client]
  );

  return {
    pool,
    userTickets,
    userWinnings: userWinnings
      ? {
          unclaimedNonReinvestedWinnings: Number(
            userWinnings.unclaimedNonReinvestedWinnings
          ),
          totalClaimed: Number(userWinnings.totalClaimed),
          totalReinvested: Number(userWinnings.totalReinvested),
          registryEntryIndex: userWinnings.registryEntryIndex,
        }
      : null,
    pendingRedemptions,
    walletBalance,
    hasUserWinningsAccount,
    isFirstDeposit: !hasUserWinningsAccount,
    isLoading,
    error,
    refetch,
    actions: {
      buyBonds,
      sellBonds,
      claimRedemption,
      claimNonReinvestedWinnings,
      reinvestWinnings,
    },
  };
}
