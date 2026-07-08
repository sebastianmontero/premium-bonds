import {
  createSolanaRpc,
  address,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  KeyPairSigner,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  findPrizePoolPda,
  findGlobalConfigPda,
  findDrawCyclePda,
  findPayoutRegistryPda,
  parsePrizePool,
  parseGlobalConfig,
  parseDrawCycle,
  parsePayoutRegistry,
  buildHarvestYieldAndCommitInstruction,
  buildRevealAndPickWinnersInstruction,
  buildReinvestWinningsInstruction,
} from "../app/lib/bonds-sdk";

// ─── Help / Usage ────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
Premium Bonds Crank CLI (pb-cli)

Usage:
  pb-cli [command] [options]

Commands:
  harvest              Harvest yield from Huma and commit it to the current draw cycle
  reveal               Reveal the random seed and pick winners for the draw cycle
  query-config         Query and display the Global Config state
  query-pool           Query and display the Prize Pool state
  query-draw           Query and display the current Draw Cycle state
  query-payout         Query and display the Payout Registry state
  reinvest             Reinvest draw winnings back into principal/tickets

Options:
  --pool <number>      Pool ID (default: 1)
  --keypair <path>     Path to the keypair file (default: scripts/admin-key.json)
  --rpc <url>          Solana RPC URL (default: http://127.0.0.1:8899)
  --seed <hex>         32-byte hex string seed for the reveal command (default: randomly generated)
  --cycle <number>     Draw Cycle ID to target or query (default: pool's currentDrawCycleId - 1)
  --winner <idx|addr>  Winner index or public key to reinvest (default: all unprocessed winners)
  --max-bonds <number> Maximum bonds to buy per reinvest transaction (default: 1000)
  --help, -h           Show this help message
`);
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function formatAmount(amount: bigint | number): string {
  const val = Number(amount) / 1_000_000;
  return val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function loadAddresses(): Record<string, string> {
  const filePath = path.resolve(__dirname, "localnet-state", "addresses.json");
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      console.warn("Failed to parse addresses.json, using defaults:", err);
    }
  }
  return {};
}

async function sendTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  signer: KeyPairSigner,
  instruction: Parameters<typeof appendTransactionMessageInstruction>[0]
) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    setTransactionMessageFeePayerSigner(
      signer,
      appendTransactionMessageInstruction(
        instruction,
        createTransactionMessage({ version: 0 })
      )
    )
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const wireTx = getBase64EncodedWireTransaction(signedTx);
  const signature = await rpc
    .sendTransaction(wireTx, { encoding: "base64" })
    .send();

  console.log(`Transaction sent: ${signature}. Waiting for confirmation...`);

  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const status = await rpc.getSignatureStatuses([signature]).send();
      if (status && status.value && status.value[0]) {
        const err = status.value[0].err;
        if (err) {
          throw new Error(`Transaction failed: ${JSON.stringify(err)}`);
        }
        console.log("Transaction confirmed successfully!");
        return signature;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("Checking signature status:", msg);
    }
  }

  console.warn(
    "Transaction signature status check timed out, continuing anyway."
  );
  return signature;
}

// ─── Main CLI Logic ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    showHelp();
    return;
  }

  const command = args[0];
  const options: Record<string, string> = {};
  const positionals: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        options[arg] = val;
        i++;
      } else {
        options[arg] = "true";
      }
    } else {
      positionals.push(arg);
    }
  }

  // Parse global options
  const poolId = parseInt(options["--pool"] || "1", 10);
  const rpcUrl = options["--rpc"] || "http://127.0.0.1:8899";
  const keypairPath =
    options["--keypair"] || path.resolve(__dirname, "admin-key.json");

  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();
  const localnetAddresses = loadAddresses();

  // Load keypair if performing writes
  let signer: KeyPairSigner | null = null;
  if (command === "harvest" || command === "reveal" || command === "reinvest") {
    if (!fs.existsSync(keypairPath)) {
      throw new Error(`Keypair file not found at ${keypairPath}`);
    }
    const bytes = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    signer = await createKeyPairSignerFromBytes(new Uint8Array(bytes));
    console.log(`Loaded Keypair Address: ${signer.address}`);
  }

  switch (command) {
    case "harvest": {
      console.log(`Harvesting yield for pool ${poolId}...`);

      // Retrieve pool state first to extract draw cycle details and registry pointer
      const poolPda = await findPrizePoolPda(poolId);
      const poolAcc = await rpc
        .getAccountInfo(poolPda, { encoding: "base64" })
        .send();
      if (!poolAcc || !poolAcc.value) {
        throw new Error(
          `PrizePool account for pool ${poolId} not found on-chain.`
        );
      }
      const poolBytes = new Uint8Array(
        base64Encoder.encode(poolAcc.value.data[0])
      );
      const poolState = parsePrizePool(poolBytes);

      const pstMintStr = localnetAddresses.pstMint;
      const humaPoolStateStr = localnetAddresses.humaPoolState;
      if (!pstMintStr || !humaPoolStateStr) {
        throw new Error(
          "Missing pstMint or humaPoolState in localnet addresses."
        );
      }

      console.log(`Pool Details:
  Current Draw Cycle ID: ${poolState.currentDrawCycleId}
  Ticket Registry: ${poolState.ticketRegistry}
  PST Mint: ${pstMintStr}
  Huma Pool State: ${humaPoolStateStr}
`);

      const ix = await buildHarvestYieldAndCommitInstruction({
        crank: signer!.address,
        poolId,
        ticketRegistry: address(poolState.ticketRegistry),
        currentDrawCycleId: poolState.currentDrawCycleId,
        pstMint: address(pstMintStr),
        humaPoolState: address(humaPoolStateStr),
      });

      await sendTransaction(rpc, signer!, ix);
      break;
    }

    case "reveal": {
      console.log(`Revealing and picking winners for pool ${poolId}...`);

      const poolPda = await findPrizePoolPda(poolId);
      const poolAcc = await rpc
        .getAccountInfo(poolPda, { encoding: "base64" })
        .send();
      if (!poolAcc || !poolAcc.value) {
        throw new Error(
          `PrizePool account for pool ${poolId} not found on-chain.`
        );
      }
      const poolBytes = new Uint8Array(
        base64Encoder.encode(poolAcc.value.data[0])
      );
      const poolState = parsePrizePool(poolBytes);

      // Parse seed option or generate random
      let seed = crypto.randomBytes(32);
      const seedHex = options["--seed"];
      if (seedHex) {
        if (seedHex.length !== 64) {
          throw new Error("Seed must be a 64-character (32-byte) hex string.");
        }
        seed = Buffer.from(seedHex, "hex");
      }

      let cycleId = poolState.currentDrawCycleId - 1;
      if (options["--cycle"]) {
        cycleId = parseInt(options["--cycle"], 10);
      } else if (positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) {
          cycleId = val;
        }
      }

      if (cycleId < 0) {
        throw new Error(
          `Invalid Draw Cycle ID: ${cycleId}. No draw cycle has been created yet.`
        );
      }

      console.log(`Using Random Seed (hex): ${seed.toString("hex")}`);
      console.log(`Targeting Draw Cycle ID: ${cycleId}`);

      const ix = await buildRevealAndPickWinnersInstruction({
        crank: signer!.address,
        poolId,
        currentDrawCycleId: cycleId,
        ticketRegistry: address(poolState.ticketRegistry),
        randomSeed: new Uint8Array(seed),
      });

      await sendTransaction(rpc, signer!, ix);
      break;
    }

    case "query-config": {
      const configPda = await findGlobalConfigPda();
      console.log(`Querying Global Config state at ${configPda}...`);
      const configAcc = await rpc
        .getAccountInfo(configPda, { encoding: "base64" })
        .send();
      if (!configAcc || !configAcc.value) {
        console.log("Global Config account does not exist.");
        return;
      }
      const bytes = new Uint8Array(
        base64Encoder.encode(configAcc.value.data[0])
      );
      const state = parseGlobalConfig(bytes);
      console.log(`Global Config:
  Admin: ${state.admin}
  Jobs Account (Crank): ${state.jobsAccount}
  Max Tickets Per Buy: ${state.maxTicketsPerBuy}
`);
      break;
    }

    case "query-pool": {
      let targetPoolId = poolId;
      if (positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) {
          targetPoolId = val;
        }
      }
      const poolPda = await findPrizePoolPda(targetPoolId);
      console.log(`Querying Prize Pool ${targetPoolId} state at ${poolPda}...`);
      const poolAcc = await rpc
        .getAccountInfo(poolPda, { encoding: "base64" })
        .send();
      if (!poolAcc || !poolAcc.value) {
        console.log(`Prize Pool ${targetPoolId} account does not exist.`);
        return;
      }
      const bytes = new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]));
      const state = parsePrizePool(bytes);
      console.log(`Prize Pool ${poolId}:
  Token Mint: ${state.tokenMint}
  Ticket Registry: ${state.ticketRegistry}
  Fee Wallet: ${state.feeWallet}
  Bond Price: ${formatAmount(state.bondPrice)}
  Stake Cycle Duration (Hrs): ${state.stakeCycleDurationHrs}
  Fee Basis Points: ${state.feeBasisPoints}
  Status: ${state.status}
  Total Deposited Principal: ${formatAmount(state.totalDepositedPrincipal)}
  Total Fees Collected: ${formatAmount(state.totalFeesCollected)}
  Current Cycle End At: ${new Date(state.currentCycleEndAt * 1000).toLocaleString()}
  Is Frozen For Draw: ${state.isFrozenForDraw}
  Current Draw Cycle ID: ${state.currentDrawCycleId}
  Prize Tiers: ${JSON.stringify(state.prizeTiers)}
  Next Redemption ID: ${state.nextRedemptionId}
  Total Fees Accrued: ${formatAmount(state.totalFeesAccrued)}
  Total Fees Withdrawn: ${formatAmount(state.totalFeesWithdrawn)}
`);
      break;
    }

    case "query-draw": {
      // Query the current draw cycle state
      const poolPda = await findPrizePoolPda(poolId);
      const poolAcc = await rpc
        .getAccountInfo(poolPda, { encoding: "base64" })
        .send();
      if (!poolAcc || !poolAcc.value) {
        throw new Error(
          `PrizePool account for pool ${poolId} not found on-chain.`
        );
      }
      const poolBytes = new Uint8Array(
        base64Encoder.encode(poolAcc.value.data[0])
      );
      const poolState = parsePrizePool(poolBytes);

      let cycleId = poolState.currentDrawCycleId - 1;
      if (options["--cycle"]) {
        cycleId = parseInt(options["--cycle"], 10);
      } else if (positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) {
          cycleId = val;
        }
      }

      if (cycleId < 0) {
        console.log("No draw cycle has been created yet.");
        return;
      }

      const drawCyclePda = await findDrawCyclePda(poolId, cycleId);
      console.log(
        `Querying Draw Cycle ${cycleId} for Pool ${poolId} at ${drawCyclePda}...`
      );

      const drawCycleAcc = await rpc
        .getAccountInfo(drawCyclePda, { encoding: "base64" })
        .send();
      if (!drawCycleAcc || !drawCycleAcc.value) {
        console.log(`Draw Cycle account does not exist.`);
        return;
      }

      const bytes = new Uint8Array(
        base64Encoder.encode(drawCycleAcc.value.data[0])
      );
      const state = parseDrawCycle(bytes);

      console.log(`Draw Cycle ${state.cycleId}:
  Pool ID: ${state.poolId}
  Status: ${state.status}
  Locked Ticket Count: ${state.lockedTicketCount}
  Randomness Seed (hex): ${Buffer.from(state.randomnessSeed).toString("hex")}
  Prize Pot: ${formatAmount(state.prizePot)}
  Cycle Fee Collected: ${formatAmount(state.cycleFeeCollected)}
`);
      break;
    }

    case "query-payout": {
      // Query the payout registry state
      const poolPda = await findPrizePoolPda(poolId);
      const poolAcc = await rpc
        .getAccountInfo(poolPda, { encoding: "base64" })
        .send();
      if (!poolAcc || !poolAcc.value) {
        throw new Error(
          `PrizePool account for pool ${poolId} not found on-chain.`
        );
      }
      const poolBytes = new Uint8Array(
        base64Encoder.encode(poolAcc.value.data[0])
      );
      const poolState = parsePrizePool(poolBytes);

      let cycleId = poolState.currentDrawCycleId - 1;
      if (options["--cycle"]) {
        cycleId = parseInt(options["--cycle"], 10);
      } else if (positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) {
          cycleId = val;
        }
      }

      if (cycleId < 0) {
        console.log("No draw cycle has been created yet.");
        return;
      }

      const payoutRegistryPda = await findPayoutRegistryPda(poolId, cycleId);
      console.log(
        `Querying Payout Registry ${cycleId} for Pool ${poolId} at ${payoutRegistryPda}...`
      );

      const payoutRegistryAcc = await rpc
        .getAccountInfo(payoutRegistryPda, { encoding: "base64" })
        .send();
      if (!payoutRegistryAcc || !payoutRegistryAcc.value) {
        console.log(`Payout Registry account does not exist.`);
        return;
      }

      const bytes = new Uint8Array(
        base64Encoder.encode(payoutRegistryAcc.value.data[0])
      );
      const state = parsePayoutRegistry(bytes);

      let totalOwed = 0n;
      let totalReinvested = 0n;
      let totalClaimable = 0n;

      console.log(`Payout Registry for Pool ${poolId}, Cycle ${cycleId}:
  Pool ID: ${state.poolId}
  Cycle ID: ${state.cycleId}
  Winners Count: ${state.winnersCount}
  Payouts Completed: ${state.payoutsCompleted}
  Payout Progress: ${state.payoutsCompleted} / ${state.winnersCount} processed
  Winners:`);

      state.winners.forEach((w, idx) => {
        const claimable = w.amountOwed - w.amountReinvested;
        totalOwed += w.amountOwed;
        totalReinvested += w.amountReinvested;
        totalClaimable += claimable;

        console.log(`    [${idx}] Winner: ${w.winnerPubkey}
        Tier Index: ${w.tierIndex}
        Amount Owed: ${formatAmount(w.amountOwed)}
        Amount Reinvested: ${formatAmount(w.amountReinvested)}
        Claimable Amount: ${formatAmount(claimable)}
        Processed: ${w.processed}`);
      });

      console.log(`
  Totals:
    Total Amount Owed: ${formatAmount(totalOwed)}
    Total Amount Reinvested: ${formatAmount(totalReinvested)}
    Total Claimable: ${formatAmount(totalClaimable)}
`);
      break;
    }
    case "reinvest": {
      // 1. Fetch PrizePool state to get currentDrawCycleId and ticketRegistry
      const poolPda = await findPrizePoolPda(poolId);
      const poolAcc = await rpc
        .getAccountInfo(poolPda, { encoding: "base64" })
        .send();
      if (!poolAcc || !poolAcc.value) {
        throw new Error(
          `PrizePool account for pool ${poolId} not found on-chain.`
        );
      }
      const poolBytes = new Uint8Array(
        base64Encoder.encode(poolAcc.value.data[0])
      );
      const poolState = parsePrizePool(poolBytes);

      // Parse cycle option (default: latest completed cycle)
      let cycleId = poolState.currentDrawCycleId - 1;
      if (options["--cycle"]) {
        cycleId = parseInt(options["--cycle"], 10);
      }
      if (cycleId < 0) {
        throw new Error(
          `Invalid Draw Cycle ID: ${cycleId}. No draw cycle has been created yet.`
        );
      }

      // Parse max bonds
      const maxBonds = parseInt(options["--max-bonds"] || "1000", 10);
      if (isNaN(maxBonds) || maxBonds <= 0) {
        throw new Error(
          "Invalid --max-bonds value. Must be a positive integer."
        );
      }

      const payoutRegistryPda = await findPayoutRegistryPda(poolId, cycleId);
      console.log(
        `Fetching Payout Registry ${cycleId} for Pool ${poolId} at ${payoutRegistryPda}...`
      );

      const payoutRegistryAcc = await rpc
        .getAccountInfo(payoutRegistryPda, { encoding: "base64" })
        .send();
      if (!payoutRegistryAcc || !payoutRegistryAcc.value) {
        console.log(
          `Payout Registry account for cycle ${cycleId} does not exist.`
        );
        return;
      }

      const bytes = new Uint8Array(
        base64Encoder.encode(payoutRegistryAcc.value.data[0])
      );
      const state = parsePayoutRegistry(bytes);

      // Determine target winner(s)
      const winnerOption = options["--winner"] || positionals[0];
      let targetWinnerIndices: number[] = [];

      if (winnerOption) {
        // Resolve target winner index
        const parsedIdx = parseInt(winnerOption, 10);
        if (!isNaN(parsedIdx)) {
          if (parsedIdx < 0 || parsedIdx >= state.winners.length) {
            throw new Error(
              `Winner index ${parsedIdx} out of range (0-${state.winners.length - 1})`
            );
          }
          targetWinnerIndices = [parsedIdx];
        } else {
          // Check if it's a pubkey
          const index = state.winners.findIndex(
            (w) => w.winnerPubkey === winnerOption
          );
          if (index === -1) {
            throw new Error(
              `Winner address ${winnerOption} not found in payout registry.`
            );
          }
          targetWinnerIndices = [index];
        }
      } else {
        // Get all unprocessed winner indices
        targetWinnerIndices = state.winners
          .map((w, idx) => ({ ...w, idx }))
          .filter((w) => !w.processed)
          .map((w) => w.idx);
      }

      if (targetWinnerIndices.length === 0) {
        console.log("No unprocessed winners found to reinvest.");
        break;
      }

      console.log(
        `Starting reinvestment for ${targetWinnerIndices.length} winner(s)...`
      );

      for (const winnerIndex of targetWinnerIndices) {
        while (true) {
          // Fetch the latest state of the payout registry to check processed status
          const currentRegistryAcc = await rpc
            .getAccountInfo(payoutRegistryPda, { encoding: "base64" })
            .send();
          if (!currentRegistryAcc || !currentRegistryAcc.value) {
            throw new Error("Payout Registry not found during loop execution.");
          }
          const currentBytes = new Uint8Array(
            base64Encoder.encode(currentRegistryAcc.value.data[0])
          );
          const currentRegistry = parsePayoutRegistry(currentBytes);
          const winnerEntry = currentRegistry.winners[winnerIndex];

          if (winnerEntry.processed) {
            console.log(
              `Winner ${winnerEntry.winnerPubkey} (index ${winnerIndex}) is fully processed.`
            );
            break;
          }

          const claimable =
            winnerEntry.amountOwed - winnerEntry.amountReinvested;
          console.log(
            `Winner ${winnerEntry.winnerPubkey} (index ${winnerIndex}): Owed: ${formatAmount(
              winnerEntry.amountOwed
            )}, Reinvested: ${formatAmount(
              winnerEntry.amountReinvested
            )}, Claimable: ${formatAmount(claimable)}`
          );

          const ix = await buildReinvestWinningsInstruction({
            crank: signer!.address,
            winner: address(winnerEntry.winnerPubkey),
            poolId,
            cycleId,
            winnerIndex,
            maxBonds,
            ticketRegistry: address(poolState.ticketRegistry),
          });

          console.log(
            `Submitting reinvestment transaction (maxBonds: ${maxBonds})...`
          );
          await sendTransaction(rpc, signer!, ix);

          // Brief delay between batch checks
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      console.log("Reinvestment process completed successfully!");
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("CLI Execution Error:", err.message || err);
  process.exit(1);
});
