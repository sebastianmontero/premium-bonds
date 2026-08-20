import { resolveNetwork, NETWORK_CONFIGS } from "../app/lib/network";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

console.log("=========================================");
console.log("   TEST: Solana Network Utils Detection  ");
console.log("=========================================\n");

// 1. Explicit Environment Override Precedence
console.log("1. Testing explicit environment overrides...");
{
  const resMainnet = resolveNetwork("mainnet-beta", "http://127.0.0.1:8899");
  assert(
    resMainnet.cluster === "mainnet-beta",
    "Should resolve to mainnet-beta when env is mainnet-beta"
  );
  assert(
    resMainnet.displayNameKey === "networkMainnet",
    "Display key should be networkMainnet"
  );
  assert(resMainnet.variant === "success", "Variant should be success");

  const resDevnet = resolveNetwork(
    "devnet",
    "https://api.mainnet-beta.solana.com"
  );
  assert(
    resDevnet.cluster === "devnet",
    "Should resolve to devnet when env is devnet"
  );
  assert(
    resDevnet.displayNameKey === "networkDevnet",
    "Display key should be networkDevnet"
  );
  assert(resDevnet.variant === "info", "Variant should be info");

  const resLocal = resolveNetwork("localnet", "https://api.devnet.solana.com");
  assert(
    resLocal.cluster === "localnet",
    "Should resolve to localnet when env is localnet"
  );
  assert(
    resLocal.displayNameKey === "networkLocalnet",
    "Display key should be networkLocalnet"
  );

  const resTest = resolveNetwork("testnet", "http://localhost:8899");
  assert(
    resTest.cluster === "testnet",
    "Should resolve to testnet when env is testnet"
  );
  assert(
    resTest.displayNameKey === "networkTestnet",
    "Display key should be networkTestnet"
  );
  console.log("  ✓ Explicit environment overrides tested successfully.");
}

// 2. RPC URL Pattern Matching (when env is omitted/null)
console.log("2. Testing RPC URL pattern matching...");
{
  const resLocal1 = resolveNetwork(null, "http://127.0.0.1:8899");
  assert(
    resLocal1.cluster === "localnet",
    "127.0.0.1:8899 should resolve to localnet"
  );

  const resLocal2 = resolveNetwork(undefined, "http://localhost:8899");
  assert(
    resLocal2.cluster === "localnet",
    "localhost:8899 should resolve to localnet"
  );

  const resDevnet = resolveNetwork("", "https://api.devnet.solana.com");
  assert(
    resDevnet.cluster === "devnet",
    "api.devnet.solana.com should resolve to devnet"
  );

  const resTestnet = resolveNetwork(null, "https://api.testnet.solana.com");
  assert(
    resTestnet.cluster === "testnet",
    "api.testnet.solana.com should resolve to testnet"
  );

  const resHelius = resolveNetwork(
    null,
    "https://mainnet.helius-rpc.com/?api-key=abc123xyz"
  );
  assert(
    resHelius.cluster === "mainnet-beta",
    "Helius mainnet URL should resolve to mainnet-beta"
  );

  const resQuicknode = resolveNetwork(
    null,
    "https://solana-mainnet.quiknode.pro/123456/"
  );
  assert(
    resQuicknode.cluster === "mainnet-beta",
    "QuickNode mainnet URL should resolve to mainnet-beta"
  );

  const resAlchemy = resolveNetwork(
    null,
    "https://solana-mainnet.g.alchemy.com/v2/your-api-key"
  );
  assert(
    resAlchemy.cluster === "mainnet-beta",
    "Alchemy mainnet URL should resolve to mainnet-beta"
  );
  console.log("  ✓ RPC URL pattern matching tested successfully.");
}

// 3. Fallback behavior
console.log("3. Testing fallback behavior...");
{
  const fallbackRes = resolveNetwork(null, null);
  assert(
    fallbackRes.cluster === "devnet",
    "Default empty resolution should fallback to devnet"
  );

  const unknownRpcRes = resolveNetwork(
    null,
    "https://my-custom-private-proxy.internal.net"
  );
  assert(
    unknownRpcRes.cluster === "devnet",
    "Unrecognized private RPC without env should fallback to devnet"
  );
  console.log("  ✓ Fallback behavior verified.");
}

// 4. Config Integrity
console.log("4. Verifying config dictionary integrity...");
{
  for (const cluster of [
    "mainnet-beta",
    "devnet",
    "localnet",
    "testnet",
  ] as const) {
    const config = NETWORK_CONFIGS[cluster];
    assert(!!config, `Config for ${cluster} should exist`);
    assert(config.cluster === cluster, `Cluster mismatch for ${cluster}`);
    assert(
      typeof config.displayNameKey === "string" &&
        config.displayNameKey.length > 0,
      `Invalid displayNameKey for ${cluster}`
    );
    assert(
      typeof config.pillClassName === "string" &&
        config.pillClassName.length > 0,
      `Invalid pillClassName for ${cluster}`
    );
  }
  console.log("  ✓ All network config entries are valid.");
}

console.log("\n✅ ALL NETWORK UTILITY TESTS PASSED SUCCESSFULLY!\n");
