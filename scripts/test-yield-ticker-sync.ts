import assert from "assert";
import {
  calculateLiveYield,
  LiveYieldCalculationParams,
} from "../app/hooks/useLivePrizePot";
import {
  SECONDS_PER_YEAR,
  DEFAULT_APY,
  DEFAULT_LIVE_YIELD_PRECISION,
  getLiveYieldFormatter,
  USDC_DECIMALS,
} from "../app/lib/formatters";
import { createDefaultPoolFallback } from "../app/types";

console.log("Running Live Yield Ticker Synchronization verification tests...\n");

// ── Test 1: Multi-Component Ticker Synchronization ──────────────────────────
{
  const syncTime = 1_700_000_000;
  const now = syncTime + 60; // 60 seconds later

  const pool = createDefaultPoolFallback(1);
  pool.totalDepositedPrincipal = 1_000_000 * 10 ** USDC_DECIMALS; // 1M USDC
  pool.estimatedPrizePot = 10_000 * 10 ** USDC_DECIMALS; // 10k USDC
  pool.lastSyncedAt = syncTime;

  const baseUi = pool.estimatedPrizePot / 10 ** pool.tokenDecimals;
  const tvlUi = pool.totalDepositedPrincipal / 10 ** pool.tokenDecimals;

  // PoolCard evaluates at 'now'
  const poolCardVal = calculateLiveYield({
    baseUi,
    tvlUi,
    apy: DEFAULT_APY,
    lastSyncedAt: pool.lastSyncedAt,
    nowInSeconds: now,
  });

  // DepositModal opens at 'now' and receives the exact same pool snapshot
  const depositModalVal = calculateLiveYield({
    baseUi,
    tvlUi,
    apy: DEFAULT_APY,
    lastSyncedAt: pool.lastSyncedAt,
    nowInSeconds: now,
  });

  assert.strictEqual(
    poolCardVal,
    depositModalVal,
    "PoolCard and DepositModal must compute identical floating-point yield"
  );

  const formatter = getLiveYieldFormatter(6);
  const formattedCard = formatter.format(poolCardVal);
  const formattedModal = formatter.format(depositModalVal);

  assert.strictEqual(
    formattedCard,
    formattedModal,
    "Formatted string output must be 100% identical"
  );

  // Theoretical check: 1M USDC * 0.08 APY * 60s / 31557600s = 0.15210282... USDC
  const expectedYield = (1_000_000 * 0.08 * 60) / SECONDS_PER_YEAR;
  assert(
    Math.abs(poolCardVal - (10_000 + expectedYield)) < 1e-9,
    "Calculated yield must match financial formula"
  );

  console.log("✓ Test 1: Multi-Component Ticker Synchronization verified");
}

// ── Test 2: Modal Dynamic Mounting Latency Invariance ───────────────────────
{
  const syncTime = 1_700_000_000;
  const baseUi = 5_000;
  const tvlUi = 500_000;

  // Initial dashboard view at T+0s
  const valAtMount = calculateLiveYield({
    baseUi,
    tvlUi,
    apy: 0.08,
    lastSyncedAt: syncTime,
    nowInSeconds: syncTime,
  });
  assert.strictEqual(valAtMount, 5_000, "Yield at T=0 must equal baseUi");

  // User opens deposit modal 120s later
  const valAtModalOpen = calculateLiveYield({
    baseUi,
    tvlUi,
    apy: 0.08,
    lastSyncedAt: syncTime,
    nowInSeconds: syncTime + 120,
  });

  const expected120s = 5_000 + (500_000 * 0.08 * 120) / SECONDS_PER_YEAR;
  assert(
    Math.abs(valAtModalOpen - expected120s) < 1e-9,
    "Modal mounted at T+120s must calculate full 120s elapsed yield without resetting"
  );

  console.log("✓ Test 2: Modal Dynamic Mounting Latency Invariance verified");
}

