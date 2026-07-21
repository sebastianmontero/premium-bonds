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
  getBase58Decoder,
  Base58EncodedBytes,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { sendTx } from "./utils";
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
  findUserWinningsPda,
  findPendingRedemptionPda,
  parseUserWinnings,
  parsePendingRedemption,
  parseTicketRegistry,
  findPoolVaultPda,
  findPoolPstVaultPda,
  encodeU32,
  PROGRAM_ID,
  buildPrepareDrawInstruction,
} from "../app/lib/bonds-sdk";

// ─── Help / Usage ────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
Premium Bonds Crank CLI (pb-cli)

Usage:
  pb-cli [command] [options]

Commands:
  harvest              Harvest yield from Huma and commit it to the current draw cycle
  prepare-draw         Prepare tickets for the draw cycle in batches
  reveal               Reveal the random seed and pick winners for the draw cycle
  query-config         Query and display the Global Config state
  query-pool           Query and display the Prize Pool state
  query-draw           Query and display the current Draw Cycle state
  query-payout         Query and display the Payout Registry state
  query-winnings [usr] Query and display User Winnings (specify user pubkey or omit to list all)
  query-redemption [id] Query Pending Redemption (specify ID or omit to list all, optionally filter with --user)
  query-registry       Query and display the Ticket Registry state (optionally filter with --user)
  reinvest             Reinvest draw winnings back into principal/tickets

Options:
  --pool <number>      Pool ID (default: 1)
  --keypair <path>     Path to the keypair file (default: scripts/admin-key.json)
  --rpc <url>          Solana RPC URL (default: http://127.0.0.1:8899)
  --seed <hex>         32-byte hex string seed for the reveal command (default: randomly generated)
  --cycle <number>     Draw Cycle ID to target or query (default: pool's currentDrawCycleId - 1)
  --winner <idx|addr>  Winner index or public key to reinvest (default: all unprocessed winners)
  --max-bonds <number> Maximum bonds to buy per reinvest transaction (default: 1000)
  --batch-size <num>   Maximum entries to process per prepare-draw transaction (default: 1000)
  --user <pubkey>      User public key filter/target (for query-winnings, query-redemption, or query-registry)
  --help, -h           Show this help message

Environments & Usage Examples:
  The CLI dynamically resolves configuration state (e.g. program and vault addresses)
  between localnet and devnet based on the '--rpc' URL.

  Localnet (Default):
    Runs against a local validator (http://127.0.0.1:8899) and defaults to the local
    admin keypair:
      npm run pb-cli query-pool

  Devnet:
    Runs against Solana Devnet. You must supply a devnet RPC URL and a funded,
    authorized keypair file:
      npm run pb-cli query-pool -- --rpc https://api.devnet.solana.com
      npm run pb-cli harvest -- --rpc https://api.devnet.solana.com --keypair ~/.config/solana/id.json

  Note: When running via 'npm run', always include '--' before specifying CLI options so
  that npm forwards the arguments properly.
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

function loadAddresses(isDevnet: boolean): Record<string, string> {
  const stateDir = isDevnet ? "devnet-state" : "localnet-state";
  const filePath = path.resolve(__dirname, stateDir, "addresses.json");
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      console.warn(
        `Failed to parse ${stateDir}/addresses.json, using defaults:`,
        err
      );
    }
  }
  return {};
}

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const env: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
      if (match) {
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        }
        env[match[1]] = val;
      }
    }
  }
  return env;
}

