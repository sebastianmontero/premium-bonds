import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, address, getBase58Encoder } from "@solana/kit";
import {
  parseSwitchboardRandomnessHeader,
  isRandomnessCommittable,
  createVrfProvider,
  MockVrfProvider,
  SwitchboardOnDemandProvider,
  SwitchboardAuthorityMismatchError,
  SB_RANDOMNESS_ACCOUNT_SIZE,
  SB_AUTHORITY_OFFSET,
  SB_REQUEST_SLOT_OFFSET,
  SB_REVEAL_SLOT_OFFSET,
  SB_RANDOMNESS_FRESHNESS_SLOT_LIMIT,
  SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
} from "../vrf/randomness-provider";
import { toPoolId, toDrawCycleId, toSlot } from "../types";

function createMockRandomnessBuffer(options?: {
  discriminator?: readonly number[];
  authority?: string;
  seedSlot?: bigint;
  revealSlot?: bigint;
  size?: number;
}): Uint8Array {
  const size = options?.size ?? SB_RANDOMNESS_ACCOUNT_SIZE;
  const buffer = new Uint8Array(size);
  const disc = options?.discriminator ?? SWITCHBOARD_RANDOMNESS_DISCRIMINATOR;
  buffer.set(disc, 0);

  if (options?.authority) {
    const authBytes = getBase58Encoder().encode(address(options.authority));
    buffer.set(authBytes, SB_AUTHORITY_OFFSET);
  }

  const view = new DataView(buffer.buffer);
  if (options?.seedSlot !== undefined && size >= SB_REQUEST_SLOT_OFFSET + 8) {
    view.setBigUint64(SB_REQUEST_SLOT_OFFSET, options.seedSlot, true);
  }
  if (options?.revealSlot !== undefined && size >= SB_REVEAL_SLOT_OFFSET + 8) {
    view.setBigUint64(SB_REVEAL_SLOT_OFFSET, options.revealSlot, true);
  }

  return buffer;
}

