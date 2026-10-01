import * as web3 from "@solana/web3.js";
import { AnchorProvider, Wallet, type Program } from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseArgs } from "node:util";
import {
  resolveDevnetRpcUrl,
  checkRpcHealth,
  expandHomeDir,
  printErrorDetails,
} from "./utils";
import {
  DEVNET_STATE_DIR,
  DEVNET_ENV_PATH,
  recordDevnetRandomnessAccount,
  assertActiveEnvIsNotLocalnet,
} from "./devnet-state";
import { readEnvFile } from "./env-utils";
import { parseSwitchboardRandomnessHeader } from "../services/crank/vrf/randomness-provider";

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
  const resolvedPath = expandHomeDir(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Keypair file not found at: ${resolvedPath}`);
  }
  const secret = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
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
  const resolvedPath = expandHomeDir(keypairPath);
  if (fs.existsSync(resolvedPath) && !forceNew) {
    return { keypair: loadLegacyKeypair(resolvedPath), isExisting: true };
  }
  return { keypair: web3.Keypair.generate(), isExisting: false };
}

export function saveKeypairSecurely(
  filePath: string,
  keypair: web3.Keypair
): void {
  const resolvedPath = expandHomeDir(filePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${resolvedPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(Array.from(keypair.secretKey)), {
    mode: 0o600,
    encoding: "utf-8",
  });
  fs.renameSync(tempPath, resolvedPath);
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
  assertActiveEnvIsNotLocalnet();

  const rpcUrl = options?.rpcUrl || resolveDevnetRpcUrl();
  console.log(`Connecting to Devnet RPC at ${rpcUrl}...`);

  const isHealthy = await checkRpcHealth(rpcUrl);
  if (!isHealthy) {
    throw new Error(`Devnet RPC is not reachable at ${rpcUrl}.`);
  }

  const connection = new web3.Connection(rpcUrl, "confirmed");

  const devKeypair = path.resolve(
    os.homedir(),
    ".config/solana/crank-keypair-dev.json"
  );
  const resolvedPayerPath = expandHomeDir(
    options?.payerKeypairPath ||
      (fs.existsSync(devKeypair)
        ? devKeypair
        : path.resolve(os.homedir(), ".config", "solana", "id.json"))
  );

  console.log(`Loading payer keypair from ${resolvedPayerPath}...`);
  const payerKeypair = loadLegacyKeypair(resolvedPayerPath);
  const payerPubkeyStr = payerKeypair.publicKey.toBase58();
  await assertPayerSolBalance(connection, payerKeypair.publicKey);

  // Authority-aware existence check: if already configured in environment and active on-chain with matching authority, reuse it
  const existingConfigured =
    process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT ||
    readEnvFile(DEVNET_ENV_PATH).NEXT_PUBLIC_RANDOMNESS_ACCOUNT;

  if (existingConfigured && !options?.forceNew) {
    try {
      const pubkey = new web3.PublicKey(existingConfigured);
      const accInfo = await connection.getAccountInfo(pubkey);
      if (accInfo && accInfo.owner.equals(DEVNET_SB_PID)) {
        const header = parseSwitchboardRandomnessHeader(accInfo.data);
        if (header && header.authority === payerPubkeyStr) {
          console.log(
            `✓ Configured Switchboard randomness account ${existingConfigured} is already active on Devnet with matching authority (${payerPubkeyStr}).`
          );
          recordDevnetRandomnessAccount(existingConfigured);
          return {
            address: existingConfigured,
            isNewlyCreated: false,
          };
        } else {
          console.warn(
            `⚠️ Configured randomness account ${existingConfigured} authority (${header?.authority ?? "unknown"}) does not match payer (${payerPubkeyStr}). Re-provisioning fresh randomness account...`
          );
        }
      }
    } catch {
      // Invalid pubkey in env; proceed to generate
    }
  }

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

  // Check if account already exists on-chain with matching authority
  if (!options?.forceNew) {
    const accInfo = await connection.getAccountInfo(
      randomnessKeypair.publicKey
    );
    if (accInfo) {
      if (!accInfo.owner.equals(DEVNET_SB_PID)) {
        throw new Error(
          `Account ${randomnessAddress} exists on-chain but is owned by ${accInfo.owner.toBase58()}, expected ${DEVNET_SB_PID.toBase58()}.`
        );
      }
      const header = parseSwitchboardRandomnessHeader(accInfo.data);
      if (header && header.authority === payerPubkeyStr) {
        console.log(
          `✓ Switchboard randomness account ${randomnessAddress} is already initialized on Devnet with matching authority.`
        );
        recordDevnetRandomnessAccount(randomnessAddress);
        return {
          address: randomnessAddress,
          isNewlyCreated: false,
        };
      } else {
        console.warn(
          `⚠️ Existing randomness account ${randomnessAddress} authority (${header?.authority ?? "unknown"}) does not match payer (${payerPubkeyStr}). Generating fresh keypair...`
        );
      }
    }
  }

  // If we get here and need to create a fresh one (e.g. forced or mismatch on disk), ensure we use a fresh keypair if the on-disk one exists with mismatched authority
  let freshRandomnessKeypair = randomnessKeypair;
  if (isExisting && !options?.forceNew) {
    freshRandomnessKeypair = web3.Keypair.generate();
  }
  const freshRandomnessAddress = freshRandomnessKeypair.publicKey.toBase58();

  console.log("Submitting Switchboard randomnessInit transaction on Devnet...");
  const createInstruction = await buildRandomnessInitInstruction({
    program: switchboardProgram,
    randomnessKeypair: freshRandomnessKeypair,
    payerPublicKey: payerKeypair.publicKey,
    queuePublicKey: DEVNET_SB_QUEUE,
  });

  const tx = new web3.Transaction().add(createInstruction);
  tx.feePayer = payerKeypair.publicKey;
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;

  tx.sign(payerKeypair, freshRandomnessKeypair);

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

  saveKeypairSecurely(randomnessKeyPath, freshRandomnessKeypair);
  recordDevnetRandomnessAccount(freshRandomnessAddress);

  return {
    address: freshRandomnessAddress,
    isNewlyCreated: true,
    signature: txSignature,
  };
}

function printUsage() {
  console.log(
    "Usage: tsx scripts/create-switchboard-randomness.ts [options] [payer_keypair_path]"
  );
  console.log("Options:");
  console.log(
    "  --payer <path>   Path to payer keypair (defaults to ~/.config/solana/id.json)"
  );
  console.log(
    "  --force          Force provision a new Switchboard randomness account"
  );
  console.log("  --rpc <url>      Devnet RPC URL");
  console.log("  --help, -h       Display this help message");
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      payer: { type: "string" },
      force: { type: "boolean", default: false },
      rpc: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const rawPayer = values.payer || positionals[0];
  const payerKeypairPath = rawPayer ? expandHomeDir(rawPayer) : undefined;
  const forceNew = Boolean(values.force);
  const rpcUrl = values.rpc;
  await provisionDevnetRandomnessAccount({
    payerKeypairPath,
    forceNew,
    rpcUrl,
  });
}

if (require.main === module) {
  main().catch((err) => {
    printErrorDetails(err, "Switchboard Randomness CLI");
    process.exit(1);
  });
}
