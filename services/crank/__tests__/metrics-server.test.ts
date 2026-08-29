import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetricsServer } from "../metrics/metrics-server";

describe("Metrics Server Unit Tests", () => {
  it("should serve /health and /metrics endpoints correctly", async () => {
    const testPort = 9876;
    const server = new MetricsServer(testPort);

    await server.start();

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
      assert.equal(healthJson.status, "ok");
      assert.equal(healthJson.solBalance, 2.5);
      assert.equal(healthJson.pools.length, 1);
      assert.equal(healthJson.pools[0].poolId, 1);
      assert.equal(healthJson.pools[0].activeCycle, 2);

      // Test /metrics
      const metricsRes = await fetch(`http://127.0.0.1:${testPort}/metrics`);
      assert.equal(metricsRes.status, 200);
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
