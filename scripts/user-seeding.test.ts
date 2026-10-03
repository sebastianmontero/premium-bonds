import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  address,
  generateKeyPairSigner,
  AccountRole,
  getBase58Encoder,
  getBase58Decoder,
} from "@solana/kit";

// Configure non-system dummy addresses for Huma accounts during unit tests
process.env.HUMA_CONFIG = "EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW";
process.env.HUMA_POOL_CONFIG = "EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW";
process.env.HUMA_POOL_STATE = "EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW";
process.env.HUMA_MODE_CONFIG = "EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW";
process.env.HUMA_MODE_MINT = "EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW";
process.env.HUMA_POOL_UNDERLYING_TOKEN =
  "EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW";

import {
  parseSeedUsersCliArgs,
  estimateSeedingCostLamports,
  buildFundInstructions,
  formatStoredUserKeyRecord,
  appendKeypairToFile,
  resolveSeedingAccounts,
  seedUser,
  seedUsers,
  advanceCycleToMatureTickets,
  DEFAULT_TICKETS_PER_USER,
  DEFAULT_SOL_PER_USER_LAMPORTS,
  USER_WINNINGS_RENT_LAMPORTS,
  MICRO_USDC_PER_TICKET,
  SEEDING_ATOMIC_CU_LIMIT,
  ESTIMATED_ATA_RENT_LAMPORTS,
  ESTIMATED_TX_FEE_LAMPORTS,
  DEFAULT_SAVE_KEYS_PATH,
} from "./user-seeding";
import { DEVNET_USERS_PATH } from "./devnet-state";
import {
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  MIN_ADMIN_RESERVE_LAMPORTS,
} from "./utils";
import {
  ATA_PROGRAM_ID,
  USDC_MINT,
  HUMA_POOL_STATE,
  PROGRAM_ID,
  findPrizePoolPda,
  findUserWinningsPda,
  findPoolVaultPda,
  findPoolPstVaultPda,
  findDrawCyclePda,
  findAtaAddress,
  PoolStatus,
} from "../app/lib/bonds-sdk";
import { buildMockPrizePoolArgs } from "../app/lib/test-harness/account-builders";
import { getPrizePoolEncoder } from "../app/lib/generated/yield-bonds/src/generated/accounts/prizePool";

const VALID_MOCK_BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

