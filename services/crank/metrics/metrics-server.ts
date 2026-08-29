import http from "node:http";

export interface PoolMetricSnapshot {
  poolId: number;
  activeCycle: number;
  isFrozen: boolean;
  status: string;
}

export class MetricsServer {
  private server: http.Server | null = null;
  private txCounters: Map<string, number> = new Map();
  private errorCounters: Map<string, number> = new Map();
  private poolMetrics: Map<number, PoolMetricSnapshot> = new Map();
  private crankSolBalance = 0;
  private startTime = Date.now();

  constructor(private readonly port: number) {}

  incrementTx(workerName: string, success: boolean): void {
    const key = `${workerName}_${success ? "success" : "failed"}`;
    this.txCounters.set(key, (this.txCounters.get(key) || 0) + 1);
  }

  incrementError(workerName: string, errorType: string): void {
    const key = `${workerName}_${errorType}`;
    this.errorCounters.set(key, (this.errorCounters.get(key) || 0) + 1);
  }

  updatePoolState(
    poolId: number,
    activeCycle: number,
    isFrozen: boolean,
    status: string
  ): void {
    this.poolMetrics.set(poolId, {
      poolId,
      activeCycle,
      isFrozen,
      status,
    });
  }

  updateSolBalance(balance: number): void {
    this.crankSolBalance = balance;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const url = req.url || "/";

        if (url === "/health" || url === "/healthz") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
              solBalance: this.crankSolBalance,
              pools: Array.from(this.poolMetrics.values()),
            })
          );
          return;
        }

        if (url === "/metrics") {
          res.writeHead(200, {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          });
          let metricsOutput = "";

          // Uptime
          metricsOutput += `# HELP yieldbonds_crank_uptime_seconds Daemon uptime in seconds\n`;
          metricsOutput += `# TYPE yieldbonds_crank_uptime_seconds gauge\n`;
          metricsOutput += `yieldbonds_crank_uptime_seconds ${Math.floor((Date.now() - this.startTime) / 1000)}\n\n`;

          // SOL Balance
          metricsOutput += `# HELP yieldbonds_crank_sol_balance Crank signer SOL balance\n`;
          metricsOutput += `# TYPE yieldbonds_crank_sol_balance gauge\n`;
          metricsOutput += `yieldbonds_crank_sol_balance ${this.crankSolBalance}\n\n`;

          // Tx Counters
          metricsOutput += `# HELP yieldbonds_crank_tx_total Total transactions submitted\n`;
          metricsOutput += `# TYPE yieldbonds_crank_tx_total counter\n`;
          for (const [key, val] of this.txCounters.entries()) {
            const [worker, status] = key.split("_");
            metricsOutput += `yieldbonds_crank_tx_total{worker="${worker}",status="${status}"} ${val}\n`;
          }
          metricsOutput += "\n";

          // Error Counters
          metricsOutput += `# HELP yieldbonds_crank_errors_total Total errors encountered\n`;
          metricsOutput += `# TYPE yieldbonds_crank_errors_total counter\n`;
          for (const [key, val] of this.errorCounters.entries()) {
            const [worker, errorType] = key.split("_");
            metricsOutput += `yieldbonds_crank_errors_total{worker="${worker}",error_type="${errorType}"} ${val}\n`;
          }
          metricsOutput += "\n";

          // Pools
          metricsOutput += `# HELP yieldbonds_pool_cycle_id Current draw cycle ID for pool\n`;
          metricsOutput += `# TYPE yieldbonds_pool_cycle_id gauge\n`;
          for (const [poolId, data] of this.poolMetrics.entries()) {
            metricsOutput += `yieldbonds_pool_cycle_id{pool_id="${poolId}"} ${data.activeCycle}\n`;
          }

          res.end(metricsOutput);
          return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      });

      this.server.listen(this.port, () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }
}
