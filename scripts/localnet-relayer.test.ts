import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import { serializeAnchorEvent } from "../app/lib/anchor-event-serializer";
import { parseEventsFromTxMeta } from "../app/lib/anchor-events";
import {
  saveWatermarkCursor,
  readWatermarkCursor,
  getCursorFilePath,
  waitForWebhookEndpoint,
} from "./webhook-relayer";
import { sendMockWebhookEvent, sendMockWebhookFixture } from "./mock-webhook";

const TEST_USER = "User111111111111111111111111111111111111111";
const TEST_ADMIN = "Admin11111111111111111111111111111111111111";
const TEST_RANDOMNESS = "Rand111111111111111111111111111111111111111";
const TEST_DB = "test_unit_db";

describe("Localnet Webhook Relayer & Event Serializer Suite", () => {
  let server: http.Server;
  let mockWebhookUrl: string;
  const mockSecret = "secret_test_key_123";
  let receivedRequests: { auth: string | undefined; body: any }[] = [];

  before(async () => {
    server = http.createServer((req, res) => {
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

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const addressInfo = server.address() as { port: number };
    mockWebhookUrl = `http://127.0.0.1:${addressInfo.port}/api/webhooks/solana`;
  });

  after(() => {
    if (server) {
      server.close();
    }
    // Clean up cursor file if it exists
    const cursorPath = getCursorFilePath(TEST_DB);
    if (fs.existsSync(cursorPath)) {
      fs.unlinkSync(cursorPath);
    }
  });

  it("should round-trip serialize and parse all 11 Anchor event types", () => {
    // 1. BondsPurchased
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

    // 2. BondsSold
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

    // 3. WinningsReinvested
    {
      const log = serializeAnchorEvent("WinningsReinvested", {
        winner: TEST_USER,
        poolId: 1,
        cycleId: 3,
        winnerIndex: 4,
        bondsBought: 2,
        amountReinvested: 10000000n,
        timestamp: 1700000000n,
      });
      const parsed = parseEventsFromTxMeta({ logMessages: [log] });
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].type, "WinningsReinvested");
      assert.strictEqual(parsed[0].data.winner, TEST_USER);
      assert.strictEqual(parsed[0].data.cycleId, 3);
      assert.strictEqual(parsed[0].data.winnerIndex, 4);
      assert.strictEqual(parsed[0].data.bondsBought, 2);
      assert.strictEqual(parsed[0].data.amountReinvested, 10000000n);
    }

    // 4. WinningsClaimed
    {
      const log = serializeAnchorEvent("WinningsClaimed", {
        user: TEST_USER,
        poolId: 1,
        amount: 30000000n,
        redemptionId: 456n,
      });
      const parsed = parseEventsFromTxMeta({ logMessages: [log] });
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].type, "WinningsClaimed");
      assert.strictEqual(parsed[0].data.user, TEST_USER);
      assert.strictEqual(parsed[0].data.poolId, 1);
      assert.strictEqual(parsed[0].data.amount, 30000000n);
      assert.strictEqual(parsed[0].data.redemptionId, 456n);
    }

    // 5. RedemptionClaimed
    {
      const log = serializeAnchorEvent("RedemptionClaimed", {
        user: TEST_USER,
        poolId: 1,
        amount: 25000000n,
        redemptionId: 789n,
      });
      const parsed = parseEventsFromTxMeta({ logMessages: [log] });
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].type, "RedemptionClaimed");
      assert.strictEqual(parsed[0].data.user, TEST_USER);
      assert.strictEqual(parsed[0].data.poolId, 1);
      assert.strictEqual(parsed[0].data.amount, 25000000n);
      assert.strictEqual(parsed[0].data.redemptionId, 789n);
    }

    // 6. YieldHarvested
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

    // 7. DrawCompleted
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

    // 8. DrawSkipped
    {
      const log = serializeAnchorEvent("DrawSkipped", {
        poolId: 1,
        cycleId: 2,
        rawYield: 1000000n,
        threshold: 5000000n,
      });
      const parsed = parseEventsFromTxMeta({ logMessages: [log] });
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].type, "DrawSkipped");
      assert.strictEqual(parsed[0].data.poolId, 1);
      assert.strictEqual(parsed[0].data.cycleId, 2);
      assert.strictEqual(parsed[0].data.rawYield, 1000000n);
      assert.strictEqual(parsed[0].data.threshold, 5000000n);
    }

    // 9. DrawForceUnlocked
    {
      const log = serializeAnchorEvent("DrawForceUnlocked", {
        poolId: 1,
        cycleId: 3,
        admin: TEST_ADMIN,
        prizePot: 50000000n,
        cycleFeeCollected: 1250000n,
      });
      const parsed = parseEventsFromTxMeta({ logMessages: [log] });
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].type, "DrawForceUnlocked");
      assert.strictEqual(parsed[0].data.admin, TEST_ADMIN);
      assert.strictEqual(parsed[0].data.prizePot, 50000000n);
    }

    // 10. DrawVoided
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

    // 11. DrawPreparationProgress
    {
      const log = serializeAnchorEvent("DrawPreparationProgress", {
        poolId: 1,
        cycleId: 6,
        batchStart: 0,
        batchEnd: 50,
        userCount: 100,
        isComplete: false,
      });
      const parsed = parseEventsFromTxMeta({ logMessages: [log] });
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].type, "DrawPreparationProgress");
      assert.strictEqual(parsed[0].data.poolId, 1);
      assert.strictEqual(parsed[0].data.batchEnd, 50);
      assert.strictEqual(parsed[0].data.isComplete, false);
    }
  });

  it("should persist, update, and reset watermark cursors per database cleanly", () => {
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
  });

  it("should communicate with HTTP mock webhook and serialize BigInt payloads", async () => {
    // Endpoint readiness check
    const isReady = await waitForWebhookEndpoint(mockWebhookUrl, 3000);
    assert.strictEqual(isReady, true);

    // sendMockWebhookEvent
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

    // sendMockWebhookFixture
    receivedRequests = [];
    await sendMockWebhookFixture("buy", {
      targetUrl: mockWebhookUrl,
      secret: mockSecret,
    });
    assert.strictEqual(receivedRequests.length, 1);
    assert.strictEqual(receivedRequests[0].auth, `Bearer ${mockSecret}`);

    // BigInt payload serialization
    receivedRequests = [];
    const payloadWithBigInts = [
      {
        signature: "sig_bigint_test_123",
        slot: 12345678,
        timestamp: 1700000000,
        err: null,
        meta: {
          err: null,
          fee: 5000n as any,
          preBalances: [1000000000n as any, 50000000n as any],
          postBalances: [999995000n as any, 50000000n as any],
          logMessages: [
            "Program CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx invoke [1]",
          ],
          innerInstructions: [],
        },
      },
    ];

    const bigIntRes = await fetch(mockWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockSecret}`,
      },
      body: JSON.stringify(payloadWithBigInts, (_key, value) =>
        typeof value === "bigint"
          ? Number.isSafeInteger(Number(value))
            ? Number(value)
            : value.toString()
          : value
      ),
    });
    assert.strictEqual(bigIntRes.ok, true);
    assert.strictEqual(receivedRequests.length, 1);
    assert.strictEqual(receivedRequests[0].body[0].meta.fee, 5000);
    assert.strictEqual(
      receivedRequests[0].body[0].meta.preBalances[0],
      1000000000
    );
  });
});
