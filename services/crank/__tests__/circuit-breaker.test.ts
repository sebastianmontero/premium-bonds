import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../executor/circuit-breaker";
import { loadConfig } from "../config";

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
    const config = loadConfig({ dryRun: true });
    const cooldownMs = 50;
    const breaker = new CircuitBreaker(config, 2, cooldownMs);

    await breaker.recordFailure("fail 1");
    await breaker.recordFailure("fail 2");
    assert.strictEqual(breaker.getState(), "OPEN");
    assert.strictEqual(breaker.canExecute(), false);

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, cooldownMs + 10));

    assert.strictEqual(breaker.getState(), "HALF_OPEN");
    assert.strictEqual(breaker.canExecute(), true);

    breaker.recordSuccess();
    assert.strictEqual(breaker.getState(), "CLOSED");
    assert.strictEqual(breaker.canExecute(), true);
  });
});
