import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveNetwork,
  resolveSolanaRpcUrl,
  resolveClientSolanaRpcUrl,
  sanitizeEnvValue,
  getNetworkInfo,
  NETWORK_CONFIGS,
  DEFAULT_SOLANA_RPC_URL,
} from "../app/lib/network";

describe("Solana Network Utils Detection Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    delete process.env.NEXT_PUBLIC_ENVIRONMENT;
    delete process.env.NEXT_PUBLIC_NETWORK;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should sanitize environment variable strings correctly", () => {
    assert.strictEqual(sanitizeEnvValue(undefined), undefined);
    assert.strictEqual(sanitizeEnvValue(null), undefined);
    assert.strictEqual(sanitizeEnvValue(""), undefined);
    assert.strictEqual(sanitizeEnvValue("   "), undefined);
    assert.strictEqual(sanitizeEnvValue("undefined"), undefined);
    assert.strictEqual(sanitizeEnvValue("null"), undefined);
    assert.strictEqual(
      sanitizeEnvValue("  https://api.devnet.solana.com  "),
      "https://api.devnet.solana.com"
    );
  });

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

  describe("RPC Resolution Hierarchy Suite", () => {
    it("resolveClientSolanaRpcUrl should resolve in priority order", () => {
      // 1. Default fallback
      assert.strictEqual(resolveClientSolanaRpcUrl(), DEFAULT_SOLANA_RPC_URL);

      // 2. NEXT_PUBLIC_SOLANA_RPC_URL override
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com";
      assert.strictEqual(
        resolveClientSolanaRpcUrl(),
        "https://api.devnet.solana.com"
      );

      // 3. Custom argument override
      assert.strictEqual(
        resolveClientSolanaRpcUrl("https://custom-rpc.solana.com"),
        "https://custom-rpc.solana.com"
      );

      // 4. Ignores private SOLANA_RPC_URL for client safety
      process.env.SOLANA_RPC_URL = "https://private-backend-rpc.solana.com";
      assert.strictEqual(
        resolveClientSolanaRpcUrl(),
        "https://api.devnet.solana.com"
      );
    });

    it("resolveSolanaRpcUrl should resolve in 4-tier hierarchy", () => {
      // 1. Default fallback
      assert.strictEqual(resolveSolanaRpcUrl(), DEFAULT_SOLANA_RPC_URL);

      // 2. Public NEXT_PUBLIC_SOLANA_RPC_URL
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com";
      assert.strictEqual(
        resolveSolanaRpcUrl(),
        "https://api.devnet.solana.com"
      );

      // 3. Private server override SOLANA_RPC_URL
      process.env.SOLANA_RPC_URL = "https://private-backend-rpc.solana.com";
      assert.strictEqual(
        resolveSolanaRpcUrl(),
        "https://private-backend-rpc.solana.com"
      );

      // 4. Custom parameter override
      assert.strictEqual(
        resolveSolanaRpcUrl("https://override-rpc.solana.com"),
        "https://override-rpc.solana.com"
      );
    });

    it("should handle literal undefined and null string values without crashing", () => {
      process.env.SOLANA_RPC_URL = "undefined";
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "null";
      assert.strictEqual(resolveSolanaRpcUrl(), DEFAULT_SOLANA_RPC_URL);
      assert.strictEqual(resolveClientSolanaRpcUrl(), DEFAULT_SOLANA_RPC_URL);
    });

    it("getNetworkInfo should use client-safe variables and guarantee deterministic SSR", () => {
      process.env.NEXT_PUBLIC_ENVIRONMENT = "localnet";
      process.env.SOLANA_RPC_URL =
        "https://mainnet.helius-rpc.com/?api-key=secret";
      // Even if server has private mainnet RPC, client UI cluster is driven by public variables
      const info = getNetworkInfo();
      assert.strictEqual(info.cluster, "localnet");
      assert.strictEqual(info.displayNameKey, "networkLocalnet");
    });
  });
});
