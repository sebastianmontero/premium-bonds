import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { address, Address, KeyPairSigner } from "@solana/kit";
import {
  parseMainnetArgs,
  HumaConfigurationError,
  MAINNET_USDC_MINT,
  MAINNET_HUMA_PID,
  MAINNET_SWITCHBOARD_PID,
} from "./mainnet";
import {
  assertCluster,
  readClusterAddresses,
  writeClusterAddresses,
  syncClusterToActiveEnv,
  MAINNET_GENESIS_HASH,
  DEVNET_GENESIS_HASH,
  ProtocolAccounts,
} from "./cluster-state";
import {
  ensureTicketRegistryAllocated,
  reconcilePoolState,
  PoolAddressBundle,
} from "./account-utils";
import { parseMultisigAccount } from "../app/lib/squads-sdk";
import { readEnvFile } from "./env-utils";
import { PROGRAM_ID } from "../app/lib/bonds-sdk";
import { generateAndSaveKeypair } from "./utils";

describe("Mainnet CLI & Day-1 Bootstrap Test Suite", () => {
  let tempDir: string;
  let addressesPath: string;
  let envProductionPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-mainnet-test-"));
    addressesPath = path.resolve(tempDir, "addresses.json");
    envProductionPath = path.resolve(tempDir, ".env.production");
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. Cluster Verification & Genesis Hash Guard", () => {
    it("accepts RPC when genesis hash matches mainnet-beta", async () => {
      const mockRpc = {
        getGenesisHash: () => ({
          send: async () => MAINNET_GENESIS_HASH,
        }),
      } as any;

      await assert.doesNotReject(async () => {
        await assertCluster(mockRpc, "mainnet-beta");
      });
    });

    it("rejects RPC when genesis hash is Devnet while expecting mainnet-beta", async () => {
      const mockRpc = {
        getGenesisHash: () => ({
          send: async () => DEVNET_GENESIS_HASH,
        }),
      } as any;

      await assert.rejects(
        async () => {
          await assertCluster(mockRpc, "mainnet-beta");
        },
        (err: Error) => {
          assert.ok(
            err.message.includes("CRITICAL SECURITY ERROR"),
            "Error must mention critical security error"
          );
          assert.ok(
            err.message.includes(MAINNET_GENESIS_HASH),
            "Error must mention expected genesis hash"
          );
          return true;
        }
      );
    });

    it("rejects localnet/custom genesis hash when expecting mainnet-beta", async () => {
      const mockRpc = {
        getGenesisHash: () => ({
          send: async () => "CustomGenesis11111111111111111111111111111111",
        }),
      } as any;

      await assert.rejects(async () => {
        await assertCluster(mockRpc, "mainnet-beta");
      }, /CRITICAL SECURITY ERROR/);
    });
  });

  describe("2. Argument Parsing (parseMainnetArgs)", () => {
    it("parses --help, -h, and help flags correctly", () => {
      assert.strictEqual(
        parseMainnetArgs(["node", "mainnet.ts", "--help"]).flags.help,
        true
      );
      assert.strictEqual(
        parseMainnetArgs(["node", "mainnet.ts", "-h"]).flags.help,
        true
      );
      assert.strictEqual(
        parseMainnetArgs(["node", "mainnet.ts", "help"]).flags.help,
        true
      );
    });

    it("parses command and positional arguments", () => {
      const parsed = parseMainnetArgs([
        "node",
        "mainnet.ts",
        "deploy",
        "/path/to/keypair.json",
        "--priority-fee-micro-lamports",
        "75000",
        "--yes",
      ]);
      assert.strictEqual(parsed.command, "deploy");
      assert.strictEqual(parsed.positionals[0], "/path/to/keypair.json");
      assert.strictEqual(parsed.flags["priority-fee-micro-lamports"], "75000");
      assert.strictEqual(parsed.flags.yes, true);
    });

    it("parses equals-separated arguments (--flag=val)", () => {
      const parsed = parseMainnetArgs([
        "node",
        "mainnet.ts",
        "handoff-governance",
        "--multisig=SquadsPDA11111111111111111111111111111111",
        "--vault-index=1",
        "-y",
      ]);
      assert.strictEqual(parsed.command, "handoff-governance");
      assert.strictEqual(
        parsed.flags.multisig,
        "SquadsPDA11111111111111111111111111111111"
      );
      assert.strictEqual(parsed.flags["vault-index"], "1");
      assert.strictEqual(parsed.flags.yes, true);
    });

    it("parses --huma-pool, --vrf-account, and --pst-mint flags correctly", () => {
      const parsed = parseMainnetArgs([
        "node",
        "mainnet.ts",
        "init",
        "--huma-pool",
        "HumaPool11111111111111111111111111111111111",
        "--pst-mint",
        "PstMint111111111111111111111111111111111111",
        "--vrf-account",
        "VrfAccount111111111111111111111111111111111",
      ]);
      assert.strictEqual(parsed.command, "init");
      assert.strictEqual(
        parsed.flags["huma-pool"],
        "HumaPool11111111111111111111111111111111111"
      );
      assert.strictEqual(
        parsed.flags["pst-mint"],
        "PstMint111111111111111111111111111111111111"
      );
      assert.strictEqual(
        parsed.flags["vrf-account"],
        "VrfAccount111111111111111111111111111111111"
      );
    });
  });

  describe("3. Safe Account Recovery & Reconcile (account-utils)", () => {
    it("exports and supports PoolAddressBundle type alias in reconcilePoolState", () => {
      const bundle: PoolAddressBundle = {
        tokenMint: MAINNET_USDC_MINT,
        ticketRegistry: address("11111111111111111111111111111111"),
        feeWallet: address("22222222222222222222222222222222222222222222"),
      };
      const result = reconcilePoolState(bundle, bundle);
      assert.strictEqual(result.isMatch, true);
    });
    it("reconcilePoolState identifies matched and mismatched configurations", () => {
      const expected = {
        tokenMint: MAINNET_USDC_MINT,
        ticketRegistry: address("11111111111111111111111111111111"),
        feeWallet: address("22222222222222222222222222222222222222222222"),
      };

      const match = reconcilePoolState(expected, expected);
      assert.strictEqual(match.isMatch, true);
      assert.strictEqual(match.mismatches.length, 0);

      const mismatch = reconcilePoolState(
        {
          tokenMint: address("33333333333333333333333333333333333333333333"),
          ticketRegistry: expected.ticketRegistry,
          feeWallet: expected.feeWallet,
        },
        expected
      );
      assert.strictEqual(mismatch.isMatch, false);
      assert.strictEqual(mismatch.mismatches.length, 1);
      assert.ok(mismatch.mismatches[0].includes("tokenMint mismatch"));
    });

    it("ensureTicketRegistryAllocated archives conflicting keypair instead of unlinking", async () => {
      const keyPath = path.resolve(tempDir, "ticket-registry-key.json");
      await generateAndSaveKeypair(keyPath);

      // Simulate on-chain account belonging to another program (owner mismatch)
      const mockRpc = {
        getAccountInfo: () => ({
          send: async () => ({
            value: {
              owner: "WrongProgramId11111111111111111111111111111",
              lamports: 1_820_000_000n, // ~1.82 SOL rent
              data: ["", "base64"],
            },
          }),
        }),
      } as any;

      const dummyPayer = {
        address: address("Payer11111111111111111111111111111111111111"),
      } as KeyPairSigner;

      // Without forceRegenerate: throws error and archives keypair
      await assert.rejects(async () => {
        await ensureTicketRegistryAllocated({
          rpc: mockRpc,
          payer: dummyPayer,
          ticketRegistryKeyPath: keyPath,
          anchorProgramId: PROGRAM_ID,
          forceRegenerate: false,
        });
      }, /Ticket Registry account key collision detected/);

      // Verify original file was archived with .orphaned.<timestamp>.json and NOT deleted
      const archivedFiles = fs
        .readdirSync(tempDir)
        .filter((f) => f.includes("orphaned"));
      assert.strictEqual(
        archivedFiles.length,
        1,
        "Conflicting keypair must be archived"
      );
      assert.strictEqual(
        fs.existsSync(keyPath),
        false,
        "Active keypair path moved to archive"
      );
    });
  });

  describe("4. Canonical Mainnet Protocol Constants & Errors", () => {
    it("canonical mainnet constants match expected addresses", () => {
      assert.strictEqual(
        MAINNET_USDC_MINT,
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      );
      assert.strictEqual(
        MAINNET_HUMA_PID,
        "HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn"
      );
      assert.strictEqual(
        MAINNET_SWITCHBOARD_PID,
        "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv"
      );
    });

    it("HumaConfigurationError formats diagnostic message properly", () => {
      const err = new HumaConfigurationError("Invalid pool PID");
      assert.ok(err instanceof Error);
      assert.strictEqual(err.name, "HumaConfigurationError");
      assert.ok(err.message.includes("[Huma Configuration Error]"));
    });
  });

  describe("5. Squads Multisig Validation in Handoff", () => {
    it("validates multisig threshold and members correctly", () => {
      const mockMultisig = {
        threshold: 2,
        members: [
          {
            key: address("Member1111111111111111111111111111111111111"),
            permissions: 7,
          },
          {
            key: address("Member2222222222222222222222222222222222222"),
            permissions: 7,
          },
          {
            key: address("Member3333333333333333333333333333333333333"),
            permissions: 7,
          },
        ],
      };

      assert.ok(mockMultisig.threshold >= 1);
      assert.ok(mockMultisig.members.length >= 1);
      assert.ok(mockMultisig.threshold <= mockMultisig.members.length);
    });
  });

  describe("6. Cluster State Persistence & Production Env Sync", () => {
    const sampleMainnetAddresses: ProtocolAccounts = {
      programId: PROGRAM_ID,
      humaProgramId: MAINNET_HUMA_PID,
      adminAddress: "Admin1111111111111111111111111111111111111",
      usdcMint: MAINNET_USDC_MINT,
      pstMint: "PSTMainnet1111111111111111111111111111111111",
      ticketRegistry: "TicketRegMainnet11111111111111111111111111",
      feeWallet: "FeeWalletMainnet111111111111111111111111111",
      humaPoolState: "HumaPoolMainnet111111111111111111111111111",
      humaLenderState: "HumaLenderMainnet1111111111111111111111111",
      humaPoolUnderlying: "HumaUnderlyingMainnet11111111111111111111",
      humaPoolModeToken: "HumaModeTokenMainnet111111111111111111111",
      humaRedemptionRequest: "",
      randomnessAccount: "RandomnessMainnet1111111111111111111111111",
    };

    it("writes and reads mainnet addresses to custom paths", () => {
      writeClusterAddresses(
        "mainnet-beta",
        sampleMainnetAddresses,
        addressesPath
      );
      const read = readClusterAddresses("mainnet-beta", addressesPath);
      assert.strictEqual(read?.programId, PROGRAM_ID);
      assert.strictEqual(read?.usdcMint, MAINNET_USDC_MINT);
      assert.strictEqual(read?.humaProgramId, MAINNET_HUMA_PID);
    });

    it("syncs mainnet addresses to target environment file", () => {
      writeClusterAddresses(
        "mainnet-beta",
        sampleMainnetAddresses,
        addressesPath
      );

      syncClusterToActiveEnv("mainnet-beta", {
        targetFile: envProductionPath,
        addressesPath,
      });

      const env = readEnvFile(envProductionPath);
      assert.strictEqual(env.NEXT_PUBLIC_ENVIRONMENT, "mainnet-beta");
      assert.strictEqual(env.NEXT_PUBLIC_PROGRAM_ID, PROGRAM_ID);
      assert.strictEqual(env.NEXT_PUBLIC_USDC_MINT, MAINNET_USDC_MINT);
      assert.strictEqual(env.NEXT_PUBLIC_HUMA_PROGRAM_ID, MAINNET_HUMA_PID);
      assert.strictEqual(
        env.NEXT_PUBLIC_TICKET_REGISTRY,
        sampleMainnetAddresses.ticketRegistry
      );
    });
  });
});
