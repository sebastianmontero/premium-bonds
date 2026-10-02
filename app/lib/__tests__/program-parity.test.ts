import test from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_ID, HUMA_PROGRAM_ID } from "../bonds-sdk";
import { ANCHOR_PROGRAM_ADDRESS } from "../generated/yield-bonds/src/generated";
import { MOCK_HUMA_PROGRAM_ADDRESS } from "../generated/mock-huma/src/generated";
import { CANONICAL_KEYPAIRS } from "../../../scripts/sync-keys";

test("program-parity: bonds-sdk exports match Codama generated canonical addresses", () => {
  assert.strictEqual(
    PROGRAM_ID,
    ANCHOR_PROGRAM_ADDRESS,
    "PROGRAM_ID must strictly equal Codama ANCHOR_PROGRAM_ADDRESS"
  );

  assert.strictEqual(
    HUMA_PROGRAM_ID,
    MOCK_HUMA_PROGRAM_ADDRESS,
    "HUMA_PROGRAM_ID must strictly equal Codama MOCK_HUMA_PROGRAM_ADDRESS"
  );

  const anchorConfig = CANONICAL_KEYPAIRS.find((k) => k.name === "anchor");
  assert.ok(anchorConfig, "anchor must exist in CANONICAL_KEYPAIRS");
  assert.strictEqual(
    anchorConfig.expectedAddress,
    PROGRAM_ID,
    "anchor canonical address in sync-keys must match PROGRAM_ID"
  );

  const humaConfig = CANONICAL_KEYPAIRS.find((k) => k.name === "mock_huma");
  assert.ok(humaConfig, "mock_huma must exist in CANONICAL_KEYPAIRS");
  assert.strictEqual(
    humaConfig.expectedAddress,
    HUMA_PROGRAM_ID,
    "mock_huma canonical address in sync-keys must match HUMA_PROGRAM_ID"
  );

  const kaminoConfig = CANONICAL_KEYPAIRS.find((k) => k.name === "mock_kamino");
  assert.ok(kaminoConfig, "mock_kamino must exist in CANONICAL_KEYPAIRS");
  assert.strictEqual(
    kaminoConfig.expectedAddress,
    "GVkUHNohGv2AqewpZnciXhjwt3diSsLuDAKp1Q1bH1GA",
    "mock_kamino canonical address must match GVkUHNohGv2AqewpZnciXhjwt3diSsLuDAKp1Q1bH1GA"
  );
});
