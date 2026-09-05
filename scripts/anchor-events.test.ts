import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getBase58Decoder } from "@solana/kit";
import {
  fetchProgramEvents,
  getCachedEvents,
  setCachedEvents,
  clearCachedEvents,
  fetchClusterGenesisHash,
  resolveEventMetadata,
  parseEventsFromTxMeta,
} from "../app/lib/anchor-events";
import { serializeAnchorEvent } from "../app/lib/anchor-event-serializer";

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
  DrawVoided: new Uint8Array([0x99, 0x2d, 0x33, 0xee, 0x8e, 0x91, 0x03, 0x0c]),
  DrawPreparationProgress: new Uint8Array([
    0xb0, 0x87, 0x00, 0x12, 0xac, 0xfe, 0x87, 0x82,
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

describe("Anchor Program Events Parser & Cache Suite", () => {
  let origLocalStorage: any;
  let storageMap: Map<string, string>;

  beforeEach(() => {
    origLocalStorage = (globalThis as any).localStorage;
    storageMap = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
      get length() {
        return storageMap.size;
      },
      key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    };
  });

  afterEach(() => {
    if (origLocalStorage !== undefined) {
      (globalThis as any).localStorage = origLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
  });

  it("should decode BondsPurchased log event accurately", async () => {
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
    assert.strictEqual(res.events.length, 1, "Expected 1 parsed event");
    assert.strictEqual(res.events[0].type, "BondsPurchased");
    assert.strictEqual(res.events[0].data.user, dummyPubkeyStr);
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.bonds, 10);
    assert.strictEqual(res.events[0].data.amount, 50_000_000n);
    assert.strictEqual(res.events[0].signature, "sig_purchased_123");
  });

  it("should decode BondsSold log event accurately", async () => {
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
    assert.strictEqual(res.events.length, 1, "Expected 1 parsed event");
    assert.strictEqual(res.events[0].type, "BondsSold");
    assert.strictEqual(res.events[0].data.user, dummyPubkeyStr);
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.bonds, 5);
    assert.strictEqual(res.events[0].data.principal, 25_000_000n);
    assert.strictEqual(res.events[0].data.redemptionId, 999n);
  });

  it("should decode CPI WinningsReinvested inner instruction event accurately", async () => {
    // Payload for WinningsReinvested: Pubkey(32) + u32 pool_id(4) + u32 cycle_id(4) + u32 winner_index(4) + u32 bonds_bought(4) + u64 amount_reinvested(8) + i64 timestamp(8) = 64 bytes
    const fields = new Uint8Array(64);
    fields.set(dummyPubkeyBytes, 0);
    const view = new DataView(
      fields.buffer,
      fields.byteOffset,
      fields.byteLength
    );
    view.setUint32(32, 1, true); // pool_id
    view.setUint32(36, 3, true); // cycle_id
    view.setUint32(40, 5, true); // winner_index
    view.setUint32(44, 2, true); // bonds_bought
    view.setBigUint64(48, 10_000_000n, true); // amount_reinvested
    view.setBigInt64(56, 1700000000n, true); // timestamp

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
    assert.strictEqual(res.events.length, 1, "Expected 1 parsed event");
    assert.strictEqual(res.events[0].type, "WinningsReinvested");
    assert.strictEqual(res.events[0].data.winner, dummyPubkeyStr);
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.cycleId, 3);
    assert.strictEqual(res.events[0].data.winnerIndex, 5);
    assert.strictEqual(res.events[0].data.bondsBought, 2);
    assert.strictEqual(res.events[0].data.amountReinvested, 10_000_000n);
    assert.strictEqual(res.events[0].data.timestamp, 1700000000n);
  });

  it("should decode CPI DrawVoided inner instruction event accurately", async () => {
    // Payload for DrawVoided: u32 pool_id(4) + u32 cycle_id(4) + Pubkey admin(32) + u64 prizes_reversed(8) + u64 fees_reversed(8) = 56 bytes
    const fields = new Uint8Array(56);
    const view = new DataView(
      fields.buffer,
      fields.byteOffset,
      fields.byteLength
    );
    view.setUint32(0, 1, true); // pool_id
    view.setUint32(4, 2, true); // cycle_id
    fields.set(dummyPubkeyBytes, 8); // admin
    view.setBigUint64(40, 50_000_000n, true); // prizes_reversed
    view.setBigUint64(48, 5_000_000n, true); // fees_reversed

    const disc = DISCRIMINATORS.DrawVoided;
    const cpiBytes = new Uint8Array(
      ANCHOR_EVENT_IX_TAG.length + disc.length + fields.length
    );
    cpiBytes.set(ANCHOR_EVENT_IX_TAG, 0);
    cpiBytes.set(disc, ANCHOR_EVENT_IX_TAG.length);
    cpiBytes.set(fields, ANCHOR_EVENT_IX_TAG.length + disc.length);

    const mockRpc = {
      getSignaturesForAddress: () => ({
        send: async () => [
          { signature: "sig_cpi_void", blockTime: 1700000300, err: null },
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
    assert.strictEqual(res.events.length, 1, "Expected 1 parsed event");
    assert.strictEqual(res.events[0].type, "DrawVoided");
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.cycleId, 2);
    assert.strictEqual(res.events[0].data.admin, dummyPubkeyStr);
    assert.strictEqual(res.events[0].data.prizesReversed, 50_000_000n);
    assert.strictEqual(res.events[0].data.feesReversed, 5_000_000n);
  });

  it("should decode DrawPreparationProgress log event accurately", async () => {
    // Payload: u32 pool_id(4) + u32 cycle_id(4) + u32 batch_start(4) + u32 batch_end(4) + u32 user_count(4) + bool is_complete(1) = 21 bytes
    const fields = new Uint8Array(21);
    const view = new DataView(
      fields.buffer,
      fields.byteOffset,
      fields.byteLength
    );
    view.setUint32(0, 1, true); // pool_id
    view.setUint32(4, 5, true); // cycle_id
    view.setUint32(8, 0, true); // batch_start
    view.setUint32(12, 10, true); // batch_end
    view.setUint32(16, 10, true); // user_count
    view.setUint8(20, 1); // is_complete = true

    const logMessage = buildLogPayload("DrawPreparationProgress", fields);

    const mockRpc = {
      getSignaturesForAddress: () => ({
        send: async () => [
          { signature: "sig_prep_prog", blockTime: 1700000400, err: null },
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
    assert.strictEqual(res.events.length, 1, "Expected 1 parsed event");
    assert.strictEqual(res.events[0].type, "DrawPreparationProgress");
    assert.strictEqual(res.events[0].data.poolId, 1);
    assert.strictEqual(res.events[0].data.cycleId, 5);
    assert.strictEqual(res.events[0].data.batchStart, 0);
    assert.strictEqual(res.events[0].data.batchEnd, 10);
    assert.strictEqual(res.events[0].data.userCount, 10);
    assert.strictEqual(res.events[0].data.isComplete, true);
  });

  it("should validate event caching, genesisHash versioning, and invalidation", async () => {
    const dummyUser = "User11111111111111111111111111111111111111";
    const genesisA = "GenesisHashAlpha11111111111111111111111111";
    const genesisB = "GenesisHashBeta222222222222222222222222222";

    const mockEvents = [
      {
        type: "BondsPurchased" as const,
        data: {
          user: dummyUser,
          poolId: 1,
          bonds: 5,
          amount: 25_000_000n,
        },
        signature: "sig_abc_1",
        blockTime: 1700000000,
      },
    ];

    // Write and read cache with genesisHash
    setCachedEvents(
      dummyUser,
      mockEvents,
      "sig_abc_1",
      "sig_abc_1",
      true,
      genesisA
    );
    const cachedA = getCachedEvents(dummyUser, genesisA);
    assert.notStrictEqual(
      cachedA,
      null,
      "Expected cached events to be retrieved"
    );
    assert.strictEqual(cachedA?.events.length, 1);
    assert.strictEqual(cachedA?.genesisHash, genesisA);
    assert.strictEqual(cachedA?.lastSignature, "sig_abc_1");

    // Mismatched genesisHash should invalidate and purge cache
    const cachedMismatch = getCachedEvents(dummyUser, genesisB);
    assert.strictEqual(
      cachedMismatch,
      null,
      "Expected genesis mismatch to return null and purge"
    );

    // Legacy un-versioned cache entries should be strictly evicted when expectedGenesisHash is passed
    const legacyUser = "LegacyUser999999999999999999999999999999";
    const legacyRaw = JSON.stringify(
      {
        events: mockEvents,
        lastSignature: "sig_legacy",
        oldestSignature: "sig_legacy",
        hasMore: true,
        timestamp: Date.now(),
      },
      (_, value) =>
        typeof value === "bigint" ? { __bigint: value.toString() } : value
    );
    globalThis.localStorage.setItem(
      `pb_events:activity:${legacyUser}`,
      legacyRaw
    );

    const legacyChecked = getCachedEvents(legacyUser, genesisA);
    assert.strictEqual(
      legacyChecked,
      null,
      "Expected legacy cache with undefined genesisHash to be evicted when expectedGenesisHash is provided"
    );
    assert.strictEqual(
      globalThis.localStorage.getItem(`pb_events:activity:${legacyUser}`),
      null,
      "Expected legacy key to be removed from storage"
    );

    // fetchClusterGenesisHash helper
    const mockRpcGenesis = {
      getGenesisHash: () => ({
        send: async () => genesisA,
      }),
    };
    const fetchedGenesis = await fetchClusterGenesisHash(mockRpcGenesis as any);
    assert.strictEqual(fetchedGenesis, genesisA);

    // Failing RPC fallback
    const mockFailingRpc = {
      getGenesisHash: () => ({
        send: async () => {
          throw new Error("RPC unreachable");
        },
      }),
    };
    const fallbackGenesis = await fetchClusterGenesisHash(
      mockFailingRpc as any
    );
    assert.strictEqual(
      fallbackGenesis,
      null,
      "Expected failing RPC to return null safely without throwing"
    );

    // clearCachedEvents
    setCachedEvents(
      dummyUser,
      mockEvents,
      "sig_abc_1",
      "sig_abc_1",
      true,
      genesisA
    );
    clearCachedEvents(dummyUser, genesisA);
    assert.strictEqual(getCachedEvents(dummyUser, genesisA), null);

    setCachedEvents(
      dummyUser,
      mockEvents,
      "sig_abc_1",
      "sig_abc_1",
      true,
      genesisB
    );
    clearCachedEvents();
    assert.strictEqual(globalThis.localStorage.length, 0);
  });

  it("should handle clean empty RPC responses gracefully", async () => {
    const emptyRpc = {
      getSignaturesForAddress: () => ({
        send: async () => [],
      }),
    };

    const emptyResult = await fetchProgramEvents(
      emptyRpc as any,
      "CleanNodeWallet111111111111111111111111111" as any
    );
    assert.strictEqual(emptyResult.events.length, 0);
    assert.strictEqual(emptyResult.oldestRawSignature, null);
    assert.strictEqual(emptyResult.hasMore, false);
  });

  it("should roundtrip 36-byte DrawSkipped event serialization and deserialization", () => {
    const log = serializeAnchorEvent("DrawSkipped", {
      poolId: 1,
      cycleId: 4,
      rawYield: 250_000n,
      threshold: 1_000_000n,
      lockedTicketCount: 42,
      timestamp: 1700000000n,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "DrawSkipped");
    if (parsed[0].type === "DrawSkipped") {
      assert.strictEqual(parsed[0].data.poolId, 1);
      assert.strictEqual(parsed[0].data.cycleId, 4);
      assert.strictEqual(parsed[0].data.rawYield, 250_000n);
      assert.strictEqual(parsed[0].data.threshold, 1_000_000n);
      assert.strictEqual(parsed[0].data.lockedTicketCount, 42);
      assert.strictEqual(parsed[0].data.timestamp, 1700000000n);
    }
  });

  it("should roundtrip 88-byte RandomnessRebound event serialization and deserialization", () => {
    const log = serializeAnchorEvent("RandomnessRebound", {
      poolId: 1,
      cycleId: 7,
      oldRandomnessAccount: dummyPubkeyStr,
      newRandomnessAccount: "22222222222222222222222222222222222222222222",
      harvestSlot: 5555n,
      timestamp: 1700000000n,
    });
    const parsed = parseEventsFromTxMeta({ logMessages: [log] });
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].type, "RandomnessRebound");
    if (parsed[0].type === "RandomnessRebound") {
      assert.strictEqual(parsed[0].data.poolId, 1);
      assert.strictEqual(parsed[0].data.cycleId, 7);
      assert.strictEqual(parsed[0].data.oldRandomnessAccount, dummyPubkeyStr);
      assert.strictEqual(
        parsed[0].data.newRandomnessAccount,
        "22222222222222222222222222222222222222222222"
      );
      assert.strictEqual(parsed[0].data.harvestSlot, 5555n);
    }
  });

  it("should roundtrip EmergencyInsolvencyDetected and YieldVelocityBreached events", () => {
    const insolvLog = serializeAnchorEvent("EmergencyInsolvencyDetected", {
      poolId: 1,
      cycleId: 2,
      currentValue: 8_000_000n,
      bookValue: 10_000_000n,
      deficit: 2_000_000n,
      lockedTicketCount: 15,
      timestamp: 1700000000n,
    });
    const parsedInsolv = parseEventsFromTxMeta({ logMessages: [insolvLog] });
    assert.strictEqual(parsedInsolv.length, 1);
    assert.strictEqual(parsedInsolv[0].type, "EmergencyInsolvencyDetected");
    if (parsedInsolv[0].type === "EmergencyInsolvencyDetected") {
      assert.strictEqual(parsedInsolv[0].data.poolId, 1);
      assert.strictEqual(parsedInsolv[0].data.cycleId, 2);
      assert.strictEqual(parsedInsolv[0].data.currentValue, 8_000_000n);
      assert.strictEqual(parsedInsolv[0].data.bookValue, 10_000_000n);
      assert.strictEqual(parsedInsolv[0].data.deficit, 2_000_000n);
      assert.strictEqual(parsedInsolv[0].data.lockedTicketCount, 15);
    }

    const spikeLog = serializeAnchorEvent("YieldVelocityBreached", {
      poolId: 1,
      cycleId: 3,
      yieldGenerated: 5_000_000n,
      maxAllowedYield: 500_000n,
      lockedTicketCount: 20,
      timestamp: 1700000000n,
    });
    const parsedSpike = parseEventsFromTxMeta({ logMessages: [spikeLog] });
    assert.strictEqual(parsedSpike.length, 1);
    assert.strictEqual(parsedSpike[0].type, "YieldVelocityBreached");
    if (parsedSpike[0].type === "YieldVelocityBreached") {
      assert.strictEqual(parsedSpike[0].data.poolId, 1);
      assert.strictEqual(parsedSpike[0].data.cycleId, 3);
      assert.strictEqual(parsedSpike[0].data.yieldGenerated, 5_000_000n);
      assert.strictEqual(parsedSpike[0].data.maxAllowedYield, 500_000n);
      assert.strictEqual(parsedSpike[0].data.lockedTicketCount, 20);
    }
  });

  it("should resolve proper metadata scopes for DrawVoided, EmergencyInsolvencyDetected, and YieldVelocityBreached", () => {
    const metaVoided = resolveEventMetadata({
      type: "DrawVoided",
      data: {
        poolId: 1,
        cycleId: 2,
        admin: dummyPubkeyStr as any,
        prizesReversed: 1000n,
        feesReversed: 100n,
      },
    });
    assert.deepStrictEqual(metaVoided.scopes, ["draws", "pool", "user"]);

    const metaInsolv = resolveEventMetadata({
      type: "EmergencyInsolvencyDetected",
      data: {
        poolId: 1,
        cycleId: 2,
        currentValue: 8000n,
        bookValue: 10000n,
        deficit: 2000n,
        lockedTicketCount: 10,
      },
    });
    assert.deepStrictEqual(metaInsolv.scopes, ["pool", "draws"]);

    const metaSpike = resolveEventMetadata({
      type: "YieldVelocityBreached",
      data: {
        poolId: 1,
        cycleId: 2,
        yieldGenerated: 5000n,
        maxAllowedYield: 500n,
        lockedTicketCount: 10,
      },
    });
    assert.deepStrictEqual(metaSpike.scopes, ["pool", "draws"]);
  });
});

