import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampHeadroomSlots,
  parseHeadroomSlots,
  loadConfig,
  MIN_REGISTRY_HEADROOM_SLOTS,
  DEFAULT_REGISTRY_HEADROOM_SLOTS,
  MAX_REGISTRY_HEADROOM_SLOTS,
  DEFAULT_MAX_EXPANSIONS_PER_HOUR,
  DEFAULT_RPC_SETTLE_COOLDOWN_MS,
} from "../config";

describe("Crank Configuration & Registry Expansion Config Unit Tests", () => {
  it("clampHeadroomSlots should clamp values strictly within bounds [160, 1600]", () => {
    assert.strictEqual(
      clampHeadroomSlots(NaN),
      DEFAULT_REGISTRY_HEADROOM_SLOTS
    );
    assert.strictEqual(clampHeadroomSlots(0), MIN_REGISTRY_HEADROOM_SLOTS);
    assert.strictEqual(clampHeadroomSlots(50), MIN_REGISTRY_HEADROOM_SLOTS);
    assert.strictEqual(clampHeadroomSlots(160), 160);
    assert.strictEqual(clampHeadroomSlots(320), 320);
    assert.strictEqual(clampHeadroomSlots(800), 800);
    assert.strictEqual(clampHeadroomSlots(1600), 1600);
    assert.strictEqual(clampHeadroomSlots(2000), MAX_REGISTRY_HEADROOM_SLOTS);
    assert.strictEqual(
      clampHeadroomSlots(100_000),
      MAX_REGISTRY_HEADROOM_SLOTS
    );
  });

  it("parseHeadroomSlots should parse valid numbers, handle invalid strings, and clamp bounds", () => {
    // Undefined raw string -> returns default
    assert.strictEqual(
      parseHeadroomSlots(undefined),
      DEFAULT_REGISTRY_HEADROOM_SLOTS
    );
    assert.strictEqual(parseHeadroomSlots(undefined, 480), 480);

    // Valid string within bounds
    assert.strictEqual(parseHeadroomSlots("480"), 480);

    // Clamped string below min
    assert.strictEqual(parseHeadroomSlots("50"), MIN_REGISTRY_HEADROOM_SLOTS);

    // Clamped string above max
    assert.strictEqual(parseHeadroomSlots("5000"), MAX_REGISTRY_HEADROOM_SLOTS);

    // Malformed string -> fallback to default
    assert.strictEqual(
      parseHeadroomSlots("invalid_number"),
      DEFAULT_REGISTRY_HEADROOM_SLOTS
    );
  });

  it("loadConfig should populate registryExpansion with defaults or provided overrides", () => {
    const config = loadConfig({
      rpcUrl: "http://127.0.0.1:8899",
      poolIds: [1],
      dryRun: true,
      registryExpansion: {
        headroomSlots: 640,
        maxExpansionsPerHour: 12,
        rpcCooldownMs: 20_000,
      },
    });

    assert.ok(config.registryExpansion, "registryExpansion must be populated");
    assert.strictEqual(config.registryExpansion.headroomSlots, 640);
    assert.strictEqual(config.registryExpansion.maxExpansionsPerHour, 12);
    assert.strictEqual(config.registryExpansion.rpcCooldownMs, 20_000);
  });

  it("loadConfig should fallback to standard defaults when registryExpansion is omitted", () => {
    const origEnv = process.env.CRANK_REGISTRY_HEADROOM_SLOTS;
    delete process.env.CRANK_REGISTRY_HEADROOM_SLOTS;

    try {
      const config = loadConfig({
        rpcUrl: "http://127.0.0.1:8899",
        poolIds: [1],
        dryRun: true,
      });

      assert.ok(config.registryExpansion);
      assert.strictEqual(
        config.registryExpansion.headroomSlots,
        DEFAULT_REGISTRY_HEADROOM_SLOTS
      );
      assert.strictEqual(
        config.registryExpansion.maxExpansionsPerHour,
        DEFAULT_MAX_EXPANSIONS_PER_HOUR
      );
      assert.strictEqual(
        config.registryExpansion.rpcCooldownMs,
        DEFAULT_RPC_SETTLE_COOLDOWN_MS
      );
    } finally {
      if (origEnv !== undefined) {
        process.env.CRANK_REGISTRY_HEADROOM_SLOTS = origEnv;
      }
    }
  });

  it("loadConfig should give overrides precedence over process.env across all fields and support partial overrides", () => {
    const origSlots = process.env.CRANK_REGISTRY_HEADROOM_SLOTS;
    const origMaxPerHour = process.env.CRANK_REGISTRY_MAX_EXPANSIONS_PER_HOUR;
    const origCooldown = process.env.CRANK_REGISTRY_RPC_COOLDOWN_MS;

    process.env.CRANK_REGISTRY_HEADROOM_SLOTS = "480";
    process.env.CRANK_REGISTRY_MAX_EXPANSIONS_PER_HOUR = "99";
    process.env.CRANK_REGISTRY_RPC_COOLDOWN_MS = "99999";

    try {
      // Full override: all 3 fields override competing process.env
      const fullConfig = loadConfig({
        rpcUrl: "http://127.0.0.1:8899",
        poolIds: [1],
        dryRun: true,
        registryExpansion: {
          headroomSlots: 640,
          maxExpansionsPerHour: 12,
          rpcCooldownMs: 20_000,
        },
      });

      assert.strictEqual(fullConfig.registryExpansion?.headroomSlots, 640);
      assert.strictEqual(
        fullConfig.registryExpansion?.maxExpansionsPerHour,
        12
      );
      assert.strictEqual(fullConfig.registryExpansion?.rpcCooldownMs, 20_000);

      // Partial override: only headroomSlots provided, others fall back to process.env
      const partialConfig = loadConfig({
        rpcUrl: "http://127.0.0.1:8899",
        poolIds: [1],
        dryRun: true,
        registryExpansion: {
          headroomSlots: 800,
        },
      });

      assert.strictEqual(partialConfig.registryExpansion?.headroomSlots, 800);
      assert.strictEqual(
        partialConfig.registryExpansion?.maxExpansionsPerHour,
        99
      );
      assert.strictEqual(partialConfig.registryExpansion?.rpcCooldownMs, 99999);
    } finally {
      if (origSlots !== undefined) {
        process.env.CRANK_REGISTRY_HEADROOM_SLOTS = origSlots;
      } else {
        delete process.env.CRANK_REGISTRY_HEADROOM_SLOTS;
      }
      if (origMaxPerHour !== undefined) {
        process.env.CRANK_REGISTRY_MAX_EXPANSIONS_PER_HOUR = origMaxPerHour;
      } else {
        delete process.env.CRANK_REGISTRY_MAX_EXPANSIONS_PER_HOUR;
      }
      if (origCooldown !== undefined) {
        process.env.CRANK_REGISTRY_RPC_COOLDOWN_MS = origCooldown;
      } else {
        delete process.env.CRANK_REGISTRY_RPC_COOLDOWN_MS;
      }
    }
  });
});
