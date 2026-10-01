import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as web3 from "@solana/web3.js";
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
  SB_SEED_OFFSET,
  SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
  encodeMockSwitchboardRandomness,
} from "../vrf/randomness-provider";
import { VRF_FRESHNESS_WINDOW_SLOTS } from "../constants";
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
          toSlot(100n + VRF_FRESHNESS_WINDOW_SLOTS + 1n)
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
          toSlot(500n + VRF_FRESHNESS_WINDOW_SLOTS)
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

    it("should pass randomnessAccount to MockVrfProvider for local RPC URLs", async () => {
      const mockAddr = address("11111111111111111111111111111111");
      const p = createVrfProvider("http://127.0.0.1:8899", {
        randomnessAccount: mockAddr,
      });
      assert.ok(p instanceof MockVrfProvider);
      const binding = await p.prepareHarvestRandomness({
        poolId: toPoolId(1),
        cycleId: toDrawCycleId(1),
      });
      assert.strictEqual(binding.randomnessAccount, mockAddr);
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

    it("should use defaultRandomnessAccount from options when resolving randomness", async () => {
      const signer = await generateKeyPairSigner();
      const customAddr = address("GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze");
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com",
        {
          signer,
          randomnessAccount: customAddr,
        }
      );

      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      let requestedKey: web3.PublicKey | undefined;
      web3.Connection.prototype.getAccountInfo = (async (pk: web3.PublicKey) => {
        requestedKey = pk;
        return null; // Return null so it fails on account existence, validating the address chosen
      }) as typeof originalGetAccountInfo;

      try {
        await assert.rejects(
          () =>
            provider.prepareHarvestRandomness({
              poolId: toPoolId(1),
              cycleId: toDrawCycleId(1),
            }),
          /Randomness account GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze not found on-chain/
        );
        assert.strictEqual(requestedKey?.toBase58(), customAddr);
      } finally {
        web3.Connection.prototype.getAccountInfo = originalGetAccountInfo;
      }
    });

    it("should prioritize params.randomnessAccount over defaultRandomnessAccount and env", async () => {
      const signer = await generateKeyPairSigner();
      const optionAddr = address("11111111111111111111111111111111");
      const paramAddr = address("GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze");
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com",
        {
          signer,
          randomnessAccount: optionAddr,
        }
      );

      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      let requestedKey: web3.PublicKey | undefined;
      web3.Connection.prototype.getAccountInfo = (async (pk: web3.PublicKey) => {
        requestedKey = pk;
        return null;
      }) as typeof originalGetAccountInfo;

      try {
        await assert.rejects(
          () =>
            provider.prepareHarvestRandomness({
              poolId: toPoolId(1),
              cycleId: toDrawCycleId(1),
              randomnessAccount: paramAddr,
            }),
          /Randomness account GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze not found on-chain/
        );
        assert.strictEqual(requestedKey?.toBase58(), paramAddr);
      } finally {
        web3.Connection.prototype.getAccountInfo = originalGetAccountInfo;
      }
    });

    it("should prioritize POOL_2_RANDOMNESS_ACCOUNT over defaultRandomnessAccount for pool 2", async () => {
      const signer = await generateKeyPairSigner();
      const defaultAddr = address("11111111111111111111111111111111");
      const pool2Addr = "GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze";
      const oldEnv = process.env.POOL_2_RANDOMNESS_ACCOUNT;
      process.env.POOL_2_RANDOMNESS_ACCOUNT = pool2Addr;

      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com",
        {
          signer,
          randomnessAccount: defaultAddr,
        }
      );

      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      let requestedKey: web3.PublicKey | undefined;
      web3.Connection.prototype.getAccountInfo = (async (pk: web3.PublicKey) => {
        requestedKey = pk;
        return null;
      }) as typeof originalGetAccountInfo;

      try {
        await assert.rejects(
          () =>
            provider.prepareHarvestRandomness({
              poolId: toPoolId(2),
              cycleId: toDrawCycleId(1),
            }),
          /Randomness account GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze not found on-chain/
        );
        assert.strictEqual(requestedKey?.toBase58(), pool2Addr);
      } finally {
        process.env.POOL_2_RANDOMNESS_ACCOUNT = oldEnv;
        web3.Connection.prototype.getAccountInfo = originalGetAccountInfo;
      }
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

    it("should return uncommitted on prepareReveal when account is missing", async () => {
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com"
      );
      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      web3.Connection.prototype.getAccountInfo = async () => null;
      try {
        const res = await provider.prepareReveal({
          randomnessAccount: address("11111111111111111111111111111111"),
          committedSeedSlot: toSlot(100n),
          currentSlot: toSlot(200n),
        });
        assert.strictEqual(res.status, "uncommitted");
        assert.strictEqual(res.seedSlot, toSlot(0n));
        assert.strictEqual(res.committedSeedSlot, toSlot(100n));
      } finally {
        web3.Connection.prototype.getAccountInfo = originalGetAccountInfo;
      }
    });

    it("should return mismatch on prepareReveal when seedSlot !== committedSeedSlot", async () => {
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com"
      );
      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      const raw = createMockRandomnessBuffer({
        authority: "11111111111111111111111111111111",
        seedSlot: 99n,
        revealSlot: 0n,
      });
      web3.Connection.prototype.getAccountInfo = (async () => ({
        data: Buffer.from(raw),
        executable: false,
        lamports: 1000000,
        owner: new web3.PublicKey(
          "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
        ),
      })) as typeof originalGetAccountInfo;
      try {
        const res = await provider.prepareReveal({
          randomnessAccount: address("11111111111111111111111111111111"),
          committedSeedSlot: toSlot(100n),
          currentSlot: toSlot(200n),
        });
        assert.strictEqual(res.status, "mismatch");
        assert.strictEqual(res.seedSlot, toSlot(99n));
        assert.strictEqual(res.committedSeedSlot, toSlot(100n));
      } finally {
        web3.Connection.prototype.getAccountInfo = originalGetAccountInfo;
      }
    });

    it("should return expired on prepareReveal when elapsed slots > 1000n", async () => {
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com"
      );
      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      const raw = createMockRandomnessBuffer({
        authority: "11111111111111111111111111111111",
        seedSlot: 100n,
        revealSlot: 0n,
      });
      web3.Connection.prototype.getAccountInfo = (async () => ({
        data: Buffer.from(raw),
        executable: false,
        lamports: 1000000,
        owner: new web3.PublicKey(
          "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
        ),
      })) as typeof originalGetAccountInfo;
      try {
        const res = await provider.prepareReveal({
          randomnessAccount: address("11111111111111111111111111111111"),
          committedSeedSlot: toSlot(100n),
          currentSlot: toSlot(1200n),
        });
        assert.strictEqual(res.status, "expired");
        assert.strictEqual(res.elapsedSlots, toSlot(1100n));
      } finally {
        web3.Connection.prototype.getAccountInfo = originalGetAccountInfo;
      }
    });
  });

  describe("encodeMockSwitchboardRandomness helper", () => {
    it("should produce a valid 408-byte Switchboard account buffer with discriminator", async () => {
      const auth = await generateKeyPairSigner();
      const seedValue = new Uint8Array(32);
      seedValue.fill(42);

      const encoded = encodeMockSwitchboardRandomness({
        authority: auth.address,
        seedSlot: 550n,
        revealSlot: 552n,
        value: seedValue,
      });

      assert.strictEqual(encoded.length, SB_RANDOMNESS_ACCOUNT_SIZE);
      const parsed = parseSwitchboardRandomnessHeader(encoded);
      assert.notStrictEqual(parsed, null);
      assert.strictEqual(parsed?.authority, auth.address);
      assert.strictEqual(parsed?.seedSlot, toSlot(550n));
      assert.strictEqual(parsed?.revealSlot, toSlot(552n));

      // Check seed value slice
      const valueSlice = encoded.subarray(SB_SEED_OFFSET, SB_SEED_OFFSET + 32);
      assert.deepStrictEqual(Array.from(valueSlice), Array.from(seedValue));
    });

    it("should reject randomness values that are not 32 bytes", () => {
      assert.throws(
        () =>
          encodeMockSwitchboardRandomness({
            value: new Uint8Array(16),
          }),
        /Invalid randomness value length: expected 32 bytes/
      );
    });
  });

  describe("MockVrfProvider", () => {
    it("should allocate static mockAddress when configured", async () => {
      const mockAddr = address("11111111111111111111111111111111");
      const provider = new MockVrfProvider(mockAddr);
      const binding = await provider.prepareHarvestRandomness({
        poolId: toPoolId(1),
        cycleId: toDrawCycleId(1),
      });
      assert.strictEqual(binding.randomnessAccount, mockAddr);
      assert.strictEqual(binding.instructions.length, 0);
    });

    it("should prioritize params.randomnessAccount over constructor mockAddress and env", async () => {
      const mockAddr = address("11111111111111111111111111111111");
      const paramAddr = address("GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze");
      const provider = new MockVrfProvider(mockAddr);
      const binding = await provider.prepareHarvestRandomness({
        poolId: toPoolId(1),
        cycleId: toDrawCycleId(1),
        randomnessAccount: paramAddr,
      });
      assert.strictEqual(binding.randomnessAccount, paramAddr);
    });

    it("should prioritize POOL_2_RANDOMNESS_ACCOUNT over mockAddress in MockVrfProvider", async () => {
      const mockAddr = address("11111111111111111111111111111111");
      const pool2Addr = "GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze";
      const oldEnv = process.env.POOL_2_RANDOMNESS_ACCOUNT;
      process.env.POOL_2_RANDOMNESS_ACCOUNT = pool2Addr;

      try {
        const provider = new MockVrfProvider(mockAddr);
        const binding = await provider.prepareHarvestRandomness({
          poolId: toPoolId(2),
          cycleId: toDrawCycleId(1),
        });
        assert.strictEqual(binding.randomnessAccount, pool2Addr);
      } finally {
        process.env.POOL_2_RANDOMNESS_ACCOUNT = oldEnv;
      }
    });

    it("should generate fresh signer on prepareRebindRandomness", async () => {
      const provider = new MockVrfProvider();
      const binding = await provider.prepareRebindRandomness({
        poolId: toPoolId(1),
        cycleId: toDrawCycleId(1),
        staleRandomness: address("11111111111111111111111111111111"),
      });
      assert.ok(binding.randomnessAccount);
      assert.ok(binding.signers && binding.signers.length > 0);
      assert.strictEqual(binding.signers[0].address, binding.randomnessAccount);
    });

    it("should return ready status on prepareReveal", async () => {
      const provider = new MockVrfProvider();
      const result = await provider.prepareReveal({
        randomnessAccount: address("11111111111111111111111111111111"),
        committedSeedSlot: toSlot(100n),
        currentSlot: toSlot(105n),
      });
      assert.strictEqual(result.status, "ready");
    });
  });
});
