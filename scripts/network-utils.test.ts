import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveNetwork, NETWORK_CONFIGS } from "../app/lib/network";

describe("Solana Network Utils Detection Suite", () => {
  it("should prioritize explicit environment overrides", () => {
    const resMainnet = resolveNetwork("mainnet-beta", "http://127.0.0.1:8899");
    assert.strictEqual(
      resMainnet.cluster,
      "mainnet-beta",
      "Should resolve to mainnet-beta when env is mainnet-beta"
    );
    assert.strictEqual(
      resMainnet.displayNameKey,
      "networkMainnet",
      "Display key should be networkMainnet"
    );
    assert.strictEqual(
      resMainnet.variant,
      "success",
      "Variant should be success"
    );

    const resDevnet = resolveNetwork(
      "devnet",
      "https://api.mainnet-beta.solana.com"
    );
    assert.strictEqual(
      resDevnet.cluster,
      "devnet",
      "Should resolve to devnet when env is devnet"
    );
    assert.strictEqual(
      resDevnet.displayNameKey,
      "networkDevnet",
      "Display key should be networkDevnet"
    );
    assert.strictEqual(resDevnet.variant, "info", "Variant should be info");

    const resLocal = resolveNetwork(
      "localnet",
      "https://api.devnet.solana.com"
    );
    assert.strictEqual(
      resLocal.cluster,
      "localnet",
      "Should resolve to localnet when env is localnet"
    );
    assert.strictEqual(
      resLocal.displayNameKey,
      "networkLocalnet",
      "Display key should be networkLocalnet"
    );

    const resTest = resolveNetwork("testnet", "http://localhost:8899");
    assert.strictEqual(
      resTest.cluster,
      "testnet",
      "Should resolve to testnet when env is testnet"
    );
    assert.strictEqual(
      resTest.displayNameKey,
      "networkTestnet",
      "Display key should be networkTestnet"
    );
  });

  it("should match RPC URL patterns when environment is omitted or null", () => {
    const resLocal1 = resolveNetwork(null, "http://127.0.0.1:8899");
    assert.strictEqual(
      resLocal1.cluster,
      "localnet",
      "127.0.0.1:8899 should resolve to localnet"
    );

    const resLocal2 = resolveNetwork(undefined, "http://localhost:8899");
    assert.strictEqual(
      resLocal2.cluster,
      "localnet",
      "localhost:8899 should resolve to localnet"
    );

    const resDevnet = resolveNetwork("", "https://api.devnet.solana.com");
    assert.strictEqual(
      resDevnet.cluster,
      "devnet",
      "api.devnet.solana.com should resolve to devnet"
    );

    const resTestnet = resolveNetwork(null, "https://api.testnet.solana.com");
    assert.strictEqual(
      resTestnet.cluster,
      "testnet",
      "api.testnet.solana.com should resolve to testnet"
    );

    const resHelius = resolveNetwork(
      null,
      "https://mainnet.helius-rpc.com/?api-key=abc123xyz"
    );
    assert.strictEqual(
      resHelius.cluster,
      "mainnet-beta",
      "Helius mainnet URL should resolve to mainnet-beta"
    );

    const resQuicknode = resolveNetwork(
      null,
      "https://solana-mainnet.quiknode.pro/123456/"
    );
    assert.strictEqual(
      resQuicknode.cluster,
      "mainnet-beta",
      "QuickNode mainnet URL should resolve to mainnet-beta"
    );

    const resAlchemy = resolveNetwork(
      null,
      "https://solana-mainnet.g.alchemy.com/v2/your-api-key"
    );
    assert.strictEqual(
      resAlchemy.cluster,
      "mainnet-beta",
      "Alchemy mainnet URL should resolve to mainnet-beta"
    );
  });

  it("should fallback to devnet when RPC is unknown or omitted", () => {
    const fallbackRes = resolveNetwork(null, null);
    assert.strictEqual(
      fallbackRes.cluster,
      "devnet",
      "Default empty resolution should fallback to devnet"
    );

    const unknownRpcRes = resolveNetwork(
      null,
      "https://my-custom-private-proxy.internal.net"
    );
    assert.strictEqual(
      unknownRpcRes.cluster,
      "devnet",
      "Unrecognized private RPC without env should fallback to devnet"
    );
  });

  it("should maintain dictionary integrity across all network configurations", () => {
    for (const cluster of [
      "mainnet-beta",
      "devnet",
      "localnet",
      "testnet",
    ] as const) {
      const config = NETWORK_CONFIGS[cluster];
      assert.ok(config, `Config for ${cluster} should exist`);
      assert.strictEqual(
        config.cluster,
        cluster,
        `Cluster mismatch for ${cluster}`
      );
      assert.ok(
        typeof config.displayNameKey === "string" &&
          config.displayNameKey.length > 0,
        `Invalid displayNameKey for ${cluster}`
      );
      assert.ok(
        typeof config.pillClassName === "string" &&
          config.pillClassName.length > 0,
        `Invalid pillClassName for ${cluster}`
      );
    }
  });
});
