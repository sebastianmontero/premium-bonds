import {
  createDefaultRpcTransport,
  createSolanaRpc,
  createSolanaRpcFromTransport,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
} from "@solana/kit";

export type ResilientRpcClient = ReturnType<typeof createSolanaRpc>;

export interface BackoffConfig {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number;
  readonly jitter: boolean;
}

export interface RateLimitCoordinatorOptions {
  readonly defaultFallbackCooldownMs?: number;
  readonly defaultJitterMs?: number;
  readonly defaultStaggerJitterMs?: number;
  readonly minCooldownFloorMs?: number;
  readonly now?: () => number;
}

export interface CooldownOverrideOptions {
  readonly fallbackMs?: number;
  readonly jitterMs?: number;
}

/**
 * Centrally manages abortable timer delays, guaranteeing listener cleanup.
 */
export async function sleepAbortable(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, delayMs);

    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort!);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Traverses an Error.cause chain from outermost to innermost safely with circular reference protection.
 */
export function* getErrorChain(err: unknown): Generator<unknown> {
  let current = err;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    yield current;
    seen.add(current);
    current =
      "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
}

function parseHeaderValue(
  headers: Headers | Record<string, string> | Map<string, string>,
  targetName: string
): string | null {
  if (typeof (headers as Headers).get === "function") {
    const val = (headers as Headers).get(targetName);
    if (val !== null && val !== undefined) return val;
  }
  const target = targetName.toLowerCase();
  const entries =
    headers instanceof Map
      ? headers.entries()
      : Object.entries(headers as Record<string, string>);
  for (const [key, value] of entries) {
    if (key.toLowerCase() === target) {
      return String(value);
    }
  }
  return null;
}

/**
 * Extracts Retry-After delay in milliseconds from HTTP transport error headers if present.
 * Inspects retry-after-ms, retry-after (seconds or HTTP date), and x-ratelimit-reset (relative or epoch).
 */
export function getRetryAfterMs(err: unknown): number | null {
  for (const item of getErrorChain(err)) {
    if (!isSolanaError(item, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
      continue;
    }
    const context = item.context as
      | { headers?: Headers | Record<string, string> | Map<string, string> }
      | undefined;
    const headers = context?.headers;
    if (!headers) continue;

    // 1. Direct milliseconds header
    const msVal = parseHeaderValue(headers, "retry-after-ms");
    if (msVal && !isNaN(Number(msVal))) {
      return Math.max(1000, Number(msVal));
    }

    // 2. Standard Retry-After (seconds or HTTP-date)
    const retryAfter = parseHeaderValue(headers, "retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.max(1000, seconds * 1000);
      }
      const dateMs = Date.parse(retryAfter);
      if (!isNaN(dateMs)) {
        return Math.max(1000, dateMs - Date.now());
      }
    }

    // 3. x-ratelimit-reset (relative seconds, epoch seconds, or epoch ms)
    const resetVal = parseHeaderValue(headers, "x-ratelimit-reset");
    if (resetVal && !isNaN(Number(resetVal))) {
      const num = Number(resetVal);
      if (num > 10_000_000_000) {
        // Epoch milliseconds (> 10 billion)
        return Math.max(1000, num - Date.now());
      } else if (num > 1_000_000_000) {
        // Epoch seconds (1 billion to 10 billion)
        return Math.max(1000, num * 1000 - Date.now());
      } else if (num > 0) {
        // Relative seconds
        return Math.max(1000, num * 1000);
      }
    }
  }
  return null;
}

/**
 * Shared coordinator for RPC rate-limiting cooldown windows.
 */
export class RateLimitCoordinator {
  private cooldownUntil = 0;
  private readonly fallbackCooldownMs: number;
  private readonly jitterMs: number;
  private readonly defaultStaggerJitterMs: number;
  private readonly minCooldownFloorMs: number;
  private readonly now: () => number;

  constructor(options?: RateLimitCoordinatorOptions) {
    this.fallbackCooldownMs = options?.defaultFallbackCooldownMs ?? 10_000;
    this.jitterMs = options?.defaultJitterMs ?? 500;
    this.defaultStaggerJitterMs = options?.defaultStaggerJitterMs ?? 500;
    this.minCooldownFloorMs = options?.minCooldownFloorMs ?? 1_000;
    this.now = options?.now ?? Date.now;
  }

