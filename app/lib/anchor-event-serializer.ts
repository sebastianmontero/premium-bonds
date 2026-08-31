import { getBase58Encoder } from "@solana/kit";

const base58Encoder = getBase58Encoder();

// Event Discriminators: SHA-256("event:<EventName>")[..8]
export const ANCHOR_EVENT_DISCRIMINATORS: Record<string, Uint8Array> = {
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
  YieldHarvested: new Uint8Array([
    0x31, 0xc5, 0xe2, 0xe8, 0x9a, 0xd3, 0xf9, 0xde,
  ]),
  DrawCompleted: new Uint8Array([
    0xc1, 0x88, 0x25, 0x58, 0xb4, 0x7c, 0x60, 0x14,
  ]),
  DrawSkipped: new Uint8Array([0x27, 0x0b, 0x1d, 0xbe, 0x81, 0xf9, 0x5c, 0xb4]),
  DrawForceUnlocked: new Uint8Array([
    0x1a, 0x1d, 0xc5, 0x3c, 0xe5, 0x04, 0xde, 0x2d,
  ]),
  DrawVoided: new Uint8Array([0x99, 0x2d, 0x33, 0xee, 0x8e, 0x91, 0x03, 0x0c]),
  DrawPreparationProgress: new Uint8Array([
    0xb0, 0x87, 0x00, 0x12, 0xac, 0xfe, 0x87, 0x82,
  ]),
  PoolCreated: new Uint8Array([0xca, 0x2c, 0x29, 0x58, 0x68, 0xdc, 0x9d, 0x52]),
  HumaLenderInitialized: new Uint8Array([
    0x42, 0xd0, 0xfe, 0x01, 0x99, 0x15, 0xd7, 0x33,
  ]),
  GlobalConfigInitialized: new Uint8Array([
    0x05, 0xdd, 0xac, 0x9e, 0x4d, 0x57, 0x9d, 0x71,
  ]),
  GlobalConfigUpdated: new Uint8Array([
    0xe8, 0xee, 0x9e, 0x7b, 0xd2, 0xac, 0x9f, 0x2e,
  ]),
  PoolConfigUpdated: new Uint8Array([
    0xce, 0x21, 0x1d, 0x08, 0x54, 0x54, 0x82, 0x27,
  ]),
  PoolStatusChanged: new Uint8Array([
    0x94, 0xbe, 0x51, 0x3e, 0x51, 0xef, 0x89, 0xbc,
  ]),
  EmergencyInsolvencyDetected: new Uint8Array([
    0xa8, 0x99, 0x8a, 0x09, 0xbe, 0x43, 0xe6, 0x11,
  ]),
  YieldVelocityBreached: new Uint8Array([
    0x27, 0x08, 0x55, 0x32, 0xe5, 0x24, 0x42, 0x19,
  ]),
  PrizeTiersUpdated: new Uint8Array([
    0x2b, 0xbe, 0x13, 0x94, 0x99, 0x88, 0x29, 0x79,
  ]),
  RegistryResized: new Uint8Array([
    0x04, 0x1b, 0xfd, 0x9b, 0x7c, 0xbe, 0x1d, 0xeb,
  ]),
  RandomnessRebound: new Uint8Array([
    0xc2, 0xb5, 0xca, 0xda, 0x34, 0x80, 0x13, 0x42,
  ]),
  FeesWithdrawn: new Uint8Array([
    0xea, 0x0f, 0x00, 0x77, 0x94, 0xf1, 0x28, 0x15,
  ]),
};

function pubkeyToBytes(pubkey: string): Uint8Array {
  try {
    const bytes = base58Encoder.encode(pubkey);
    if (bytes.length === 32) return new Uint8Array(bytes);
  } catch {
    // fallback to padded/truncated byte array
  }
  const fallback = new Uint8Array(32);
  const raw = Buffer.from(pubkey);
  fallback.set(raw.slice(0, 32));
  return fallback;
}

/**
 * Serializes Anchor event fields into a raw `Program data: <base64>` log string.
 */
