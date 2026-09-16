import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";

export function createApiRequest(
  urlPath: string,
  options?: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    body?: unknown;
    headers?: Record<string, string>;
  }
): NextRequest {
  const url = new URL(urlPath, "http://localhost:3000");
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return new NextRequest(url, {
    method: options?.method || "GET",
    headers,
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export interface SuccessEnvelope<T> {
  json: Record<string, unknown>;
  data: T;
  meta?: Record<string, unknown>;
  aggregates?: Record<string, unknown>;
}

export async function assertSuccessResponse<T>(
  res: Response,
  expectedStatus = 200
): Promise<SuccessEnvelope<T>> {
  const json = (await res.json()) as Record<string, unknown>;
  assert.strictEqual(
    res.status,
    expectedStatus,
    `Expected HTTP status ${expectedStatus}, got ${res.status}. Server response: ${JSON.stringify(json)}`
  );
  assert.strictEqual(
    json.success,
    true,
    `Response success boolean must be true. Body: ${JSON.stringify(json)}`
  );
  assert.strictEqual(
    json.fallbackRequired,
    false,
    `fallbackRequired must be false on success. Body: ${JSON.stringify(json)}`
  );
  return {
    json,
    data: json.data as T,
    meta: json.meta as Record<string, unknown> | undefined,
    aggregates: json.aggregates as Record<string, unknown> | undefined,
  };
}

export async function assertErrorResponse(
  res: Response,
  expectedStatus = 400,
  errorSubstring?: string
): Promise<{ json: Record<string, unknown>; error: string }> {
  const json = (await res.json()) as Record<string, unknown>;
  assert.strictEqual(
    res.status,
    expectedStatus,
    `Expected status ${expectedStatus}, got ${res.status}. Server response: ${JSON.stringify(json)}`
  );
  assert.strictEqual(json.success, false, "Response success must be false");
  assert.strictEqual(
    json.fallbackRequired,
    true,
    "fallbackRequired must be true"
  );
  if (errorSubstring) {
    assert.ok(
      typeof json.error === "string" &&
        json.error.toLowerCase().includes(errorSubstring.toLowerCase()),
      `Expected error message containing "${errorSubstring}", got "${json.error}"`
    );
  }
  return { json, error: (json.error as string) || "" };
}

export function assertNoCache(res: Response): void {
  assert.strictEqual(
    res.headers.get("Cache-Control"),
    NO_CACHE_HEADERS["Cache-Control"]
  );
}

export function assertPrivateNoCache(res: Response): void {
  assert.strictEqual(
    res.headers.get("Cache-Control"),
    "private, no-cache, no-store, must-revalidate"
  );
}
