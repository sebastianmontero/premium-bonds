"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  useWalletConnection,
  useSendTransaction,
  useSolanaClient,
} from "@solana/react-hooks";
import {
  address,
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
  parseUserEntryFromSlice,
  parseRegistryHeaderFromSlice,
  resolveUserTickets,
  parsePendingRedemption,
  parseMockHumaPoolState,
  calculatePoolYield,
  parseTokenAccountBalance,
  parseMintSupply,
  parseModeConfig,
  fetchBatchedBondsState,
  fetchTicketRegistryHeaderSlice,
  fetchUserRegistryEntrySlice,
  decodeAccountBase64Data,
  UNASSIGNED_REGISTRY_INDEX,
  HUMA_CONFIG,
  HUMA_POOL_CONFIG,
  HUMA_POOL_STATE,
  HUMA_MODE_CONFIG,
  HUMA_LENDER_STATE,
  HUMA_POOL_UNDERLYING_TOKEN,
  HUMA_MODE_MINT,
  HUMA_POOL_MODE_TOKEN,
  HUMA_REDEMPTION_REQUEST,
  buildReinvestWinningsInstruction,
  resolveWinnerAddress,
  RedemptionType,
  UserWinningsInfo,
} from "../lib/bonds-sdk";
import { notifyBalanceUpdate } from "./useUserTokenBalance";
import { notifyProtocolUpdate } from "../lib/protocol-sync-bus";
import { useProtocolSyncSubscription } from "./useProtocolSyncSubscription";
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
      const rpc = client.runtime.rpc;

      // 1. Fetch batched protocol & user accounts in a single slot-consistent RPC call
      const batched = await fetchBatchedBondsState({
        rpc,
        poolId,
        userAddress,
        humaPoolStateAddress: HUMA_POOL_STATE,
        pstMintAddress: HUMA_MODE_MINT,
        humaModeConfigAddress: HUMA_MODE_CONFIG,
      });

      let poolInfo: ExtendedPoolInfo | null = null;
      let registryHeader: ReturnType<typeof parseRegistryHeaderFromSlice> = null;

      if (batched.poolAccountData) {
        const parsed = parsePrizePool(batched.poolAccountData);
        const currentPool: ExtendedPoolInfo = {
          ...parsed,
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          estimatedPrizePot: 0,
          ticketRegistry: parsed.ticketRegistry.toString(),
          totalUsers: 0,
        };

        // 2. Fetch 104-byte header slice if registry exists
        if (currentPool.ticketRegistry) {
          try {
            const headerBytes = await fetchTicketRegistryHeaderSlice(
              rpc,
              currentPool.ticketRegistry
            );
            if (headerBytes) {
              registryHeader = parseRegistryHeaderFromSlice(headerBytes);
              if (registryHeader) {
                currentPool.totalUsers = registryHeader.userCount;
              }
            }
          } catch (err) {
            console.warn(
              "Could not fetch ticket registry header slice:",
              err
            );
          }
        }

        // 3. Compute live prize pot and APY from batched state
        try {
          const humaTotalAssets = batched.humaPoolStateData
            ? parseMockHumaPoolState(batched.humaPoolStateData).totalAssets
            : 0n;
          const pstSupply = batched.pstMintData
            ? parseMintSupply(batched.pstMintData)
            : 0n;
          const poolPstBalance = batched.poolPstVaultData
            ? parseTokenAccountBalance(batched.poolPstVaultData)
            : 0n;
          const humaModeApy = batched.humaModeConfigData
            ? parseModeConfig(batched.humaModeConfigData).apy
            : undefined;

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
              }
            );
          }
        } catch {
          currentPool.estimatedPrizePot = 0;
        } finally {
          currentPool.lastSyncedAt = Date.now() / 1000;
        }
        poolInfo = currentPool;
      }
      setPool(poolInfo);

      // 4. Resolve User State
      if (userAddress) {
        // USDC ATA Balance
        const balance = batched.userAtaData
          ? Number(parseTokenAccountBalance(batched.userAtaData))
          : 0;
        setWalletBalance(balance);

        let registryEntryIndex = UNASSIGNED_REGISTRY_INDEX;
        // UserWinnings PDA
        if (batched.userWinningsData) {
          const parsedWinnings = parseUserWinnings(batched.userWinningsData);
          setUserWinnings(parsedWinnings);
          setHasUserWinningsAccount(true);
          registryEntryIndex = parsedWinnings.registryEntryIndex;
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
            registryEntryIndex: UNASSIGNED_REGISTRY_INDEX,
            version: 1,
            reserved: new Uint8Array(32),
          });
        }

        // 5. Fetch User's 64-byte entry slice from TicketRegistry
        if (
          poolInfo?.ticketRegistry &&
          registryEntryIndex !== UNASSIGNED_REGISTRY_INDEX &&
          registryHeader &&
          registryEntryIndex < registryHeader.userCount
        ) {
          try {
            const userEntryBytes = await fetchUserRegistryEntrySlice(
              rpc,
              poolInfo.ticketRegistry,
              registryEntryIndex
            );
            if (userEntryBytes) {
              const userEntry = parseUserEntryFromSlice(userEntryBytes);
              const isFrozen = poolInfo.isFrozenForDraw ?? false;
              const { activeTicketsCount, pendingTicketsCount } =
                resolveUserTickets(
                  userEntry?.owner === userAddress ? userEntry : null,
                  registryHeader.drawCycleId,
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
          } catch (err) {
            console.warn("Failed to fetch user entry slice:", err);
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

        // 6. Fetch User's Pending Redemptions on-chain
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
              commitment: "confirmed",
            })
            .send();

          let nextHumaRequestId = BigInt(0);
          if (batched.humaPoolStateData) {
            const humaState = parseMockHumaPoolState(batched.humaPoolStateData);
            nextHumaRequestId = humaState.nextRequestId;
          }

          const parsedRedemptions: PendingRedemption[] = redemptions.map(
            (r) => {
              const bytes = decodeAccountBase64Data(r.account);
              if (!bytes) {
                return {
                  redemptionId: "0",
                  amount: 0,
                  status: "settling",
                  requestedAt: new Date().toISOString(),
                  type: "bond_sale",
                };
              }
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

  // Synchronize state and wallet balance upon scoped protocol updates or focus
  useProtocolSyncSubscription(
    async () => {
      await refetch();
    },
    {
      scopes: ["all", "pool", "redemptions", "clock", "user"],
      debounceMs: 100,
    }
  );

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
      if (pool.isFrozenForDraw) {
        throw new Error("Pool is frozen while draw is being resolved");
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
      notifyProtocolUpdate("pool", { poolId, reason: "buy_settled" });
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

      const userWinningsPda = await findUserWinningsPda(poolId, userAddress);

      // 1 & 2. Fetch UserWinnings PDA and TicketRegistry 104-byte header slice in parallel
      const [winningsAcc, headerBytes] = await Promise.all([
        rpc
          .getAccountInfo(userWinningsPda, {
            encoding: "base64",
            commitment: "confirmed",
          })
          .send(),
        fetchTicketRegistryHeaderSlice(rpc, registryAddrStr),
      ]);

      let registryEntryIndex = UNASSIGNED_REGISTRY_INDEX;
      if (winningsAcc && winningsAcc.value) {
        const winningsBytes = decodeAccountBase64Data(winningsAcc.value);
        if (winningsBytes) {
          const winnings = parseUserWinnings(winningsBytes);
          registryEntryIndex = winnings.registryEntryIndex;
        }
      }

      if (!headerBytes)
        throw new Error("Ticket registry header not found on-chain");
      const registry = parseRegistryHeaderFromSlice(headerBytes);
      if (!registry)
        throw new Error("Failed to parse ticket registry header");

      // 3. Fetch User's 64-byte entry slice
      let activeOwned = 0;
      let pendingOwned = 0;
      if (
        registryEntryIndex !== UNASSIGNED_REGISTRY_INDEX &&
        registryEntryIndex < registry.userCount
      ) {
        const userEntryBytes = await fetchUserRegistryEntrySlice(
          rpc,
          registryAddrStr,
          registryEntryIndex
        );
        if (userEntryBytes) {
          const userEntry = parseUserEntryFromSlice(userEntryBytes);
          const resolved = resolveUserTickets(
            userEntry && userEntry.owner === userAddress ? userEntry : null,
            registry.drawCycleId,
            pool.isFrozenForDraw
          );
          activeOwned = resolved.activeTicketsCount;
          pendingOwned = resolved.pendingTicketsCount;
        }
      }

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
          const lastEntryBytes = await fetchUserRegistryEntrySlice(
            rpc,
            registryAddrStr,
            lastEntryIdx
          );
          if (lastEntryBytes) {
            const lastEntry = parseUserEntryFromSlice(lastEntryBytes);
            if (lastEntry) {
              swappedUserWinningsPda = await findUserWinningsPda(
                poolId,
                lastEntry.owner
              );
            }
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
        notifyProtocolUpdate("pool", { poolId, reason: "sell_settled" });
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
          notifyProtocolUpdate("pool", { poolId, reason: "sell_settled" });
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
        { address: address(userAddress), role: AccountRole.WRITABLE_SIGNER }, // caller
        { address: address(userAddress), role: AccountRole.WRITABLE }, // beneficiary
        { address: poolPda, role: AccountRole.WRITABLE },
        { address: pendingRedemptionPda, role: AccountRole.WRITABLE },
        { address: USDC_MINT, role: AccountRole.READONLY },
        { address: poolVault, role: AccountRole.WRITABLE },
        { address: userTokenAccount, role: AccountRole.WRITABLE }, // beneficiary_token_account
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
      notifyProtocolUpdate("pool", { poolId, reason: "claim_redemption_settled" });
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
    if (pool.isFrozenForDraw) {
      throw new Error("Pool is frozen while draw is being resolved");
    }
    if (!userWinnings || userWinnings.unclaimedNonReinvestedWinnings <= 0n) {
      throw new Error("No non-reinvested prize winnings to claim");
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
    notifyProtocolUpdate("all", { poolId, reason: "claim_winnings_settled" });
    notifyBalanceUpdate();
    return signature;
  }, [userAddress, pool, userWinnings, poolId, send, refetch]);

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
      if (pool.isFrozenForDraw) {
        throw new Error("Pool is frozen while draw is being resolved");
      }

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
      notifyProtocolUpdate("all", { poolId, reason: "reinvest_settled" });
      notifyBalanceUpdate();
      return signature;
    },
    [userAddress, pool, poolId, send, refetch, client]
  );

  const actions = useMemo(
    () => ({
      buyBonds,
      sellBonds,
      claimRedemption,
      claimNonReinvestedWinnings,
      reinvestWinnings,
    }),
    [
      buyBonds,
      sellBonds,
      claimRedemption,
      claimNonReinvestedWinnings,
      reinvestWinnings,
    ]
  );

  const formattedUserWinnings = useMemo(
    () =>
      userWinnings
        ? {
            unclaimedNonReinvestedWinnings: Number(
              userWinnings.unclaimedNonReinvestedWinnings
            ),
            totalClaimed: Number(userWinnings.totalClaimed),
            totalReinvested: Number(userWinnings.totalReinvested),
            registryEntryIndex: userWinnings.registryEntryIndex,
          }
        : null,
    [userWinnings]
  );

  return useMemo(
    () => ({
      pool,
      userTickets,
      userWinnings: formattedUserWinnings,
      pendingRedemptions,
      walletBalance,
      hasUserWinningsAccount,
      isFirstDeposit: !hasUserWinningsAccount,
      isLoading,
      error,
      refetch,
      actions,
    }),
    [
      pool,
      userTickets,
      formattedUserWinnings,
      pendingRedemptions,
      walletBalance,
      hasUserWinningsAccount,
      isLoading,
      error,
      refetch,
      actions,
    ]
  );
}

export type UseBondsContractReturn = ReturnType<typeof useBondsContract>;