describe("User Seeding Module Suite (scripts/user-seeding.test.ts)", () => {
  describe("parseSeedUsersCliArgs", () => {
    it("parses default parameters when no flags are provided", () => {
      const opts = parseSeedUsersCliArgs([]);
      assert.strictEqual(opts.count, 1);
      assert.strictEqual(opts.tickets, DEFAULT_TICKETS_PER_USER);
      assert.strictEqual(opts.solLamports, DEFAULT_SOL_PER_USER_LAMPORTS);
      assert.strictEqual(opts.usdcAmount, undefined);
      assert.strictEqual(opts.poolId, 1);
      assert.strictEqual(opts.atomic, true);
      assert.strictEqual(opts.mature, false);
      assert.ok(opts.rpcUrl.length > 0);
      assert.strictEqual(opts.saveKeysPath, DEFAULT_SAVE_KEYS_PATH);
      assert.strictEqual(opts.saveKeysPath, DEVNET_USERS_PATH);
      assert.strictEqual(opts.keypairPath, undefined);
    });

    it("parses custom short and long flags accurately", () => {
      const args = [
        "--users",
        "5",
        "--tickets",
        "250",
        "--sol",
        "0.1",
        "--usdc",
        "300",
        "--pool",
        "3",
        "--mature",
        "--no-atomic",
        "--save-keys",
        "/tmp/test-keys.json",
        "--admin-key",
        "/tmp/admin.json",
        "--rpc",
        "http://localhost:8899",
      ];
      const opts = parseSeedUsersCliArgs(args);
      assert.strictEqual(opts.count, 5);
      assert.strictEqual(opts.tickets, 250);
      assert.strictEqual(opts.solLamports, 100_000_000n); // 0.1 SOL
      assert.strictEqual(opts.usdcAmount, 300_000_000n); // 300 USDC
      assert.strictEqual(opts.poolId, 3);
      assert.strictEqual(opts.mature, true);
      assert.strictEqual(opts.atomic, false);
      assert.strictEqual(opts.saveKeysPath, "/tmp/test-keys.json");
      assert.strictEqual(opts.keypairPath, "/tmp/admin.json");
      assert.strictEqual(opts.rpcUrl, "http://localhost:8899");
    });

    it("parses --save-keys without explicit argument using default path", () => {
      const opts = parseSeedUsersCliArgs(["--save-keys"]);
      assert.strictEqual(opts.saveKeysPath, DEFAULT_SAVE_KEYS_PATH);
    });

    it("parses --save-keys followed by another flag without consuming it as a path", () => {
      const opts = parseSeedUsersCliArgs(["--save-keys", "--users", "3"]);
      assert.strictEqual(opts.saveKeysPath, DEFAULT_SAVE_KEYS_PATH);
      assert.strictEqual(opts.count, 3);
    });

    it("parses --save-keys=<path> syntax accurately", () => {
      const opts = parseSeedUsersCliArgs(["--save-keys=/tmp/equals-keys.json"]);
      assert.strictEqual(opts.saveKeysPath, "/tmp/equals-keys.json");
    });

    it("disables key saving with --no-save-keys, --disable-save-keys, or disabling values", () => {
      assert.strictEqual(
        parseSeedUsersCliArgs(["--no-save-keys"]).saveKeysPath,
        undefined
      );
      assert.strictEqual(
        parseSeedUsersCliArgs(["--disable-save-keys"]).saveKeysPath,
        undefined
      );
      assert.strictEqual(
        parseSeedUsersCliArgs(["--save-keys", "none"]).saveKeysPath,
        undefined
      );
      assert.strictEqual(
        parseSeedUsersCliArgs(["--save-keys", "false"]).saveKeysPath,
        undefined
      );
      assert.strictEqual(
        parseSeedUsersCliArgs(["--save-keys", "off"]).saveKeysPath,
        undefined
      );
      assert.strictEqual(
        parseSeedUsersCliArgs(["--save-keys=none"]).saveKeysPath,
        undefined
      );
      assert.strictEqual(
        parseSeedUsersCliArgs(["--save-keys=false"]).saveKeysPath,
        undefined
      );
    });

    it("supports funding-only mode with 0 tickets and 0 SOL", () => {
      const opts = parseSeedUsersCliArgs(["--tickets", "0", "--sol", "0"]);
      assert.strictEqual(opts.tickets, 0);
      assert.strictEqual(opts.solLamports, 0n);
    });

    it("rejects invalid count, tickets, poolId, or unknown flags", () => {
      assert.throws(
        () => parseSeedUsersCliArgs(["--users", "0"]),
        /Must be an integer >= 1/
      );
      assert.throws(
        () => parseSeedUsersCliArgs(["--users", "-2"]),
        /Must be an integer >= 1/
      );
      assert.throws(
        () => parseSeedUsersCliArgs(["--tickets", "-1"]),
        /Must be an integer >= 0/
      );
      assert.throws(
        () => parseSeedUsersCliArgs(["--pool", "0"]),
        /Must be an integer >= 1/
      );
      assert.throws(
        () => parseSeedUsersCliArgs(["--sol", "-0.5"]),
        /Must be a non-negative number/
      );
      assert.throws(
        () => parseSeedUsersCliArgs(["--unknown-flag"]),
        /Unknown option/
      );
    });

    it("rejects fresh user ticket purchase with insufficient SOL for rent initialization", () => {
      assert.throws(
        () => parseSeedUsersCliArgs(["--tickets", "10", "--sol", "0.001"]),
        /Fresh users purchasing tickets must receive at least 2000000 lamports/
      );
    });
  });

  describe("estimateSeedingCostLamports", () => {
    it("calculates accurate total cost in atomic mode", () => {
      const count = 3;
      const solLamports = 50_000_000n;
      const expected =
        BigInt(count) *
          (solLamports +
            ESTIMATED_ATA_RENT_LAMPORTS +
            ESTIMATED_TX_FEE_LAMPORTS) +
        MIN_ADMIN_RESERVE_LAMPORTS;

      const calculated = estimateSeedingCostLamports({
        count,
        solLamports,
        tickets: 100,
        atomic: true,
      });

      assert.strictEqual(calculated, expected);
    });

    it("calculates accurate total cost in decoupled mode with 2 tx fees per user", () => {
      const count = 2;
      const solLamports = 100_000_000n;
      const expected =
        BigInt(count) *
          (solLamports +
            ESTIMATED_ATA_RENT_LAMPORTS +
            2n * ESTIMATED_TX_FEE_LAMPORTS) +
        MIN_ADMIN_RESERVE_LAMPORTS;

      const calculated = estimateSeedingCostLamports({
        count,
        solLamports,
        tickets: 100,
        atomic: false,
      });

      assert.strictEqual(calculated, expected);
    });

    it("enforces minimum rent requirement when tickets > 0", () => {
      assert.throws(
        () =>
          estimateSeedingCostLamports({
            count: 1,
            solLamports: 1_000_000n, // 0.001 SOL < 0.002 SOL
            tickets: 50,
          }),
        /cover on-chain user_winnings initialization rent debit/
      );
    });

    it("permits 0 SOL when tickets === 0 (funding-only mode)", () => {
      const calculated = estimateSeedingCostLamports({
        count: 1,
        solLamports: 0n,
        tickets: 0,
      });
      assert.ok(calculated > 0n);
    });
  });

  describe("buildFundInstructions", () => {
    it("bundles SOL transfer, idempotent ATA creation, and token minting", async () => {
      const payer = await generateKeyPairSigner();
      const recipient = (await generateKeyPairSigner()).address;
      const usdcMint = (await generateKeyPairSigner()).address;

      const res = await buildFundInstructions({
        payer,
        recipient,
        usdcMint,
        microUsdcAmount: 100_000_000n,
        transferSolLamports: 50_000_000n,
      });

      assert.strictEqual(res.instructions.length, 3);
      assert.strictEqual(res.instructions[0].programAddress, SYSTEM_PROGRAM_ID);
      assert.strictEqual(res.instructions[1].programAddress, ATA_PROGRAM_ID);
      assert.strictEqual(res.instructions[2].programAddress, TOKEN_PROGRAM_ID);
      assert.strictEqual(res.signers.length, 1);
      assert.strictEqual(res.signers[0].address, payer.address);
    });

    it("includes separate mint authority signer when provided", async () => {
      const payer = await generateKeyPairSigner();
      const mintAuthority = await generateKeyPairSigner();
      const recipient = (await generateKeyPairSigner()).address;
      const usdcMint = (await generateKeyPairSigner()).address;

      const res = await buildFundInstructions({
        payer,
        mintAuthority,
        recipient,
        usdcMint,
        microUsdcAmount: 50_000_000n,
      });

      assert.strictEqual(res.instructions.length, 2); // ATA + MintTo (no transferSol)
      assert.strictEqual(res.signers.length, 2);
      assert.strictEqual(res.signers[0].address, payer.address);
      assert.strictEqual(res.signers[1].address, mintAuthority.address);
    });

    it("omits mintTo instruction when microUsdcAmount is 0", async () => {
      const payer = await generateKeyPairSigner();
      const recipient = (await generateKeyPairSigner()).address;
      const usdcMint = (await generateKeyPairSigner()).address;

      const res = await buildFundInstructions({
        payer,
        recipient,
        usdcMint,
        microUsdcAmount: 0n,
        transferSolLamports: 50_000_000n,
      });

      assert.strictEqual(res.instructions.length, 2); // Transfer + ATA
      assert.strictEqual(res.instructions[0].programAddress, SYSTEM_PROGRAM_ID);
      assert.strictEqual(res.instructions[1].programAddress, ATA_PROGRAM_ID);
    });
  });

  describe("formatStoredUserKeyRecord", () => {
    it("formats entry from Uint8Array and automatically derives secretKeyBase58", () => {
      const secretKeyBytes = new Uint8Array(64).fill(7);
      const expectedBase58 = getBase58Decoder().decode(secretKeyBytes);

      const formatted = formatStoredUserKeyRecord({
        address: "11111111111111111111111111111111",
        secretKey: secretKeyBytes,
        ticketsBought: 50,
      });

      assert.strictEqual(formatted.address, "11111111111111111111111111111111");
      assert.deepStrictEqual(formatted.secretKey, Array(64).fill(7));
      assert.strictEqual(formatted.secretKeyBase58, expectedBase58);
      assert.strictEqual(formatted.ticketsBought, 50);
    });

    it("formats entry from number array and preserves explicitly supplied secretKeyBase58", () => {
      const formatted = formatStoredUserKeyRecord({
        address: address("EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW"),
        secretKey: Array(64).fill(9),
        secretKeyBase58: "custom_base58_string",
        ticketsBought: 150,
      });

      assert.strictEqual(
        formatted.address,
        "EthNciASE5rEqPgA6YCo3uPrDzAiMgLh5j3tstCJKgHW"
      );
      assert.deepStrictEqual(formatted.secretKey, Array(64).fill(9));
      assert.strictEqual(formatted.secretKeyBase58, "custom_base58_string");
      assert.strictEqual(formatted.ticketsBought, 150);
    });
  });

  describe("appendKeypairToFile", () => {
    it("creates a new JSON file and appends key entries with byte array, base58 string, and 0o600 mode", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-test-keys-"));
      const filePath = path.join(tmpDir, "users.json");

      try {
        const secretKey1 = new Uint8Array(64).fill(1);
        const secretKey2 = new Uint8Array(64).fill(2);
        const base58Key1 = getBase58Decoder().decode(secretKey1);
        const base58Key2 = getBase58Decoder().decode(secretKey2);

        const dummyKey1 = {
          address: "11111111111111111111111111111111",
          secretKey: secretKey1,
          ticketsBought: 100,
        };
        const dummyKey2 = {
          address: "22222222222222222222222222222222",
          secretKey: secretKey2,
          ticketsBought: 200,
        };

        appendKeypairToFile(filePath, dummyKey1);
        appendKeypairToFile(filePath, dummyKey2);

        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);

        assert.strictEqual(Array.isArray(parsed), true);
        assert.strictEqual(parsed.length, 2);

        // Record 1 verification
        assert.strictEqual(parsed[0].address, dummyKey1.address);
        assert.deepStrictEqual(parsed[0].secretKey, Array(64).fill(1));
        assert.strictEqual(parsed[0].secretKeyBase58, base58Key1);
        assert.strictEqual(parsed[0].ticketsBought, 100);

        // Record 2 verification
        assert.strictEqual(parsed[1].address, dummyKey2.address);
        assert.deepStrictEqual(parsed[1].secretKey, Array(64).fill(2));
        assert.strictEqual(parsed[1].secretKeyBase58, base58Key2);
        assert.strictEqual(parsed[1].ticketsBought, 200);

        // Bi-directional roundtrip test: base58 string decodes back to exact secret key bytes
        const encoder = getBase58Encoder();
        assert.deepStrictEqual(
          encoder.encode(parsed[0].secretKeyBase58),
          secretKey1
        );
        assert.deepStrictEqual(
          encoder.encode(parsed[1].secretKeyBase58),
          secretKey2
        );

        const stats = fs.statSync(filePath);
        // On POSIX systems, verify permission bits (0o600)
        if (process.platform !== "win32") {
          assert.strictEqual(stats.mode & 0o777, 0o600);
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("backfills secretKeyBase58 for legacy records when reading existing file from disk", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-test-legacy-"));
      const filePath = path.join(tmpDir, "users.json");

      try {
        const legacyKey = {
          address: "LegacyUserAddress1111111111111111111111111",
          secretKey: Array(64).fill(5),
          ticketsBought: 75,
        };
        // Pre-populate legacy format lacking secretKeyBase58
        fs.writeFileSync(filePath, JSON.stringify([legacyKey], null, 2), {
          mode: 0o600,
        });

        const newKey = {
          address: "NewUserAddress22222222222222222222222222222",
          secretKey: Array(64).fill(6),
          ticketsBought: 125,
        };

        appendKeypairToFile(filePath, newKey);

        const content = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);

        assert.strictEqual(parsed.length, 2);

        // Verify legacy record was backfilled with secretKeyBase58
        const expectedLegacyBase58 = getBase58Decoder().decode(
          new Uint8Array(64).fill(5)
        );
        assert.strictEqual(parsed[0].address, legacyKey.address);
        assert.deepStrictEqual(parsed[0].secretKey, legacyKey.secretKey);
        assert.strictEqual(parsed[0].secretKeyBase58, expectedLegacyBase58);
        assert.strictEqual(parsed[0].ticketsBought, 75);

        // Verify new record has secretKeyBase58
        const expectedNewBase58 = getBase58Decoder().decode(
          new Uint8Array(64).fill(6)
        );
        assert.strictEqual(parsed[1].address, newKey.address);
        assert.deepStrictEqual(parsed[1].secretKey, Array(64).fill(6));
        assert.strictEqual(parsed[1].secretKeyBase58, expectedNewBase58);
        assert.strictEqual(parsed[1].ticketsBought, 125);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("resolveSeedingAccounts", () => {
    it("prioritizes explicit overrides over defaults and on-chain values", async () => {
      const customMint = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const customRegistry = (await generateKeyPairSigner()).address;
      const customHuma = (await generateKeyPairSigner()).address;

      const mockRpc = {
        getAccountInfo: () => ({ send: async () => ({ value: null }) }),
      } as any;

      const accounts = await resolveSeedingAccounts(mockRpc, 1, {
        usdcMint: customMint,
        ticketRegistry: customRegistry,
        humaAddresses: { poolState: customHuma },
      });

      assert.strictEqual(accounts.usdcMint, customMint);
      assert.strictEqual(accounts.ticketRegistry, customRegistry);
      assert.strictEqual(accounts.humaAddresses.poolState, customHuma);
    });

    it("resolves from on-chain PrizePool account data when available", async () => {
      const onChainMint = (await generateKeyPairSigner()).address;
      const onChainRegistry = (await generateKeyPairSigner()).address;
      const onChainHuma = (await generateKeyPairSigner()).address;

      const poolBytes = new Uint8Array(
        getPrizePoolEncoder().encode(
          buildMockPrizePoolArgs({
            tokenMint: onChainMint,
            ticketRegistry: onChainRegistry,
            humaPoolState: onChainHuma,
          })
        )
      );

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              data: [Buffer.from(poolBytes).toString("base64"), "base64"],
            },
          }),
        }),
      } as any;

      const accounts = await resolveSeedingAccounts(mockRpc, 1);
      assert.strictEqual(accounts.usdcMint, onChainMint);
      assert.strictEqual(accounts.ticketRegistry, onChainRegistry);
      assert.strictEqual(accounts.humaAddresses.poolState, onChainHuma);
    });
  });

  describe("seedUser & seedUsers (Mock RPC Flow)", () => {
    it("executes 1-Tx atomic batch with correct instruction ordering and signers", async () => {
      const adminSigner = await generateKeyPairSigner();
      const userSigner = await generateKeyPairSigner();
      const ticketRegistry = (await generateKeyPairSigner()).address;
      const usdcMint = (await generateKeyPairSigner()).address;
      const humaPoolState = (await generateKeyPairSigner()).address;

      const mockRpc = {
        getLatestBlockhash: () => ({
          send: async () => ({
            value: {
              blockhash: VALID_MOCK_BLOCKHASH,
              lastValidBlockHeight: 100n,
            },
          }),
        }),
        getAccountInfo: () => ({ send: async () => ({ value: null }) }),
        getBalance: () => ({ send: async () => ({ value: 1_000_000_000n }) }),
        sendTransaction: (wireTx: string) => ({
          send: async () => "mock_atomic_tx_signature",
        }),
        getSignatureStatuses: () => ({
          send: async () => ({
            value: [{ confirmationStatus: "confirmed", err: null }],
          }),
        }),
      } as any;

      const res = await seedUser({
        rpc: mockRpc,
        adminSigner,
        userSigner,
        poolId: 1,
        tickets: 100,
        solLamports: 50_000_000n,
        atomic: true,
        accounts: {
          usdcMint,
          ticketRegistry,
          humaAddresses: { poolState: humaPoolState },
        },
      });

      assert.strictEqual(res.mode, "atomic");
      assert.strictEqual(res.txSignature, "mock_atomic_tx_signature");
      assert.strictEqual(res.ticketsBought, 100);
      assert.strictEqual(res.userAddress, userSigner.address);
    });

    it("executes decoupled flow when atomic is false", async () => {
      const adminSigner = await generateKeyPairSigner();
      const userSigner = await generateKeyPairSigner();
      const ticketRegistry = (await generateKeyPairSigner()).address;
      const usdcMint = (await generateKeyPairSigner()).address;
      const humaPoolState = (await generateKeyPairSigner()).address;

      let txCount = 0;
      const mockRpc = {
        getLatestBlockhash: () => ({
          send: async () => ({
            value: {
              blockhash: VALID_MOCK_BLOCKHASH,
              lastValidBlockHeight: 100n,
            },
          }),
        }),
        getAccountInfo: () => ({ send: async () => ({ value: null }) }),
        getBalance: () => ({ send: async () => ({ value: 1_000_000_000n }) }),
        sendTransaction: () => ({
          send: async () => `mock_tx_sig_${++txCount}`,
        }),
        getSignatureStatuses: () => ({
          send: async () => ({
            value: [{ confirmationStatus: "confirmed", err: null }],
          }),
        }),
      } as any;

      const res = await seedUser({
        rpc: mockRpc,
        adminSigner,
        userSigner,
        poolId: 1,
        tickets: 50,
        solLamports: 50_000_000n,
        atomic: false,
        accounts: {
          usdcMint,
          ticketRegistry,
          humaAddresses: { poolState: humaPoolState },
        },
      });

      assert.strictEqual(res.mode, "decoupled");
      assert.strictEqual(res.fundTxSignature, "mock_tx_sig_1");
      assert.strictEqual(res.buyTxSignature, "mock_tx_sig_2");
      assert.strictEqual(res.ticketsBought, 50);
    });

    it("executes funding-only flow when tickets === 0 without buyBonds transaction", async () => {
      const adminSigner = await generateKeyPairSigner();
      const userSigner = await generateKeyPairSigner();
      const ticketRegistry = (await generateKeyPairSigner()).address;
      const usdcMint = (await generateKeyPairSigner()).address;
      const humaPoolState = (await generateKeyPairSigner()).address;

      let txCount = 0;
      const mockRpc = {
        getLatestBlockhash: () => ({
          send: async () => ({
            value: {
              blockhash: VALID_MOCK_BLOCKHASH,
              lastValidBlockHeight: 100n,
            },
          }),
        }),
        getAccountInfo: () => ({ send: async () => ({ value: null }) }),
        getBalance: () => ({ send: async () => ({ value: 1_000_000_000n }) }),
        sendTransaction: () => ({
          send: async () => `mock_tx_sig_${++txCount}`,
        }),
        getSignatureStatuses: () => ({
          send: async () => ({
            value: [{ confirmationStatus: "confirmed", err: null }],
          }),
        }),
      } as any;

      const res = await seedUser({
        rpc: mockRpc,
        adminSigner,
        userSigner,
        poolId: 1,
        tickets: 0,
        solLamports: 20_000_000n,
        usdcAmount: 50_000_000n,
        accounts: {
          usdcMint,
          ticketRegistry,
          humaAddresses: { poolState: humaPoolState },
        },
      });

      assert.strictEqual(res.mode, "decoupled");
      assert.strictEqual(res.fundTxSignature, "mock_tx_sig_1");
      assert.strictEqual(res.buyTxSignature, undefined);
      assert.strictEqual(res.ticketsBought, 0);
    });

    it("seeds multiple users with progress tracking in seedUsers", async () => {
      const adminSigner = await generateKeyPairSigner();
      const userSigner1 = await generateKeyPairSigner();
      const userSigner2 = await generateKeyPairSigner();
      const ticketRegistry = (await generateKeyPairSigner()).address;
      const usdcMint = (await generateKeyPairSigner()).address;
      const humaPoolState = (await generateKeyPairSigner()).address;

      const progressEvents: string[] = [];

      const mockRpc = {
        getLatestBlockhash: () => ({
          send: async () => ({
            value: {
              blockhash: VALID_MOCK_BLOCKHASH,
              lastValidBlockHeight: 100n,
            },
          }),
        }),
        getAccountInfo: () => ({ send: async () => ({ value: null }) }),
        getBalance: () => ({ send: async () => ({ value: 1_000_000_000n }) }),
        sendTransaction: () => ({
          send: async () => "mock_atomic_sig",
        }),
        getSignatureStatuses: () => ({
          send: async () => ({
            value: [{ confirmationStatus: "confirmed", err: null }],
          }),
        }),
      } as any;

      const result = await seedUsers({
        rpc: mockRpc,
        adminSigner,
        count: 2,
        userSigners: [userSigner1, userSigner2],
        tickets: 100,
        solLamports: 50_000_000n,
        poolId: 1,
        accounts: {
          usdcMint,
          ticketRegistry,
          humaAddresses: { poolState: humaPoolState },
        },
        onProgress: (ev) => {
          progressEvents.push(`${ev.current}/${ev.total}:${ev.stage}`);
        },
      });

      assert.strictEqual(result.users.length, 2);
      assert.strictEqual(result.totalTicketsBought, 200);
      assert.ok(progressEvents.includes("1/2:funding"));
      assert.ok(progressEvents.includes("1/2:user_completed"));
      assert.ok(progressEvents.includes("2/2:funding"));
      assert.ok(progressEvents.includes("2/2:user_completed"));
      assert.ok(progressEvents.includes("2/2:all_completed"));
    });
  });

  describe("advanceCycleToMatureTickets guardrails", () => {
    it("rejects when prize pool account does not exist", async () => {
      const adminSigner = await generateKeyPairSigner();
      const mockRpc = {
        getAccountInfo: () => ({ send: async () => ({ value: null }) }),
      } as any;

      await assert.rejects(
        () =>
          advanceCycleToMatureTickets({
            rpc: mockRpc,
            adminSigner,
            poolId: 1,
          }),
        /Cannot mature tickets: Prize Pool #1 account not found/
      );
    });

    it("rejects when prize pool is frozen for draw", async () => {
      const adminSigner = await generateKeyPairSigner();
      const poolBytes = new Uint8Array(
        getPrizePoolEncoder().encode(
          buildMockPrizePoolArgs({
            isFrozenForDraw: 1,
          })
        )
      );

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              data: [Buffer.from(poolBytes).toString("base64"), "base64"],
            },
          }),
        }),
      } as any;

      await assert.rejects(
        () =>
          advanceCycleToMatureTickets({
            rpc: mockRpc,
            adminSigner,
            poolId: 1,
          }),
        /Cannot mature tickets: Prize Pool #1 is frozen for draw/
      );
    });

    it("rejects when prize pool is not active (e.g. Paused)", async () => {
      const adminSigner = await generateKeyPairSigner();
      const poolBytes = new Uint8Array(
        getPrizePoolEncoder().encode(
          buildMockPrizePoolArgs({
            status: PoolStatus.Paused,
          })
        )
      );

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              data: [Buffer.from(poolBytes).toString("base64"), "base64"],
            },
          }),
        }),
      } as any;

      await assert.rejects(
        () =>
          advanceCycleToMatureTickets({
            rpc: mockRpc,
            adminSigner,
            poolId: 1,
          }),
        /Cannot mature tickets: Prize Pool #1 is not active/
      );
    });

    it("rejects when draw cycle has not reached its end time", async () => {
      const adminSigner = await generateKeyPairSigner();
      const poolBytes = new Uint8Array(
        getPrizePoolEncoder().encode(
          buildMockPrizePoolArgs({
            status: PoolStatus.Active,
            isFrozenForDraw: 0,
            currentCycleEndAt: 5000n,
          })
        )
      );

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              data: [Buffer.from(poolBytes).toString("base64"), "base64"],
            },
          }),
        }),
        getSlot: () => ({ send: async () => 100n }),
        getBlockTime: () => ({ send: async () => 4000 }), // 4000 < 5000
      } as any;

      await assert.rejects(
        () =>
          advanceCycleToMatureTickets({
            rpc: mockRpc,
            adminSigner,
            poolId: 1,
          }),
        /has not reached its end time yet/
      );
    });

    it("rejects when randomnessAccount is missing or points to admin/feeWallet/system", async () => {
      const adminSigner = await generateKeyPairSigner();
      const ticketRegistry = (await generateKeyPairSigner()).address;
      const pstMint = (await generateKeyPairSigner()).address;
      const humaPoolState = (await generateKeyPairSigner()).address;

      const poolBytes = new Uint8Array(
        getPrizePoolEncoder().encode(
          buildMockPrizePoolArgs({
            status: PoolStatus.Active,
            isFrozenForDraw: 0,
            currentCycleEndAt: 1000n,
            ticketRegistry,
            humaPoolState,
          })
        )
      );

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              data: [Buffer.from(poolBytes).toString("base64"), "base64"],
            },
          }),
        }),
        getSlot: () => ({ send: async () => 100n }),
        getBlockTime: () => ({ send: async () => 2000 }),
      } as any;

      // Passing adminSigner.address as randomnessAccount should be rejected
      await assert.rejects(
        () =>
          advanceCycleToMatureTickets({
            rpc: mockRpc,
            adminSigner,
            poolId: 1,
            accounts: {
              ticketRegistry,
              pstMint,
              humaAddresses: { poolState: humaPoolState },
              randomnessAccount: adminSigner.address,
            },
          }),
        /InvalidRandomnessAccount/
      );
    });

    it("succeeds when all preconditions are satisfied", async () => {
      const adminSigner = await generateKeyPairSigner();
      const ticketRegistry = (await generateKeyPairSigner()).address;
      const pstMint = (await generateKeyPairSigner()).address;
      const humaPoolState = (await generateKeyPairSigner()).address;
      const randomnessAccount = (await generateKeyPairSigner()).address;

      const poolBytes = new Uint8Array(
        getPrizePoolEncoder().encode(
          buildMockPrizePoolArgs({
            status: PoolStatus.Active,
            isFrozenForDraw: 0,
            currentCycleEndAt: 1000n,
            ticketRegistry,
            humaPoolState,
          })
        )
      );

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              data: [Buffer.from(poolBytes).toString("base64"), "base64"],
            },
          }),
        }),
        getSlot: () => ({ send: async () => 100n }),
        getBlockTime: () => ({ send: async () => 2000 }),
        getLatestBlockhash: () => ({
          send: async () => ({
            value: {
              blockhash: VALID_MOCK_BLOCKHASH,
              lastValidBlockHeight: 100n,
            },
          }),
        }),
        sendTransaction: () => ({
          send: async () => "mock_harvest_tx_sig",
        }),
        getSignatureStatuses: () => ({
          send: async () => ({
            value: [{ confirmationStatus: "confirmed", err: null }],
          }),
        }),
      } as any;

      const txSig = await advanceCycleToMatureTickets({
        rpc: mockRpc,
        adminSigner,
        poolId: 1,
        accounts: {
          ticketRegistry,
          pstMint,
          humaAddresses: { poolState: humaPoolState },
          randomnessAccount,
        },
      });

      assert.strictEqual(txSig, "mock_harvest_tx_sig");
    });
  });
});