export function serializeAnchorEvent(
  eventName: keyof typeof ANCHOR_EVENT_DISCRIMINATORS | string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
): string {
  const discriminator = ANCHOR_EVENT_DISCRIMINATORS[eventName];
  if (!discriminator) {
    throw new Error(`Unknown event discriminator for event type: ${eventName}`);
  }

  let fields: Uint8Array;

  switch (eventName) {
    case "BondsPurchased": {
      // Pubkey(32) + u32(4) + u32(4) + u64(8) = 48 bytes
      fields = new Uint8Array(48);
      const view = new DataView(fields.buffer);
      fields.set(
        pubkeyToBytes(data.user || "11111111111111111111111111111111"),
        0
      );
      view.setUint32(32, Number(data.poolId || 1), true);
      view.setUint32(36, Number(data.bonds || 0), true);
      view.setBigUint64(40, BigInt(data.amount || 0), true);
      break;
    }
    case "BondsSold": {
      // Pubkey(32) + u32(4) + u32(4) + u64(8) + u64(8) = 56 bytes
      fields = new Uint8Array(56);
      const view = new DataView(fields.buffer);
      fields.set(
        pubkeyToBytes(data.user || "11111111111111111111111111111111"),
        0
      );
      view.setUint32(32, Number(data.poolId || 1), true);
      view.setUint32(36, Number(data.bonds || 0), true);
      view.setBigUint64(40, BigInt(data.principal || 0), true);
      view.setBigUint64(48, BigInt(data.redemptionId || 0), true);
      break;
    }
    case "WinningsReinvested": {
      // Pubkey(32) + u32(4) + u32(4) + u32(4) + u64(8) = 52 bytes
      fields = new Uint8Array(52);
      const view = new DataView(fields.buffer);
      fields.set(
        pubkeyToBytes(data.winner || "11111111111111111111111111111111"),
        0
      );
      view.setUint32(32, Number(data.poolId || 1), true);
      view.setUint32(36, Number(data.cycleId || 1), true);
      view.setUint32(40, Number(data.bondsBought || 0), true);
      view.setBigUint64(44, BigInt(data.amountReinvested || 0), true);
      break;
    }
    case "WinningsClaimed": {
      // Pubkey(32) + u32(4) + u64(8) + u64(8) = 52 bytes
      fields = new Uint8Array(52);
      const view = new DataView(fields.buffer);
      fields.set(
        pubkeyToBytes(data.user || "11111111111111111111111111111111"),
        0
      );
      view.setUint32(32, Number(data.poolId || 1), true);
      view.setBigUint64(36, BigInt(data.amount || 0), true);
      view.setBigUint64(44, BigInt(data.redemptionId || 0), true);
      break;
    }
    case "RedemptionClaimed": {
      // Pubkey(32) + u32(4) + u64(8) + u64(8) = 52 bytes
      fields = new Uint8Array(52);
      const view = new DataView(fields.buffer);
      fields.set(
        pubkeyToBytes(data.user || "11111111111111111111111111111111"),
        0
      );
      view.setUint32(32, Number(data.poolId || 1), true);
      view.setBigUint64(36, BigInt(data.amount || 0), true);
      view.setBigUint64(44, BigInt(data.redemptionId || 0), true);
      break;
    }
    case "YieldHarvested": {
      // u32(4) + u32(4) + u64(8) + u64(8) + u64(8) + u32(4) + Pubkey(32) = 68 bytes
      fields = new Uint8Array(68);
      const view = new DataView(fields.buffer);
      view.setUint32(0, Number(data.poolId || 1), true);
      view.setUint32(4, Number(data.cycleId || 1), true);
      view.setBigUint64(8, BigInt(data.rawYield || 0), true);
      view.setBigUint64(16, BigInt(data.fee || 0), true);
      view.setBigUint64(24, BigInt(data.prizePot || 0), true);
      view.setUint32(32, Number(data.lockedTicketCount || 0), true);
      fields.set(
        pubkeyToBytes(
          data.randomnessAccount || "11111111111111111111111111111111"
        ),
        36
      );
      break;
    }
    case "DrawSkipped": {
      // u32(4) + u32(4) + u64(8) + u64(8) = 24 bytes
      fields = new Uint8Array(24);
      const view = new DataView(fields.buffer);
      view.setUint32(0, Number(data.poolId || 1), true);
      view.setUint32(4, Number(data.cycleId || 1), true);
      view.setBigUint64(8, BigInt(data.rawYield || 0), true);
      view.setBigUint64(16, BigInt(data.threshold || 0), true);
      break;
    }
    case "DrawCompleted": {
      // u32(4) + u32(4) + u64(8) + u32(4) = 20 bytes
      fields = new Uint8Array(20);
      const view = new DataView(fields.buffer);
      view.setUint32(0, Number(data.poolId || 1), true);
      view.setUint32(4, Number(data.cycleId || 1), true);
      view.setBigUint64(8, BigInt(data.prizePot || 0), true);
      view.setUint32(16, Number(data.winnersCount || 0), true);
      break;
    }
    case "DrawForceUnlocked": {
      // u32(4) + u32(4) + Pubkey(32) + u64(8) + u64(8) = 56 bytes
      fields = new Uint8Array(56);
      const view = new DataView(fields.buffer);
      view.setUint32(0, Number(data.poolId || 1), true);
      view.setUint32(4, Number(data.cycleId || 1), true);
      fields.set(
        pubkeyToBytes(data.admin || "11111111111111111111111111111111"),
        8
      );
      view.setBigUint64(40, BigInt(data.prizePot || 0), true);
      view.setBigUint64(48, BigInt(data.cycleFeeCollected || 0), true);
      break;
    }
    case "DrawVoided": {
      // u32(4) + u32(4) + Pubkey(32) + u64(8) + u64(8) = 56 bytes
      fields = new Uint8Array(56);
      const view = new DataView(fields.buffer);
      view.setUint32(0, Number(data.poolId || 1), true);
      view.setUint32(4, Number(data.cycleId || 1), true);
      fields.set(
        pubkeyToBytes(data.admin || "11111111111111111111111111111111"),
        8
      );
      view.setBigUint64(40, BigInt(data.prizesReversed || 0), true);
      view.setBigUint64(48, BigInt(data.feesReversed || 0), true);
      break;
    }
    case "DrawPreparationProgress": {
      // u32(4) + u32(4) + u32(4) + u32(4) + u32(4) + bool(1) = 21 bytes
      fields = new Uint8Array(21);
      const view = new DataView(fields.buffer);
      view.setUint32(0, Number(data.poolId || 1), true);
      view.setUint32(4, Number(data.cycleId || 1), true);
      view.setUint32(8, Number(data.batchStart || 0), true);
      view.setUint32(12, Number(data.batchEnd || 0), true);
      view.setUint32(16, Number(data.userCount || 0), true);
      view.setUint8(20, data.isComplete ? 1 : 0);
      break;
    }
    default:
      throw new Error(`Serialization not implemented for event: ${eventName}`);
  }

  const combined = new Uint8Array(discriminator.length + fields.length);
  combined.set(discriminator, 0);
  combined.set(fields, discriminator.length);
  const b64 = Buffer.from(combined).toString("base64");
  return `Program data: ${b64}`;
}
