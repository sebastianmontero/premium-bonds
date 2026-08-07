import assert from "assert";
import { getBase58Decoder } from "@solana/kit";

// Discriminators: SHA-256("event:<EventName>")[..8]
const DISCRIMINATORS = {
  BondsPurchased: new Uint8Array([
    0x98, 0x57, 0x7b, 0xdd, 0x8f, 0xc9, 0x2b, 0x0f,
  ]),
  BondsSold: new Uint8Array([0x0a, 0xa4, 0x60, 0xb2, 0x94, 0xf9, 0xdc, 0x2a]),
  WinningsReinvested: new Uint8Array([
    0xae, 0xeb, 0x20, 0x97, 0xb9, 0xe6, 0x3e, 0x6e,
  ]),
  WinningsClaimed: new Uint8Array([
    0xbb, 0xb8, 0x1d, 0xc4, 0x36, 0x75, 0x46, 0x96,
  ]),
  RedemptionClaimed: new Uint8Array([
    0x6b, 0xfb, 0xc7, 0xd5, 0x3b, 0xad, 0x35, 0xbd,
  ]),
  DrawCompleted: new Uint8Array([
    0xc1, 0x88, 0x25, 0x58, 0xb4, 0x7c, 0x60, 0x14,
  ]),
  DrawForceUnlocked: new Uint8Array([
    0x1a, 0x1d, 0xc5, 0x3c, 0xe5, 0x04, 0xde, 0x2d,
  ]),
};

// ANCHOR_EVENT_IX_TAG: sha256("anchor:event")[..8]
const ANCHOR_EVENT_IX_TAG = new Uint8Array([
  0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d,
]);

function buildLogPayload(
  eventName: keyof typeof DISCRIMINATORS,
  fieldData: Uint8Array
): string {
  const disc = DISCRIMINATORS[eventName];
  const combined = new Uint8Array(disc.length + fieldData.length);
  combined.set(disc, 0);
  combined.set(fieldData, disc.length);
  const b64 = Buffer.from(combined).toString("base64");
  return `Program data: ${b64}`;
}

const base58Decoder = getBase58Decoder();
const dummyPubkeyBytes = new Uint8Array(32).fill(7);
const dummyPubkeyStr = base58Decoder.decode(dummyPubkeyBytes) as string;

console.log("Testing anchor-events event parser...");

