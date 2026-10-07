import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  safeguardDevnetEnv,
  safeguardLocalnetEnv,
  loadLocalnetProfile,
  isPusherPlaceholder,
  syncDevnetToActiveEnv,
  syncLocalnetToActiveEnv,
  writeClusterAddresses,
  readClusterAddresses,
  recordDevnetRandomnessAccount,
  checkActiveEnvIsLocalnet,
  assertActiveEnvIsNotLocalnet,
  EnvironmentMismatchError,
  ProtocolAccounts,
  DevnetProtocolAccounts,
  LOCALNET_DEFAULT_RPC_URL,
  LOCALNET_DEFAULT_WS_URL,
  LOCALNET_DEFAULT_DB_URL,
  LOCALNET_MOCK_WEBHOOK_SECRET,
  DEVNET_DEFAULT_RPC_URL,
  DEVNET_DEFAULT_WS_URL,
} from "./cluster-state";

import { readEnvFile, upsertEnvFile } from "./env-utils";
import { PROGRAM_ID, HUMA_PROGRAM_ID } from "../app/lib/bonds-sdk";

describe("Devnet State Persistence & Synchronization (devnet-state)", () => {
  let tempDir: string;
  let activeEnvPath: string;
  let devnetEnvPath: string;
  let localnetEnvPath: string;
  let addressesPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-devnet-test-"));
    activeEnvPath = path.resolve(tempDir, ".env.local");
    devnetEnvPath = path.resolve(tempDir, ".env.devnet");
    localnetEnvPath = path.resolve(tempDir, ".env.localnet");
    addressesPath = path.resolve(tempDir, "addresses.json");
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const sampleAddresses: DevnetProtocolAccounts = {
    programId: PROGRAM_ID,
    humaProgramId: HUMA_PROGRAM_ID,
    adminAddress: "Admin1111111111111111111111111111111111111",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    pstMint: "PST111111111111111111111111111111111111111",
    ticketRegistry: "TicketRegistry11111111111111111111111111111",
    feeWallet: "FeeWallet1111111111111111111111111111111111",
    humaPoolState: "HumaPoolState111111111111111111111111111111",
    humaLenderState: "HumaLenderState111111111111111111111111111",
    humaPoolUnderlying: "HumaPoolUnderlying11111111111111111111111",
    humaPoolModeToken: "HumaPoolModeToken111111111111111111111111",
    humaRedemptionRequest: "HumaRedemptionReq111111111111111111111111",
    randomnessAccount: "Randomness1111111111111111111111111111111",
  };

  it("1. Strict Guarding: should abort and NOT extract credentials when active env is localnet", () => {
    // Setup .env.local with localnet mode and a custom docker container url
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=localnet
DATABASE_URL=postgresql://docker_user:docker_pass@postgres-container:5432/pb_local
HELIUS_WEBHOOK_SECRET=my_secret_token
`,
      "utf-8"
    );

    const saved = safeguardDevnetEnv(activeEnvPath, devnetEnvPath);
    assert.deepStrictEqual(
      saved,
      {},
      "Should return empty object when active env is localnet"
    );
    assert.strictEqual(
      fs.existsSync(devnetEnvPath),
      false,
      ".env.devnet should not be created when active env is localnet"
    );
  });

  it("2. Timing Hazard: should safeguard non-mock credentials when active env is devnet", () => {
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=devnet
DATABASE_URL=postgresql://neon_user:neon_pass@ep-cool-frost.neon.tech/neondb?sslmode=require
HELIUS_WEBHOOK_SECRET=helius_devnet_secret_abc123
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=xyz
`,
      "utf-8"
    );

    const saved = safeguardDevnetEnv(activeEnvPath, devnetEnvPath);
    assert.strictEqual(
      saved.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool-frost.neon.tech/neondb?sslmode=require"
    );
    assert.strictEqual(
      saved.HELIUS_WEBHOOK_SECRET,
      "helius_devnet_secret_abc123"
    );
    assert.strictEqual(
      saved.SOLANA_RPC_URL,
      "https://devnet.helius-rpc.com/?api-key=xyz"
    );

    assert.ok(fs.existsSync(devnetEnvPath), ".env.devnet should be created");
    const devnetEnv = readEnvFile(devnetEnvPath);
    assert.strictEqual(
      devnetEnv.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool-frost.neon.tech/neondb?sslmode=require"
    );
  });

  it("3. Clean .env.devnet Syntax & Isolation: should use unprefixed keys and never write on-chain accounts to .env.devnet", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    fs.writeFileSync(
      devnetEnvPath,
      `DATABASE_URL=postgresql://neon_user:neon_pass@ep-cool-frost.neon.tech/neondb?sslmode=require
HELIUS_WEBHOOK_SECRET=helius_secret_123
`,
      "utf-8"
    );

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const devnetProfile = readEnvFile(devnetEnvPath);
    // Ensure on-chain accounts were NOT written into .env.devnet
    assert.strictEqual(devnetProfile.NEXT_PUBLIC_PROGRAM_ID, undefined);
    assert.strictEqual(devnetProfile.NEXT_PUBLIC_TICKET_REGISTRY, undefined);
    assert.strictEqual(devnetProfile.NEXT_PUBLIC_HUMA_POOL_STATE, undefined);
    assert.strictEqual(
      devnetProfile.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool-frost.neon.tech/neondb?sslmode=require"
    );

    // Ensure active env received both on-chain accounts and devnet profile keys
    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_PROGRAM_ID,
      sampleAddresses.programId
    );
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_TICKET_REGISTRY,
      sampleAddresses.ticketRegistry
    );
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool-frost.neon.tech/neondb?sslmode=require"
    );
  });

  it("4. User Edit Propagation: direct edits in .env.devnet should propagate to active env", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    fs.writeFileSync(
      devnetEnvPath,
      `DATABASE_URL=postgresql://neon_v2:new_password@ep-branch-2.neon.tech/neondb?sslmode=require
NEXT_PUBLIC_SOLANA_RPC_URL=https://custom-devnet-rpc.com
`,
      "utf-8"
    );

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://neon_v2:new_password@ep-branch-2.neon.tech/neondb?sslmode=require"
    );
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_RPC_URL,
      "https://custom-devnet-rpc.com"
    );
  });

  it("5. Database Neutralization: should neutralize DATABASE_URL in .env.local when missing in .env.devnet", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    // Existing .env.local has a local postgres connection
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=localnet
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/local_db
`,
      "utf-8"
    );

    // .env.devnet does NOT have DATABASE_URL
    fs.writeFileSync(devnetEnvPath, `# No database url\n`, "utf-8");

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "",
      "DATABASE_URL must be neutralized to empty string"
    );
  });

  it("6. Hierarchical Address Fallbacks: should resolve canonical SDK constants when addresses.json is missing", () => {
    // addresses.json does NOT exist, but .env.devnet has NEXT_PUBLIC_TICKET_REGISTRY
    fs.writeFileSync(
      devnetEnvPath,
      `NEXT_PUBLIC_TICKET_REGISTRY=TicketRegistryFallback1111111111111111
DATABASE_URL=postgresql://user:pass@neon.tech/db
`,
      "utf-8"
    );

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_PROGRAM_ID, PROGRAM_ID);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_HUMA_PROGRAM_ID, HUMA_PROGRAM_ID);
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_TICKET_REGISTRY,
      "TicketRegistryFallback1111111111111111"
    );
  });

  it("7. Multi-Cycle Switching Resilience: devnet -> localnet -> devnet -> localnet retains credentials", () => {
    writeClusterAddresses(
      "devnet",
      {
        ...sampleAddresses,
        randomnessAccount: "SwitchboardAccount123",
      },
      addressesPath
    );

    // Step 1: Active devnet setup
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=devnet
DATABASE_URL=postgresql://neon_owner:secret@neon-host.neon.tech/db?sslmode=require
HELIUS_WEBHOOK_SECRET=helius_top_secret_key
NEXT_PUBLIC_RANDOMNESS_ACCOUNT=SwitchboardAccount123
`,
      "utf-8"
    );

    // Step 2: Localnet runs safeguard
    safeguardDevnetEnv(activeEnvPath, devnetEnvPath);

    // Simulate localnet provisioning overwriting .env.local
    upsertEnvFile(activeEnvPath, {
      NEXT_PUBLIC_ENVIRONMENT: "localnet",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/local_db",
      HELIUS_WEBHOOK_SECRET: "pb_webhook_secret_local_dev_123",
      NEXT_PUBLIC_RANDOMNESS_ACCOUNT: "MockRandomnessLocal111111111111111",
    });

    // Verify .env.local has localnet values
    let activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "localnet");
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://postgres:postgres@localhost:5432/local_db"
    );

    // Step 3: Switch back to Devnet via syncDevnetToActiveEnv
    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://neon_owner:secret@neon-host.neon.tech/db?sslmode=require"
    );
    assert.strictEqual(
      activeEnv.HELIUS_WEBHOOK_SECRET,
      "helius_top_secret_key"
    );
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT,
      "SwitchboardAccount123"
    );

    // Step 4: Switch to Localnet again (safeguard should NOT clobber with localnet mock values)
    safeguardDevnetEnv(activeEnvPath, devnetEnvPath);
    upsertEnvFile(activeEnvPath, {
      NEXT_PUBLIC_ENVIRONMENT: "localnet",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/local_db",
    });

    const devnetProfile = readEnvFile(devnetEnvPath);
    assert.strictEqual(
      devnetProfile.DATABASE_URL,
      "postgresql://neon_owner:secret@neon-host.neon.tech/db?sslmode=require",
      ".env.devnet should retain remote credentials"
    );
  });

  it("8. Private RPC & WS URL Preservation: should preserve private endpoints and defaults", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    fs.writeFileSync(
      devnetEnvPath,
      `SOLANA_RPC_URL=https://private-rpc.helius.xyz/?api-key=secret
SOLANA_WS_URL=wss://private-ws.helius.xyz/?api-key=secret
`,
      "utf-8"
    );

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(
      activeEnv.SOLANA_RPC_URL,
      "https://private-rpc.helius.xyz/?api-key=secret"
    );
    assert.strictEqual(
      activeEnv.SOLANA_WS_URL,
      "wss://private-ws.helius.xyz/?api-key=secret"
    );
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_RPC_URL,
      "https://api.devnet.solana.com"
    );
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_WS_URL,
      "wss://api.devnet.solana.com"
    );
  });

  it("9. Preservation of Unmanaged Category C Keys: should leave unmanaged keys & comments untouched in active env", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    fs.writeFileSync(
      activeEnvPath,
      `# Top Level Comment
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123/abc
TELEGRAM_BOT_TOKEN=token123
# Custom Dev Setting
MY_CUSTOM_FLAG=true
ANALYTICS_KEY=analytics_secret_999
`,
      "utf-8"
    );

    fs.writeFileSync(
      devnetEnvPath,
      `DATABASE_URL=postgresql://user:pass@neon.tech/db
`,
      "utf-8"
    );

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const activeContent = fs.readFileSync(activeEnvPath, "utf-8");
    const activeEnv = readEnvFile(activeEnvPath);

    // Category C keys preserved
    assert.strictEqual(
      activeEnv.DISCORD_WEBHOOK_URL,
      "https://discord.com/api/webhooks/123/abc"
    );
    assert.strictEqual(activeEnv.TELEGRAM_BOT_TOKEN, "token123");
    assert.strictEqual(activeEnv.MY_CUSTOM_FLAG, "true");
    assert.strictEqual(activeEnv.ANALYTICS_KEY, "analytics_secret_999");

    // Comments preserved
    assert.ok(activeContent.includes("# Top Level Comment"));
    assert.ok(activeContent.includes("# Custom Dev Setting"));
  });

  it("10. Mock Replacement in Profile Salvage & Randomness Account Preservation: should preserve Switchboard account and overwrite stale mock URLs", () => {
    const { randomnessAccount, ...addressesWithoutRandomness } =
      sampleAddresses;
    writeClusterAddresses("devnet", addressesWithoutRandomness, addressesPath);

    // .env.devnet has a stale local mock DB URL and a valid Switchboard account
    fs.writeFileSync(
      devnetEnvPath,
      `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/local_db
NEXT_PUBLIC_RANDOMNESS_ACCOUNT=SwitchboardDevnetAccount1111111111111111
`,
      "utf-8"
    );

    // .env.local has a real Neon cloud database URL
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=devnet
DATABASE_URL=postgresql://neon_user:neon_pass@ep-cool.neon.tech/neondb?sslmode=require
`,
      "utf-8"
    );

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const activeEnv = readEnvFile(activeEnvPath);
    const devnetProfile = readEnvFile(devnetEnvPath);

    // Assert Switchboard account was NOT rejected as mock
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT,
      "SwitchboardDevnetAccount1111111111111111",
      "Switchboard randomness account should be preserved from .env.devnet"
    );

    // Assert active env got the real Neon URL
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool.neon.tech/neondb?sslmode=require"
    );

    // Assert .env.devnet profile had its mock URL replaced with the real Neon URL
    assert.strictEqual(
      devnetProfile.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool.neon.tech/neondb?sslmode=require",
      "Salvaged remote database URL should overwrite stale local mock in .env.devnet"
    );
  });

  it("11. Mock Profile Neutralization: should neutralize DATABASE_URL in active env if .env.devnet only contains a loopback URL", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    fs.writeFileSync(
      devnetEnvPath,
      `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/pb_local_qa
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
`,
      "utf-8"
    );

    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=localnet
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/local_db
`,
      "utf-8"
    );

    syncDevnetToActiveEnv(activeEnvPath, devnetEnvPath, addressesPath);

    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "",
      "Mock DATABASE_URL in .env.devnet must be ignored and neutralized to empty string"
    );
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_RPC_URL,
      "https://api.devnet.solana.com",
      "Mock RPC URL in .env.devnet must be ignored and fall back to default Devnet RPC"
    );
  });

  it("12. recordDevnetRandomnessAccount updates addresses.json and .env.devnet", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);
    fs.writeFileSync(devnetEnvPath, "# Devnet Env\n", "utf-8");

    const newRandomness = "NewRandomnessAccount9999999999999999999999";
    recordDevnetRandomnessAccount(newRandomness, addressesPath, devnetEnvPath);

    const updatedAddresses = readClusterAddresses("devnet", addressesPath);
    assert.strictEqual(updatedAddresses?.randomnessAccount, newRandomness);

    const updatedEnv = readEnvFile(devnetEnvPath);
    assert.strictEqual(
      updatedEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT,
      newRandomness
    );
  });

  it("13. Localnet Pusher Safeguarding: safeguardLocalnetEnv should capture Pusher credentials when active env is localnet", () => {
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=localnet
PUSHER_APP_ID=2190156
PUSHER_KEY=local_pusher_key_abc
PUSHER_SECRET=local_pusher_secret_xyz
PUSHER_CLUSTER=mt1
NEXT_PUBLIC_PUSHER_KEY=local_pusher_key_abc
NEXT_PUBLIC_PUSHER_CLUSTER=mt1
`,
      "utf-8"
    );

    const saved = safeguardLocalnetEnv(activeEnvPath, localnetEnvPath);
    assert.strictEqual(saved.PUSHER_APP_ID, "2190156");
    assert.strictEqual(saved.PUSHER_KEY, "local_pusher_key_abc");
    assert.strictEqual(saved.PUSHER_SECRET, "local_pusher_secret_xyz");
    assert.strictEqual(saved.PUSHER_CLUSTER, "mt1");
    assert.strictEqual(saved.NEXT_PUBLIC_PUSHER_KEY, "local_pusher_key_abc");
    assert.strictEqual(saved.NEXT_PUBLIC_PUSHER_CLUSTER, "mt1");

    assert.ok(fs.existsSync(localnetEnvPath));
    const localProfile = readEnvFile(localnetEnvPath);
    assert.strictEqual(localProfile.PUSHER_APP_ID, "2190156");
  });

  it("14. Devnet Pusher Synchronization: syncDevnetToActiveEnv should synchronize Devnet Pusher keys to active env", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    fs.writeFileSync(
      devnetEnvPath,
      `PUSHER_APP_ID=2197169
PUSHER_KEY=devnet_pusher_key_123
PUSHER_SECRET=devnet_pusher_secret_456
PUSHER_CLUSTER=us2
NEXT_PUBLIC_PUSHER_KEY=devnet_pusher_key_123
NEXT_PUBLIC_PUSHER_CLUSTER=us2
`,
      "utf-8"
    );

    syncDevnetToActiveEnv({
      targetFile: activeEnvPath,
      devnetEnvPath,
      addressesPath,
      localnetEnvPath,
    });

    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(activeEnv.PUSHER_APP_ID, "2197169");
    assert.strictEqual(activeEnv.PUSHER_KEY, "devnet_pusher_key_123");
    assert.strictEqual(activeEnv.PUSHER_SECRET, "devnet_pusher_secret_456");
    assert.strictEqual(activeEnv.PUSHER_CLUSTER, "us2");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_PUSHER_KEY,
      "devnet_pusher_key_123"
    );
    assert.strictEqual(activeEnv.NEXT_PUBLIC_PUSHER_CLUSTER, "us2");
  });

  it("15. Cross-Network Isolation & Neutralization: local Pusher keys must not pollute .env.devnet and must neutralize when missing in .env.devnet", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    // Active env has localnet Pusher credentials
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=localnet
PUSHER_APP_ID=2190156
PUSHER_KEY=local_key_abc
PUSHER_SECRET=local_secret_xyz
NEXT_PUBLIC_PUSHER_KEY=local_key_abc
`,
      "utf-8"
    );

    // .env.devnet does NOT have Pusher keys
    fs.writeFileSync(
      devnetEnvPath,
      `DATABASE_URL=postgresql://neon_user:neon_pass@ep-cool.neon.tech/neondb?sslmode=require
`,
      "utf-8"
    );

    syncDevnetToActiveEnv({
      targetFile: activeEnvPath,
      devnetEnvPath,
      addressesPath,
      localnetEnvPath,
    });

    const devnetProfile = readEnvFile(devnetEnvPath);
    const activeEnv = readEnvFile(activeEnvPath);

    // 1. Local Pusher keys were NOT falsely salvaged into .env.devnet
    assert.strictEqual(devnetProfile.PUSHER_APP_ID, undefined);
    assert.strictEqual(devnetProfile.PUSHER_KEY, undefined);

    // 2. Pusher keys in active env were neutralized to prevent cross-network broadcast leaks
    assert.strictEqual(activeEnv.PUSHER_APP_ID, "");
    assert.strictEqual(activeEnv.PUSHER_KEY, "");
    assert.strictEqual(activeEnv.PUSHER_SECRET, "");
    assert.strictEqual(activeEnv.NEXT_PUBLIC_PUSHER_KEY, "");
    assert.strictEqual(activeEnv.PUSHER_CLUSTER, "us2");
    assert.strictEqual(activeEnv.NEXT_PUBLIC_PUSHER_CLUSTER, "us2");
  });

  it("16. Bidirectional Multi-Cycle Switching (localnet <-> devnet) retains distinct credentials", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    // Devnet profile has Devnet Pusher App 2197169
    fs.writeFileSync(
      devnetEnvPath,
      `PUSHER_APP_ID=2197169
PUSHER_KEY=devnet_key
PUSHER_SECRET=devnet_secret
NEXT_PUBLIC_PUSHER_KEY=devnet_key
NEXT_PUBLIC_PUSHER_CLUSTER=us2
`,
      "utf-8"
    );

    // Localnet profile has Localnet Pusher App 2190156
    fs.writeFileSync(
      localnetEnvPath,
      `PUSHER_APP_ID=2190156
PUSHER_KEY=local_key
PUSHER_SECRET=local_secret
NEXT_PUBLIC_PUSHER_KEY=local_key
NEXT_PUBLIC_PUSHER_CLUSTER=mt1
`,
      "utf-8"
    );

    // Step 1: Start in Localnet mode
    const localProfile = loadLocalnetProfile(localnetEnvPath);
    upsertEnvFile(activeEnvPath, {
      NEXT_PUBLIC_ENVIRONMENT: "localnet",
      ...localProfile,
    });

    let activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "localnet");
    assert.strictEqual(activeEnv.PUSHER_APP_ID, "2190156");
    assert.strictEqual(activeEnv.NEXT_PUBLIC_PUSHER_KEY, "local_key");

    // Step 2: Switch to Devnet
    safeguardLocalnetEnv(activeEnvPath, localnetEnvPath);
    syncDevnetToActiveEnv({
      targetFile: activeEnvPath,
      devnetEnvPath,
      addressesPath,
      localnetEnvPath,
    });

    activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(activeEnv.PUSHER_APP_ID, "2197169");
    assert.strictEqual(activeEnv.NEXT_PUBLIC_PUSHER_KEY, "devnet_key");

    // Step 3: Switch back to Localnet
    safeguardDevnetEnv(activeEnvPath, devnetEnvPath);
    const restoredLocal = loadLocalnetProfile(localnetEnvPath);
    upsertEnvFile(activeEnvPath, {
      NEXT_PUBLIC_ENVIRONMENT: "localnet",
      ...restoredLocal,
    });

    activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "localnet");
    assert.strictEqual(activeEnv.PUSHER_APP_ID, "2190156");
    assert.strictEqual(activeEnv.NEXT_PUBLIC_PUSHER_KEY, "local_key");

    // Step 4: Verify profiles remained untouched and unpolluted
    const devnetFinal = readEnvFile(devnetEnvPath);
    const localnetFinal = readEnvFile(localnetEnvPath);
    assert.strictEqual(devnetFinal.PUSHER_APP_ID, "2197169");
    assert.strictEqual(localnetFinal.PUSHER_APP_ID, "2190156");
  });

  it("17. One-Time Bootstrap Seeding: should auto-seed .env.localnet if missing when active env has local Pusher keys", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    // .env.localnet does NOT exist initially
    assert.strictEqual(fs.existsSync(localnetEnvPath), false);

    // .env.local has legacy local Pusher setup
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=localnet
PUSHER_APP_ID=2190156
PUSHER_KEY=legacy_local_key
PUSHER_SECRET=legacy_local_secret
NEXT_PUBLIC_PUSHER_KEY=legacy_local_key
`,
      "utf-8"
    );

    fs.writeFileSync(
      devnetEnvPath,
      `PUSHER_APP_ID=2197169
PUSHER_KEY=devnet_cloud_key
PUSHER_SECRET=devnet_cloud_secret
NEXT_PUBLIC_PUSHER_KEY=devnet_cloud_key
`,
      "utf-8"
    );

    // Run Devnet sync
    syncDevnetToActiveEnv({
      targetFile: activeEnvPath,
      devnetEnvPath,
      addressesPath,
      localnetEnvPath,
    });

    // .env.localnet should have been bootstrapped with local keys!
    assert.ok(fs.existsSync(localnetEnvPath));
    const localnetProfile = readEnvFile(localnetEnvPath);
    assert.strictEqual(localnetProfile.PUSHER_APP_ID, "2190156");
    assert.strictEqual(localnetProfile.PUSHER_KEY, "legacy_local_key");

    // .env.local now has devnet keys
    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(activeEnv.PUSHER_APP_ID, "2197169");
  });

  it("18. isPusherPlaceholder predicate: detects varied placeholders and handles valid keys", () => {
    assert.strictEqual(isPusherPlaceholder(undefined), true);
    assert.strictEqual(isPusherPlaceholder(""), true);
    assert.strictEqual(isPusherPlaceholder("   "), true);
    assert.strictEqual(isPusherPlaceholder("your_app_id"), true);
    assert.strictEqual(isPusherPlaceholder("YOUR_PUSHER_KEY"), true);
    assert.strictEqual(isPusherPlaceholder("your_secret_abc"), true);
    assert.strictEqual(isPusherPlaceholder("placeholder_val"), true);
    assert.strictEqual(isPusherPlaceholder("TODO"), true);
    assert.strictEqual(isPusherPlaceholder("change_me"), true);
    assert.strictEqual(isPusherPlaceholder("my_dummy_secret"), true);
    assert.strictEqual(isPusherPlaceholder("null"), true);
    assert.strictEqual(isPusherPlaceholder("undefined"), true);

    // Valid keys should evaluate to false
    assert.strictEqual(isPusherPlaceholder("2190156"), false);
    assert.strictEqual(isPusherPlaceholder("2197169"), false);
    assert.strictEqual(isPusherPlaceholder("d7c62a64626829adbc7f"), false);
    assert.strictEqual(isPusherPlaceholder("4ddd4557bd916c40ee73"), false);
  });

  it("19. Complete Localnet Endpoint Synchronization: syncLocalnetToActiveEnv strictly overrides Devnet endpoints and safeguards credentials", () => {
    // Start with active .env.local configured with Devnet endpoints
    fs.writeFileSync(
      activeEnvPath,
      `NEXT_PUBLIC_ENVIRONMENT=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com
DATABASE_URL=postgresql://neon_user:secret_pass@ep-cool.neon.tech/neondb?sslmode=require
HELIUS_WEBHOOK_SECRET=cloud_webhook_secret_789
`,
      "utf-8"
    );

    const localnetVars = syncLocalnetToActiveEnv({
      activeEnvPath,
      devnetEnvPath,
      localnetEnvPath,
      accounts: sampleAddresses,
    });

    // 1. Verify returned dictionary has localnet endpoints
    assert.strictEqual(localnetVars.NEXT_PUBLIC_ENVIRONMENT, "localnet");
    assert.strictEqual(
      localnetVars.NEXT_PUBLIC_SOLANA_RPC_URL,
      LOCALNET_DEFAULT_RPC_URL
    );
    assert.strictEqual(localnetVars.SOLANA_RPC_URL, LOCALNET_DEFAULT_RPC_URL);
    assert.strictEqual(
      localnetVars.NEXT_PUBLIC_SOLANA_WS_URL,
      LOCALNET_DEFAULT_WS_URL
    );
    assert.strictEqual(localnetVars.SOLANA_WS_URL, LOCALNET_DEFAULT_WS_URL);
    assert.strictEqual(localnetVars.DATABASE_URL, LOCALNET_DEFAULT_DB_URL);
    assert.strictEqual(
      localnetVars.HELIUS_WEBHOOK_SECRET,
      LOCALNET_MOCK_WEBHOOK_SECRET
    );
    assert.strictEqual(
      localnetVars.NEXT_PUBLIC_PROGRAM_ID,
      sampleAddresses.programId
    );

    // 2. Verify .env.local on disk contains exclusively localnet endpoints
    const activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "localnet");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_RPC_URL,
      "http://127.0.0.1:8899"
    );
    assert.strictEqual(activeEnv.SOLANA_RPC_URL, "http://127.0.0.1:8899");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_WS_URL,
      "ws://127.0.0.1:8900"
    );
    assert.strictEqual(activeEnv.SOLANA_WS_URL, "ws://127.0.0.1:8900");
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://postgres:postgres@127.0.0.1:5432/pb_local_default"
    );
    assert.strictEqual(
      activeEnv.HELIUS_WEBHOOK_SECRET,
      "pb_webhook_secret_local_dev_123"
    );

    // 3. Verify .env.devnet safeguarded the previous Devnet credentials
    assert.ok(fs.existsSync(devnetEnvPath));
    const devnetProfile = readEnvFile(devnetEnvPath);
    assert.strictEqual(
      devnetProfile.DATABASE_URL,
      "postgresql://neon_user:secret_pass@ep-cool.neon.tech/neondb?sslmode=require"
    );
    assert.strictEqual(
      devnetProfile.HELIUS_WEBHOOK_SECRET,
      "cloud_webhook_secret_789"
    );
  });

  it("20. Deterministic Database Name Derivation: syncLocalnetToActiveEnv handles custom db names and explicit databaseUrl", () => {
    // Custom database name derivation
    syncLocalnetToActiveEnv({
      activeEnvPath,
      devnetEnvPath,
      localnetEnvPath,
      accounts: sampleAddresses,
      dbName: "qa_feature_branch",
    });

    let activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://postgres:postgres@127.0.0.1:5432/pb_local_qa_feature_branch"
    );

    // Explicit databaseUrl override
    syncLocalnetToActiveEnv({
      activeEnvPath,
      devnetEnvPath,
      localnetEnvPath,
      accounts: sampleAddresses,
      databaseUrl:
        "postgresql://custom_pg_user:custom_pass@postgres-container:5432/custom_db",
    });

    activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://custom_pg_user:custom_pass@postgres-container:5432/custom_db"
    );
  });

  it("21. Multi-Cycle Bidirectional Switching Full Integrity: devnet <-> localnet transitions without lingering RPC/WS/DB bleed", () => {
    writeClusterAddresses("devnet", sampleAddresses, addressesPath);

    // Initial devnet setup
    fs.writeFileSync(
      devnetEnvPath,
      `DATABASE_URL=postgresql://neon_user:neon_pass@ep-cool.neon.tech/neondb?sslmode=require
HELIUS_WEBHOOK_SECRET=helius_devnet_secret
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=123
SOLANA_WS_URL=wss://devnet.helius-rpc.com/?api-key=123
`,
      "utf-8"
    );

    // Cycle 1: Switch to Devnet
    syncDevnetToActiveEnv({
      targetFile: activeEnvPath,
      devnetEnvPath,
      addressesPath,
      localnetEnvPath,
    });

    let activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(
      activeEnv.SOLANA_RPC_URL,
      "https://devnet.helius-rpc.com/?api-key=123"
    );
    assert.strictEqual(
      activeEnv.SOLANA_WS_URL,
      "wss://devnet.helius-rpc.com/?api-key=123"
    );
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool.neon.tech/neondb?sslmode=require"
    );

    // Cycle 2: Switch to Localnet
    syncLocalnetToActiveEnv({
      activeEnvPath,
      devnetEnvPath,
      localnetEnvPath,
      accounts: sampleAddresses,
    });

    activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "localnet");
    assert.strictEqual(activeEnv.SOLANA_RPC_URL, "http://127.0.0.1:8899");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_RPC_URL,
      "http://127.0.0.1:8899"
    );
    assert.strictEqual(activeEnv.SOLANA_WS_URL, "ws://127.0.0.1:8900");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_WS_URL,
      "ws://127.0.0.1:8900"
    );
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://postgres:postgres@127.0.0.1:5432/pb_local_default"
    );

    // Cycle 3: Switch back to Devnet
    syncDevnetToActiveEnv({
      targetFile: activeEnvPath,
      devnetEnvPath,
      addressesPath,
      localnetEnvPath,
    });

    activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "devnet");
    assert.strictEqual(
      activeEnv.SOLANA_RPC_URL,
      "https://devnet.helius-rpc.com/?api-key=123"
    );
    assert.strictEqual(
      activeEnv.SOLANA_WS_URL,
      "wss://devnet.helius-rpc.com/?api-key=123"
    );
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://neon_user:neon_pass@ep-cool.neon.tech/neondb?sslmode=require"
    );

    // Cycle 4: Switch back to Localnet again
    syncLocalnetToActiveEnv({
      activeEnvPath,
      devnetEnvPath,
      localnetEnvPath,
      accounts: sampleAddresses,
      dbName: "test_db",
    });

    activeEnv = readEnvFile(activeEnvPath);
    assert.strictEqual(activeEnv.NEXT_PUBLIC_ENVIRONMENT, "localnet");
    assert.strictEqual(activeEnv.SOLANA_RPC_URL, "http://127.0.0.1:8899");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_RPC_URL,
      "http://127.0.0.1:8899"
    );
    assert.strictEqual(activeEnv.SOLANA_WS_URL, "ws://127.0.0.1:8900");
    assert.strictEqual(
      activeEnv.NEXT_PUBLIC_SOLANA_WS_URL,
      "ws://127.0.0.1:8900"
    );
    assert.strictEqual(
      activeEnv.DATABASE_URL,
      "postgresql://postgres:postgres@127.0.0.1:5432/pb_local_test_db"
    );
  });

  describe("checkActiveEnvIsLocalnet", () => {
    it("returns isLocalnet: false when target env file does not exist", () => {
      const nonExistentPath = path.resolve(tempDir, ".env.nonexistent");
      const res = checkActiveEnvIsLocalnet(nonExistentPath);
      assert.strictEqual(res.isLocalnet, false);
      assert.strictEqual(res.reason, undefined);
    });

    it("returns isLocalnet: true when NEXT_PUBLIC_ENVIRONMENT is 'localnet'", () => {
      fs.writeFileSync(
        activeEnvPath,
        "NEXT_PUBLIC_ENVIRONMENT=localnet\n",
        "utf-8"
      );
      const res = checkActiveEnvIsLocalnet(activeEnvPath);
      assert.strictEqual(res.isLocalnet, true);
      assert.strictEqual(
        res.reason,
        "NEXT_PUBLIC_ENVIRONMENT is set to 'localnet'"
      );
    });

    it("returns isLocalnet: true when SOLANA_RPC_URL points to local loopback", () => {
      fs.writeFileSync(
        activeEnvPath,
        "NEXT_PUBLIC_ENVIRONMENT=devnet\nSOLANA_RPC_URL=http://127.0.0.1:8899\n",
        "utf-8"
      );
      const res = checkActiveEnvIsLocalnet(activeEnvPath);
      assert.strictEqual(res.isLocalnet, true);
      assert.ok(res.reason?.includes("RPC URL points to a local emulator"));
    });

    it("returns isLocalnet: true when NEXT_PUBLIC_SOLANA_RPC_URL points to localhost", () => {
      fs.writeFileSync(
        activeEnvPath,
        "NEXT_PUBLIC_SOLANA_RPC_URL=http://localhost:8899\n",
        "utf-8"
      );
      const res = checkActiveEnvIsLocalnet(activeEnvPath);
      assert.strictEqual(res.isLocalnet, true);
      assert.ok(res.reason?.includes("RPC URL points to a local emulator"));
    });

    it("returns isLocalnet: true when HELIUS_WEBHOOK_SECRET is the local mock value", () => {
      fs.writeFileSync(
        activeEnvPath,
        "HELIUS_WEBHOOK_SECRET=pb_webhook_secret_local_dev_123\n",
        "utf-8"
      );
      const res = checkActiveEnvIsLocalnet(activeEnvPath);
      assert.strictEqual(res.isLocalnet, true);
      assert.strictEqual(res.reason, "Local mock webhook secret detected");
    });

    it("returns isLocalnet: false when properly configured for devnet", () => {
      fs.writeFileSync(
        activeEnvPath,
        `NEXT_PUBLIC_ENVIRONMENT=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
HELIUS_WEBHOOK_SECRET=my_cloud_helius_secret_123
`,
        "utf-8"
      );
      const res = checkActiveEnvIsLocalnet(activeEnvPath);
      assert.strictEqual(res.isLocalnet, false);
      assert.strictEqual(res.reason, undefined);
    });
  });

  describe("assertActiveEnvIsNotLocalnet", () => {
    it("throws EnvironmentMismatchError when NEXT_PUBLIC_ENVIRONMENT is 'localnet'", () => {
      fs.writeFileSync(
        activeEnvPath,
        "NEXT_PUBLIC_ENVIRONMENT=localnet\n",
        "utf-8"
      );
      assert.throws(
        () => assertActiveEnvIsNotLocalnet(activeEnvPath),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err instanceof EnvironmentMismatchError);
          assert.strictEqual(err.name, "EnvironmentMismatchError");
          assert.strictEqual(
            err.reason,
            "NEXT_PUBLIC_ENVIRONMENT is set to 'localnet'"
          );
          assert.strictEqual(err.envFilePath, activeEnvPath);
          assert.ok(
            err.message.includes(
              "❌ [ENVIRONMENT ERROR] .env.local is configured for LOCALNET"
            )
          );
          assert.ok(err.message.includes("npm run devnet sync-env"));
          assert.ok(err.message.includes("npm run localnet --help"));
          return true;
        }
      );
    });

    it("throws EnvironmentMismatchError when SOLANA_RPC_URL points to loopback", () => {
      fs.writeFileSync(
        activeEnvPath,
        "SOLANA_RPC_URL=http://127.0.0.1:8899\n",
        "utf-8"
      );
      assert.throws(
        () => assertActiveEnvIsNotLocalnet(activeEnvPath),
        (err: unknown) => {
          assert.ok(err instanceof EnvironmentMismatchError);
          assert.ok(err.reason?.includes("RPC URL points to a local emulator"));
          return true;
        }
      );
    });

    it("throws EnvironmentMismatchError when NEXT_PUBLIC_SOLANA_RPC_URL points to localhost", () => {
      fs.writeFileSync(
        activeEnvPath,
        "NEXT_PUBLIC_SOLANA_RPC_URL=http://localhost:8899\n",
        "utf-8"
      );
      assert.throws(
        () => assertActiveEnvIsNotLocalnet(activeEnvPath),
        (err: unknown) => {
          assert.ok(err instanceof EnvironmentMismatchError);
          assert.ok(err.reason?.includes("RPC URL points to a local emulator"));
          return true;
        }
      );
    });

    it("throws EnvironmentMismatchError when local mock webhook secret is present", () => {
      fs.writeFileSync(
        activeEnvPath,
        "HELIUS_WEBHOOK_SECRET=pb_webhook_secret_local_dev_123\n",
        "utf-8"
      );
      assert.throws(
        () => assertActiveEnvIsNotLocalnet(activeEnvPath),
        (err: unknown) => {
          assert.ok(err instanceof EnvironmentMismatchError);
          assert.strictEqual(err.reason, "Local mock webhook secret detected");
          return true;
        }
      );
    });

    it("does NOT throw when environment is configured for devnet", () => {
      fs.writeFileSync(
        activeEnvPath,
        `NEXT_PUBLIC_ENVIRONMENT=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
HELIUS_WEBHOOK_SECRET=cloud_secret_abc
`,
        "utf-8"
      );
      assert.doesNotThrow(() => assertActiveEnvIsNotLocalnet(activeEnvPath));
    });

    it("does NOT throw when target env file does not exist", () => {
      const nonExistentPath = path.resolve(tempDir, ".env.nonexistent");
      assert.doesNotThrow(() => assertActiveEnvIsNotLocalnet(nonExistentPath));
    });

    it("verifies structured properties and prototype inheritance on EnvironmentMismatchError", () => {
      const customPath = "/custom/path/to/.env.test";
      const customReason = "Custom reason text";
      const err = new EnvironmentMismatchError(customPath, customReason);

      assert.ok(err instanceof Error);
      assert.ok(err instanceof EnvironmentMismatchError);
      assert.strictEqual(err.name, "EnvironmentMismatchError");
      assert.strictEqual(err.envFilePath, customPath);
      assert.strictEqual(err.reason, customReason);
      assert.ok(
        err.message.includes(
          "❌ [ENVIRONMENT ERROR] .env.test is configured for LOCALNET"
        )
      );
      assert.ok(err.message.includes("Reason: Custom reason text"));
      assert.ok(err.message.includes("npm run devnet sync-env"));
      assert.ok(err.message.includes("npm run localnet --help"));
    });
  });
});
