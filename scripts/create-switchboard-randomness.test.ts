import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as web3 from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  DEVNET_SB_PID,
  DEVNET_SB_QUEUE,
  MIN_PAYER_BALANCE_LAMPORTS,
  loadLegacyKeypair,
  assertPayerSolBalance,
  loadOrCreateRandomnessKeypair,
  saveKeypairSecurely,
  buildRandomnessInitInstruction,
} from "./create-switchboard-randomness";

describe("Switchboard Randomness Provisioning Suite", () => {
  test("Canonical Devnet constants match exact Switchboard specifications", () => {
    assert.strictEqual(
      DEVNET_SB_PID.toBase58(),
      "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
    );
    assert.strictEqual(
      DEVNET_SB_QUEUE.toBase58(),
      "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7"
    );
    assert.strictEqual(MIN_PAYER_BALANCE_LAMPORTS, 5_000_000);
  });

  test("loadLegacyKeypair correctly deserializes secret key array", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-key-test-"));
    const keyPath = path.join(tempDir, "test-key.json");

    const generated = web3.Keypair.generate();
    fs.writeFileSync(
      keyPath,
      JSON.stringify(Array.from(generated.secretKey)),
      "utf-8"
    );

    const loaded = loadLegacyKeypair(keyPath);
    assert.strictEqual(
      loaded.publicKey.toBase58(),
      generated.publicKey.toBase58()
    );
    assert.deepStrictEqual(
      Array.from(loaded.secretKey),
      Array.from(generated.secretKey)
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("loadLegacyKeypair throws descriptive error when file missing", () => {
    const missingPath = path.join(os.tmpdir(), "non-existent-keypair-12345.json");
    assert.throws(
      () => loadLegacyKeypair(missingPath),
      /Keypair file not found at:/
    );
  });

  test("assertPayerSolBalance throws informative error when balance is insufficient", async () => {
    const fakeConnection = {
      getBalance: async () => 1_000_000, // 0.001 SOL (< 0.005 SOL)
    } as unknown as web3.Connection;

    const fakePubkey = web3.Keypair.generate().publicKey;
    await assert.rejects(
      async () => assertPayerSolBalance(fakeConnection, fakePubkey),
      /Insufficient SOL balance on payer/
    );
  });

  test("assertPayerSolBalance succeeds when balance is adequate", async () => {
    const fakeConnection = {
      getBalance: async () => 10_000_000, // 0.01 SOL (>= 0.005 SOL)
    } as unknown as web3.Connection;

    const fakePubkey = web3.Keypair.generate().publicKey;
    await assert.doesNotReject(async () =>
      assertPayerSolBalance(fakeConnection, fakePubkey)
    );
  });

  test("saveKeypairSecurely writes with 0o600 mode permissions", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-perm-test-"));
    const keyPath = path.join(tempDir, "secure-key.json");
    const keypair = web3.Keypair.generate();

    saveKeypairSecurely(keyPath, keypair);

    assert.ok(fs.existsSync(keyPath));
    const stat = fs.statSync(keyPath);
    // 0o600 permissions check (read/write for owner only: 0o777 mask is 0o600)
    assert.strictEqual(stat.mode & 0o777, 0o600);

    const loaded = loadLegacyKeypair(keyPath);
    assert.strictEqual(
      loaded.publicKey.toBase58(),
      keypair.publicKey.toBase58()
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("loadOrCreateRandomnessKeypair reuses existing keypair when forceNew is false", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-reuse-test-"));
    const keyPath = path.join(tempDir, "existing-key.json");
    const keypair = web3.Keypair.generate();
    saveKeypairSecurely(keyPath, keypair);

    const result = loadOrCreateRandomnessKeypair(keyPath, false);
    assert.strictEqual(result.isExisting, true);
    assert.strictEqual(
      result.keypair.publicKey.toBase58(),
      keypair.publicKey.toBase58()
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("loadOrCreateRandomnessKeypair generates fresh keypair when forceNew is true", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-force-test-"));
    const keyPath = path.join(tempDir, "existing-key.json");
    const keypair = web3.Keypair.generate();
    saveKeypairSecurely(keyPath, keypair);

    const result = loadOrCreateRandomnessKeypair(keyPath, true);
    assert.strictEqual(result.isExisting, false);
    assert.notStrictEqual(
      result.keypair.publicKey.toBase58(),
      keypair.publicKey.toBase58()
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("buildRandomnessInitInstruction passes parameter object correctly to sb.Randomness.create", async () => {
    const fakeInstruction = new web3.TransactionInstruction({
      keys: [],
      programId: DEVNET_SB_PID,
      data: Buffer.from([]),
    });

    const mockProgram = {
      programId: DEVNET_SB_PID,
      provider: {
        connection: {
          getSlot: async () => 12345678,
        },
      },
      instruction: {
        randomnessInit: () => fakeInstruction,
      },
    } as any;

    const randomnessKeypair = web3.Keypair.generate();
    const payerPublicKey = web3.Keypair.generate().publicKey;

    const ix = await buildRandomnessInitInstruction({
      program: mockProgram,
      randomnessKeypair,
      payerPublicKey,
      queuePublicKey: DEVNET_SB_QUEUE,
    });

    assert.ok(ix);
    assert.strictEqual(ix.programId.toBase58(), DEVNET_SB_PID.toBase58());
  });
});