  applyCooldown(err?: unknown, overrides?: CooldownOverrideOptions): number {
    const serverRetryAfterMs = err ? getRetryAfterMs(err) : null;
    const baseDelay =
      serverRetryAfterMs !== null && serverRetryAfterMs > 0
        ? Math.max(this.minCooldownFloorMs, serverRetryAfterMs)
        : (overrides?.fallbackMs ?? this.fallbackCooldownMs);
    return this.recordCooldown(baseDelay, overrides?.jitterMs);
  }

  recordCooldown(baseDelayMs: number, customJitterMs?: number): number {
    const jitter = Math.random() * (customJitterMs ?? this.jitterMs);
    const effectiveDelay =
      Math.max(this.minCooldownFloorMs, baseDelayMs) + jitter;
    const target = this.now() + effectiveDelay;
    this.cooldownUntil = Math.max(this.cooldownUntil, target);
    return effectiveDelay;
  }

  setCooldownUntil(targetMs: number): void {
    this.cooldownUntil = targetMs;
  }

  async waitForCooldown(
    signal?: AbortSignal,
    staggerJitterMs?: number
  ): Promise<void> {
    // Re-checking loop prevents premature wakeups if another request extended cooldownUntil
    while (this.now() < this.cooldownUntil) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const stagger =
        Math.random() * (staggerJitterMs ?? this.defaultStaggerJitterMs);
      const sleepMs = Math.max(0, this.cooldownUntil - this.now()) + stagger;
      await sleepAbortable(sleepMs, signal);
    }
  }

  isCoolingDown(): boolean {
    return this.now() < this.cooldownUntil;
  }

  getRemainingCooldownMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  getCooldownUntil(): number {
    return this.cooldownUntil;
  }

  reset(): void {
    this.cooldownUntil = 0;
  }
}

/**
 * Detects whether an RPC or network transport error is an explicit HTTP 429 / rate limit.
 */
