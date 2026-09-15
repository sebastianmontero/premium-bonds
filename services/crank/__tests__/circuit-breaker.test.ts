import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../executor/circuit-breaker";
import { loadConfig } from "../config";
import { withVirtualClock } from "@/app/lib/test-harness";

describe("Circuit Breaker Unit Tests", () => {
  it("should initialize in CLOSED state and allow execution", () => {
    const config = loadConfig({ dryRun: true });
    const breaker = new CircuitBreaker(config, 3, 100);

    assert.strictEqual(breaker.getState(), "CLOSED");
    assert.strictEqual(breaker.canExecute(), true);
  });

  it("should trip to OPEN after reaching failure threshold", async () => {
    const config = loadConfig({ dryRun: true });
    const breaker = new CircuitBreaker(config, 3, 100);

    await breaker.recordFailure("network error 1");
    assert.strictEqual(breaker.getState(), "CLOSED");
    assert.strictEqual(breaker.canExecute(), true);

    await breaker.recordFailure("network error 2");
    assert.strictEqual(breaker.getState(), "CLOSED");
    assert.strictEqual(breaker.canExecute(), true);

    await breaker.recordFailure("network error 3");
    assert.strictEqual(breaker.getState(), "OPEN");
    assert.strictEqual(breaker.canExecute(), false);
  });

  it("should trip to OPEN immediately on fatal errors", async () => {
    const config = loadConfig({ dryRun: true });
    const breaker = new CircuitBreaker(config, 5, 100);

    await breaker.recordFailure("HaltedInsolvent", true);
    assert.strictEqual(breaker.getState(), "OPEN");
    assert.strictEqual(breaker.canExecute(), false);
  });

  it("should transition to HALF_OPEN after cooldown and recover to CLOSED on success", async () => {
    await withVirtualClock(async (clock) => {
      const config = loadConfig({ dryRun: true });
      const cooldownMs = 30_000;
      const breaker = new CircuitBreaker(config, 2, cooldownMs);

      await breaker.recordFailure("fail 1");
      await breaker.recordFailure("fail 2");
      assert.strictEqual(
        breaker.getState(),
        "OPEN",
        "Must trip to OPEN after reaching failure threshold"
      );
      assert.strictEqual(
        breaker.canExecute(),
        false,
        "Must block execution when OPEN"
      );

      // Fast-forward virtual clock past cooldown window
      clock.tick(cooldownMs + 1);

      assert.strictEqual(
        breaker.getState(),
        "HALF_OPEN",
        "Must transition to HALF_OPEN after cooldown expires"
      );
      assert.strictEqual(
        breaker.canExecute(),
        true,
        "Must allow probe execution in HALF_OPEN state"
      );

      breaker.recordSuccess();
      assert.strictEqual(
        breaker.getState(),
        "CLOSED",
        "Must recover to CLOSED state upon probe success"
      );
      assert.strictEqual(
        breaker.canExecute(),
        true,
        "Must allow execution when recovered to CLOSED"
      );
    });
  });
});
