import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ORAO VRF Program on Devnet & Mainnet
export const ORAO_VRF_PROGRAM_ID = new PublicKey(
  "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y"
);
export const RANDOMNESS_SEED_PREFIX = Buffer.from("orao-vrf-randomness-request");
export const CONFIG_SEED = Buffer.from("orao-vrf-network-configuration");

// Calculate anchor discriminator for global:request_v2
const REQUEST_V2_DISCRIMINATOR = createHash("sha256")
  .update("global:request_v2")
  .digest()
  .subarray(0, 8);

async function main() {
  console.log("=== ORAO VRF Devnet Spike ===");

  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  // Load keypair
  const keypairPath =
    process.env.KEYPAIR_PATH || path.join(os.homedir(), ".config/solana/id.json");
  const secretKey = new Uint8Array(
    JSON.parse(fs.readFileSync(keypairPath, "utf-8"))
  );
  const payer = Keypair.fromSecretKey(secretKey);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  const initialBalance = await connection.getBalance(payer.publicKey);
  console.log(`Initial Balance: ${initialBalance / 1e9} SOL`);

  // 1. Fetch Network Configuration
  const [networkStatePda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    ORAO_VRF_PROGRAM_ID
  );
  const networkStateAcc = await connection.getAccountInfo(networkStatePda);
  if (!networkStateAcc) {
    throw new Error(`Network state account ${networkStatePda.toBase58()} not found`);
  }

  const treasury = new PublicKey(networkStateAcc.data.subarray(40, 72));
  const requestFee = networkStateAcc.data.readBigUInt64LE(72);
  const authCount = networkStateAcc.data.readUInt32LE(80);
  console.log(`Network State PDA: ${networkStatePda.toBase58()}`);
  console.log(`Treasury: ${treasury.toBase58()}`);
  console.log(`Request Fee: ${Number(requestFee) / 1e9} SOL (${requestFee} lamports)`);
  console.log(`Fulfillment Authorities Count: ${authCount}`);

  // 2. Generate Random Request Seed
  const seed = randomBytes(32);
  const [requestPda, bump] = PublicKey.findProgramAddressSync(
    [RANDOMNESS_SEED_PREFIX, seed],
    ORAO_VRF_PROGRAM_ID
  );
  console.log(`\nGenerated Request Seed: ${seed.toString("hex")}`);
  console.log(`Request Account PDA: ${requestPda.toBase58()} (bump: ${bump})`);

  // 3. Build request_v2 Instruction
  const ixData = Buffer.concat([REQUEST_V2_DISCRIMINATOR, seed]);
  const requestIx = new TransactionInstruction({
    programId: ORAO_VRF_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: networkStatePda, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: requestPda, isSigner: false, isWritable: true },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // system program
    ],
    data: ixData,
  });

  const tx = new Transaction().add(requestIx);

  console.log("\nSubmitting request_v2 transaction...");
  const startTime = Date.now();
  const txSignature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  const requestConfirmedTime = Date.now();
  const requestLatencyMs = requestConfirmedTime - startTime;

  console.log(`Transaction Signature: ${txSignature}`);
  console.log(`Request Confirmation Latency: ${requestLatencyMs} ms`);

  // Fetch Transaction details to record compute units and fees
  const txDetails = await connection.getTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  const cuConsumed = txDetails?.meta?.computeUnitsConsumed ?? "unknown";
  const txFee = txDetails?.meta?.fee ?? 5000;
  console.log(`Compute Units Consumed: ${cuConsumed} CU`);
  console.log(`Base Transaction Fee: ${txFee / 1e9} SOL (${txFee} lamports)`);
  console.log(
    `Total Request Cost: ${(Number(requestFee) + txFee) / 1e9} SOL`
  );

  // 4. Poll and Await Fulfillment
  console.log("\nAwaiting fulfillment from ORAO oracle quorum...");
  const pollStart = Date.now();
  let fulfilled = false;
  let fulfilledData: Buffer | null = null;
  let pollAttempts = 0;
  const timeoutMs = 60_000;

  while (Date.now() - pollStart < timeoutMs) {
    pollAttempts++;
    const acc = await connection.getAccountInfo(requestPda, "confirmed");
    if (acc) {
      // Pending request size: ~452 bytes. Fulfilled size: ~136 bytes.
      // Fulfilled enum tag: 1 (RequestAccount::Fulfilled) at byte offset 8
      const tag = acc.data[8];
      if (tag === 1 || acc.data.length < 200) {
        fulfilled = true;
        fulfilledData = acc.data;
        break;
      }
    }
    await new Promise((res) => setTimeout(res, 1000));
  }

  const fulfillmentLatencyMs = Date.now() - pollStart;
  const totalE2eLatencyMs = Date.now() - startTime;

  if (!fulfilled || !fulfilledData) {
    console.error(`❌ Randomness fulfillment timed out after ${timeoutMs} ms (${pollAttempts} polls)`);
    return;
  }

  console.log(`✅ Randomness Fulfilled!`);
  console.log(`Fulfillment Latency: ${fulfillmentLatencyMs} ms (${pollAttempts} poll intervals)`);
  console.log(`End-to-End Latency (Request -> Fulfilled): ${totalE2eLatencyMs} ms`);
  console.log(`Fulfilled Account Data Length: ${fulfilledData.length} bytes`);

  // Inspect Fulfilled Data
  // Account layout:
  // 0..8: Discriminator (RandomnessV2)
  // 8: Tag (1 = Fulfilled)
  // 9..41: Client Pubkey (32 bytes)
  // 41..73: Seed (32 bytes)
  // 73..137: Randomness (64 bytes)
  const clientPubkey = new PublicKey(fulfilledData.subarray(9, 41));
  const returnedSeed = fulfilledData.subarray(41, 73);
  const randomness64 = fulfilledData.subarray(73, 137);

  console.log(`Client Pubkey in account: ${clientPubkey.toBase58()}`);
  console.log(`Seed match: ${seed.equals(returnedSeed) ? "MATCH" : "MISMATCH"}`);
  console.log(`Fulfilled Randomness (64 bytes hex): ${randomness64.toString("hex")}`);

  // Derived 32-byte VRF seed for YieldBonds
  const derivedSeed = createHash("sha256").update(randomness64).digest();
  console.log(`YieldBonds Derived Draw Seed (32 bytes): ${derivedSeed.toString("hex")}`);

  // Check Final Payer Balance to verify rent refund
  const finalBalance = await connection.getBalance(payer.publicKey);
  const netSpentLamports = initialBalance - finalBalance;
  console.log(`\nInitial Balance: ${initialBalance / 1e9} SOL`);
  console.log(`Final Balance:   ${finalBalance / 1e9} SOL`);
  console.log(`Net Spent:       ${netSpentLamports / 1e9} SOL (${netSpentLamports} lamports)`);

  // 5. Test Retry / Duplicate Seed Behavior
  console.log("\n--- Testing Re-request with Same Seed ---");
  try {
    const duplicateTx = new Transaction().add(requestIx);
    await sendAndConfirmTransaction(connection, duplicateTx, [payer], {
      commitment: "confirmed",
    });
    console.log("❌ Duplicate request unexpectedly succeeded!");
  } catch (err: any) {
    console.log(`✅ Duplicate request correctly rejected as expected:`);
    console.log(`   Error message: ${err.message?.slice(0, 150)}...`);
  }

  console.log("\n=== ORAO VRF Spike Completed Successfully ===");
}

main().catch((err) => {
  console.error("Spike failed with error:", err);
  process.exit(1);
});
