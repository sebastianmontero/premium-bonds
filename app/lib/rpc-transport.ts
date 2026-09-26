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

export interface ResilientRpcConfig {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
  readonly jitter?: boolean;
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  readonly headers?: Record<string, string>;
  readonly transport?: Parameters<typeof createSolanaRpcFromTransport>[0];
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

/**
 * Extracts Retry-After delay in milliseconds from HTTP transport error headers if present.
 */
export function getRetryAfterMs(err: unknown): number | null {
  for (const item of getErrorChain(err)) {
    if (!isSolanaError(item, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
      continue;
    }
    const context = item.context as
      | { headers?: Headers | Record<string, string> }
      | undefined;
    const headers = context?.headers;
    if (!headers) continue;

    const headerVal =
      typeof (headers as Headers).get === "function"
        ? (headers as Headers).get("retry-after")
        : ((headers as Record<string, string>)["retry-after"] ??
          (headers as Record<string, string>)["Retry-After"]);
    if (!headerVal) continue;

    const seconds = Number(headerVal);
    if (!isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(headerVal);
    if (!isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }
  return null;
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

  const maxRetries = config?.maxRetries ?? 5;
  const initialDelayMs = config?.initialDelayMs ?? 500;
  const maxDelayMs = config?.maxDelayMs ?? 8000;
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
      if (normalizedRequest.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      try {
        return (await defaultTransport(normalizedRequest)) as TResponse;
      } catch (err) {
        if (
          normalizedRequest.signal?.aborted ||
          !isRetryableRpcError(err) ||
          attempt >= maxRetries
        ) {
          throw err;
        }

        attempt++;
        const retryAfterMs = getRetryAfterMs(err);
        const delayMs = calculateBackoffDelay(
          attempt,
          backoffConfig,
          retryAfterMs
        );

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

        // Abortable sleep timer: cancels immediately upon AbortSignal
        await new Promise<void>((resolve, reject) => {
          if (normalizedRequest.signal?.aborted) {
            return reject(
              new DOMException("The operation was aborted.", "AbortError")
            );
          }
          const timer = setTimeout(resolve, delayMs);
          normalizedRequest.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(
                new DOMException("The operation was aborted.", "AbortError")
              );
            },
            { once: true }
          );
        });
      }
    }
  };

  return createSolanaRpcFromTransport(resilientTransport);
}
