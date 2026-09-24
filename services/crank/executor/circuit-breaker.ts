export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerEvent {
  poolId?: number;
  type: "TRIP" | "RESET" | "PROBE";
  reason: string;
  timestamp: number;
}

export type CircuitBreakerListener = (event: CircuitBreakerEvent) => void;

interface BreakerInternalState {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  nextProbeTime: number;
}

export class CircuitBreaker {
  private globalState: BreakerInternalState = {
    state: "CLOSED",
    consecutiveFailures: 0,
    nextProbeTime: 0,
  };
  private poolStates: Map<number, BreakerInternalState> = new Map();
  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;
  private listener?: CircuitBreakerListener;

  constructor(
    failureThreshold = 5,
    cooldownPeriodMs = 60_000,
    listener?: CircuitBreakerListener
  ) {
    this.failureThreshold = failureThreshold;
    this.cooldownPeriodMs = cooldownPeriodMs;
    this.listener = listener;
  }

  setListener(listener: CircuitBreakerListener): void {
    this.listener = listener;
  }

  private getInternalState(poolId?: number): BreakerInternalState {
    if (poolId === undefined) {
      return this.globalState;
    }
    let pState = this.poolStates.get(poolId);
    if (!pState) {
      pState = {
        state: "CLOSED",
        consecutiveFailures: 0,
        nextProbeTime: 0,
      };
      this.poolStates.set(poolId, pState);
    }
    return pState;
  }

  getState(poolId?: number): CircuitBreakerState {
    // Check global state first
    if (
      this.globalState.state === "OPEN" &&
      Date.now() >= this.globalState.nextProbeTime
    ) {
      this.globalState.state = "HALF_OPEN";
      this.emitEvent({
        type: "PROBE",
        reason: "Global cooldown elapsed. State is HALF_OPEN",
        timestamp: Date.now(),
      });
    }

    if (poolId === undefined) {
      return this.globalState.state;
    }

    // If global breaker is OPEN, pool is also effectively blocked
    if (this.globalState.state === "OPEN") {
      return "OPEN";
    }

    const pState = this.getInternalState(poolId);
    if (pState.state === "OPEN" && Date.now() >= pState.nextProbeTime) {
      pState.state = "HALF_OPEN";
      this.emitEvent({
        poolId,
        type: "PROBE",
        reason: `Pool #${poolId} cooldown elapsed. State is HALF_OPEN`,
        timestamp: Date.now(),
      });
    }
    return pState.state;
  }

  canExecute(poolId?: number): boolean {
    const current = this.getState(poolId);
    return current === "CLOSED" || current === "HALF_OPEN";
  }

  recordSuccess(poolId?: number): void {
    if (poolId === undefined) {
      if (this.globalState.state !== "CLOSED") {
        this.emitEvent({
          type: "RESET",
          reason: "Global circuit breaker recovered to CLOSED",
          timestamp: Date.now(),
        });
      }
      this.globalState.consecutiveFailures = 0;
      this.globalState.state = "CLOSED";
      return;
    }

    const pState = this.getInternalState(poolId);
    if (pState.state !== "CLOSED") {
      this.emitEvent({
        poolId,
        type: "RESET",
        reason: `Pool #${poolId} circuit breaker recovered to CLOSED`,
        timestamp: Date.now(),
      });
    }
    pState.consecutiveFailures = 0;
    pState.state = "CLOSED";

    // If global was HALF_OPEN, recover it too
    if (this.globalState.state === "HALF_OPEN") {
      this.globalState.consecutiveFailures = 0;
      this.globalState.state = "CLOSED";
    }
  }

  recordPoolFailure(poolId: number, reason: string, isFatal = false): void {
    const pState = this.getInternalState(poolId);
    pState.consecutiveFailures += 1;

    if (isFatal || pState.consecutiveFailures >= this.failureThreshold) {
      pState.state = "OPEN";
      pState.nextProbeTime = Date.now() + this.cooldownPeriodMs;
      this.emitEvent({
        poolId,
        type: "TRIP",
        reason: `Pool #${poolId} circuit breaker tripped to OPEN. Reason: ${reason} (consecutive failures: ${pState.consecutiveFailures})`,
        timestamp: Date.now(),
      });
    }
  }

  recordGlobalFailure(reason: string, isFatal = false): void {
    this.globalState.consecutiveFailures += 1;

    if (
      isFatal ||
      this.globalState.consecutiveFailures >= this.failureThreshold
    ) {
      this.globalState.state = "OPEN";
      this.globalState.nextProbeTime = Date.now() + this.cooldownPeriodMs;
      this.emitEvent({
        type: "TRIP",
        reason: `Global circuit breaker tripped to OPEN. Reason: ${reason} (consecutive failures: ${this.globalState.consecutiveFailures})`,
        timestamp: Date.now(),
      });
    }
  }

  recordFailure(reason: string, isFatal = false, poolId?: number): void {
    if (poolId !== undefined) {
      this.recordPoolFailure(poolId, reason, isFatal);
    } else {
      this.recordGlobalFailure(reason, isFatal);
    }
  }

  private emitEvent(event: CircuitBreakerEvent): void {
    const timestamp = new Date(event.timestamp).toISOString();
    console.error(
      `[CircuitBreaker] [${event.type}] ${timestamp}: ${event.reason}`
    );
    if (this.listener) {
      try {
        this.listener(event);
      } catch {
        // Suppress listener callback error
      }
    }
  }
}
