import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  safeguardDevnetEnv,
  syncDevnetToActiveEnv,
  writeDevnetAddresses,
  readDevnetAddresses,
  recordDevnetRandomnessAccount,
  DevnetProtocolAccounts,
} from "./devnet-state";

import { readEnvFile, upsertEnvFile } from "./env-utils";
import { PROGRAM_ID, HUMA_PROGRAM_ID } from "../app/lib/bonds-sdk";

describe("Devnet State Persistence & Synchronization (devnet-state)", () => {
  let tempDir: string;
  let activeEnvPath: string;
  let devnetEnvPath: string;
  let addressesPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-devnet-test-"));
    activeEnvPath = path.resolve(tempDir, ".env.local");
    devnetEnvPath = path.resolve(tempDir, ".env.devnet");
    addressesPath = path.resolve(tempDir, "addresses.json");
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const sampleAddresses: DevnetProtocolAccounts = {
    programId: "Bonds11111111111111111111111111111111111111",
    humaProgramId: "Huma11111111111111111111111111111111111111",
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
    writeDevnetAddresses(sampleAddresses, addressesPath);

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
    writeDevnetAddresses(sampleAddresses, addressesPath);

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
    writeDevnetAddresses(sampleAddresses, addressesPath);

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
    writeDevnetAddresses(
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
    writeDevnetAddresses(sampleAddresses, addressesPath);

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
    writeDevnetAddresses(sampleAddresses, addressesPath);

    fs.writeFileSync(
      activeEnvPath,
      `# Top Level Comment
PUSHER_APP_ID=123456
PUSHER_KEY=pusher_key_abc
PUSHER_SECRET=pusher_secret_xyz
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123/abc
TELEGRAM_BOT_TOKEN=token123
# Custom Dev Setting
MY_CUSTOM_FLAG=true
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
    assert.strictEqual(activeEnv.PUSHER_APP_ID, "123456");
    assert.strictEqual(activeEnv.PUSHER_KEY, "pusher_key_abc");
    assert.strictEqual(activeEnv.PUSHER_SECRET, "pusher_secret_xyz");
    assert.strictEqual(
      activeEnv.DISCORD_WEBHOOK_URL,
      "https://discord.com/api/webhooks/123/abc"
    );
    assert.strictEqual(activeEnv.TELEGRAM_BOT_TOKEN, "token123");
    assert.strictEqual(activeEnv.MY_CUSTOM_FLAG, "true");

    // Comments preserved
    assert.ok(activeContent.includes("# Top Level Comment"));
    assert.ok(activeContent.includes("# Custom Dev Setting"));
  });

  it("10. Mock Replacement in Profile Salvage & Randomness Account Preservation: should preserve Switchboard account and overwrite stale mock URLs", () => {
    const { randomnessAccount, ...addressesWithoutRandomness } =
      sampleAddresses;
    writeDevnetAddresses(addressesWithoutRandomness, addressesPath);

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
    writeDevnetAddresses(sampleAddresses, addressesPath);

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
    writeDevnetAddresses(sampleAddresses, addressesPath);
    fs.writeFileSync(devnetEnvPath, "# Devnet Env\n", "utf-8");

    const newRandomness = "NewRandomnessAccount9999999999999999999999";
    recordDevnetRandomnessAccount(newRandomness, addressesPath, devnetEnvPath);

    const updatedAddresses = readDevnetAddresses(addressesPath);
    assert.strictEqual(updatedAddresses?.randomnessAccount, newRandomness);

    const updatedEnv = readEnvFile(devnetEnvPath);
    assert.strictEqual(
      updatedEnv.NEXT_PUBLIC_RANDOMNESS_ACCOUNT,
      newRandomness
    );
  });
});