async function setAccount(
  rpcUrl: string,
  addr: string,
  lamports: number,
  dataHex: string,
  owner: string,
  executable: boolean
) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "surfnet_setAccount",
      params: [
        addr,
        {
          lamports,
          data: dataHex,
          owner,
          executable,
        },
      ],
    }),
  });
  const json = (await res.json()) as { error?: unknown };
  if (json.error) {
    throw new Error(
      `RPC Error setting account ${addr}: ${JSON.stringify(json.error)}`
    );
  }
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

  const isDevnet = rpcUrl.includes("devnet") || rpcUrl.includes("api.devnet");
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();
  const stateAddresses = loadAddresses(isDevnet);

  // Load keypair if performing writes
  let signer: KeyPairSigner | null = null;
  if (
    command === "harvest" ||
    command === "reveal" ||
    command === "reinvest" ||
    command === "prepare-draw"
  ) {
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

      const pstMintStr = stateAddresses.pstMint;
      const humaPoolStateStr = stateAddresses.humaPoolState;
      if (!pstMintStr || !humaPoolStateStr) {
        throw new Error(
          `Missing pstMint or humaPoolState in ${isDevnet ? "devnet" : "localnet"} state addresses.`
        );
      }

      // Load static randomness account from env
      const env = loadEnvLocal();
      const randomnessAccountStr = env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT;
      if (!randomnessAccountStr) {
        throw new Error(
          `Missing NEXT_PUBLIC_RANDOMNESS_ACCOUNT in .env.local. Please run 'npm run ${isDevnet ? "devnet" : "localnet"} init' first.`
        );
      }

      console.log(`Pool Details:
  Current Draw Cycle ID: ${poolState.currentDrawCycleId}
  Ticket Registry: ${poolState.ticketRegistry}
  PST Mint: ${pstMintStr}
  Huma Pool State: ${humaPoolStateStr}
  Randomness Account: ${randomnessAccountStr}
`);

      const ix = await buildHarvestYieldAndCommitInstruction({
        crank: signer!.address,
        poolId,
        ticketRegistry: address(poolState.ticketRegistry),
        currentDrawCycleId: poolState.currentDrawCycleId,
        pstMint: address(pstMintStr),
        humaPoolState: address(humaPoolStateStr),
        randomnessAccount: address(randomnessAccountStr),
      });

      await sendTx(rpc, ix, signer!);
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

      // ─── Verification & Batch Preparation ───
      const registryAddr = poolState.ticketRegistry;
      const registryAcc = await rpc
        .getAccountInfo(address(registryAddr), { encoding: "base64" })
        .send();
      if (!registryAcc || !registryAcc.value) {
        throw new Error(`Ticket registry at ${registryAddr} not found.`);
      }
      let registryBytes = new Uint8Array(
        base64Encoder.encode(registryAcc.value.data[0])
      );
      let registryState = parseTicketRegistry(registryBytes);

      let cycleId = poolState.currentDrawCycleId - 1;
      if (options["--cycle"]) {
        cycleId = parseInt(options["--cycle"], 10);
      } else if (positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) {
          cycleId = val;
        }
      }

      if (registryState.drawPreparedUpTo < registryState.userCount) {
        console.log(
          `Draw preparation incomplete (${registryState.drawPreparedUpTo}/${registryState.userCount}). Starting automatic batched preparation...`
        );
        const batchSize = 1000;
        while (registryState.drawPreparedUpTo < registryState.userCount) {
          console.log(
            `Sending prepare_draw batch starting at index ${registryState.drawPreparedUpTo}...`
          );
          const prepIx = await buildPrepareDrawInstruction({
            crank: signer!.address,
            poolId,
            currentDrawCycleId: cycleId,
            ticketRegistry: address(registryAddr),
            batchSize,
          });
          await sendTx(rpc, prepIx, signer!);

          // Refetch registry state
          const updatedRegistryAcc = await rpc
            .getAccountInfo(address(registryAddr), { encoding: "base64" })
            .send();
          registryBytes = new Uint8Array(
            base64Encoder.encode(updatedRegistryAcc!.value!.data[0])
          );
          registryState = parseTicketRegistry(registryBytes);
          console.log(
            `Progress: Prepared ${registryState.drawPreparedUpTo}/${registryState.userCount} users.`
          );
        }
        console.log("Automatic draw preparation completed.");
      }

      // Parse seed option or generate random
      let seed = crypto.randomBytes(32);
      const seedHex = options["--seed"];
      if (seedHex) {
        if (seedHex.length !== 64) {
          throw new Error("Seed must be a 64-character (32-byte) hex string.");
        }
        seed = Buffer.from(seedHex, "hex");
      }

      if (cycleId < 0) {
        throw new Error(
          `Invalid Draw Cycle ID: ${cycleId}. No draw cycle has been created yet.`
        );
      }

      console.log(`Using Random Seed (hex): ${seed.toString("hex")}`);
      console.log(`Targeting Draw Cycle ID: ${cycleId}`);

      // Query the DrawCycle account to extract the locked randomnessAccount
      const drawCyclePda = await findDrawCyclePda(poolId, cycleId);
      const drawCycleAcc = await rpc
        .getAccountInfo(drawCyclePda, { encoding: "base64" })
        .send();
      if (!drawCycleAcc || !drawCycleAcc.value) {
        throw new Error(
          `Draw Cycle account for ID ${cycleId} not found on-chain.`
        );
      }
      const drawCycleBytes = new Uint8Array(
        base64Encoder.encode(drawCycleAcc.value.data[0])
      );
      const drawCycleState = parseDrawCycle(drawCycleBytes);
      const randomnessAccountStr = drawCycleState.randomnessAccount;
      console.log(
        `Extracted locked randomness account: ${randomnessAccountStr}`
      );

      const ix = await buildRevealAndPickWinnersInstruction({
        crank: signer!.address,
        poolId,
        currentDrawCycleId: cycleId,
        ticketRegistry: address(poolState.ticketRegistry),
        randomnessAccount: address(randomnessAccountStr),
      });

      // Inject mock resolved randomness if on localnet
      const isLocalnet =
        rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost");
      if (isLocalnet) {
        console.log("Localnet detected. Injecting mock resolved randomness...");

        const currentSlot = await rpc.getSlot().send();
        console.log(`Current slot: ${currentSlot}`);

        const buffer = new Uint8Array(408);
        const view = new DataView(buffer.buffer);

        // Copy discriminator
        const discriminator = [10, 66, 229, 135, 220, 239, 217, 114];
        buffer.set(discriminator, 0);

        // Set resolved value/seed at offset 152
        buffer.set(new Uint8Array(seed), 152);

        const sbProgramId =
          process.env.SB_ENV === "devnet"
            ? "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
            : "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv";

        // Build and sign the transaction message first to minimize latency
        const { value: latestBlockhash } = await rpc
          .getLatestBlockhash()
          .send();
        const message = setTransactionMessageLifetimeUsingBlockhash(
          latestBlockhash,
          setTransactionMessageFeePayerSigner(
            signer!,
            appendTransactionMessageInstruction(
              ix,
              createTransactionMessage({ version: 0 })
            )
          )
        );
        const signedTx = await signTransactionMessageWithSigners(message);
        const wireTx = getBase64EncodedWireTransaction(signedTx);

        // Attempt resolving using different slot offsets.
        // We try:
        // Offset +1: The expected next slot where the transaction executes (most common)
        // Offset +2: In case block production is slightly delayed
        // Offset 0: In case the slot hasn't progressed
        // Offset +3: In case of further delay
        const offsets = [1n, 2n, 0n, 3n];
        let confirmed = false;
        let lastError: Error | null = null;

        for (const offset of offsets) {
          const targetSlot = currentSlot + offset;
          console.log(
            `Attempting with reveal_slot offset +${offset} (target slot: ${targetSlot})...`
          );

          // Set seed_slot and reveal_slot to targetSlot
          view.setBigUint64(104, targetSlot, true);
          view.setBigUint64(144, targetSlot, true);

          const dataHex = Buffer.from(buffer).toString("hex");

          await setAccount(
            rpcUrl,
            randomnessAccountStr,
            1_000_000_000,
            dataHex,
            sbProgramId,
            false
          );

          try {
            // Send transaction bypassing preflight check (which would run at simulation slot != reveal_slot)
            const signature = await rpc
              .sendTransaction(wireTx, {
                encoding: "base64",
                skipPreflight: true,
              })
              .send();

            console.log(
              `Transaction sent: ${signature}. Checking confirmation status...`
            );

            // Check signature status for confirmation
            let txSuccess = false;
            for (let i = 0; i < 15; i++) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              const status = await rpc.getSignatureStatuses([signature]).send();
              if (status && status.value && status.value[0]) {
                const err = status.value[0].err;
                if (err) {
                  throw new Error(`Transaction failed: ${JSON.stringify(err)}`);
                }
                txSuccess = true;
                break;
              }
            }

            if (txSuccess) {
              console.log("Transaction confirmed successfully!");
              confirmed = true;
              break;
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`Attempt with offset +${offset} failed: ${msg}`);
            lastError = err instanceof Error ? err : new Error(msg);

            // If the failure was not a randomness resolution issue (e.g. 0x178d or 0x178e/0x1790 etc),
            // then retrying with different slots won't help. We should abort immediately.
            if (
              !msg.includes("178d") &&
              !msg.includes("178e") &&
              !msg.includes("1790") &&
              !msg.includes("SwitchboardRandomnessTooOld")
            ) {
              throw err;
            }
          }
        }

        if (!confirmed) {
          throw (
            lastError ||
            new Error(
              "Failed to confirm reveal transaction after all slot offset attempts."
            )
          );
        }
      } else {
        await sendTx(rpc, ix, signer!);
      }
      break;
    }

    case "prepare-draw": {
      const batchSize = parseInt(options["--batch-size"] || "1000", 10);
      if (isNaN(batchSize) || batchSize <= 0) {
        throw new Error("Batch size must be a positive integer.");
      }

      console.log(
        `Preparing draw for pool ${poolId} with batch size ${batchSize}...`
      );

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

      const registryAddr = poolState.ticketRegistry;
      console.log(`Registry address: ${registryAddr}`);

      let registryAcc = await rpc
        .getAccountInfo(address(registryAddr), { encoding: "base64" })
        .send();
      if (!registryAcc || !registryAcc.value) {
        throw new Error(`Ticket registry at ${registryAddr} not found.`);
      }
      let registryBytes = new Uint8Array(
        base64Encoder.encode(registryAcc.value.data[0])
      );
      let registryState = parseTicketRegistry(registryBytes);

      console.log(
        `Current state: Prepared ${registryState.drawPreparedUpTo}/${registryState.userCount} users.`
      );

      if (registryState.drawPreparedUpTo >= registryState.userCount) {
        console.log("Draw preparation is already complete.");
        break;
      }

      let cycleId = poolState.currentDrawCycleId - 1;
      if (options["--cycle"]) {
        cycleId = parseInt(options["--cycle"], 10);
      }

      while (registryState.drawPreparedUpTo < registryState.userCount) {
        console.log(
          `Sending batch transaction for entries ${registryState.drawPreparedUpTo} to ${Math.min(
            registryState.drawPreparedUpTo + batchSize,
            registryState.userCount
          )}...`
        );

        const ix = await buildPrepareDrawInstruction({
          crank: signer!.address,
          poolId,
          currentDrawCycleId: cycleId,
          ticketRegistry: address(registryAddr),
          batchSize,
        });

        await sendTx(rpc, ix, signer!);

        // Fetch updated status
        registryAcc = await rpc
          .getAccountInfo(address(registryAddr), { encoding: "base64" })
          .send();
        if (!registryAcc || !registryAcc.value) {
          throw new Error(`Ticket registry not found after transaction.`);
        }
        registryBytes = new Uint8Array(
          base64Encoder.encode(registryAcc.value.data[0])
        );
        registryState = parseTicketRegistry(registryBytes);
        console.log(
          `Progress: Prepared ${registryState.drawPreparedUpTo}/${registryState.userCount} users.`
        );
      }

      console.log("Draw preparation completed successfully.");
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
      const poolVault = await findPoolVaultPda(targetPoolId);
      const poolPstVault = await findPoolPstVaultPda(targetPoolId);

      console.log(`Prize Pool ${targetPoolId}:
  Token Mint: ${state.tokenMint}
  Pool Vault (PDA / Token Account): ${poolVault}
  Pool PST Vault (PDA / Token Account): ${poolPstVault}
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
  Total Prizes Allocated: ${formatAmount(state.totalPrizesAllocated)}
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
  Randomness Account: ${state.randomnessAccount}
  Harvest Slot: ${state.harvestSlot.toString()}
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
          await sendTx(rpc, ix, signer!);

          // Brief delay between batch checks
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      console.log("Reinvestment process completed successfully!");
      break;
    }

    case "query-winnings": {
      const userOption = options["--user"] || positionals[0];

      if (userOption) {
        // Query specific user winnings account
        const userWinningsPda = await findUserWinningsPda(poolId, userOption);
        console.log(
          `Querying User Winnings for User ${userOption} at ${userWinningsPda}...`
        );

        const account = await rpc
          .getAccountInfo(userWinningsPda, { encoding: "base64" })
          .send();

        if (!account || !account.value) {
          console.log(
            `No UserWinnings account found for user ${userOption} in pool ${poolId}.`
          );
          break;
        }

        const bytes = new Uint8Array(
          base64Encoder.encode(account.value.data[0])
        );
        const state = parseUserWinnings(bytes);

        console.log(`User Winnings details:
  Pool ID: ${state.poolId}
  User: ${state.user}
  PDA: ${userWinningsPda}
  Unclaimed Non-Reinvested Winnings: ${formatAmount(state.unclaimedNonReinvestedWinnings)}
  Total Claimed: ${formatAmount(state.totalClaimed)}
  Total Reinvested: ${formatAmount(state.totalReinvested)}
  Bump: ${state.bump}
`);
      } else {
        // List all user winnings in the pool
        console.log(
          `Fetching all User Winnings accounts for Pool ${poolId}...`
        );
        const base58Decoder = getBase58Decoder();
        const poolIdBase58 = base58Decoder.decode(encodeU32(poolId));

        const filters = [
          { dataSize: 73n },
          {
            memcmp: {
              offset: 8n,
              bytes: poolIdBase58 as Base58EncodedBytes,
              encoding: "base58" as const,
            },
          },
        ];

        const accounts = await rpc
          .getProgramAccounts(PROGRAM_ID, {
            filters,
            encoding: "base64",
          })
          .send();

        console.log(
          `Listing User Winnings for Pool ${poolId} (${accounts.length} found):`
        );
        accounts.forEach((acc) => {
          const bytes = new Uint8Array(
            base64Encoder.encode(acc.account.data[0])
          );
          const state = parseUserWinnings(bytes);
          console.log(`  User: ${state.user}`);
          console.log(`    PDA: ${acc.pubkey}`);
          console.log(
            `    Unclaimed Non-Reinvested Winnings: ${formatAmount(state.unclaimedNonReinvestedWinnings)}`
          );
          console.log(`    Total Claimed: ${formatAmount(state.totalClaimed)}`);
          console.log(
            `    Total Reinvested: ${formatAmount(state.totalReinvested)}`
          );
          console.log(`    Bump: ${state.bump}`);
          console.log("");
        });
      }
      break;
    }

    case "query-redemption": {
      const redemptionIdOption = positionals[0];
      const userOption = options["--user"];

      if (redemptionIdOption) {
        // Query specific pending redemption account
        const redemptionId = BigInt(redemptionIdOption);
        const redemptionPda = await findPendingRedemptionPda(
          poolId,
          redemptionId
        );
        console.log(
          `Querying Pending Redemption ID ${redemptionId} for Pool ${poolId} at ${redemptionPda}...`
        );

        const account = await rpc
          .getAccountInfo(redemptionPda, { encoding: "base64" })
          .send();

        if (!account || !account.value) {
          console.log(
            `No PendingRedemption account found for ID ${redemptionId} in pool ${poolId}.`
          );
          break;
        }

        const bytes = new Uint8Array(
          base64Encoder.encode(account.value.data[0])
        );
        const state = parsePendingRedemption(bytes);

        console.log(`Pending Redemption details:
  Pool ID: ${state.poolId}
  Redemption ID: ${state.redemptionId.toString()}
  PDA: ${redemptionPda}
  User/Beneficiary: ${state.user}
  Amount (USD/USDC): ${formatAmount(state.amount)}
  PST Shares Locked: ${formatAmount(state.pstSharesLocked)}
  Requested At: ${new Date(Number(state.requestedAt) * 1000).toLocaleString()}
  Huma Request ID: ${state.humaRequestId.toString()}
  Bump: ${state.bump}
`);
      } else {
        // List pending redemptions (optionally filtered by user)
        console.log(
          `Fetching Pending Redemptions for Pool ${poolId}${userOption ? ` filtered by User: ${userOption}` : ""}...`
        );
        const base58Decoder = getBase58Decoder();
        const poolIdBase58 = base58Decoder.decode(encodeU32(poolId));

        const filters = [
          { dataSize: 93n },
          {
            memcmp: {
              offset: 8n,
              bytes: poolIdBase58 as Base58EncodedBytes,
              encoding: "base58" as const,
            },
          },
        ];

        if (userOption) {
          filters.push({
            memcmp: {
              offset: 20n,
              bytes: userOption as Base58EncodedBytes,
              encoding: "base58" as const,
            },
          });
        }

        const accounts = await rpc
          .getProgramAccounts(PROGRAM_ID, {
            filters,
            encoding: "base64",
          })
          .send();

        const parsedRedemptions = accounts.map((acc) => {
          const bytes = new Uint8Array(
            base64Encoder.encode(acc.account.data[0])
          );
          const state = parsePendingRedemption(bytes);
          return { pubkey: acc.pubkey, state };
        });

        // Sort by redemptionId ascending
        parsedRedemptions.sort((a, b) => {
          if (a.state.redemptionId < b.state.redemptionId) return -1;
          if (a.state.redemptionId > b.state.redemptionId) return 1;
          return 0;
        });

        console.log(
          `Listing Pending Redemptions for Pool ${poolId}${userOption ? ` (filtered by User: ${userOption})` : ""} (${parsedRedemptions.length} found):`
        );
        parsedRedemptions.forEach(({ pubkey, state }) => {
          console.log(`  Redemption ID: ${state.redemptionId.toString()}`);
          console.log(`    PDA: ${pubkey}`);
          console.log(`    User/Beneficiary: ${state.user}`);
          console.log(`    Amount (USD/USDC): ${formatAmount(state.amount)}`);
          console.log(
            `    PST Shares Locked: ${formatAmount(state.pstSharesLocked)}`
          );
          console.log(
            `    Requested At: ${new Date(Number(state.requestedAt) * 1000).toLocaleString()}`
          );
          console.log(`    Huma Request ID: ${state.humaRequestId.toString()}`);
          console.log(`    Bump: ${state.bump}`);
          console.log("");
        });
      }
      break;
    }

    case "query-registry": {
      const userOption = options["--user"] || positionals[0];
      if (userOption) {
        try {
          address(userOption);
        } catch {
          throw new Error(`Invalid user public key address: "${userOption}"`);
        }
      }

      // Fetch PrizePool to get ticketRegistry PDA
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

      const registryAddr = poolState.ticketRegistry;
      console.log(
        `Fetching Ticket Registry for Pool ${poolId} at ${registryAddr}...`
      );

      const registryAcc = await rpc
        .getAccountInfo(address(registryAddr), { encoding: "base64" })
        .send();

      if (!registryAcc || !registryAcc.value) {
        throw new Error(
          `TicketRegistry account at ${registryAddr} not found on-chain.`
        );
      }

      const registryBytes = new Uint8Array(
        base64Encoder.encode(registryAcc.value.data[0])
      );
      const registryState = parseTicketRegistry(registryBytes);

      if (userOption) {
        const target = address(userOption);
        const entry = registryState.entries.find((e) => e.owner === target);

        console.log(`
Ticket Registry for Pool ${poolId} (Filtered by User: ${target})
  Registry Address: ${registryAddr}
  Capacity (Max Users): ${registryState.capacity}
  User Count: ${registryState.userCount}
  Total Active Tickets: ${registryState.totalActiveTickets}
  Total Pending Tickets: ${registryState.totalPendingTickets}
  Draw Cycle ID: ${registryState.drawCycleId}
  Draw Prepared Up To: ${registryState.drawPreparedUpTo}
`);

        if (entry) {
          const isStale = entry.mergedThroughCycle < registryState.drawCycleId;
          const activeVal = isStale
            ? entry.active + entry.pending
            : entry.active;
          const pendingVal = isStale ? 0 : entry.pending;
          console.log(`User Entry Details:
  Owner: ${entry.owner}
  Active Tickets: ${activeVal} ${isStale ? `(Lazy-merged: ${entry.active} + ${entry.pending} pending)` : ""}
  Pending Tickets: ${pendingVal}
  Merged Cycle: ${entry.mergedThroughCycle}
  Cumulative Active (Prefix Sum): ${entry.cumulativeActive}
`);
        } else {
          console.log("  No registry entry found for this user address.");
        }
      } else {
        console.log(`
Ticket Registry for Pool ${poolId}
  Registry Address: ${registryAddr}
  Capacity (Max Users): ${registryState.capacity}
  Active User Entries: ${registryState.userCount}
  Total Active Tickets: ${registryState.totalActiveTickets}
  Total Pending Tickets: ${registryState.totalPendingTickets}
  Draw Cycle ID: ${registryState.drawCycleId}
  Draw Prepared Up To: ${registryState.drawPreparedUpTo}
`);

        console.log("Registered User Entries:");
        if (registryState.entries.length === 0) {
          console.log("  No registered users found.");
        } else {
          console.table(
            registryState.entries.map((e, index) => {
              const isStale = e.mergedThroughCycle < registryState.drawCycleId;
              return {
                Index: index,
                Owner: e.owner.slice(0, 8) + "...",
                Active: isStale ? e.active + e.pending : e.active,
                Pending: isStale ? 0 : e.pending,
                "Merged Cycle": e.mergedThroughCycle,
                "Cumulative Active": e.cumulativeActive,
                Stale: isStale ? "YES (will merge)" : "NO",
              };
            })
          );
        }
      }
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
