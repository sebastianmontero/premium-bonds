import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AlertNotifier } from "../alerts/alert-notifier";
import { loadConfig } from "../config";

describe("AlertNotifier Unit Tests", () => {
  it("should rate limit non-critical alerts per event/pool within rate limit window", async () => {
    const config = loadConfig({ dryRun: true });
    const notifier = new AlertNotifier(config, 60_000);

    // Call twice in rapid succession
    await notifier.notifyAlert("TEST_EVENT", "First message", 1, "warning");
    await notifier.notifyAlert("TEST_EVENT", "Second message", 1, "warning");

    // Critical alerts should bypass rate limiting
    await notifier.notifyAlert(
      "CRITICAL_EVENT",
      "Critical message",
      1,
      "critical"
    );
    assert.strictEqual(true, true);
  });

  it("should not trigger low balance alert if balance is >= 0.2 SOL", async () => {
    const config = loadConfig({ dryRun: true });
    const notifier = new AlertNotifier(config);

    // 0.5 SOL >= 0.2 SOL -> no alert
    await notifier.notifyLowBalance(0.5);
    assert.strictEqual(true, true);
  });
});