export function isRateLimitRpcError(err: unknown): boolean {
  if (!err) return false;
  for (const item of getErrorChain(err)) {
    if (isSolanaError(item, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
      if (item.context?.statusCode === 429) return true;
    }
    const errObj = item as {
      code?: number;
      context?: { statusCode?: number };
      message?: string;
    };
    if (
      errObj.code === 429 ||
      errObj.code === -32005 ||
      errObj.context?.statusCode === 429
    ) {
      return true;
    }
    const msg = String(errObj.message || item).toLowerCase();
    if (
      msg.includes("429") ||
      msg.includes("too many requests") ||
      msg.includes("rate limit") ||
      msg.includes("exceeded limit")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Detects whether an RPC or network transport error is transient and safe to retry.
 */
export function isRetryableRpcError(err: unknown): boolean {
  if (!err) return false;
  if (isRateLimitRpcError(err)) return true;

  const retryableCodes = new Set([
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENOTFOUND",
    "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
  ]);

  for (const item of getErrorChain(err)) {
    if (isSolanaError(item, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
      const status = item.context?.statusCode;
      if (status === 408 || (status !== undefined && status >= 500)) {
        return true;
      }
    }

    if (
      isSolanaError(item, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY)
    ) {
      return true;
    }

    const errObj = item as {
      code?: number | string;
      message?: string;
    };
    const msg = (errObj.message || "").toLowerCase();
    const code = typeof errObj.code === "string" ? errObj.code : undefined;

    if (code && retryableCodes.has(code)) return true;
    if (
      msg.includes("fetch failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("other side closed") ||
      msg.includes("socket hang up") ||
      msg.includes("connection reset")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates backoff delay with Equal Jitter (50% guaranteed base floor + 50% randomized jitter)
 * or uses Retry-After server directive if provided.
 */
export function calculateBackoffDelay(
  attempt: number,
  config: BackoffConfig,
  retryAfterMs?: number | null
): number {
  if (retryAfterMs !== null && retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(config.maxDelayMs, retryAfterMs);
  }
  const exponentialDelay = Math.min(
    config.maxDelayMs,
    config.initialDelayMs *
      Math.pow(config.backoffFactor, Math.max(0, attempt - 1))
  );
  if (!config.jitter) return exponentialDelay;
  // Equal Jitter: guaranteed 50% delay floor + 50% random jitter
  const half = exponentialDelay / 2;
  return half + Math.random() * half;
}

export const ACCOUNT_QUERY_METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getProgramAccounts",
]);

/**
 * Normalizes JSON-RPC request payloads to ensure binary account queries
 * default to base64 encoding rather than Solana's default base58 (which errors on data >= 128 bytes).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeRpcPayload(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) {
    return payload.map(normalizeRpcPayload);
  }
  const rpcObj = payload as { method?: string; params?: unknown[] };
  if (!rpcObj.method || !ACCOUNT_QUERY_METHODS.has(rpcObj.method))
    return payload;
  const params = Array.isArray(rpcObj.params) ? [...rpcObj.params] : [];
  if (params.length === 0) return payload;

  const config =
    params[1] && typeof params[1] === "object"
      ? { ...(params[1] as Record<string, unknown>) }
      : {};
  if (!config.encoding) {
    config.encoding = "base64";
    params[1] = config;
    return { ...rpcObj, params };
  }
  return payload;
}

export interface ResilientRpcConfig {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
  readonly jitter?: boolean;
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  readonly headers?: Record<string, string>;
  readonly transport?: Parameters<typeof createSolanaRpcFromTransport>[0];
  readonly rateLimitCoordinator?: RateLimitCoordinator;
}

/**
 * Creates a Solana RPC client wrapped with a resilient transport that automatically
 * normalizes account queries to base64 encoding and retries transient network, socket,
 * rate-limit, and connection-drop errors with Equal Jitter exponential backoff and abortable sleep.
 */
export function createResilientRpc(
  clusterUrl: string,
  config?: ResilientRpcConfig
): ResilientRpcClient {
  const defaultTransport =
    config?.transport ??
    createDefaultRpcTransport({
      url: clusterUrl,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers: config?.headers as any,
    });

  const coordinator =
    config?.rateLimitCoordinator ?? new RateLimitCoordinator();

  const maxRetries = config?.maxRetries ?? 5;
  const initialDelayMs = config?.initialDelayMs ?? 500;
  const maxDelayMs = config?.maxDelayMs ?? 30000;
  const backoffFactor = config?.backoffFactor ?? 2;
  const useJitter = config?.jitter ?? true;
  const backoffConfig: BackoffConfig = {
    initialDelayMs,
    maxDelayMs,
    backoffFactor,
    jitter: useJitter,
  };

  const resilientTransport = async <TResponse>(
    request: Parameters<typeof defaultTransport>[0]
  ): Promise<TResponse> => {
    const normalizedRequest = {
      ...request,
      payload: normalizeRpcPayload(request.payload),
    };
    let attempt = 0;
    while (true) {
      await coordinator.waitForCooldown(normalizedRequest.signal);

      if (normalizedRequest.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      try {
        return (await defaultTransport(normalizedRequest)) as TResponse;
      } catch (err) {
        let delayMs: number;
        if (isRateLimitRpcError(err)) {
          delayMs = coordinator.applyCooldown(err);
        } else {
          delayMs = calculateBackoffDelay(attempt + 1, backoffConfig);
        }

        if (
          normalizedRequest.signal?.aborted ||
          !isRetryableRpcError(err) ||
          attempt >= maxRetries
        ) {
          throw err;
        }

        attempt++;

        if (config?.onRetry) {
          config.onRetry(err, attempt, delayMs);
        } else {
          const cause = (err as { cause?: { message?: string } })?.cause;
          const msg =
            err instanceof Error ? cause?.message || err.message : String(err);
          console.warn(
            `[RPC Retry] Transient RPC error (${msg}) on attempt ${attempt}/${maxRetries}. Retrying in ${Math.round(delayMs)}ms...`
          );
        }

        if (isRateLimitRpcError(err)) {
          // Skip calculateBackoffDelay sleep! Loop back to waitForCooldown as single delay source.
        } else {
          await sleepAbortable(delayMs, normalizedRequest.signal);
        }
      }
    }
  };

  return createSolanaRpcFromTransport(resilientTransport);
}
