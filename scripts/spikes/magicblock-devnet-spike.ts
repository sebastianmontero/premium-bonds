import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// MagicBlock VRF Program & Constants on Devnet
export const MAGICBLOCK_VRF_PROGRAM_ID = new PublicKey(
  "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
);
export const DEFAULT_EPHEMERAL_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
);
export const KNOWN_DEVNET_ORACLE_QUEUE = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"
);

async function main() {
  console.log("=== MagicBlock VRF Devnet Spike & Architecture Inspection ===");

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

  // 1. Inspect MagicBlock Registered Oracles PDA
  const [oraclesPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracles")],
    MAGICBLOCK_VRF_PROGRAM_ID
  );
  console.log(`Oracles PDA: ${oraclesPda.toBase58()}`);
  const oraclesAcc = await connection.getAccountInfo(oraclesPda);
  if (!oraclesAcc) {
    throw new Error(`Oracles PDA ${oraclesPda.toBase58()} not found on devnet`);
  }
  console.log(`Oracles Account Size: ${oraclesAcc.data.length} bytes`);
  const registeredCount = oraclesAcc.data.readUInt32LE(8);
  console.log(`Registered Oracles Count: ${registeredCount}`);

  // 2. Inspect Oracle Queue on Devnet
  const queueAcc = await connection.getAccountInfo(KNOWN_DEVNET_ORACLE_QUEUE);
  if (queueAcc) {
    console.log(`\nBase-Layer Oracle Queue: ${KNOWN_DEVNET_ORACLE_QUEUE.toBase58()}`);
    console.log(`Owner: ${queueAcc.owner.toBase58()}`);
    console.log(`Queue Data Size: ${queueAcc.data.length} bytes`);

    // Queue Header layout (after 8 bytes discriminator):
    // item_count: u32 (offset 8)
    // cursor: u32 (offset 12)
    // index: u8 (offset 16)
    // paused: u8 (offset 17)
    const itemCount = queueAcc.data.readUInt32LE(8);
    const cursor = queueAcc.data.readUInt32LE(12);
    const index = queueAcc.data.readUInt8(16);
    const paused = queueAcc.data.readUInt8(17);

    console.log(`Queue Header Details:`);
    console.log(`  Active Item Count: ${itemCount}`);
    console.log(`  Queue Byte Cursor: ${cursor}`);
    console.log(`  Queue Index: ${index}`);
    console.log(`  Is Paused: ${paused === 1 ? "YES" : "NO"}`);
  }

  // 3. Inspect Ephemeral Queue
  const ephemQueueAcc = await connection.getAccountInfo(DEFAULT_EPHEMERAL_QUEUE);
  if (ephemQueueAcc) {
    console.log(`\nEphemeral Rollup Queue: ${DEFAULT_EPHEMERAL_QUEUE.toBase58()}`);
    console.log(`Owner: ${ephemQueueAcc.owner.toBase58()}`);
    console.log(`Data Size: ${ephemQueueAcc.data.length} bytes`);
  }

  // 4. Demonstrate Architectural Constraint: CPI-Only Calling Convention
  console.log("\n--- Architectural Verification: Direct Off-Chain Request Constraint ---");
  console.log(
    "MagicBlock VRF request instruction (tag 8 / 10) enforces that Account 1\n" +
    "(`program_identity_info`) must be a signer PDA derived from `[b\"identity\"]` and\n" +
    "the calling program ID (`callback_program_id`).\n" +
    "Therefore, external clients/cranks CANNOT directly request randomness off-chain;\n" +
    "requests must be dispatched via on-chain CPI by the consumer program itself."
  );

  console.log("\n=== MagicBlock VRF Spike & Inspection Completed ===");
}

main().catch((err) => {
  console.error("Spike failed with error:", err);
  process.exit(1);
});
