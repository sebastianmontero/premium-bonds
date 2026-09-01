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

      // Test /health
      const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
      const healthJson = (await healthRes.json()) as {
        status: string;
        solBalance: number;
        pools: Array<{ poolId: number; activeCycle: number }>;
      };
      assert.strictEqual(healthJson.status, "ok");
      assert.strictEqual(healthJson.solBalance, 2.5);
      assert.strictEqual(healthJson.pools.length, 1);
      assert.strictEqual(healthJson.pools[0].poolId, 1);
      assert.strictEqual(healthJson.pools[0].activeCycle, 2);

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
    } finally {
      await server.stop();
    }
  });
});
