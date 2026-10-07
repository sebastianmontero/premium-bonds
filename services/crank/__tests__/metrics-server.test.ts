import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetricsServer } from "../metrics/metrics-server";

describe("Metrics Server Unit Tests", () => {
  it("should serve /health and /metrics endpoints correctly on ephemeral port", async () => {
    const server = new MetricsServer(0);

    await server.start();
    const testPort = server.getPort();
    assert.ok(testPort > 0, "Server must bind to an ephemeral port > 0");

    try {
      server.incrementTx("HarvestYieldWorker", true);
      server.incrementTx("PrepareDrawWorker", false);
      server.incrementError("PrepareDrawWorker", "RpcTimeout");
      server.updateSolBalance(2.5);
      server.updatePoolState(1, 2, false, "IDLE");
      server.updateRegistryStats(1, 4096, 3800);

      // Test /health
      const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
      const healthJson = (await healthRes.json()) as {
        status: string;
        solBalance: number;
        pools: Array<{ poolId: number; activeCycle: number }>;
        registry: Array<{
          poolId: number;
          capacity: number;
          userCount: number;
          headroom: number;
        }>;
      };
      assert.strictEqual(healthJson.status, "ok");
      assert.strictEqual(healthJson.solBalance, 2.5);
      assert.strictEqual(healthJson.pools.length, 1);
      assert.strictEqual(healthJson.pools[0].poolId, 1);
      assert.strictEqual(healthJson.pools[0].activeCycle, 2);
      assert.strictEqual(healthJson.registry.length, 1);
      assert.strictEqual(healthJson.registry[0].poolId, 1);
      assert.strictEqual(healthJson.registry[0].capacity, 4096);
      assert.strictEqual(healthJson.registry[0].userCount, 3800);
      assert.strictEqual(healthJson.registry[0].headroom, 296);

      // Test /metrics
      const metricsRes = await fetch(`http://127.0.0.1:${testPort}/metrics`);
      assert.strictEqual(metricsRes.status, 200);
      const metricsText = await metricsRes.text();
      assert.match(metricsText, /yieldbonds_crank_sol_balance 2.5/);
      assert.match(
        metricsText,
        /yieldbonds_crank_tx_total\{worker="HarvestYieldWorker",status="success"\} 1/
      );
      assert.match(
        metricsText,
        /yieldbonds_crank_errors_total\{worker="PrepareDrawWorker",error_type="RpcTimeout"\} 1/
      );
      assert.match(
        metricsText,
        /yieldbonds_pool_registry_capacity\{pool_id="1"\} 4096/
      );
      assert.match(
        metricsText,
        /yieldbonds_pool_registry_user_count\{pool_id="1"\} 3800/
      );
      assert.match(
        metricsText,
        /yieldbonds_pool_registry_headroom_slots\{pool_id="1"\} 296/
      );
    } finally {
      await server.stop();
    }
  });

  it("should evict payout registry claimable metric when clearPayoutRegistryClaimable is called", async () => {
    const server = new MetricsServer(0);
    await server.start();
    const testPort = server.getPort();

    try {
      server.setPayoutRegistryClaimable(1, 10, true);
      server.setPayoutRegistryClaimable(2, 5, false);

      let res = await fetch(`http://127.0.0.1:${testPort}/metrics`);
      let text = await res.text();
      assert.match(
        text,
        /yieldbonds_crank_payout_registry_claimable\{pool_id="1",cycle_id="10"\} 1/
      );
      assert.match(
        text,
        /yieldbonds_crank_payout_registry_claimable\{pool_id="2",cycle_id="5"\} 0/
      );

      server.clearPayoutRegistryClaimable(1);

      res = await fetch(`http://127.0.0.1:${testPort}/metrics`);
      text = await res.text();
      assert.doesNotMatch(
        text,
        /yieldbonds_crank_payout_registry_claimable\{pool_id="1",cycle_id="10"\}/
      );
      assert.match(
        text,
        /yieldbonds_crank_payout_registry_claimable\{pool_id="2",cycle_id="5"\} 0/
      );
    } finally {
      await server.stop();
    }
  });
});
