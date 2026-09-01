import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateLiveYield,
  calculateLiveYieldBreakdown,
} from "../app/hooks/useLivePrizePot";
import {
  SECONDS_PER_YEAR,
  DEFAULT_APY,
  DEFAULT_LIVE_YIELD_PRECISION,
  getLiveYieldFormatter,
  formatLiveYieldMetric,
  USDC_DECIMALS,
  resolvePoolThresholdBreakdown,
} from "../app/lib/formatters";
import { createDefaultPoolFallback } from "../app/types";

describe("Live Yield Ticker Synchronization Suite", () => {
  it("should synchronize yield across PoolCard and DepositModal components", () => {
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

    // Theoretical check: 1M USDC * DEFAULT_APY * 60s / 31557600s
    const expectedYield = (1_000_000 * DEFAULT_APY * 60) / SECONDS_PER_YEAR;
    assert.ok(
      Math.abs(poolCardVal - (10_000 + expectedYield)) < 1e-9,
      "Calculated yield must match financial formula"
    );
  });

  it("should preserve elapsed yield on dynamic modal mounting latency", () => {
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
    assert.ok(
      Math.abs(valAtModalOpen - expected120s) < 1e-9,
      "Modal mounted at T+120s must calculate full 120s elapsed yield without resetting"
    );
  });

  it("should enforce defensive edge case bounds and safety guards", () => {
    const baseUi = 250;
    const tvlUi = 50_000;
    const now = 1_700_000_100;

    // Undefined / Zero / Negative lastSyncedAt
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
      "Zero lastSyncedAt must safely return baseUi without yield inflation"
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

    // Clock Skew (nowInSeconds < lastSyncedAt)
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

    // Frozen for draw / Disabled / Zero TVL / Zero APY
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
  });

  it("should calculate continuous accrual across tab backgrounding", () => {
    const syncTime = 1_700_000_000;
    const baseUi = 1_000;
    const tvlUi = 100_000;

    const valBeforeSwitch = calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: syncTime,
      nowInSeconds: syncTime + 10,
    });

    const valAfterReturn = calculateLiveYield({
      baseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: syncTime,
      nowInSeconds: syncTime + 310,
    });

    assert.ok(
      valAfterReturn > valBeforeSwitch,
      "Pot must continue accruing smoothly while tab was backgrounded"
    );

    const expected310s = 1_000 + (100_000 * 0.08 * 310) / SECONDS_PER_YEAR;
    assert.ok(
      Math.abs(valAfterReturn - expected310s) < 1e-9,
      "Elapsed yield after tab focus must match true elapsed wall-clock time"
    );
  });

  it("should handle atomic RPC refetch baseline transitions", () => {
    const initialSyncTime = 1_700_000_000;
    const initialBaseUi = 1_000;
    const tvlUi = 200_000;

    // RPC refetches: new on-chain base pot is 1,200 USDC, new sync timestamp is T+500s
    const newSyncTime = initialSyncTime + 500;
    const newBaseUi = 1_200;

    const valAfterRefetch = calculateLiveYield({
      baseUi: newBaseUi,
      tvlUi,
      apy: 0.08,
      lastSyncedAt: newSyncTime,
      nowInSeconds: newSyncTime + 10,
    });

    const expectedNew = 1_200 + (200_000 * 0.08 * 10) / SECONDS_PER_YEAR;
    assert.ok(
      Math.abs(valAfterRefetch - expectedNew) < 1e-9,
      "Refetch must atomically reset baseline to newBaseUi and accumulate strictly from newSyncTime"
    );
  });

  it("should cache formatters and provide default pool fallbacks", () => {
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
    assert.strictEqual(typeof fallbackPool.lastSyncedAt, "number");
    assert.ok(fallbackPool.lastSyncedAt! > 0);
  });

  it("should deduct protocol fee on net APY live ticker accrual", () => {
    const syncTime = 1_700_000_000;
    const baseUi = 1_000;
    const tvlUi = 1_000_000;
    const apy = 0.085; // 8.50% gross APY
    const feeBasisPoints = 250; // 2.50% protocol fee (net = 8.2875% APY)

    const valWithFee = calculateLiveYield({
      baseUi,
      tvlUi,
      apy,
      feeBasisPoints,
      lastSyncedAt: syncTime,
      nowInSeconds: syncTime + 100,
    });

    const netApy = apy * (1 - 0.025);
    const expectedYield = (1_000_000 * netApy * 100) / SECONDS_PER_YEAR;

    assert.ok(
      Math.abs(valWithFee - (1_000 + expectedYield)) < 1e-9,
      "Live yield calculation must accurately deduct protocol reserve fee"
    );
  });

  it("should maintain mathematical consistency and card parity on yield breakdown ticker", () => {
    const syncTime = 1_700_000_000;
    const pool = createDefaultPoolFallback(1);
    pool.totalDepositedPrincipal = 2_000_000 * 10 ** USDC_DECIMALS; // 2M USDC
    pool.grossYield = 10_000 * 10 ** USDC_DECIMALS; // 10k USDC gross
    pool.feeBasisPoints = 250; // 2.50% fee
    pool.protocolFeeAmount = 250 * 10 ** USDC_DECIMALS; // 250 USDC fee
    pool.estimatedPrizePot = 9_750 * 10 ** USDC_DECIMALS; // 9,750 USDC net
    pool.underlyingApy = 0.085; // 8.50%
    pool.lastSyncedAt = syncTime;

    // Mathematical Invariant: Gross = Fee + Net across arbitrary time deltas
    for (const dt of [0, 1, 10, 60, 3600, 86400]) {
      const live = calculateLiveYieldBreakdown(pool, syncTime + dt);
      const sum = live.protocolFeeUi + live.netYieldUi;
      assert.ok(
        Math.abs(live.grossYieldUi - sum) < 1e-9,
        `Gross (${live.grossYieldUi}) must equal Fee (${live.protocolFeeUi}) + Net (${live.netYieldUi}) at dt=${dt}s`
      );
    }

    // Card-to-Modal Net Pot Parity: calculateLiveYield === calculateLiveYieldBreakdown.netYieldUi
    const now = syncTime + 300;
    const directPot = calculateLiveYield({
      baseUi: pool.estimatedPrizePot / 10 ** pool.tokenDecimals,
      tvlUi: pool.totalDepositedPrincipal / 10 ** pool.tokenDecimals,
      apy: pool.underlyingApy,
      feeBasisPoints: pool.feeBasisPoints,
      lastSyncedAt: pool.lastSyncedAt,
      nowInSeconds: now,
    });
    const breakdownLive = calculateLiveYieldBreakdown(pool, now);
    assert.strictEqual(
      directPot,
      breakdownLive.netYieldUi,
      "calculateLiveYield and calculateLiveYieldBreakdown must produce identical net yield"
    );

    // Zero Fee Pool Invariant: feeBasisPoints = 0 -> Fee = 0 and Gross = Net
    const zeroFeePool = {
      ...pool,
      feeBasisPoints: 0,
      protocolFeeAmount: 0,
      estimatedPrizePot: pool.grossYield,
    };
    const zeroFeeLive = calculateLiveYieldBreakdown(zeroFeePool, now);
    assert.strictEqual(
      zeroFeeLive.protocolFeeUi,
      0,
      "Zero fee pool must yield 0 protocol fee"
    );
    assert.strictEqual(
      zeroFeeLive.grossYieldUi,
      zeroFeeLive.netYieldUi,
      "Zero fee pool must have Gross === Net"
    );

    // Frozen pool safeguard
    const frozenPool = { ...pool, isFrozenForDraw: true };
    const frozenLive = calculateLiveYieldBreakdown(frozenPool, now);
    assert.strictEqual(
      frozenLive.grossYieldUi,
      pool.grossYield / 10 ** pool.tokenDecimals,
      "Frozen pool gross yield must remain at base"
    );
    assert.strictEqual(
      frozenLive.netYieldUi,
      pool.estimatedPrizePot / 10 ** pool.tokenDecimals,
      "Frozen pool net yield must remain at base"
    );

    // Canonical formatLiveYieldMetric token-aware prefix verification
    assert.strictEqual(
      formatLiveYieldMetric(1234.56789, "USDC", "+", 6),
      "+$1,234.567890"
    );
    assert.strictEqual(
      formatLiveYieldMetric(1234.56789, "USDC", "-", 6),
      "-$1,234.567890"
    );
    assert.strictEqual(
      formatLiveYieldMetric(1234.56789, "USDC", "", 6),
      "$1,234.567890"
    );
    assert.strictEqual(
      formatLiveYieldMetric(12.345678, "SOL", "+", 6),
      "+12.345678 SOL"
    );
    assert.strictEqual(
      formatLiveYieldMetric(12.345678, "SOL", "-", 6),
      "-12.345678 SOL"
    );
  });

  it("should synchronize minimum yield status live ticker and threshold progress", () => {
    const syncTime = 1_700_000_000;
    const pool = createDefaultPoolFallback(1);
    pool.totalDepositedPrincipal = 1_000_000 * 10 ** USDC_DECIMALS; // 1M USDC
    pool.grossYield = 5_000 * 10 ** USDC_DECIMALS; // 5,000 USDC gross (50% of 10,000 threshold)
    pool.minYieldThreshold = 10_000 * 10 ** USDC_DECIMALS; // 10,000 USDC gross target
    pool.feeBasisPoints = 250; // 2.50% fee (net target = 9,750 USDC)
    pool.protocolFeeAmount = 125 * 10 ** USDC_DECIMALS;
    pool.estimatedPrizePot = 4_875 * 10 ** USDC_DECIMALS;
    pool.underlyingApy = 0.085;
    pool.lastSyncedAt = syncTime;

    // Mathematical Identity of Gross vs. Net Threshold Progress
    const breakdown = resolvePoolThresholdBreakdown(pool);
    assert.strictEqual(
      breakdown.isConfigured,
      true,
      "10k threshold must be configured"
    );
    assert.strictEqual(breakdown.isMet, false, "5k / 10k must not be met");
    assert.strictEqual(
      breakdown.progressPercent,
      50,
      "Progress must be exactly 50%"
    );
    assert.strictEqual(
      breakdown.gross.targetUi,
      10_000,
      "Gross target must be 10,000 USDC"
    );
    assert.strictEqual(
      breakdown.net.targetUi,
      9_750,
      "Net target must be 9,750 USDC"
    );
    assert.strictEqual(
      breakdown.gross.currentUi,
      5_000,
      "Gross current must be 5,000 USDC"
    );
    assert.strictEqual(
      breakdown.net.currentUi,
      4_875,
      "Net current must be 4,875 USDC"
    );

    // Ratio check: 4,875 / 9,750 === 5,000 / 10,000 === 0.5
    assert.strictEqual(
      breakdown.net.currentUi / breakdown.net.targetUi,
      breakdown.gross.currentUi / breakdown.gross.targetUi,
      "Gross and Net progress ratios must be strictly equal"
    );

    // 60 FPS Live Accrual Synchronization with calculateLiveYieldBreakdown
    const dt = 3600; // 1 hour later
    const live = calculateLiveYieldBreakdown(pool, syncTime + dt);
    const liveProgressPct = Math.min(
      100,
      (live.netYieldUi / breakdown.net.targetUi) * 100
    );
    const expectedNetYield =
      4_875 + (1_000_000 * (0.085 * (1 - 0.025)) * 3600) / SECONDS_PER_YEAR;
    assert.ok(
      Math.abs(live.netYieldUi - expectedNetYield) < 1e-6,
      "Live net yield must match 1-hour accrual formula"
    );
    assert.ok(
      liveProgressPct > 50,
      "Live progress percentage must tick upward with accrued yield"
    );

    // Dynamic Boundary Crossing (< 100% -> >= 100%)
    const crossingDt = 2_000_000;
    const liveAfterCrossing = calculateLiveYieldBreakdown(
      pool,
      syncTime + crossingDt
    );
    const crossedProgressPct = Math.min(
      100,
      (liveAfterCrossing.netYieldUi / breakdown.net.targetUi) * 100
    );
    assert.strictEqual(
      crossedProgressPct,
      100,
      "Progress must cap at 100% upon crossing threshold"
    );
    assert.ok(
      liveAfterCrossing.netYieldUi >= breakdown.net.targetUi,
      "Net yield must exceed net target"
    );

    // Defensive Handling: Zero Threshold, Zero TVL, Frozen Pool
    const zeroTargetPool = { ...pool, minYieldThreshold: 0 };
    const zeroBreakdown = resolvePoolThresholdBreakdown(zeroTargetPool);
    assert.strictEqual(zeroBreakdown.isConfigured, false);
    assert.strictEqual(zeroBreakdown.isMet, true);
    assert.strictEqual(zeroBreakdown.progressPercent, 100);

    const frozenPool = { ...pool, isFrozenForDraw: true };
    const frozenLive = calculateLiveYieldBreakdown(frozenPool, syncTime + 1000);
    assert.strictEqual(
      frozenLive.netYieldUi,
      pool.estimatedPrizePot / 10 ** pool.tokenDecimals,
      "Frozen pool live yield must remain clamped at snapshot base"
    );
  });
});
