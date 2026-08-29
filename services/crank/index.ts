import { loadConfig } from "./config";
import { loadSignerKeypair } from "./keypair-manager";
import { createLeaderLock } from "./leader/leader-lock";
import { MetricsServer } from "./metrics/metrics-server";
import { AdaptiveCrankScheduler } from "./scheduler/adaptive-scheduler";

async function main() {
  const args = process.argv.slice(2);

  const dryRun = args.includes("--dry-run");
  const once = args.includes("--once");

  let poolIds: number[] | undefined;
  const poolIdx = args.indexOf("--pool");
  if (poolIdx !== -1 && args[poolIdx + 1]) {
    poolIds = [parseInt(args[poolIdx + 1], 10)];
  }

  const poolsIdx = args.indexOf("--pools");
  if (poolsIdx !== -1 && args[poolsIdx + 1]) {
    poolIds = args[poolsIdx + 1]
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
  }

  const portIdx = args.indexOf("--port");
  const metricsPort =
    portIdx !== -1 && args[portIdx + 1]
      ? parseInt(args[portIdx + 1], 10)
      : undefined;

  const config = loadConfig({
    dryRun,
    poolIds,
    metricsPort,
  });

  console.log(
    "================================================================================"
  );
  console.log("⚡ YieldBonds Autonomous Crank & Keeper Daemon Service");
  console.log(
    "================================================================================"
  );
  console.log(`RPC Endpoint:        ${config.rpcUrl}`);
  console.log(`Target Pools:        [${config.poolIds.join(", ")}]`);
  console.log(
    `Poll Interval:       ${config.pollIntervalMs}ms (Active: ${config.activeWindowPollIntervalMs}ms)`
  );
  console.log(
    `Auto-Disburse:       ${config.enableAutoDisburse ? "ENABLED" : "DISABLED"}`
  );
  console.log(`Dry Run Mode:        ${config.dryRun ? "ENABLED" : "DISABLED"}`);
  console.log(`Metrics Port:        ${config.metricsPort}`);
  console.log(
    "================================================================================"
  );

  const signer = await loadSignerKeypair(config);
  const leaderLock = createLeaderLock("local");
  const metrics = new MetricsServer(config.metricsPort);

  await metrics.start();
  console.log(
    `[Telemetry] Prometheus metrics & health server running on port ${config.metricsPort}`
  );

  const scheduler = new AdaptiveCrankScheduler(
    config,
    signer,
    leaderLock,
    metrics
  );

  if (once) {
    console.log("[Execution Mode] Running single tick sweep (--once)...");
    await scheduler.tickOnce();
    await metrics.stop();
    console.log("[Execution Mode] Single tick sweep complete. Exiting.");
    process.exit(0);
  }

  await scheduler.start();

  const shutdown = async (signal: string) => {
    console.log(`\n[Signal] Received ${signal}. Shutting down gracefully...`);
    await scheduler.stop();
    await metrics.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[Crank Daemon Fatal Error]:", err);
  process.exit(1);
});