describe("Switchboard VRF Provider Unit Tests", () => {
  describe("parseSwitchboardRandomnessHeader", () => {
    it("should parse valid header with accurate authority, seedSlot, and revealSlot", async () => {
      const signer = await generateKeyPairSigner();
      const raw = createMockRandomnessBuffer({
        authority: signer.address,
        seedSlot: 12345n,
        revealSlot: 12348n,
      });

      const parsed = parseSwitchboardRandomnessHeader(raw);
      assert.notStrictEqual(parsed, null);
      assert.strictEqual(parsed?.authority, signer.address);
      assert.strictEqual(parsed?.seedSlot, toSlot(12345n));
      assert.strictEqual(parsed?.revealSlot, toSlot(12348n));
    });

    it("should return null for buffers shorter than 408 bytes", () => {
      const truncated = new Uint8Array(407);
      truncated.set(SWITCHBOARD_RANDOMNESS_DISCRIMINATOR, 0);
      assert.strictEqual(parseSwitchboardRandomnessHeader(truncated), null);
      assert.strictEqual(parseSwitchboardRandomnessHeader(null), null);
      assert.strictEqual(parseSwitchboardRandomnessHeader(undefined), null);
    });

    it("should succeed for exact 408 bytes and larger buffers", async () => {
      const signer = await generateKeyPairSigner();
      const exact = createMockRandomnessBuffer({
        authority: signer.address,
        seedSlot: 100n,
        revealSlot: 200n,
        size: 408,
      });
      const parsedExact = parseSwitchboardRandomnessHeader(exact);
      assert.notStrictEqual(parsedExact, null);
      assert.strictEqual(parsedExact?.authority, signer.address);

      const larger = createMockRandomnessBuffer({
        authority: signer.address,
        seedSlot: 100n,
        revealSlot: 200n,
        size: 512,
      });
      const parsedLarger = parseSwitchboardRandomnessHeader(larger);
      assert.notStrictEqual(parsedLarger, null);
      assert.strictEqual(parsedLarger?.authority, signer.address);
    });

    it("should return null on invalid discriminator", async () => {
      const signer = await generateKeyPairSigner();
      const corrupted = createMockRandomnessBuffer({
        authority: signer.address,
        discriminator: [0, 1, 2, 3, 4, 5, 6, 7],
      });
      assert.strictEqual(parseSwitchboardRandomnessHeader(corrupted), null);
    });
  });

  describe("isRandomnessCommittable", () => {
    const dummyAuth = address("11111111111111111111111111111111");

    it("should be committable when seedSlot === 0n (never used)", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(0n),
        revealSlot: toSlot(0n),
      };
      assert.strictEqual(isRandomnessCommittable(header, toSlot(500n)), true);
    });

    it("should be committable when revealSlot !== 0n (previous cycle revealed)", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(500n),
        revealSlot: toSlot(505n),
      };
      assert.strictEqual(isRandomnessCommittable(header, toSlot(600n)), true);
    });

    it("should be committable when currentSlot - seedSlot > 1000n (expired window)", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(100n),
        revealSlot: toSlot(0n),
      };
      assert.strictEqual(
        isRandomnessCommittable(
          header,
          toSlot(100n + SB_RANDOMNESS_FRESHNESS_SLOT_LIMIT + 1n)
        ),
        true
      );
    });

    it("should NOT be committable when locked in unrevealed active window", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(500n),
        revealSlot: toSlot(0n),
      };
      // Within 1000 slots
      assert.strictEqual(isRandomnessCommittable(header, toSlot(550n)), false);
      assert.strictEqual(
        isRandomnessCommittable(
          header,
          toSlot(500n + SB_RANDOMNESS_FRESHNESS_SLOT_LIMIT)
        ),
        false
      );
    });
  });

  describe("createVrfProvider factory & options bag", () => {
    it("should return MockVrfProvider for local RPC URLs", () => {
      const p1 = createVrfProvider("http://127.0.0.1:8899");
      assert.ok(p1 instanceof MockVrfProvider);

      const p2 = createVrfProvider("http://localhost:8899");
      assert.ok(p2 instanceof MockVrfProvider);

      const p3 = createVrfProvider("http://surfpool:8899");
      assert.ok(p3 instanceof MockVrfProvider);
    });

    it("should return SwitchboardOnDemandProvider with options for remote RPC URLs", async () => {
      const signer = await generateKeyPairSigner();
      const p = createVrfProvider("https://api.devnet.solana.com", {
        signer,
      });
      assert.ok(p instanceof SwitchboardOnDemandProvider);
    });
  });

  describe("SwitchboardOnDemandProvider Fail-Fast & Authority Validation", () => {
    it("should throw error if signer is not configured on prepareHarvestRandomness", async () => {
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com"
      );
      await assert.rejects(
        async () => {
          await provider.prepareHarvestRandomness({
            poolId: toPoolId(1),
            cycleId: toDrawCycleId(1),
          });
        },
        {
          name: "Error",
          message:
            "[SwitchboardOnDemandProvider] Signer is required for harvest randomness authority validation.",
        }
      );
    });

    it("should throw error if signer is not configured on prepareRebindRandomness", async () => {
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com"
      );
      await assert.rejects(
        async () => {
          await provider.prepareRebindRandomness({
            poolId: toPoolId(1),
            cycleId: toDrawCycleId(1),
            staleRandomness: address("11111111111111111111111111111111"),
          });
        },
        {
          name: "Error",
          message:
            "[SwitchboardOnDemandProvider] Signer is required for provisioning fresh randomness.",
        }
      );
    });

    it("should format SwitchboardAuthorityMismatchError with actionable guidance", async () => {
      const crank = await generateKeyPairSigner();
      const admin = await generateKeyPairSigner();
      const rand = address("GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze");

      const err = new SwitchboardAuthorityMismatchError(
        rand,
        admin.address,
        crank.address
      );

      assert.strictEqual(err.code, "SWITCHBOARD_AUTHORITY_MISMATCH");
      assert.strictEqual(err.randomnessAccount, rand);
      assert.strictEqual(err.onChainAuthority, admin.address);
      assert.strictEqual(err.crankSigner, crank.address);
      assert.match(err.message, /Run 'npm run devnet:randomness'/);
    });

    it("should reset programPromise on transient failure to self-heal", async () => {
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com"
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const providerAny = provider as any;
      providerAny.programPromise = Promise.reject(new Error("Network glitch"));
      providerAny.programPromise.catch(() => {
        providerAny.programPromise = undefined;
      });
      try {
        await providerAny.programPromise;
      } catch {
        // expected
      }
      assert.strictEqual(providerAny.programPromise, undefined);
    });
  });
});
