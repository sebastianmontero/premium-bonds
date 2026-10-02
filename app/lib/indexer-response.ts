import type { ZodError } from "zod";
import { NextResponse } from "next/server";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";
import type { ApiResponse } from "@/app/types/indexer-contracts";

export function respondSuccess<
  T,
  M = Record<string, unknown>,
  A = Record<string, unknown>,
>(
  data: T,
  options?: {
    meta?: M;
    aggregates?: A;
    headers?: HeadersInit;
  }
): NextResponse<ApiResponse<T, M, A>> {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: options?.meta,
      aggregates: options?.aggregates,
      fallbackRequired: false,
    },
    {
      status: 200,
      headers: options?.headers ?? NO_CACHE_HEADERS,
    }
  );
}

export function respondFallback<T = never, M = never, A = never>(
  error: unknown,
  status = 200,
  headers: HeadersInit = NO_CACHE_HEADERS
): NextResponse<ApiResponse<T, M, A>> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return NextResponse.json(
    {
      success: false,
      fallbackRequired: true,
      error: errorMessage,
    },
    { status, headers }
  );
}

export function respondValidationError(
  error: ZodError | string,
  headers: HeadersInit = NO_CACHE_HEADERS
): NextResponse<ApiResponse<never, never, never>> {
  const message =
    typeof error === "string"
      ? error
      : error.issues.map((i) => i.message).join(", ");
  return respondFallback(message, 400, headers);
}
