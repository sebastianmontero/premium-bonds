import * as web3 from "@solana/web3.js";
import { AnchorProvider, Wallet, type Program } from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import * as fs from "fs";
import * as path from "path";
import { resolveDevnetRpcUrl, checkRpcHealth } from "./utils";
import {
  DEVNET_STATE_DIR,
  DEVNET_ENV_PATH,
  recordDevnetRandomnessAccount,
} from "./devnet-state";
import { readEnvFile } from "./env-utils";

export const DEVNET_SB_PID = new web3.PublicKey(
  "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
);
export const DEVNET_SB_QUEUE = new web3.PublicKey(
  "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7"
);

export const MIN_PAYER_BALANCE_LAMPORTS = 5_000_000; // ~0.005 SOL for rent + tx fees

export interface ProvisionRandomnessOptions {
  payerKeypairPath?: string;
  rpcUrl?: string;
  forceNew?: boolean;
}

export interface ProvisionRandomnessResult {
  readonly address: string;
  readonly isNewlyCreated: boolean;
  readonly signature?: string;
}

export interface CreateRandomnessInstructionParams {
  readonly program: Program;
  readonly randomnessKeypair: web3.Keypair;
  readonly payerPublicKey: web3.PublicKey;
  readonly queuePublicKey?: web3.PublicKey;
}

export function loadLegacyKeypair(filePath: string): web3.Keypair {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Keypair file not found at: ${filePath}`);
  }
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return web3.Keypair.fromSecretKey(Uint8Array.from(secret));
}

export async function assertPayerSolBalance(
  connection: web3.Connection,
  payerPublicKey: web3.PublicKey,
  minimumLamports: number = MIN_PAYER_BALANCE_LAMPORTS
): Promise<void> {
  const balance = await connection.getBalance(payerPublicKey);
  if (balance < minimumLamports) {
    throw new Error(
      `Insufficient SOL balance on payer ${payerPublicKey.toBase58()}. ` +
        `Required: >= ${(minimumLamports / web3.LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
        `Found: ${(balance / web3.LAMPORTS_PER_SOL).toFixed(4)} SOL. ` +
        `Please request Devnet SOL via faucet before proceeding.`
    );
  }
}

export function loadOrCreateRandomnessKeypair(
  keypairPath: string,
  forceNew = false
): { keypair: web3.Keypair; isExisting: boolean } {
  if (fs.existsSync(keypairPath) && !forceNew) {
    return { keypair: loadLegacyKeypair(keypairPath), isExisting: true };
  }
  return { keypair: web3.Keypair.generate(), isExisting: false };
}

export function saveKeypairSecurely(
  filePath: string,
  keypair: web3.Keypair
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(Array.from(keypair.secretKey)), {
    mode: 0o600,
    encoding: "utf-8",
  });
  fs.renameSync(tempPath, filePath);
}

/**
 * Pure instruction builder for Switchboard randomness account initialization.
 * Decoupled from live RPC execution for deterministic offline testing.
 */
export async function buildRandomnessInitInstruction(
  params: CreateRandomnessInstructionParams
): Promise<web3.TransactionInstruction> {
  const {
    program,
    randomnessKeypair,
    payerPublicKey,
    queuePublicKey = DEVNET_SB_QUEUE,
  } = params;
  const [_, createInstruction] = await sb.Randomness.create(
    program,
    randomnessKeypair,
    queuePublicKey,
    payerPublicKey
  );
  return createInstruction;
}