async function runTests() {
  const { fetchProgramEvents } = await import("../app/lib/anchor-events");

  // 1. Mock BondsPurchased log parsing
  {
    // Payload: Pubkey(32) + u32 pool_id(4) + u32 bonds(4) + u64 amount(8) = 48 bytes
    const fields = new Uint8Array(48);
    fields.set(dummyPubkeyBytes, 0);
    const view = new DataView(
      fields.buffer,
      fields.byteOffset,
      fields.byteLength
    );
    view.setUint32(32, 1, true); // pool_id
    view.setUint32(36, 10, true); // bonds
    view.setBigUint64(40, 50_000_000n, true); // amount

    const logMessage = buildLogPayload("BondsPurchased", fields);

    // Mock RPC client returning 1 tx with this log message
    const mockRpc = {
      getSignaturesForAddress: () => ({
        send: async () => [
          { signature: "sig_purchased_123", blockTime: 1700000000, err: null },
        ],
      }),
      getTransaction: () => ({
        send: async () => ({
          meta: {
            logMessages: [logMessage],
          },
        }),
      }),
    };

    const res = await fetchProgramEvents(mockRpc as any, "DummyAddress" as any);
    assert.strictEqual(res.events.length, 1);
    assert.strictEqual(res.events[0].type, "BondsPurchased");
    assert.strictEqual(res.events[0].data.user, dummyPubkeyStr);
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.bonds, 10);
    assert.strictEqual(res.events[0].data.amount, 50_000_000n);
    assert.strictEqual(res.events[0].signature, "sig_purchased_123");
    console.log("✓ BondsPurchased log event decoded successfully!");
  }

  // 2. Mock BondsSold log parsing
  {
    // Payload: Pubkey(32) + u32 pool_id(4) + u32 bonds(4) + u64 principal(8) + u64 redemption_id(8) = 56 bytes
    const fields = new Uint8Array(56);
    fields.set(dummyPubkeyBytes, 0);
    const view = new DataView(
      fields.buffer,
      fields.byteOffset,
      fields.byteLength
    );
    view.setUint32(32, 1, true); // pool_id
    view.setUint32(36, 5, true); // bonds
    view.setBigUint64(40, 25_000_000n, true); // principal
    view.setBigUint64(48, 999n, true); // redemption_id

    const logMessage = buildLogPayload("BondsSold", fields);

    const mockRpc = {
      getSignaturesForAddress: () => ({
        send: async () => [
          { signature: "sig_sold_456", blockTime: 1700000100, err: null },
        ],
      }),
      getTransaction: () => ({
        send: async () => ({
          meta: {
            logMessages: [logMessage],
          },
        }),
      }),
    };

    const res = await fetchProgramEvents(mockRpc as any, "DummyAddress" as any);
    assert.strictEqual(res.events.length, 1);
    assert.strictEqual(res.events[0].type, "BondsSold");
    assert.strictEqual(res.events[0].data.user, dummyPubkeyStr);
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.bonds, 5);
    assert.strictEqual(res.events[0].data.principal, 25_000_000n);
    assert.strictEqual(res.events[0].data.redemptionId, 999n);
    console.log("✓ BondsSold log event decoded successfully!");
  }

  // 3. Mock CPI Inner Instruction event parsing
  {
    // Payload for WinningsReinvested: Pubkey(32) + u32 pool_id(4) + u32 cycle_id(4) + u32 bonds_bought(4) + u64 amount_reinvested(8) + bool is_final_batch(1) = 53 bytes
    const fields = new Uint8Array(53);
    fields.set(dummyPubkeyBytes, 0);
    const view = new DataView(
      fields.buffer,
      fields.byteOffset,
      fields.byteLength
    );
    view.setUint32(32, 1, true); // pool_id
    view.setUint32(36, 3, true); // cycle_id
    view.setUint32(40, 2, true); // bonds_bought
    view.setBigUint64(44, 10_000_000n, true); // amount_reinvested
    fields[52] = 1; // is_final_batch = true

    const disc = DISCRIMINATORS.WinningsReinvested;
    const cpiBytes = new Uint8Array(
      ANCHOR_EVENT_IX_TAG.length + disc.length + fields.length
    );
    cpiBytes.set(ANCHOR_EVENT_IX_TAG, 0);
    cpiBytes.set(disc, ANCHOR_EVENT_IX_TAG.length);
    cpiBytes.set(fields, ANCHOR_EVENT_IX_TAG.length + disc.length);

    const mockRpc = {
      getSignaturesForAddress: () => ({
        send: async () => [
          { signature: "sig_cpi_reinvest", blockTime: 1700000200, err: null },
        ],
      }),
      getTransaction: () => ({
        send: async () => ({
          meta: {
            innerInstructions: [
              {
                index: 0,
                instructions: [
                  {
                    programIdIndex: 1,
                    data: cpiBytes,
                  },
                ],
              },
            ],
          },
        }),
      }),
    };

    const res = await fetchProgramEvents(mockRpc as any, "DummyAddress" as any);
    assert.strictEqual(res.events.length, 1);
    assert.strictEqual(res.events[0].type, "WinningsReinvested");
    assert.strictEqual(res.events[0].data.winner, dummyPubkeyStr);
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.cycleId, 3);
    assert.strictEqual(res.events[0].data.bondsBought, 2);
    assert.strictEqual(res.events[0].data.amountReinvested, 10_000_000n);
    assert.strictEqual(res.events[0].data.isFinalBatch, true);
    console.log(
      "✓ CPI WinningsReinvested inner instruction event decoded successfully!"
    );
  }

  console.log("\nAll anchor-events tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
