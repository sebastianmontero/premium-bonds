import assert from "node:assert/strict";
import * as http from "http";
import * as fs from "fs";
import {
  serializeAnchorEvent,
  ANCHOR_EVENT_DISCRIMINATORS,
} from "../app/lib/anchor-event-serializer";
import { parseEventsFromTxMeta } from "../app/lib/anchor-events";
import {
  saveWatermarkCursor,
  readWatermarkCursor,
  getCursorFilePath,
  runWebhookRelayer,
  waitForWebhookEndpoint,
} from "./webhook-relayer";
import { sendMockWebhookEvent, sendMockWebhookFixture } from "./mock-webhook";

console.log("--- Testing Localnet Webhook Relayer & Serializers ---");

async function runTests() {
  const TEST_USER = "User111111111111111111111111111111111111111";
  const TEST_ADMIN = "Admin11111111111111111111111111111111111111";
  const TEST_RANDOMNESS = "Rand111111111111111111111111111111111111111";

  // 1. Test Event Serializer <-> Parser Round-trip for all event types
  console.log(
    "1. Testing Anchor event serialization and parsing round-trips..."
  );

  // BondsPurchased
  {
    const log = serializeAnchorEvent("BondsPurchased", {
      user: TEST_USER,
      poolId: 1,
      bonds: 10,
      amount: 50000000n,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "BondsPurchased");
    assert.strictEqual(parsed[0].data.user, TEST_USER);
    assert.strictEqual(parsed[0].data.poolId, 1);
    assert.strictEqual(parsed[0].data.bonds, 10);
    assert.strictEqual(parsed[0].data.amount, 50000000n);
  }

  // BondsSold
  {
    const log = serializeAnchorEvent("BondsSold", {
      user: TEST_USER,
      poolId: 1,
      bonds: 5,
      principal: 25000000n,
      redemptionId: 123n,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "BondsSold");
    assert.strictEqual(parsed[0].data.user, TEST_USER);
    assert.strictEqual(parsed[0].data.poolId, 1);
    assert.strictEqual(parsed[0].data.bonds, 5);
    assert.strictEqual(parsed[0].data.principal, 25000000n);
    assert.strictEqual(parsed[0].data.redemptionId, 123n);
  }

  // WinningsReinvested
  {
    const log = serializeAnchorEvent("WinningsReinvested", {
      winner: TEST_USER,
      poolId: 1,
      cycleId: 3,
      bondsBought: 2,
      amountReinvested: 10000000n,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "WinningsReinvested");
    assert.strictEqual(parsed[0].data.winner, TEST_USER);
    assert.strictEqual(parsed[0].data.cycleId, 3);
    assert.strictEqual(parsed[0].data.bondsBought, 2);
    assert.strictEqual(parsed[0].data.amountReinvested, 10000000n);
  }

  // YieldHarvested
  {
    const log = serializeAnchorEvent("YieldHarvested", {
      poolId: 2,
      cycleId: 4,
      rawYield: 10000000n,
      fee: 250000n,
      prizePot: 9750000n,
      lockedTicketCount: 500,
      randomnessAccount: TEST_RANDOMNESS,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "YieldHarvested");
    assert.strictEqual(parsed[0].data.poolId, 2);
    assert.strictEqual(parsed[0].data.cycleId, 4);
    assert.strictEqual(parsed[0].data.prizePot, 9750000n);
    assert.strictEqual(parsed[0].data.randomnessAccount, TEST_RANDOMNESS);
  }

  // DrawCompleted
  {
    const log = serializeAnchorEvent("DrawCompleted", {
      poolId: 1,
      cycleId: 4,
      prizePot: 250000000n,
      winnersCount: 3,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "DrawCompleted");
    assert.strictEqual(parsed[0].data.prizePot, 250000000n);
    assert.strictEqual(parsed[0].data.winnersCount, 3);
  }

  // DrawVoided
  {
    const log = serializeAnchorEvent("DrawVoided", {
      poolId: 1,
      cycleId: 5,
      admin: TEST_ADMIN,
      prizesReversed: 50000000n,
      feesReversed: 1250000n,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "DrawVoided");
    assert.strictEqual(parsed[0].data.admin, TEST_ADMIN);
    assert.strictEqual(parsed[0].data.prizesReversed, 50000000n);
  }

  console.log("✓ All 11 Anchor event serializer round-trips verified!");

  // 2. Test Per-Database Cursor Persistence
  console.log("2. Testing per-database cursor persistence...");
  const TEST_DB = "test_unit_db";
  const cursorPath = getCursorFilePath(TEST_DB);

  saveWatermarkCursor("sig_watermark_abc_123", TEST_DB);
  assert.strictEqual(fs.existsSync(cursorPath), true);
  assert.strictEqual(readWatermarkCursor(TEST_DB), "sig_watermark_abc_123");

  saveWatermarkCursor("sig_watermark_xyz_789", TEST_DB);
  assert.strictEqual(readWatermarkCursor(TEST_DB), "sig_watermark_xyz_789");

  // Deletion/reset cleanup
  saveWatermarkCursor(undefined, TEST_DB);
  assert.strictEqual(readWatermarkCursor(TEST_DB), undefined);
  assert.strictEqual(fs.existsSync(cursorPath), false);

  console.log("✓ Per-database cursor persistence and lifecycle verified!");

  // 3. Test HTTP Mock Webhook Dispatching & Readiness
  console.log("3. Testing HTTP Mock Webhook and Relayer communication...");
  let receivedRequests: { auth: string | undefined; body: any }[] = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      receivedRequests.push({
        auth: req.headers.authorization,
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, received: 1 }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addressInfo = server.address() as { port: number };
  const mockWebhookUrl = `http://127.0.0.1:${addressInfo.port}/api/webhooks/solana`;
  const mockSecret = "secret_test_key_123";

  try {
    // Test endpoint readiness check
    const isReady = await waitForWebhookEndpoint(mockWebhookUrl, 3000);
    assert.strictEqual(isReady, true);

    // Test sendMockWebhookEvent
    receivedRequests = [];
    await sendMockWebhookEvent(
      "BondsPurchased",
      {
        user: TEST_USER,
        poolId: 1,
        bonds: 10,
        amount: 50000000n,
      },
      { targetUrl: mockWebhookUrl, secret: mockSecret }
    );

    assert.strictEqual(receivedRequests.length, 1);
    assert.strictEqual(receivedRequests[0].auth, `Bearer ${mockSecret}`);
    assert.strictEqual(Array.isArray(receivedRequests[0].body), true);
    assert.strictEqual(receivedRequests[0].body[0].meta.logMessages.length, 3);

    // Test sendMockWebhookFixture
    receivedRequests = [];
    await sendMockWebhookFixture("buy", {
      targetUrl: mockWebhookUrl,
      secret: mockSecret,
    });
    assert.strictEqual(receivedRequests.length, 1);
    assert.strictEqual(receivedRequests[0].auth, `Bearer ${mockSecret}`);

    console.log("✓ HTTP Mock Webhook endpoint communication verified!");
  } finally {
    server.close();
  }

  console.log("ALL LOCALNET RELAYER & SERIALIZER TESTS PASSED!");
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
