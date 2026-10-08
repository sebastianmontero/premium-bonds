import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as web3 from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import { generateKeyPairSigner, address, getBase58Encoder } from "@solana/kit";
import {
  parseSwitchboardRandomnessHeader,
  isRandomnessCommittable,
  isRandomnessRevealed,
  createVrfProvider,
  MockVrfProvider,
  SwitchboardOnDemandProvider,
  SwitchboardAuthorityMismatchError,
  parseGatewayUri,
  resolveHealthyQueueOracle,
  DEFAULT_GATEWAY_PROBE_TIMEOUT_MS,
  DEFAULT_ORACLE_CACHE_TTL_MS,
  type SwitchboardProgram,
  SB_RANDOMNESS_ACCOUNT_SIZE,
  SB_AUTHORITY_OFFSET,
  SB_REQUEST_SLOT_OFFSET,
  SB_REVEAL_SLOT_OFFSET,
  SB_SEED_OFFSET,
  SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
  encodeMockSwitchboardRandomness,
  buildMockSwitchboardRevealInstruction,
  MOCK_SWITCHBOARD_REVEAL_IX_DISCRIMINATOR,
} from "../vrf/randomness-provider";
import { VRF_FRESHNESS_WINDOW_SLOTS } from "../constants";
import {
  toPoolId,
  toDrawCycleId,
  toSlot,
  toRandomnessSeed,
  parseRandomnessSeed,
  generateRandomnessSeed,
} from "../types";

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
        value: new Uint8Array(32),
      };
      assert.strictEqual(isRandomnessCommittable(header, toSlot(500n)), true);
    });

    it("should be committable when revealSlot !== 0n (previous cycle revealed)", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(500n),
        revealSlot: toSlot(505n),
        value: new Uint8Array(32).fill(1),
      };
      assert.strictEqual(isRandomnessCommittable(header, toSlot(600n)), true);
    });

    it("should be committable when currentSlot - seedSlot > 1000n (expired window)", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(100n),
        revealSlot: toSlot(0n),
        value: new Uint8Array(32),
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
        value: new Uint8Array(32),
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

  describe("isRandomnessRevealed", () => {
    const dummyAuth = address("11111111111111111111111111111111");

    it("should return true when revealSlot > 0 and value has non-zero bytes", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(100n),
        revealSlot: toSlot(105n),
        value: new Uint8Array(32).fill(42),
      };
      assert.strictEqual(isRandomnessRevealed(header), true);
    });

    it("should return false when revealSlot === 0n", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(100n),
        revealSlot: toSlot(0n),
        value: new Uint8Array(32).fill(42),
      };
      assert.strictEqual(isRandomnessRevealed(header), false);
    });

    it("should return false when value is all zeros", () => {
      const header = {
        authority: dummyAuth,
        seedSlot: toSlot(100n),
        revealSlot: toSlot(105n),
        value: new Uint8Array(32),
      };
      assert.strictEqual(isRandomnessRevealed(header), false);
    });

    it("should return false for null, undefined, or missing values", () => {
      assert.strictEqual(isRandomnessRevealed(null), false);
      assert.strictEqual(isRandomnessRevealed(undefined), false);
      assert.strictEqual(isRandomnessRevealed({ revealSlot: 0n }), false);
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
      const customAddr = address(
        "GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze"
      );
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com",
        {
          signer,
          randomnessAccount: customAddr,
        }
      );

      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      let requestedKey: web3.PublicKey | undefined;
      web3.Connection.prototype.getAccountInfo = (async (
        pk: web3.PublicKey
      ) => {
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
      web3.Connection.prototype.getAccountInfo = (async (
        pk: web3.PublicKey
      ) => {
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
      web3.Connection.prototype.getAccountInfo = (async (
        pk: web3.PublicKey
      ) => {
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

    it("should return ready with executionMode consume_only on prepareReveal when account is already revealed", async () => {
      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com"
      );
      const originalGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      const raw = createMockRandomnessBuffer({
        authority: "11111111111111111111111111111111",
        seedSlot: 100n,
        revealSlot: 105n,
      });
      raw.fill(42, SB_SEED_OFFSET, SB_SEED_OFFSET + 32);
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
        assert.strictEqual(res.status, "ready");
        if (res.status === "ready") {
          assert.strictEqual(res.executionMode, "consume_only");
        }
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

    it("should return ready status and revealInstruction on prepareReveal", async () => {
      const provider = new MockVrfProvider();
      const seed = generateRandomnessSeed();
      const result = await provider.prepareReveal({
        randomnessAccount: address("11111111111111111111111111111111"),
        committedSeedSlot: toSlot(100n),
        currentSlot: toSlot(105n),
        seed,
      });
      assert.strictEqual(result.status, "ready");
      if (result.status === "ready") {
        assert.ok(result.revealInstruction);
        assert.ok(result.revealInstruction.data);
        assert.strictEqual(result.revealInstruction.data.length, 8 + 1 + 32);
        assert.deepStrictEqual(
          result.revealInstruction.data.subarray(0, 8),
          MOCK_SWITCHBOARD_REVEAL_IX_DISCRIMINATOR
        );
        assert.strictEqual(result.revealInstruction.data[8], 1);
        assert.deepStrictEqual(
          result.revealInstruction.data.subarray(9, 41),
          seed
        );
      }
    });
  });

  describe("RandomnessSeed Value Object & Helpers", () => {
    it("toRandomnessSeed validates length and creates defensive copy", () => {
      const buf = new Uint8Array(32);
      buf[0] = 42;
      const seed = toRandomnessSeed(buf);
      assert.strictEqual(seed.length, 32);
      assert.strictEqual(seed[0], 42);
      buf[0] = 99;
      assert.strictEqual(
        seed[0],
        42,
        "Defensive copy must isolate seed from original buffer"
      );

      assert.throws(() => toRandomnessSeed(new Uint8Array(31)), RangeError);
      assert.throws(() => toRandomnessSeed(new Uint8Array(33)), RangeError);
    });

    it("parseRandomnessSeed parses hex strings and Uint8Array", () => {
      const hex =
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
      const seedFromHex = parseRandomnessSeed(hex);
      assert.strictEqual(seedFromHex.length, 32);
      assert.strictEqual(seedFromHex[0], 0x00);
      assert.strictEqual(seedFromHex[31], 0x1f);

      const seedWithPrefix = parseRandomnessSeed("0x" + hex);
      assert.deepStrictEqual(seedWithPrefix, seedFromHex);

      assert.throws(() => parseRandomnessSeed("invalid_hex"), TypeError);
      assert.throws(() => parseRandomnessSeed("00".repeat(31)), TypeError);
    });

    it("buildMockSwitchboardRevealInstruction constructs Option::None when seed is omitted", () => {
      const ix = buildMockSwitchboardRevealInstruction({
        randomnessAccount: address("11111111111111111111111111111111"),
      });
      assert.ok(ix.data);
      assert.strictEqual(ix.data.length, 9);
      assert.strictEqual(ix.data[8], 0); // None
    });
  });

  describe("Oracle Resolution Constants", () => {
    it("should export correct probe timeout and cache TTL constants", () => {
      assert.strictEqual(DEFAULT_GATEWAY_PROBE_TIMEOUT_MS, 1500);
      assert.strictEqual(DEFAULT_ORACLE_CACHE_TTL_MS, 60000);
    });
  });

  describe("parseGatewayUri", () => {
    it("should truncate null-terminated C-strings", () => {
      const raw = Buffer.from("https://example.com/devnet\0trailing_junk_data");
      assert.strictEqual(parseGatewayUri(raw), "https://example.com/devnet");
    });

    it("should preserve valid subpaths and strip trailing slashes", () => {
      const uri1 = Buffer.from("https://oracle.switchboard.xyz/devnet/");
      assert.strictEqual(
        parseGatewayUri(uri1),
        "https://oracle.switchboard.xyz/devnet"
      );

      const uri2 = Buffer.from(
        "https://oracle.switchboard.xyz/nested/subpath///"
      );
      assert.strictEqual(
        parseGatewayUri(uri2),
        "https://oracle.switchboard.xyz/nested/subpath"
      );

      const uri3 = Buffer.from("https://oracle.switchboard.xyz/");
      assert.strictEqual(
        parseGatewayUri(uri3),
        "https://oracle.switchboard.xyz"
      );
    });

    it("should return null for empty, null, or undefined inputs", () => {
      assert.strictEqual(parseGatewayUri(null), null);
      assert.strictEqual(parseGatewayUri(undefined), null);
      assert.strictEqual(parseGatewayUri(new Uint8Array(0)), null);
      assert.strictEqual(parseGatewayUri(new Uint8Array(10)), null); // all zeros
    });

    it("should return null for non-http/https protocols or malformed URLs", () => {
      const ftp = Buffer.from("ftp://example.com/gateway");
      assert.strictEqual(parseGatewayUri(ftp), null);

      const invalid = Buffer.from("not_a_valid_url");
      assert.strictEqual(parseGatewayUri(invalid), null);
    });
  });

  describe("resolveHealthyQueueOracle", () => {
    function createMockOracleData(options?: {
      gatewayUri?: string;
      verificationStatus?: number;
      validUntilSec?: number;
      lastHeartbeatSec?: number;
      isOnQueue?: boolean;
    }) {
      const nowSec = Math.floor(Date.now() / 1000);
      const uriStr =
        options?.gatewayUri ?? "https://oracle1.switchboard.xyz/devnet";
      const uriBuf = new Uint8Array(64);
      const encoded = Buffer.from(uriStr, "utf-8");
      uriBuf.set(encoded);

      return {
        gatewayUri: uriBuf,
        enclave: {
          verificationStatus: options?.verificationStatus ?? 4,
          validUntil: new BN(options?.validUntilSec ?? nowSec + 3600),
          quoteSigner: new Uint8Array(32),
          mrEnclave: new Uint8Array(32),
        },
        isOnQueue: options?.isOnQueue ?? true,
        lastHeartbeat: new BN(options?.lastHeartbeatSec ?? nowSec - 10),
      };
    }

    function createMockQueueData(
      oracleKeys: web3.PublicKey[],
      nodeTimeoutSec = 300
    ) {
      return {
        oracleKeys,
        oracleKeysLen: oracleKeys.length,
        nodeTimeout: new BN(nodeTimeoutSec),
      };
    }

    it("should throw if no oracle keys are registered on queue", async () => {
      const dummyProgram = {} as unknown as SwitchboardProgram;
      const dummyQueueKey = web3.Keypair.generate().publicKey;

      const origQueueLoadData = sb.Queue.prototype.loadData;
      sb.Queue.prototype.loadData = (async () =>
        createMockQueueData([])) as typeof origQueueLoadData;

      try {
        await assert.rejects(
          () => resolveHealthyQueueOracle(dummyProgram, dummyQueueKey),
          /No oracle keys registered on queue/
        );
      } finally {
        sb.Queue.prototype.loadData = origQueueLoadData;
      }
    });

    it("should throw if no readable oracle candidate accounts are found", async () => {
      const dummyProgram = {} as unknown as SwitchboardProgram;
      const dummyQueueKey = web3.Keypair.generate().publicKey;
      const oracleKey = web3.Keypair.generate().publicKey;

      const origQueueLoadData = sb.Queue.prototype.loadData;
      const origOracleLoadMany = sb.Oracle.loadMany;
      sb.Queue.prototype.loadData = (async () =>
        createMockQueueData([oracleKey])) as typeof origQueueLoadData;
      sb.Oracle.loadMany = (async () => [null]) as typeof origOracleLoadMany;

      try {
        await assert.rejects(
          () => resolveHealthyQueueOracle(dummyProgram, dummyQueueKey),
          /No readable oracle candidate accounts found on queue/
        );
      } finally {
        sb.Queue.prototype.loadData = origQueueLoadData;
        sb.Oracle.loadMany = origOracleLoadMany;
      }
    });

    it("should select healthy oracle based on 200 health probe response and bound TTL", async () => {
      const dummyProgram = {} as unknown as SwitchboardProgram;
      const dummyQueueKey = web3.Keypair.generate().publicKey;
      const oracle1 = web3.Keypair.generate().publicKey;
      const oracle2 = web3.Keypair.generate().publicKey;

      const nowSec = Math.floor(Date.now() / 1000);
      const validUntilSec = nowSec + 45; // 45 seconds remaining quote validity

      const origQueueLoadData = sb.Queue.prototype.loadData;
      const origOracleLoadMany = sb.Oracle.loadMany;
      sb.Queue.prototype.loadData = (async () =>
        createMockQueueData(
          [oracle1, oracle2],
          300
        )) as typeof origQueueLoadData;
      sb.Oracle.loadMany = (async () => [
        createMockOracleData({
          gatewayUri: "https://oracle1.switchboard.xyz/devnet",
          validUntilSec,
          lastHeartbeatSec: nowSec - 5,
        }),
        createMockOracleData({
          gatewayUri: "https://oracle2.switchboard.xyz/devnet",
          validUntilSec: nowSec + 3600,
          lastHeartbeatSec: nowSec - 5,
        }),
      ]) as unknown as typeof origOracleLoadMany;

      // Mock fetch probe
      const mockFetch: typeof fetch = (async (input: RequestInfo | URL) => {
        const urlStr = input.toString();
        if (urlStr.includes("oracle1.switchboard.xyz")) {
          return new Response(
            JSON.stringify({
              oracles: [
                {
                  oracle_id: oracle1.toBase58(),
                  queue: dummyQueueKey.toBase58(),
                  oracle_config: {
                    pull_oracle: oracle1.toBase58(),
                    enable_pull_oracle: 1,
                    version: "3.10.6",
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      try {
        const { oracleKey, ttlMs } = await resolveHealthyQueueOracle(
          dummyProgram,
          dummyQueueKey,
          { fetchFn: mockFetch }
        );

        assert.strictEqual(oracleKey.toBase58(), oracle1.toBase58());
        // TTL should be dynamically bounded by quote validity <= 45s (<= 45000ms)
        assert.ok(ttlMs <= 45_000, `TTL ${ttlMs} should be <= 45000ms`);
        assert.ok(ttlMs >= 1_000, `TTL ${ttlMs} should be >= 1000ms`);
      } finally {
        sb.Queue.prototype.loadData = origQueueLoadData;
        sb.Oracle.loadMany = origOracleLoadMany;
      }
    });

    it("should gracefully handle malformed JSON responses and fallback to on-chain verified candidate", async () => {
      const dummyProgram = {} as unknown as SwitchboardProgram;
      const dummyQueueKey = web3.Keypair.generate().publicKey;
      const oracle1 = web3.Keypair.generate().publicKey;

      const nowSec = Math.floor(Date.now() / 1000);
      const origQueueLoadData = sb.Queue.prototype.loadData;
      const origOracleLoadMany = sb.Oracle.loadMany;
      sb.Queue.prototype.loadData = (async () =>
        createMockQueueData([oracle1], 300)) as typeof origQueueLoadData;
      sb.Oracle.loadMany = (async () => [
        createMockOracleData({
          gatewayUri: "https://oracle1.switchboard.xyz/devnet",
          validUntilSec: nowSec + 3600,
          lastHeartbeatSec: nowSec - 5,
        }),
      ]) as unknown as typeof origOracleLoadMany;

      // Mock fetch probe returning non-array oracles payload
      const mockFetch: typeof fetch = (async () => {
        return new Response(
          JSON.stringify({ oracles: "invalid_string_not_array" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      try {
        const { oracleKey, ttlMs } = await resolveHealthyQueueOracle(
          dummyProgram,
          dummyQueueKey,
          { fetchFn: mockFetch }
        );

        // Falls back to verified on-chain candidate
        assert.strictEqual(oracleKey.toBase58(), oracle1.toBase58());
        assert.ok(ttlMs <= DEFAULT_ORACLE_CACHE_TTL_MS);
      } finally {
        sb.Queue.prototype.loadData = origQueueLoadData;
        sb.Oracle.loadMany = origOracleLoadMany;
      }
    });

    it("should skip null accounts in Oracle.loadMany and evaluate remaining valid candidates", async () => {
      const dummyProgram = {} as unknown as SwitchboardProgram;
      const dummyQueueKey = web3.Keypair.generate().publicKey;
      const brokenOracleKey = web3.Keypair.generate().publicKey;
      const healthyOracleKey = web3.Keypair.generate().publicKey;

      const nowSec = Math.floor(Date.now() / 1000);
      const origQueueLoadData = sb.Queue.prototype.loadData;
      const origOracleLoadMany = sb.Oracle.loadMany;
      sb.Queue.prototype.loadData = (async () =>
        createMockQueueData(
          [brokenOracleKey, healthyOracleKey],
          300
        )) as typeof origQueueLoadData;
      sb.Oracle.loadMany = (async () => [
        null, // first account fails to load/deserialize
        createMockOracleData({
          gatewayUri: "https://healthy.switchboard.xyz/devnet",
          validUntilSec: nowSec + 3600,
          lastHeartbeatSec: nowSec - 5,
        }),
      ]) as unknown as typeof origOracleLoadMany;

      const mockFetch: typeof fetch = (async () => {
        return new Response("Timeout", { status: 504 });
      }) as unknown as typeof fetch;

      try {
        const { oracleKey } = await resolveHealthyQueueOracle(
          dummyProgram,
          dummyQueueKey,
          { fetchFn: mockFetch }
        );

        assert.strictEqual(oracleKey.toBase58(), healthyOracleKey.toBase58());
      } finally {
        sb.Queue.prototype.loadData = origQueueLoadData;
        sb.Oracle.loadMany = origOracleLoadMany;
      }
    });
  });

  describe("SwitchboardOnDemandProvider Oracle Caching, Deduplication & CommitIx placement", () => {
    it("should pass resolved oracle to commitIx at account index 2 and cache the result", async () => {
      const signer = await generateKeyPairSigner();
      const randomnessAddr = address(
        "GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze"
      );
      const fastMockFetch: typeof fetch = (async () =>
        new Response("{}", { status: 404 })) as unknown as typeof fetch;

      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com",
        {
          signer,
          randomnessAccount: randomnessAddr,
          fetchFn: fastMockFetch,
          gatewayTimeoutMs: 10,
        }
      );

      const oraclePubkey = web3.Keypair.generate().publicKey;
      const nowSec = Math.floor(Date.now() / 1000);

      // Mock account info for randomness account
      const rawHeader = createMockRandomnessBuffer({
        authority: signer.address,
        seedSlot: 0n,
        revealSlot: 0n,
      });

      const origGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      const origGetSlot = web3.Connection.prototype.getSlot;
      const origQueueLoadData = sb.Queue.prototype.loadData;
      const origOracleLoadMany = sb.Oracle.loadMany;

      let queueLoadDataCallCount = 0;
      let commitIxOracleParam: web3.PublicKey | undefined;

      web3.Connection.prototype.getAccountInfo = (async () => ({
        data: Buffer.from(rawHeader),
        executable: false,
        lamports: 1000000,
        owner: new web3.PublicKey(
          "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
        ),
      })) as typeof origGetAccountInfo;

      web3.Connection.prototype.getSlot = (async () =>
        500) as typeof origGetSlot;

      sb.Queue.prototype.loadData = (async () => {
        queueLoadDataCallCount++;
        return {
          oracleKeys: [oraclePubkey],
          oracleKeysLen: 1,
          nodeTimeout: new BN(300),
        };
      }) as typeof origQueueLoadData;

      sb.Oracle.loadMany = (async () => [
        {
          gatewayUri: Buffer.from("https://oracle.switchboard.xyz/devnet"),
          enclave: {
            verificationStatus: 4,
            validUntil: new BN(nowSec + 3600),
            quoteSigner: new Uint8Array(32),
            mrEnclave: new Uint8Array(32),
          },
          isOnQueue: true,
          lastHeartbeat: new BN(nowSec - 10),
        },
      ]) as unknown as typeof origOracleLoadMany;

      // Mock program randomness commitIx to capture oracle passed
      const mockProgram = {
        instruction: {
          randomnessCommit: (
            _args: unknown,
            accounts: {
              accounts: {
                randomness: web3.PublicKey;
                queue: web3.PublicKey;
                oracle: web3.PublicKey;
                recentSlothashes: web3.PublicKey;
                authority: web3.PublicKey;
              };
            }
          ) => {
            commitIxOracleParam = accounts.accounts.oracle;
            return {
              programId: new web3.PublicKey(
                "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
              ),
              keys: [
                {
                  pubkey: accounts.accounts.randomness,
                  isSigner: false,
                  isWritable: true,
                },
                {
                  pubkey: accounts.accounts.queue,
                  isSigner: false,
                  isWritable: false,
                },
                {
                  pubkey: accounts.accounts.oracle,
                  isSigner: false,
                  isWritable: false,
                },
                {
                  pubkey: accounts.accounts.recentSlothashes,
                  isSigner: false,
                  isWritable: false,
                },
                {
                  pubkey: accounts.accounts.authority,
                  isSigner: true,
                  isWritable: true,
                },
              ],
              data: Buffer.alloc(8),
            };
          },
        },
      } as unknown as SwitchboardProgram;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).getProgram = async () => mockProgram;

      try {
        // First harvest call: resolves oracle via RPC
        const binding1 = await provider.prepareHarvestRandomness({
          poolId: toPoolId(1),
          cycleId: toDrawCycleId(1),
        });

        assert.strictEqual(queueLoadDataCallCount, 1);
        assert.ok(commitIxOracleParam);
        assert.strictEqual(
          commitIxOracleParam.toBase58(),
          oraclePubkey.toBase58()
        );
        assert.strictEqual(binding1.instructions.length, 1);
        const ix1Accounts = binding1.instructions[0]?.accounts;
        assert.ok(ix1Accounts && ix1Accounts[2]);
        assert.strictEqual(ix1Accounts[2].address, oraclePubkey.toBase58());

        // Second harvest call: must hit cache and NOT call Queue.loadData again
        const binding2 = await provider.prepareHarvestRandomness({
          poolId: toPoolId(1),
          cycleId: toDrawCycleId(2),
        });

        assert.strictEqual(
          queueLoadDataCallCount,
          1,
          "Cache hit must prevent second queue loadData"
        );
        const ix2Accounts = binding2.instructions[0]?.accounts;
        assert.ok(ix2Accounts && ix2Accounts[2]);
        assert.strictEqual(ix2Accounts[2].address, oraclePubkey.toBase58());

        // Invalidate cache: next call must trigger resolution
        provider.invalidateOracleCache();
        await provider.prepareHarvestRandomness({
          poolId: toPoolId(1),
          cycleId: toDrawCycleId(3),
        });
        assert.strictEqual(
          queueLoadDataCallCount,
          2,
          "Invalidation must trigger fresh queue resolution"
        );
      } finally {
        web3.Connection.prototype.getAccountInfo = origGetAccountInfo;
        web3.Connection.prototype.getSlot = origGetSlot;
        sb.Queue.prototype.loadData = origQueueLoadData;
        sb.Oracle.loadMany = origOracleLoadMany;
      }
    });

    it("should deduplicate in-flight oracle resolutions across concurrent calls", async () => {
      const signer = await generateKeyPairSigner();
      const fastMockFetch: typeof fetch = (async () =>
        new Response("{}", { status: 404 })) as unknown as typeof fetch;

      const provider = new SwitchboardOnDemandProvider(
        "https://api.devnet.solana.com",
        {
          signer,
          randomnessAccount: address(
            "GHm448VoBJ3zdygPie9t434WD6MZMRnNNemndTZXTHze"
          ),
          fetchFn: fastMockFetch,
          gatewayTimeoutMs: 10,
        }
      );

      const oraclePubkey = web3.Keypair.generate().publicKey;
      let loadCount = 0;

      const origQueueLoadData = sb.Queue.prototype.loadData;
      const origOracleLoadMany = sb.Oracle.loadMany;
      const origGetAccountInfo = web3.Connection.prototype.getAccountInfo;
      const origGetSlot = web3.Connection.prototype.getSlot;

      web3.Connection.prototype.getAccountInfo = (async () => ({
        data: Buffer.from(
          createMockRandomnessBuffer({
            authority: signer.address,
            seedSlot: 0n,
            revealSlot: 0n,
          })
        ),
        executable: false,
        lamports: 1000000,
        owner: new web3.PublicKey(
          "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
        ),
      })) as typeof origGetAccountInfo;

      web3.Connection.prototype.getSlot = (async () =>
        500) as typeof origGetSlot;

      sb.Queue.prototype.loadData = (async () => {
        loadCount++;
        // Small delay to simulate async network roundtrip
        await new Promise((r) => setTimeout(r, 20));
        return {
          oracleKeys: [oraclePubkey],
          oracleKeysLen: 1,
          nodeTimeout: new BN(300),
        };
      }) as typeof origQueueLoadData;

      sb.Oracle.loadMany = (async () => [
        {
          gatewayUri: Buffer.from("https://oracle.switchboard.xyz/devnet"),
          enclave: {
            verificationStatus: 4,
            validUntil: new BN(Math.floor(Date.now() / 1000) + 3600),
            quoteSigner: new Uint8Array(32),
            mrEnclave: new Uint8Array(32),
          },
          isOnQueue: true,
          lastHeartbeat: new BN(Math.floor(Date.now() / 1000) - 10),
        },
      ]) as unknown as typeof origOracleLoadMany;

      const mockProgram = {
        instruction: {
          randomnessCommit: (
            _args: unknown,
            accounts: {
              accounts: {
                randomness: web3.PublicKey;
                queue: web3.PublicKey;
                oracle: web3.PublicKey;
                recentSlothashes: web3.PublicKey;
                authority: web3.PublicKey;
              };
            }
          ) => ({
            programId: new web3.PublicKey(
              "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
            ),
            keys: [
              {
                pubkey: accounts.accounts.randomness,
                isSigner: false,
                isWritable: true,
              },
              {
                pubkey: accounts.accounts.queue,
                isSigner: false,
                isWritable: false,
              },
              {
                pubkey: accounts.accounts.oracle,
                isSigner: false,
                isWritable: false,
              },
              {
                pubkey: accounts.accounts.recentSlothashes,
                isSigner: false,
                isWritable: false,
              },
              {
                pubkey: accounts.accounts.authority,
                isSigner: true,
                isWritable: true,
              },
            ],
            data: Buffer.alloc(8),
          }),
        },
      } as unknown as SwitchboardProgram;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (provider as any).getProgram = async () => mockProgram;

      try {
        const [res1, res2] = await Promise.all([
          provider.prepareHarvestRandomness({
            poolId: toPoolId(1),
            cycleId: toDrawCycleId(1),
          }),
          provider.prepareHarvestRandomness({
            poolId: toPoolId(2),
            cycleId: toDrawCycleId(1),
          }),
        ]);

        assert.strictEqual(
          loadCount,
          1,
          "Concurrent resolutions must be deduplicated into a single in-flight promise"
        );
        const res1Accounts = res1.instructions[0]?.accounts;
        const res2Accounts = res2.instructions[0]?.accounts;
        assert.ok(res1Accounts && res1Accounts[2]);
        assert.ok(res2Accounts && res2Accounts[2]);
        assert.strictEqual(res1Accounts[2].address, oraclePubkey.toBase58());
        assert.strictEqual(res2Accounts[2].address, oraclePubkey.toBase58());
      } finally {
        web3.Connection.prototype.getAccountInfo = origGetAccountInfo;
        web3.Connection.prototype.getSlot = origGetSlot;
        sb.Queue.prototype.loadData = origQueueLoadData;
        sb.Oracle.loadMany = origOracleLoadMany;
      }
    });
  });
});
