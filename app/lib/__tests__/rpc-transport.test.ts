/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getErrorChain,
  getRetryAfterMs,
  isRateLimitRpcError,
  isRetryableRpcError,
  calculateBackoffDelay,
  normalizeRpcPayload,
  createResilientRpc,
  sleepAbortable,
  RateLimitCoordinator,
  type BackoffConfig,
} from "../rpc-transport";
import {
  SolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
  address,
} from "@solana/kit";

function createMockHttpSolanaError(
  statusCode: number,
  headers?: any
): SolanaError<typeof SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR> {
  return new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    statusCode,
    headers: headers ?? {},
    message: `HTTP error (${statusCode})`,
  } as any);
}

describe("RPC Resilient Transport Unit Tests (rpc-transport.test.ts)", () => {
  describe("sleepAbortable", () => {
    it("should return immediately when delayMs is 0 or negative", async () => {
      const start = Date.now();
      await sleepAbortable(0);
      await sleepAbortable(-10);
      assert.ok(Date.now() - start < 50);
    });

    it("should reject immediately if signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        async () => {
          await sleepAbortable(1000, controller.signal);
        },
        { name: "AbortError" }
      );
    });

    it("should resolve normally after delay and clean up event listener", async () => {
      const controller = new AbortController();
      const start = Date.now();
      await sleepAbortable(20, controller.signal);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 15);
    });

    it("should reject immediately when signal aborts mid-sleep and clean up timer", async () => {
      const controller = new AbortController();
      const start = Date.now();
      setTimeout(() => controller.abort(), 20);

      await assert.rejects(
        async () => {
          await sleepAbortable(5000, controller.signal);
        },
        { name: "AbortError" }
      );

      const elapsed = Date.now() - start;
      assert.ok(elapsed < 1000);
    });
  });

  describe("getErrorChain", () => {
    it("should traverse cause chain in order", () => {
      const err3 = new Error("Root cause");
      const err2 = new Error("Middle wrapper", { cause: err3 });
      const err1 = new Error("Top level wrapper", { cause: err2 });

      const chain = Array.from(getErrorChain(err1));
      assert.strictEqual(chain.length, 3);
      assert.strictEqual(chain[0], err1);
      assert.strictEqual(chain[1], err2);
      assert.strictEqual(chain[2], err3);
    });

    it("should safely handle circular references without infinite loops", () => {
      const errA: any = new Error("Error A");
      const errB: any = new Error("Error B");
      errA.cause = errB;
      errB.cause = errA; // Cycle

      const chain = Array.from(getErrorChain(errA));
      assert.strictEqual(chain.length, 2);
      assert.strictEqual(chain[0], errA);
      assert.strictEqual(chain[1], errB);
    });

    it("should handle non-object, null, and undefined values safely", () => {
      assert.deepStrictEqual(Array.from(getErrorChain(null)), []);
      assert.deepStrictEqual(Array.from(getErrorChain(undefined)), []);
      assert.deepStrictEqual(Array.from(getErrorChain("plain string")), []);
      assert.deepStrictEqual(Array.from(getErrorChain(123)), []);
    });
  });

  describe("getRetryAfterMs", () => {
    it("should parse numeric seconds from retry-after header", () => {
      const solanaErr = createMockHttpSolanaError(429, { "retry-after": "5" });
      assert.strictEqual(getRetryAfterMs(solanaErr), 5000);
    });

    it("should parse numeric seconds from Headers instance", () => {
      const headersMap = new Map<string, string>();
      headersMap.set("retry-after", "12");
      const solanaErr = createMockHttpSolanaError(429, headersMap);
      assert.strictEqual(getRetryAfterMs(solanaErr), 12000);
    });

    it("should parse HTTP date string from retry-after header", () => {
      const targetDate = new Date(Date.now() + 15000);
      const solanaErr = createMockHttpSolanaError(429, {
        "retry-after": targetDate.toUTCString(),
      });
      const ms = getRetryAfterMs(solanaErr);
      assert.ok(ms !== null && ms > 10000 && ms <= 16000);
    });

    it("should parse direct retry-after-ms header", () => {
      const solanaErr = createMockHttpSolanaError(429, {
        "retry-after-ms": "3500",
      });
      assert.strictEqual(getRetryAfterMs(solanaErr), 3500);
    });

    it("should parse x-ratelimit-reset relative seconds", () => {
      const solanaErr = createMockHttpSolanaError(429, {
        "x-ratelimit-reset": "8",
      });
      assert.strictEqual(getRetryAfterMs(solanaErr), 8000);
    });

    it("should parse x-ratelimit-reset epoch seconds", () => {
      const futureEpochSec = Math.floor(Date.now() / 1000) + 15;
      const solanaErr = createMockHttpSolanaError(429, {
        "x-ratelimit-reset": String(futureEpochSec),
      });
      const ms = getRetryAfterMs(solanaErr);
      assert.ok(ms !== null && ms > 10000 && ms <= 16000);
    });

    it("should parse x-ratelimit-reset epoch milliseconds", () => {
      const futureEpochMs = Date.now() + 20000;
      const solanaErr = createMockHttpSolanaError(429, {
        "x-ratelimit-reset": String(futureEpochMs),
      });
      const ms = getRetryAfterMs(solanaErr);
      assert.ok(ms !== null && ms > 15000 && ms <= 21000);
    });

    it("should enforce 1000ms minimum floor on parsed delays", () => {
      const solanaErr = createMockHttpSolanaError(429, {
        "retry-after-ms": "50",
      });
      assert.strictEqual(getRetryAfterMs(solanaErr), 1000);
    });

    it("should find retry-after nested in error cause", () => {
      const httpErr = createMockHttpSolanaError(429, { "Retry-After": "8" });
      const wrapperErr = new Error("Transport failed", { cause: httpErr });
      assert.strictEqual(getRetryAfterMs(wrapperErr), 8000);
    });

    it("should return null if no retry-after header exists", () => {
      const httpErr = createMockHttpSolanaError(429, {});
      assert.strictEqual(getRetryAfterMs(httpErr), null);
      assert.strictEqual(getRetryAfterMs(new Error("generic error")), null);
    });
  });

  describe("RateLimitCoordinator", () => {
    it("should manage cooldown window and report cooling down status correctly", () => {
      let simulatedTime = 1000;
      const coordinator = new RateLimitCoordinator({
        defaultFallbackCooldownMs: 5000,
        defaultJitterMs: 0,
        minCooldownFloorMs: 1000,
        now: () => simulatedTime,
      });

      assert.strictEqual(coordinator.isCoolingDown(), false);
      assert.strictEqual(coordinator.getRemainingCooldownMs(), 0);

      const delay = coordinator.applyCooldown();
      assert.strictEqual(delay, 5000);
      assert.strictEqual(coordinator.isCoolingDown(), true);
      assert.strictEqual(coordinator.getCooldownUntil(), 6000);
      assert.strictEqual(coordinator.getRemainingCooldownMs(), 5000);

      simulatedTime = 4000;
      assert.strictEqual(coordinator.isCoolingDown(), true);
      assert.strictEqual(coordinator.getRemainingCooldownMs(), 2000);

      simulatedTime = 6000;
      assert.strictEqual(coordinator.isCoolingDown(), false);
      assert.strictEqual(coordinator.getRemainingCooldownMs(), 0);
    });

    it("should allow setCooldownUntil to modify cooldown target directly", () => {
      const coordinator = new RateLimitCoordinator();
      coordinator.setCooldownUntil(50000);
      assert.strictEqual(coordinator.getCooldownUntil(), 50000);

      coordinator.reset();
      assert.strictEqual(coordinator.getCooldownUntil(), 0);
      assert.strictEqual(coordinator.isCoolingDown(), false);
    });

    it("should take max target timestamp across concurrent applyCooldown calls", () => {
      const simulatedTime = 1000;
      const coordinator = new RateLimitCoordinator({
        defaultJitterMs: 0,
        now: () => simulatedTime,
      });

      coordinator.recordCooldown(3000); // target 4000
      assert.strictEqual(coordinator.getCooldownUntil(), 4000);

      coordinator.recordCooldown(2000); // target 3000 < 4000
      assert.strictEqual(coordinator.getCooldownUntil(), 4000);

      coordinator.recordCooldown(5000); // target 6000 > 4000
      assert.strictEqual(coordinator.getCooldownUntil(), 6000);
    });

    it("should abort waitForCooldown immediately if signal is aborted", async () => {
      const coordinator = new RateLimitCoordinator();
      coordinator.setCooldownUntil(Date.now() + 10000);

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);

      const start = Date.now();
      await assert.rejects(
        async () => {
          await coordinator.waitForCooldown(controller.signal);
        },
        { name: "AbortError" }
      );
      assert.ok(Date.now() - start < 1000);
    });

    it("should loop in waitForCooldown and wait longer if another request extends cooldown", async () => {
      const coordinator = new RateLimitCoordinator({
        defaultStaggerJitterMs: 0,
      });
      coordinator.setCooldownUntil(Date.now() + 40);

      // Extend cooldown while waiting
      setTimeout(() => {
        coordinator.setCooldownUntil(Date.now() + 80);
      }, 20);

      const start = Date.now();
      await coordinator.waitForCooldown();
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 70, `Expected elapsed >= 70ms, got ${elapsed}ms`);
    });
  });

  describe("isRateLimitRpcError", () => {
    it("should detect HTTP 429 status code from SolanaError", () => {
      const err = createMockHttpSolanaError(429);
      assert.strictEqual(isRateLimitRpcError(err), true);
    });

    it("should detect JSON-RPC -32005 rate limit error code", () => {
      const err = { code: -32005, message: "Server limit reached" };
      assert.strictEqual(isRateLimitRpcError(err), true);
    });

    it("should detect rate limit substrings in error messages", () => {
      assert.strictEqual(
        isRateLimitRpcError(new Error("HTTP error (429): Too Many Requests")),
        true
      );
      assert.strictEqual(
        isRateLimitRpcError(new Error("RPC rate limit reached for endpoint")),
        true
      );
      assert.strictEqual(
        isRateLimitRpcError(new Error("exceeded limit of requests per second")),
        true
      );
    });

    it("should inspect nested cause for rate limit errors", () => {
      const nested429 = createMockHttpSolanaError(429);
      const wrapper = new Error("Failed to send transaction", {
        cause: nested429,
      });
      assert.strictEqual(isRateLimitRpcError(wrapper), true);
    });

    it("should return false for non-rate-limit errors", () => {
      assert.strictEqual(isRateLimitRpcError(null), false);
      assert.strictEqual(isRateLimitRpcError(undefined), false);
      assert.strictEqual(
        isRateLimitRpcError(new Error("Invalid account")),
        false
      );
      assert.strictEqual(
        isRateLimitRpcError(createMockHttpSolanaError(404)),
        false
      );
    });
  });

  describe("isRetryableRpcError", () => {
    it("should classify all rate-limit errors as retryable", () => {
      const err429 = createMockHttpSolanaError(429);
      assert.strictEqual(isRetryableRpcError(err429), true);
    });

    it("should classify 408 and 5xx HTTP errors as retryable", () => {
      const err408 = createMockHttpSolanaError(408);
      const err500 = createMockHttpSolanaError(500);
      const err503 = createMockHttpSolanaError(503);
      assert.strictEqual(isRetryableRpcError(err408), true);
      assert.strictEqual(isRetryableRpcError(err500), true);
      assert.strictEqual(isRetryableRpcError(err500), true);
      assert.strictEqual(isRetryableRpcError(err503), true);
    });

    it("should classify node unhealthy error as retryable", () => {
      const unhealthy = new SolanaError(
        SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
        {} as any
      );
      assert.strictEqual(isRetryableRpcError(unhealthy), true);
    });

    it("should classify standard Node.js network socket codes as retryable", () => {
      const socketErr: any = new Error("socket error");
      socketErr.code = "UND_ERR_SOCKET";
      assert.strictEqual(isRetryableRpcError(socketErr), true);

      const connReset: any = new Error("conn reset");
      connReset.code = "ECONNRESET";
      assert.strictEqual(isRetryableRpcError(connReset), true);

      const timeoutErr: any = new Error("timeout");
      timeoutErr.code = "ETIMEDOUT";
      assert.strictEqual(isRetryableRpcError(timeoutErr), true);
    });

    it("should classify common transient network error messages as retryable", () => {
      assert.strictEqual(
        isRetryableRpcError(new TypeError("fetch failed")),
        true
      );
      assert.strictEqual(
        isRetryableRpcError(new Error("socket hang up")),
        true
      );
      assert.strictEqual(
        isRetryableRpcError(new Error("other side closed")),
        true
      );
    });

    it("should reject non-retryable errors (HTTP 400, 401, 403, 404, program errors)", () => {
      const err400 = createMockHttpSolanaError(400);
      const err404 = createMockHttpSolanaError(404);
      assert.strictEqual(isRetryableRpcError(err400), false);
      assert.strictEqual(isRetryableRpcError(err404), false);
      assert.strictEqual(
        isRetryableRpcError(new Error("custom program error: 0x1")),
        false
      );
    });
  });

  describe("calculateBackoffDelay & Equal Jitter", () => {
    const config: BackoffConfig = {
      initialDelayMs: 500,
      maxDelayMs: 8000,
      backoffFactor: 2,
      jitter: true,
    };

    it("should enforce Equal Jitter bounds (50% floor and 100% ceiling)", () => {
      for (let i = 0; i < 50; i++) {
        const delay = calculateBackoffDelay(1, config);
        assert.ok(
          delay >= 250 && delay <= 500,
          `Attempt 1 delay ${delay} out of range [250, 500]`
        );
      }

      for (let i = 0; i < 50; i++) {
        const delay = calculateBackoffDelay(2, config);
        assert.ok(
          delay >= 500 && delay <= 1000,
          `Attempt 2 delay ${delay} out of range [500, 1000]`
        );
      }

      for (let i = 0; i < 50; i++) {
        const delay = calculateBackoffDelay(3, config);
        assert.ok(
          delay >= 1000 && delay <= 2000,
          `Attempt 3 delay ${delay} out of range [1000, 2000]`
        );
      }
    });

    it("should cap backoff delay at maxDelayMs", () => {
      for (let i = 0; i < 20; i++) {
        const delay = calculateBackoffDelay(10, config);
        assert.ok(
          delay >= 4000 && delay <= 8000,
          `Max delay ${delay} must be <= maxDelayMs (8000) and >= floor (4000)`
        );
      }
    });

    it("should prioritize retryAfterMs when provided and cap at maxDelayMs", () => {
      const delay1 = calculateBackoffDelay(1, config, 3000);
      assert.strictEqual(delay1, 3000);

      const delay2 = calculateBackoffDelay(1, config, 15000);
      assert.strictEqual(delay2, 8000); // capped at maxDelayMs
    });

    it("should return exact exponential delay when jitter is false", () => {
      const noJitterConfig: BackoffConfig = {
        ...config,
        jitter: false,
      };
      assert.strictEqual(calculateBackoffDelay(1, noJitterConfig), 500);
      assert.strictEqual(calculateBackoffDelay(2, noJitterConfig), 1000);
      assert.strictEqual(calculateBackoffDelay(3, noJitterConfig), 2000);
      assert.strictEqual(calculateBackoffDelay(4, noJitterConfig), 4000);
      assert.strictEqual(calculateBackoffDelay(5, noJitterConfig), 8000);
      assert.strictEqual(calculateBackoffDelay(6, noJitterConfig), 8000);
    });
  });

  describe("normalizeRpcPayload", () => {
    it("should add base64 encoding to account query methods when missing", () => {
      const req1 = normalizeRpcPayload({
        method: "getAccountInfo",
        params: ["11111111111111111111111111111111"],
      });
      assert.strictEqual(req1.params[1].encoding, "base64");

      const req2 = normalizeRpcPayload({
        method: "getMultipleAccounts",
        params: [["11111111111111111111111111111111"]],
      });
      assert.strictEqual(req2.params[1].encoding, "base64");

      const req3 = normalizeRpcPayload({
        method: "getProgramAccounts",
        params: ["11111111111111111111111111111111", { filters: [] }],
      });
      assert.strictEqual(req3.params[1].encoding, "base64");
    });

    it("should preserve custom encoding if already specified", () => {
      const req = normalizeRpcPayload({
        method: "getAccountInfo",
        params: [
          "11111111111111111111111111111111",
          { encoding: "base64+zstd" },
        ],
      });
      assert.strictEqual(req.params[1].encoding, "base64+zstd");
    });

    it("should recursively normalize batch request arrays", () => {
      const batch = normalizeRpcPayload([
        {
          method: "getAccountInfo",
          params: ["11111111111111111111111111111111"],
        },
        {
          method: "getSlot",
          params: [],
        },
      ]);
      assert.strictEqual(batch[0].params[1].encoding, "base64");
      assert.strictEqual(batch[1].method, "getSlot");
    });

    it("should leave non-account query methods untouched", () => {
      const req = {
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }],
      };
      const normalized = normalizeRpcPayload(req);
      assert.deepStrictEqual(normalized, req);
    });
  });

  describe("createResilientRpc", () => {
    it("should retry transient errors and succeed once recovered", async () => {
      let callCount = 0;
      const retryAttempts: number[] = [];

      const mockTransport: any = async (req: any) => {
        callCount++;
        if (callCount < 3) {
          throw createMockHttpSolanaError(429);
        }
        return {
          jsonrpc: "2.0",
          id: req.payload?.id ?? 1,
          result: { context: { slot: 123 }, value: null },
        };
      };

      const coordinator = new RateLimitCoordinator({
        defaultFallbackCooldownMs: 20,
        defaultJitterMs: 0,
        defaultStaggerJitterMs: 0,
        minCooldownFloorMs: 10,
      });

      const rpc = createResilientRpc("http://mock-rpc", {
        transport: mockTransport,
        rateLimitCoordinator: coordinator,
        initialDelayMs: 10,
        maxDelayMs: 50,
        onRetry: (_err, attempt) => {
          retryAttempts.push(attempt);
        },
      });

      const res = await rpc
        .getAccountInfo(address("11111111111111111111111111111111"))
        .send();

      assert.strictEqual(callCount, 3);
      assert.deepStrictEqual(retryAttempts, [1, 2]);
      assert.strictEqual(res.value, null);
    });

    it("should pause concurrent requests when one request hits 429", async () => {
      const coordinator = new RateLimitCoordinator({
        defaultFallbackCooldownMs: 80,
        defaultJitterMs: 0,
        defaultStaggerJitterMs: 0,
        minCooldownFloorMs: 50,
      });

      let callCount = 0;
      const timestamps: { req: string; time: number }[] = [];

      const mockTransport: any = async (req: any) => {
        callCount++;
        timestamps.push({ req: req.payload.params[0], time: Date.now() });
        if (callCount === 1) {
          // First call triggers 429
          throw createMockHttpSolanaError(429);
        }
        return {
          jsonrpc: "2.0",
          id: req.payload?.id ?? 1,
          result: { context: { slot: 123 }, value: null },
        };
      };

      const rpc = createResilientRpc("http://mock-rpc", {
        transport: mockTransport,
        rateLimitCoordinator: coordinator,
      });

      // Dispatch Request A and Request B concurrently
      const [resA, resB] = await Promise.all([
        rpc.getAccountInfo(address("11111111111111111111111111111111")).send(),
        (async () => {
          // Slightly offset dispatch of B
          await new Promise((r) => setTimeout(r, 10));
          return rpc
            .getAccountInfo(
              address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
            )
            .send();
        })(),
      ]);

      assert.strictEqual(resA.value, null);
      assert.strictEqual(resB.value, null);
      // 3 network attempts total: A (failed 429), A (retry ok after 80ms), B (waited until cooldown expired, ok on 1st attempt)
      assert.strictEqual(callCount, 3);
    });

    it("should abort immediately and reject with AbortError when AbortSignal triggers during backoff sleep", async () => {
      const controller = new AbortController();
      let callCount = 0;

      const mockTransport: any = async () => {
        callCount++;
        throw createMockHttpSolanaError(500); // 500 uses backoff sleep
      };

      const rpc = createResilientRpc("http://mock-rpc", {
        transport: mockTransport,
        initialDelayMs: 5000, // long delay
        maxDelayMs: 10000,
      });

      // Trigger abort shortly after launching request
      const start = Date.now();
      setTimeout(() => controller.abort(), 20);

      await assert.rejects(
        async () => {
          await rpc
            .getAccountInfo(address("11111111111111111111111111111111"))
            .send({ abortSignal: controller.signal });
        },
        { name: "AbortError" }
      );

      const elapsed = Date.now() - start;
      assert.ok(
        elapsed < 1000,
        `Abortable sleep must abort immediately, took ${elapsed}ms`
      );
      assert.strictEqual(callCount, 1);
    });

    it("should not retry non-retryable errors and fail immediately", async () => {
      let callCount = 0;
      const mockTransport: any = async () => {
        callCount++;
        throw createMockHttpSolanaError(400);
      };

      const rpc = createResilientRpc("http://mock-rpc", {
        transport: mockTransport,
        maxRetries: 3,
      });

      await assert.rejects(
        async () => {
          await rpc
            .getAccountInfo(address("11111111111111111111111111111111"))
            .send();
        },
        (err: any) => err.context?.statusCode === 400
      );

      assert.strictEqual(callCount, 1, "Should not retry HTTP 400");
    });
  });
});
