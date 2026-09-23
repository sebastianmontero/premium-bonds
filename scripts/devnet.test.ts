import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  address,
  generateKeyPairSigner,
  AccountRole,
  getBase58Encoder,
} from "@solana/kit";
import {
  buildCreateMintInstructions,
  buildMintToInstruction,
  ensureTokenMintOnChain,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./utils";
import { reconcilePoolState } from "./devnet";
import {
  findPrizePoolPda,
  findPoolVaultPda,
  findPoolPstVaultPda,
  findGlobalConfigPda,
  createAssociatedTokenIdempotentInstruction,
  ATA_PROGRAM_ID,
} from "../app/lib/bonds-sdk";

describe("Devnet CLI & Initialization Suite (scripts/devnet.test.ts)", () => {
  describe("buildCreateMintInstructions", () => {
    it("creates valid SystemProgram::CreateAccount and TokenProgram::InitializeMint2 instructions", async () => {
      const payer = await generateKeyPairSigner();
      const mint = await generateKeyPairSigner();
      const mintAuthoritySigner = await generateKeyPairSigner();
      const mintAuthority = mintAuthoritySigner.address;

      const mockRpc = {
        getMinimumBalanceForRentExemption: () => ({
          send: async () => 1_461_600n,
        }),
      } as any;

      const ixs = await buildCreateMintInstructions({
        rpc: mockRpc,
        payer,
        mint,
        decimals: 6,
        mintAuthority,
      });

      assert.strictEqual(ixs.length, 2);

      // 1. SystemProgram CreateAccount instruction
      const createAccountIx = ixs[0];
      assert.strictEqual(createAccountIx.programAddress, SYSTEM_PROGRAM_ID);
      assert.strictEqual(createAccountIx.accounts?.length, 2);
      assert.strictEqual(createAccountIx.accounts[0].address, payer.address);
      assert.strictEqual(
        createAccountIx.accounts[0].role,
        AccountRole.WRITABLE_SIGNER
      );
      assert.strictEqual(createAccountIx.accounts[1].address, mint.address);
      assert.strictEqual(
        createAccountIx.accounts[1].role,
        AccountRole.WRITABLE_SIGNER
      );

      const createDataView = new DataView(
        createAccountIx.data!.buffer,
        createAccountIx.data!.byteOffset,
        createAccountIx.data!.byteLength
      );
      assert.strictEqual(createDataView.getUint32(0, true), 0); // SystemProgram::CreateAccount opcode
      assert.strictEqual(createDataView.getBigUint64(4, true), 1_461_600n); // lamports
      assert.strictEqual(createDataView.getBigUint64(12, true), 82n); // space: 82 bytes for SPL Mint

      // 2. TokenProgram InitializeMint2 instruction
      const initMintIx = ixs[1];
      assert.strictEqual(initMintIx.programAddress, TOKEN_PROGRAM_ID);
      assert.strictEqual(initMintIx.accounts?.length, 1);
      assert.strictEqual(initMintIx.accounts[0].address, mint.address);
      assert.strictEqual(initMintIx.accounts[0].role, AccountRole.WRITABLE);

      const initData = initMintIx.data!;
      assert.strictEqual(initData[0], 20); // InitializeMint2 opcode
      assert.strictEqual(initData[1], 6); // decimals
      assert.deepStrictEqual(
        initData.subarray(2, 34),
        getBase58Encoder().encode(mintAuthority)
      );
      assert.strictEqual(initData[34], 0); // No freeze authority
    });

    it("encodes freeze authority when provided", async () => {
      const payer = await generateKeyPairSigner();
      const mint = await generateKeyPairSigner();
      const mintAuthoritySigner = await generateKeyPairSigner();
      const freezeAuthoritySigner = await generateKeyPairSigner();
      const mintAuthority = mintAuthoritySigner.address;
      const freezeAuthority = freezeAuthoritySigner.address;

      const mockRpc = {
        getMinimumBalanceForRentExemption: () => ({
          send: async () => 1_461_600n,
        }),
      } as any;

      const ixs = await buildCreateMintInstructions({
        rpc: mockRpc,
        payer,
        mint,
        decimals: 9,
        mintAuthority,
        freezeAuthority,
      });

      const initData = ixs[1].data!;
      assert.strictEqual(initData[0], 20);
      assert.strictEqual(initData[1], 9);
      assert.strictEqual(initData[34], 1); // Freeze authority present
      assert.deepStrictEqual(
        initData.subarray(35, 67),
        getBase58Encoder().encode(freezeAuthority)
      );
    });
  });

  describe("buildMintToInstruction", () => {
    it("encodes SPL Token MintTo opcode 7 with correct little-endian u64 amount", async () => {
      const authority = await generateKeyPairSigner();
      const mintSigner = await generateKeyPairSigner();
      const destSigner = await generateKeyPairSigner();
      const mint = mintSigner.address;
      const destination = destSigner.address;
      const amount = 10_000_000_000n; // 10k USDC

      const ix = buildMintToInstruction({
        mint,
        destination,
        authority,
        amount,
      });

      assert.strictEqual(ix.programAddress, TOKEN_PROGRAM_ID);
      assert.strictEqual(ix.accounts?.length, 3);
      assert.strictEqual(ix.accounts[0].address, mint);
      assert.strictEqual(ix.accounts[0].role, AccountRole.WRITABLE);
      assert.strictEqual(ix.accounts[1].address, destination);
      assert.strictEqual(ix.accounts[1].role, AccountRole.WRITABLE);
      assert.strictEqual(ix.accounts[2].address, authority.address);
      assert.strictEqual(ix.accounts[2].role, AccountRole.WRITABLE_SIGNER);

      const data = ix.data!;
      assert.strictEqual(data[0], 7); // MintTo opcode
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      assert.strictEqual(view.getBigUint64(1, true), amount);
    });
  });

  describe("ensureTokenMintOnChain", () => {
    it("skips creation if mint already exists on-chain", async () => {
      const payer = await generateKeyPairSigner();
      const mint = await generateKeyPairSigner();
      let rpcGetCalled = false;

      const mockRpc = {
        getAccountInfo: () => {
          rpcGetCalled = true;
          return {
            send: async () => ({
              value: { lamports: 1_461_600n, owner: TOKEN_PROGRAM_ID },
            }),
          };
        },
      } as any;

      await ensureTokenMintOnChain(mockRpc, {
        payer,
        mint,
        decimals: 6,
        mintAuthority: payer.address,
        label: "Test Mint",
      });

      assert.strictEqual(rpcGetCalled, true);
    });

    it("wraps failure errors with descriptive diagnostic context", async () => {
      const payer = await generateKeyPairSigner();
      const mint = await generateKeyPairSigner();

      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({ value: null }),
        }),
        getMinimumBalanceForRentExemption: () => ({
          send: async () => {
            throw new Error("RPC Network Timeout");
          },
        }),
      } as any;

      await assert.rejects(
        () =>
          ensureTokenMintOnChain(mockRpc, {
            payer,
            mint,
            decimals: 6,
            mintAuthority: payer.address,
            label: "Test Mint",
          }),
        (err: any) => {
          assert.match(
            err.message,
            /Failed to create token mint.*RPC Network Timeout/
          );
          assert.strictEqual(err.cause?.message, "RPC Network Timeout");
          return true;
        }
      );
    });
  });

  describe("reconcilePoolState", () => {
    it("returns isMatch: true when on-chain pool matches expected state", async () => {
      const mintSigner = await generateKeyPairSigner();
      const regSigner = await generateKeyPairSigner();
      const feeSigner = await generateKeyPairSigner();

      const expected = {
        tokenMint: mintSigner.address,
        ticketRegistry: regSigner.address,
        feeWallet: feeSigner.address,
      };

      const result = reconcilePoolState(expected, expected);
      assert.strictEqual(result.isMatch, true);
      assert.strictEqual(result.mismatches.length, 0);
    });

    it("reports all address divergences when on-chain pool differs from local state", async () => {
      const onChainMint = await generateKeyPairSigner();
      const onChainReg = await generateKeyPairSigner();
      const onChainFee = await generateKeyPairSigner();

      const localMint = await generateKeyPairSigner();
      const localReg = await generateKeyPairSigner();
      const localFee = await generateKeyPairSigner();

      const onChain = {
        tokenMint: onChainMint.address,
        ticketRegistry: onChainReg.address,
        feeWallet: onChainFee.address,
      };
      const local = {
        tokenMint: localMint.address,
        ticketRegistry: localReg.address,
        feeWallet: localFee.address,
      };

      const result = reconcilePoolState(onChain, local);
      assert.strictEqual(result.isMatch, false);
      assert.strictEqual(result.mismatches.length, 3);
      assert.match(result.mismatches[0], /tokenMint mismatch/);
      assert.match(result.mismatches[1], /ticketRegistry mismatch/);
      assert.match(result.mismatches[2], /feeWallet mismatch/);
    });
  });

  describe("PDA Derivations and SDK Helpers", () => {
    it("returns valid 32-44 byte Base58 public key strings without character truncation", async () => {
      const poolAddress = await findPrizePoolPda(1);
      const poolVaultAddress = await findPoolVaultPda(1);
      const poolPstVaultAddress = await findPoolPstVaultPda(1);
      const globalConfigAddress = await findGlobalConfigPda();

      for (const [name, addr] of Object.entries({
        poolAddress,
        poolVaultAddress,
        poolPstVaultAddress,
        globalConfigAddress,
      })) {
        assert.strictEqual(typeof addr, "string", `${name} should be a string`);
        assert.ok(
          addr.length >= 32 && addr.length <= 44,
          `${name} (${addr}) must be a valid base58 address length (32-44), got ${addr.length}`
        );
      }
    });

    it("creates idempotent ATA instructions with opcode 1", async () => {
      const payer = await generateKeyPairSigner();
      const owner = await generateKeyPairSigner();
      const mint = await generateKeyPairSigner();
      const ata = await generateKeyPairSigner();

      const ix = createAssociatedTokenIdempotentInstruction({
        payer,
        owner: owner.address,
        mint: mint.address,
        ata: ata.address,
      });

      assert.strictEqual(ix.programAddress, ATA_PROGRAM_ID);
      assert.strictEqual(ix.data?.[0], 1); // Idempotent create opcode
      assert.strictEqual(ix.accounts?.length, 6);
      assert.strictEqual(ix.accounts[0].address, payer.address);
      assert.strictEqual(ix.accounts[1].address, ata.address);
      assert.strictEqual(ix.accounts[2].address, owner.address);
      assert.strictEqual(ix.accounts[3].address, mint.address);
      assert.strictEqual(ix.accounts[4].address, SYSTEM_PROGRAM_ID);
      assert.strictEqual(ix.accounts[5].address, TOKEN_PROGRAM_ID);
    });
  });
});
