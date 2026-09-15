import { mock } from "node:test";

export interface VirtualClock {
  tick: (ms: number) => void;
  advanceToTime: (targetTimestampMs: number) => void;
}

/**
 * Executes a test function under virtualized timers, safely restoring native timers
 * in a finally block to prevent global state leaks across tests.
 */
export async function withVirtualClock<T>(
  fn: (clock: VirtualClock) => Promise<T> | T,
  initialTime?: number | Date
): Promise<T> {
  const initialEpoch =
    initialTime !== undefined ? new Date(initialTime).getTime() : undefined;
  mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: initialEpoch,
  });

  const clock: VirtualClock = {
    tick: (ms: number) => mock.timers.tick(ms),
    advanceToTime: (targetTimestampMs: number) => {
      const now = Date.now();
      if (targetTimestampMs > now) {
        mock.timers.tick(targetTimestampMs - now);
      }
    },
  };

  try {
    return await fn(clock);
  } finally {
    mock.timers.reset();
  }
}
