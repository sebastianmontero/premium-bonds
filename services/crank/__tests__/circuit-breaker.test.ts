import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CircuitBreaker,
  CircuitBreakerEvent,
} from "../executor/circuit-breaker";
import { withVirtualClock } from "@/app/lib/test-harness";

describe("Circuit Breaker Unit Tests", () => {
  it("should initialize in CLOSED state and allow execution", () => {
    const breaker = new CircuitBreaker(3, 100);

    assert.strictEqual(breaker.getState(), "CLOSED");
    assert.strictEqual(breaker.canExecute(), true);
    assert.strictEqual(breaker.getState(1), "CLOSED");
    assert.strictEqual(breaker.canExecute(1), true);
  });

  it("should isolate failures per pool: tripping Pool #1 does not trip Pool #2", () => {
    const events: CircuitBreakerEvent[] = [];
    const breaker = new CircuitBreaker(3, 100, (e) => events.push(e));

    breaker.recordPoolFailure(1, "fail 1");
    breaker.recordPoolFailure(1, "fail 2");
    breaker.recordPoolFailure(1, "fail 3");

    assert.strictEqual(breaker.getState(1), "OPEN");
    assert.strictEqual(breaker.canExecute(1), false);

    // Pool 2 remains unaffected and CLOSED
    assert.strictEqual(breaker.getState(2), "CLOSED");
    assert.strictEqual(breaker.canExecute(2), true);

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].poolId, 1);
    assert.strictEqual(events[0].type, "TRIP");
  });

  it("should trip to OPEN immediately on fatal errors", () => {
    const breaker = new CircuitBreaker(5, 100);

    breaker.recordPoolFailure(1, "HaltedInsolvent", true);
    assert.strictEqual(breaker.getState(1), "OPEN");
    assert.strictEqual(breaker.canExecute(1), false);
  });

  it("should block all pools when global failure threshold is reached", () => {
    const breaker = new CircuitBreaker(2, 100);

    breaker.recordGlobalFailure("RPC 429 Too Many Requests");
    assert.strictEqual(breaker.getState(), "CLOSED");
    assert.strictEqual(breaker.canExecute(1), true);

    breaker.recordGlobalFailure("RPC 429 Too Many Requests");
    assert.strictEqual(breaker.getState(), "OPEN");
    assert.strictEqual(breaker.canExecute(), false);
    assert.strictEqual(breaker.canExecute(1), false);
    assert.strictEqual(breaker.canExecute(2), false);
  });

  it("should transition to HALF_OPEN after cooldown and recover to CLOSED on success", async () => {
    await withVirtualClock(async (clock) => {
      const cooldownMs = 30_000;
      const breaker = new CircuitBreaker(2, cooldownMs);

      breaker.recordPoolFailure(1, "fail 1");
      breaker.recordPoolFailure(1, "fail 2");
      assert.strictEqual(
        breaker.getState(1),
        "OPEN",
        "Must trip to OPEN after reaching failure threshold"
      );
      assert.strictEqual(
        breaker.canExecute(1),
        false,
        "Must block execution when OPEN"
      );

      // Fast-forward virtual clock past cooldown window
      clock.tick(cooldownMs + 1);

      assert.strictEqual(
        breaker.getState(1),
        "HALF_OPEN",
        "Must transition to HALF_OPEN after cooldown expires"
      );
      assert.strictEqual(
        breaker.canExecute(1),
        true,
        "Must allow probe execution in HALF_OPEN state"
      );

      breaker.recordSuccess(1);
      assert.strictEqual(
        breaker.getState(1),
        "CLOSED",
        "Must recover to CLOSED state upon probe success"
      );
      assert.strictEqual(
        breaker.canExecute(1),
        true,
        "Must allow execution when recovered to CLOSED"
      );
    });
  });
});
