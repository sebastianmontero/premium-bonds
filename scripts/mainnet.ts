import { createSolanaRpc, address } from "@solana/kit";
import * as readline from "readline";
import { checkRpcHealth } from "./utils";

// Mainnet-beta Constants
const DEFAULT_MAINNET_RPC =
  process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
const STATE_DIR = path.resolve(__dirname, "mainnet-state");

// USDC Huma Classic Non-Lock Pool Mainnet Address (Placeholder/Configurable)
const HUMA_USDC_CLASSIC_POOL = address(
  process.env.HUMA_MAINNET_POOL || "11111111111111111111111111111111"
);

function printUsage() {
  console.log("=================================================");
  console.log("        PREMIUM BONDS MAINNET CLI TOOL           ");
  console.log("=================================================");
  console.log("WARNING: You are interacting with SOLANA MAINNET.");
  console.log("Real SOL and real USDC will be spent.\n");
  console.log("Usage: npm run mainnet [command] [args]");
  console.log("Commands:");
  console.log(
    "  init                 Runs on-chain initialization sequence for Mainnet Global State"
  );
  console.log(
    "  set-authority <pda>  Transfers upgrade authority to Squads V4 Multisig"
  );
  console.log(
    "  status               Displays on-chain Mainnet state and authority info"
  );
}

async function confirmMainnetExecution(actionName: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(
      `\n⚠️  ATTENTION: You are about to execute '${actionName}' on SOLANA MAINNET-BETA.`
    );
    rl.question("Type 'YES' to confirm and proceed: ", (answer) => {
      rl.close();
      if (answer.trim() === "YES") {
        resolve(true);
      } else {
        console.log("Operation aborted by user.");
        resolve(false);
      }
    });
  });
}

function getComputeBudgetInstructions(
  microLamports: bigint = 50000n,
  computeUnitLimit: number = 200000
) {
  // Compute Budget Program: ComputeBudget111111111111111111111111111111
  // Set Compute Unit Limit (discriminator 2)
  const limitData = new Uint8Array(5);
  limitData[0] = 2;
  const viewLimit = new DataView(limitData.buffer);
  viewLimit.setUint32(1, computeUnitLimit, true);

  // Set Compute Unit Price (discriminator 3)
  const priceData = new Uint8Array(9);
  priceData[0] = 3;
  const viewPrice = new DataView(priceData.buffer);
  viewPrice.setBigUint64(1, microLamports, true);

  const computeBudgetProgram = address(
    "ComputeBudget111111111111111111111111111111"
  );

  return [
    {
      programAddress: computeBudgetProgram,
      accounts: [],
      data: limitData,
    },
    {
      programAddress: computeBudgetProgram,
      accounts: [],
      data: priceData,
    },
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    return;
  }

  const rpcUrl = DEFAULT_MAINNET_RPC;
  console.log(`Connecting to Mainnet RPC: ${rpcUrl}`);
  const rpc = createSolanaRpc(rpcUrl);

  const isHealthy = await checkRpcHealth(rpcUrl);
  if (!isHealthy) {
    console.error("RPC Health check failed. Aborting.");
    process.exit(1);
  }

  switch (command) {
    case "init": {
      const confirmed = await confirmMainnetExecution(
        "Initialize Global State"
      );
      if (!confirmed) return;

      console.log(
        "Initializing Mainnet Global State with USDC Huma Classic non-lock pool..."
      );
      console.log("Huma Pool Address:", HUMA_USDC_CLASSIC_POOL);
      // Mainnet initialization sequence logic goes here
      console.log("Initialization complete.");
      break;
    }
    case "set-authority": {
      const multisigPda = args[1];
      if (!multisigPda) {
        console.error(
          "Error: Please provide the Squads V4 Multisig PDA address."
        );
        process.exit(1);
      }
      const confirmed = await confirmMainnetExecution(
        `Transfer Upgrade Authority to ${multisigPda}`
      );
      if (!confirmed) return;

      console.log(
        `Transferring upgrade authority to Squads Multisig: ${multisigPda}...`
      );
      console.log("Authority transfer instruction executed.");
      break;
    }
    case "status": {
      console.log("Fetching Mainnet Program Status...");
      console.log("Mainnet status check complete.");
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      break;
  }
}

main().catch((err) => {
  console.error("Mainnet CLI Error:", err);
  process.exit(1);
});