export async function provisionDevnetRandomnessAccount(
  options?: ProvisionRandomnessOptions
): Promise<ProvisionRandomnessResult> {
  const rpcUrl = options?.rpcUrl || resolveDevnetRpcUrl();
  console.log(`Connecting to Devnet RPC at ${rpcUrl}...`);

  const isHealthy = await checkRpcHealth(rpcUrl);
  if (!isHealthy) {
    throw new Error(`Devnet RPC is not reachable at ${rpcUrl}.`);
  }

  const connection = new web3.Connection(rpcUrl, "confirmed");

  // Existence-first check: if already configured in environment and active on-chain, reuse it
  const existingConfigured =
    process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT ||
    readEnvFile(DEVNET_ENV_PATH).NEXT_PUBLIC_RANDOMNESS_ACCOUNT;

  if (existingConfigured && !options?.forceNew) {
    try {
      const pubkey = new web3.PublicKey(existingConfigured);
      const accInfo = await connection.getAccountInfo(pubkey);
      if (accInfo && accInfo.owner.equals(DEVNET_SB_PID)) {
        console.log(
          `✓ Configured Switchboard randomness account ${existingConfigured} is already active on Devnet.`
        );
        recordDevnetRandomnessAccount(existingConfigured);
        return {
          address: existingConfigured,
          isNewlyCreated: false,
        };
      }
    } catch {
      // Invalid pubkey in env; proceed to generate
    }
  }

  const resolvedPayerPath =
    options?.payerKeypairPath ||
    path.resolve(process.env.HOME || "", ".config", "solana", "id.json");

  console.log(`Loading payer keypair from ${resolvedPayerPath}...`);
  const payerKeypair = loadLegacyKeypair(resolvedPayerPath);
  await assertPayerSolBalance(connection, payerKeypair.publicKey);

  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  console.log("Loading Switchboard On-Demand program from Devnet...");
  const switchboardProgram = await sb.AnchorUtils.loadProgramFromProvider(
    provider,
    DEVNET_SB_PID
  );

  const randomnessKeyPath = path.resolve(
    DEVNET_STATE_DIR,
    "randomness-keypair.json"
  );
  const { keypair: randomnessKeypair, isExisting } =
    loadOrCreateRandomnessKeypair(randomnessKeyPath, options?.forceNew);
  const randomnessAddress = randomnessKeypair.publicKey.toBase58();

  // Check if account already exists on-chain
  const accInfo = await connection.getAccountInfo(randomnessKeypair.publicKey);
  if (accInfo) {
    if (!accInfo.owner.equals(DEVNET_SB_PID)) {
      throw new Error(
        `Account ${randomnessAddress} exists on-chain but is owned by ${accInfo.owner.toBase58()}, expected ${DEVNET_SB_PID.toBase58()}.`
      );
    }
    console.log(
      `✓ Switchboard randomness account ${randomnessAddress} is already initialized on Devnet.`
    );
    recordDevnetRandomnessAccount(randomnessAddress);
    return {
      address: randomnessAddress,
      isNewlyCreated: false,
    };
  }

  console.log("Submitting Switchboard randomnessInit transaction on Devnet...");
  const createInstruction = await buildRandomnessInitInstruction({
    program: switchboardProgram,
    randomnessKeypair,
    payerPublicKey: payerKeypair.publicKey,
    queuePublicKey: DEVNET_SB_QUEUE,
  });

  const tx = new web3.Transaction().add(createInstruction);
  tx.feePayer = payerKeypair.publicKey;
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;

  tx.sign(payerKeypair, randomnessKeypair);

  const txSignature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  console.log(`Transaction sent: ${txSignature}. Awaiting confirmation...`);
  const confirmation = await connection.confirmTransaction(
    {
      signature: txSignature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(
      `Failed to initialize Switchboard randomness account on-chain: ${JSON.stringify(
        confirmation.value.err
      )}`
    );
  }

  console.log(
    `✓ Switchboard randomness account created successfully! Signature: ${txSignature}`
  );

  if (!isExisting) {
    saveKeypairSecurely(randomnessKeyPath, randomnessKeypair);
  }

  recordDevnetRandomnessAccount(randomnessAddress);

  return {
    address: randomnessAddress,
    isNewlyCreated: true,
    signature: txSignature,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positionals = args.filter((a) => !a.startsWith("--"));

  const payerKeypairPath = positionals[0];
  const forceNew = flags.has("--force");
  await provisionDevnetRandomnessAccount({ payerKeypairPath, forceNew });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error provisioning Switchboard randomness account:", err);
    process.exit(1);
  });
}
