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
    PROGRAM_ID,
    "3GTfYY4nefPvDpeUuyVjqCVUCtvhBMga82RjLVn6MTos",
    "PROGRAM_ID must match canonical YieldBonds address"
  );

  assert.strictEqual(
    HUMA_PROGRAM_ID,
    MOCK_HUMA_PROGRAM_ADDRESS,
    "HUMA_PROGRAM_ID must strictly equal Codama MOCK_HUMA_PROGRAM_ADDRESS"
  );
  assert.strictEqual(
    HUMA_PROGRAM_ID,
    "4VSPD3TcxWc98Ed6e6vAYshrqsrpHHqvXCB4W73JQtXg",
    "HUMA_PROGRAM_ID must match canonical Mock Huma address"
  );

  const kaminoConfig = CANONICAL_KEYPAIRS.find((k) => k.name === "mock_kamino");
  assert.ok(kaminoConfig, "mock_kamino must exist in CANONICAL_KEYPAIRS");
  assert.strictEqual(
    kaminoConfig.expectedAddress,
    "GVkUHNohGv2AqewpZnciXhjwt3diSsLuDAKp1Q1bH1GA",
    "mock_kamino canonical address must match GVkUHNohGv2AqewpZnciXhjwt3diSsLuDAKp1Q1bH1GA"
  );
});
