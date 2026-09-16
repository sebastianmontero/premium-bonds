import assert from "node:assert/strict";

export function assertAlmostEqual(
  actual: number,
  expected: number,
  eps = 1e-8,
  message = ""
): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `Expected ${actual} ≈ ${expected} (diff ${Math.abs(actual - expected)} > ${eps}). ${message}`
  );
}