// ── Test 3: Defensive Edge Case Bounds & Safety Guards ──────────────────────
{
  const baseUi = 250;
  const tvlUi = 50_000;
  const now = 1_700_000_100;

  // 3a: Undefined / Zero / Negative lastSyncedAt
  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: undefined,
      nowInSeconds: now,
    }),
    baseUi,
    "Undefined lastSyncedAt must safely return baseUi"
  );

  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: 0,
      nowInSeconds: now,
    }),
    baseUi,
    "Zero lastSyncedAt must safely return baseUi without 50-year yield inflation"
  );

  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: -100,
      nowInSeconds: now,
    }),
    baseUi,
    "Negative lastSyncedAt must safely return baseUi"
  );

  // 3b: Clock Skew (nowInSeconds < lastSyncedAt)
  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: now + 50,
      nowInSeconds: now,
    }),
    baseUi,
    "Future lastSyncedAt (clock skew) must clamp elapsed to 0 and return baseUi"
  );

  // 3c: Frozen for draw / Disabled / Zero TVL / Zero APY
  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: now - 100,
      nowInSeconds: now,
      isFrozenForDraw: true,
    }),
    baseUi,
    "isFrozenForDraw must freeze ticker at baseUi"
  );

  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: now - 100,
      nowInSeconds: now,
      enabled: false,
    }),
    baseUi,
    "enabled: false must return baseUi"
  );

  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi: 0,
      apy: 0.08,
      lastSyncedAt: now - 100,
      nowInSeconds: now,
    }),
    baseUi,
    "Zero TVL must return baseUi"
  );

  assert.strictEqual(
    calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0,
      lastSyncedAt: now - 100,
      nowInSeconds: now,
    }),
    baseUi,
    "Zero APY must return baseUi"
  );

  console.log("✓ Test 3: Defensive Edge Case Bounds & Safety Guards verified");
}

// ── Test 4: Tab Backgrounding & Continuous Accrual ───────────────────────────
{
  const syncTime = 1_700_000_000;
  const baseUi = 1_000;
  const tvlUi = 100_000;

  // Active view before tab switch (T+10s)
  const valBeforeSwitch = calculateLiveYield({
    baseUi,
    tvlUi,
    apy: 0.08,
    lastSyncedAt: syncTime,
    nowInSeconds: syncTime + 10,
  });

  // User backgrounds tab for 300 seconds and returns (T+310s)
  const valAfterReturn = calculateLiveYield({
    baseUi,
    tvlUi,
    apy: 0.08,
    lastSyncedAt: syncTime,
    nowInSeconds: syncTime + 310,
  });

  assert(
    valAfterReturn > valBeforeSwitch,
    "Pot must continue accruing smoothly while tab was backgrounded"
  );

  const expected310s = 1_000 + (100_000 * 0.08 * 310) / SECONDS_PER_YEAR;
  assert(
    Math.abs(valAfterReturn - expected310s) < 1e-9,
    "Elapsed yield after tab focus must match true elapsed wall-clock time"
  );

  console.log("✓ Test 4: Tab Backgrounding & Continuous Accrual verified");
}

// ── Test 5: Atomic RPC Refetch State Transition ─────────────────────────────
{
  const initialSyncTime = 1_700_000_000;
  const initialBaseUi = 1_000;
  const tvlUi = 200_000;

  // Before RPC refetch at T+500s
  const valBeforeRefetch = calculateLiveYield({
    baseUi: initialBaseUi,
    tvlUi,
    apy: 0.08,
    lastSyncedAt: initialSyncTime,
    nowInSeconds: initialSyncTime + 500,
  });

  // RPC refetches: new on-chain base pot is 1,200 USDC, new sync timestamp is T+500s
  const newSyncTime = initialSyncTime + 500;
  const newBaseUi = 1_200;

  // 10 seconds after refetch at T+510s
  const valAfterRefetch = calculateLiveYield({
    baseUi: newBaseUi,
    tvlUi,
    apy: 0.08,
    lastSyncedAt: newSyncTime,
    nowInSeconds: newSyncTime + 10,
  });

  const expectedNew = 1_200 + (200_000 * 0.08 * 10) / SECONDS_PER_YEAR;
  assert(
    Math.abs(valAfterRefetch - expectedNew) < 1e-9,
    "Refetch must atomically reset baseline to newBaseUi and accumulate strictly from newSyncTime"
  );

  console.log("✓ Test 5: Atomic RPC Refetch State Transition verified");
}

// ── Test 6: Formatter Cache Identity & Fallback Factory ─────────────────────
{
  const fmt1 = getLiveYieldFormatter(6);
  const fmt2 = getLiveYieldFormatter(6);
  assert.strictEqual(
    fmt1,
    fmt2,
    "getLiveYieldFormatter must return cached instance for identical precision"
  );

  const fallbackPool = createDefaultPoolFallback(1);
  assert.strictEqual(fallbackPool.poolId, 1);
  assert.strictEqual(fallbackPool.tokenSymbol, "USDC");
  assert(typeof fallbackPool.lastSyncedAt === "number");
  assert(fallbackPool.lastSyncedAt! > 0);

  console.log("✓ Test 6: Formatter Cache Identity & Fallback Factory verified");
}

console.log("\nAll Live Yield Ticker Synchronization tests passed successfully!");
