import crypto from "crypto";

/**
 * Validates the Authorization header against the expected secret using timing-safe comparison.
 */
export function isTimingSafeAuthorized(
  authHeader: string | null | undefined,
  expectedSecret: string
): boolean {
  if (!authHeader || !expectedSecret) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (token.length !== expectedSecret.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expectedSecret)
  );
}
