/**
 * Squads V4 Multisig CLI Middleware & Subcommand Handlers.
 *
 * Provides execution pipeline middleware for pb-cli admin commands and
 * isolated implementations for all Squads V4 governance subcommands.
 */

import {
  Address,
  address,
  Instruction,
  KeyPairSigner,
  getBase64Decoder,
  getBase58Encoder,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getBase64EncodedWireTransaction,
  AccountRole,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import {
  findMultisigPda,
  findMultisigVaultPda,
  findVaultTransactionPda,
  findProposalPda,
  parseMultisigAccount,
  parseProposalAccount,
  parseVaultTransactionAccount,
  isMultisigMember,
  isProposalExecutable,
  buildAtomicProposeInstructions,
  buildProposalApproveInstruction,
  buildProposalRejectInstruction,
  buildProposalCancelInstruction,
  buildVaultTransactionCloseInstruction,
  buildVaultTransactionExecuteInstruction,
  exportSquadsTransactionJson,
  createNoopSigner,
  SQUADS_PROGRAM_ADDRESS,
} from "../app/lib/squads-sdk";
import { sendTx, safeStringify, printErrorDetails, readEnvFile } from "./utils";
import { SolanaRpc } from "../app/lib/bonds-sdk";

// ─── Execution Mode Discriminated Union ────────────────────────────────────────

export type AdminExecutionMode =
  | { kind: "direct" }
  | {
      kind: "propose";
      multisig: Address;
      vaultIndex: number;
      autoApprove: boolean;
    }
  | { kind: "export"; multisig: Address; vaultIndex: number }
  | { kind: "dry-run"; multisig?: Address; vaultIndex: number };

export interface RawMultisigCliFlags {
  multisig?: string;
  vaultIndex?: string | number;
  propose?: boolean;
  exportIx?: boolean;
  dryRun?: boolean;
  noAutoApprove?: boolean;
  cuLimit?: string | number;
}

/**
 * Resolves fallback multisig address from environment or deployed state files.
 */
export function resolveFallbackMultisigAddress(): Address | undefined {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const env = readEnvFile(envPath);
    if (env.SQUADS_MULTISIG_ADDRESS) {
      return address(env.SQUADS_MULTISIG_ADDRESS);
    }
  }

  for (const stateDir of ["devnet-state", "localnet-state"]) {
    const addrFile = path.resolve(__dirname, stateDir, "addresses.json");
    if (fs.existsSync(addrFile)) {
      try {
        const json = JSON.parse(fs.readFileSync(addrFile, "utf-8"));
        if (json.squadsMultisig) {
          return address(json.squadsMultisig);
        }
      } catch {
        // Ignored
      }
    }
  }

  return undefined;
}

/**
 * Parses and validates raw CLI flags into a strictly typed AdminExecutionMode.
 */
export function resolveAdminExecutionMode(
  flags: RawMultisigCliFlags,
  fallbackMultisig?: Address
): AdminExecutionMode {
  const activeModes = [
    flags.propose ? "--propose" : null,
    flags.exportIx ? "--export-ix" : null,
    flags.dryRun ? "--dry-run" : null,
  ].filter(Boolean);

  if (activeModes.length > 1) {
    throw new Error(
      `Conflicting execution flags passed: ${activeModes.join(", ")}. Please specify only one of --propose, --export-ix, or --dry-run.`
    );
  }

  const vaultIndex =
    flags.vaultIndex !== undefined ? Number(flags.vaultIndex) : 0;
  if (
    isNaN(vaultIndex) ||
    vaultIndex < 0 ||
    vaultIndex > 255 ||
    !Number.isInteger(vaultIndex)
  ) {
    throw new Error(
      `Invalid --vault-index: ${flags.vaultIndex}. Must be an integer between 0 and 255.`
    );
  }

  const fallback = fallbackMultisig || resolveFallbackMultisigAddress();
  const multisigAddress = flags.multisig ? address(flags.multisig) : fallback;

  if (flags.exportIx) {
    if (!multisigAddress) {
      throw new Error(
        `--multisig address is required for --export-ix (or set SQUADS_MULTISIG_ADDRESS).`
      );
    }
    return { kind: "export", multisig: multisigAddress, vaultIndex };
  }

  if (flags.propose) {
    if (!multisigAddress) {
      throw new Error(
        `--multisig address is required for --propose (or set SQUADS_MULTISIG_ADDRESS).`
      );
    }
    return {
      kind: "propose",
      multisig: multisigAddress,
      vaultIndex,
      autoApprove: !flags.noAutoApprove,
    };
  }

  if (flags.dryRun) {
    return { kind: "dry-run", multisig: multisigAddress, vaultIndex };
  }

  return { kind: "direct" };
}

// ─── Pipeline Middleware ──────────────────────────────────────────────────────

export type AdminInstructionBuilder = (
  authority: Address
) => Promise<Instruction | Instruction[]>;

export interface AdminDispatchParams {
  rpc: SolanaRpc;
  signer: KeyPairSigner;
  expectedAdmin: Address;
  builder: AdminInstructionBuilder;
  mode: AdminExecutionMode;
  commandName: string;
  preflightCheck?: (context: {
    rpc: SolanaRpc;
    effectiveAuthority: Address;
    mode: AdminExecutionMode;
  }) => Promise<void>;
}

/**
 * Fetches account data from Solana RPC.
 */
export async function fetchAccountData(
  rpc: SolanaRpc,
  accountAddress: Address
): Promise<Uint8Array | null> {
  const res = await rpc
    .getAccountInfo(accountAddress, { encoding: "base64" })
    .send();
  if (!res || !res.value || !res.value.data) {
    return null;
  }
  const base64Data = res.value.data[0];
  const decoder = getBase64Decoder();
  return decoder.decode(base64Data);
}

/**
 * Reads cluster timestamp from Solana RPC sysvar clock or slot time.
 */
export async function getClusterTimestamp(rpc: SolanaRpc): Promise<bigint> {
  try {
    const slot = await rpc.getSlot().send();
    const blockTime = await rpc.getBlockTime(slot).send();
    if (blockTime !== null && blockTime !== undefined) {
      return BigInt(blockTime);
    }
  } catch {
    // Fallback
  }
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * Unified dispatch middleware routing admin instructions according to ExecutionMode.
 */
export async function dispatchAdminInstruction(
  params: AdminDispatchParams
): Promise<void> {
  const {
    rpc,
    signer,
    expectedAdmin,
    builder,
    mode,
    commandName,
    preflightCheck,
  } = params;

  let effectiveAuthority: Address;
  if (mode.kind === "direct") {
    effectiveAuthority = signer.address;
    if (effectiveAuthority !== expectedAdmin) {
      throw new Error(
        `Direct signer ${effectiveAuthority} does not match expected on-chain authority ${expectedAdmin}.`
      );
    }
  } else if (mode.kind === "propose" || mode.kind === "export") {
    effectiveAuthority = await findMultisigVaultPda(
      mode.multisig,
      mode.vaultIndex
    );
    if (effectiveAuthority !== expectedAdmin) {
      throw new Error(
        `Squads Vault PDA ${effectiveAuthority} (index ${mode.vaultIndex}) does not match expected on-chain authority ${expectedAdmin}.`
      );
    }
  } else {
    // dry-run
    effectiveAuthority = mode.multisig
      ? await findMultisigVaultPda(mode.multisig, mode.vaultIndex)
      : signer.address;
  }

  // Preflight validation hook
  if (preflightCheck) {
    await preflightCheck({ rpc, effectiveAuthority, mode });
  }

  switch (mode.kind) {
    case "direct": {
      console.log(
        `[Direct Mode] Executing '${commandName}' signed by hot authority ${signer.address}...`
      );
      const ixs = await builder(effectiveAuthority);
      const instructionList = Array.isArray(ixs) ? ixs : [ixs];
      const sig = await sendTx(rpc, instructionList, signer);
      console.log(
        `✓ '${commandName}' executed successfully in Direct Mode! Tx: ${sig}`
      );
      break;
    }

    case "propose": {
      console.log(
        `[Proposal Mode] Proposing '${commandName}' to Squads V4 Multisig: ${mode.multisig}...`
      );

      // 1. Fetch multisig account to verify member and get current transaction index
      const multisigData = await fetchAccountData(rpc, mode.multisig);
      if (!multisigData) {
        throw new Error(
          `Squads Multisig account not found at ${mode.multisig}.`
        );
      }
      const multisig = parseMultisigAccount(multisigData, mode.multisig);

      if (!isMultisigMember(multisig, signer.address)) {
        throw new Error(
          `Signer ${signer.address} is not an authorized member of Squads multisig ${mode.multisig}.`
        );
      }

      // Check vault balance for state-allocating operations
      const vaultData = await rpc.getAccountInfo(effectiveAuthority).send();
      const vaultLamports = vaultData?.value?.lamports ?? 0n;
      if (vaultLamports < 50_000_000n) {
        console.warn(
          `[WARNING] Vault PDA (${effectiveAuthority}) balance is ${
            Number(vaultLamports) / 1e9
          } SOL. Recommended minimum is >= 0.05 SOL to cover account rent creation.`
        );
      }

      const nextTxIndex = multisig.transactionIndex + 1n;
      console.log(
        `Creating Vault Transaction #${nextTxIndex} for Vault Index ${mode.vaultIndex} (${effectiveAuthority})...`
      );

      // 2. Build inner instructions using the Vault PDA as authority
      const innerIxs = await builder(effectiveAuthority);
      const innerInstructions = Array.isArray(innerIxs) ? innerIxs : [innerIxs];

      // 3. Compile atomic proposal with wire size calculation
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
      const proposeResult = await buildAtomicProposeInstructions({
        multisig: mode.multisig,
        signer,
        transactionIndex: nextTxIndex,
        vaultIndex: mode.vaultIndex,
        innerInstructions,
        autoApprove: mode.autoApprove,
        memo: `pb-cli: ${commandName}`,
        recentBlockhash: latestBlockhash.blockhash,
      });

      if (proposeResult.isSingleTransaction) {
        console.log(
          `Submitting atomic proposal (Wire length: ${proposeResult.estimatedWireLength} B)...`
        );
        const sig = await sendTx(rpc, proposeResult.tx1Instructions, signer);
        console.log(
          `✓ Proposal #${nextTxIndex} created and approved atomically! Tx: ${sig}`
        );
      } else {
        console.log(
          `Proposal wire size (${proposeResult.estimatedWireLength} B) exceeds 1100 B limit. Submitting via 2-phase split...`
        );
        const sig1 = await sendTx(rpc, proposeResult.tx1Instructions, signer);
        console.log(`✓ Phase 1: Proposal #${nextTxIndex} created. Tx: ${sig1}`);

        if (proposeResult.tx2Instructions) {
          try {
            const sig2 = await sendTx(
              rpc,
              proposeResult.tx2Instructions,
              signer
            );
            console.log(
              `✓ Phase 2: Proposal #${nextTxIndex} approved. Tx: ${sig2}`
            );
          } catch (approveErr) {
            console.warn(
              `⚠️ Proposal was created successfully at index #${nextTxIndex}, but auto-approval failed: ${approveErr}. You can approve it using 'pb-cli squads-approve --multisig ${mode.multisig} --index ${nextTxIndex}'.`
            );
          }
        }
      }

      console.log("\n=======================================================");
      console.log("             SQUADS V4 PROPOSAL CREATED               ");
      console.log("=======================================================");
      console.log(`Multisig:          ${mode.multisig}`);
      console.log(`Transaction Index: #${nextTxIndex}`);
      console.log(`Proposal PDA:      ${proposeResult.proposalPda}`);
      console.log(`Transaction PDA:   ${proposeResult.transactionPda}`);
      console.log(
        `Squads UI URL:     https://app.squads.so/multisig/${mode.multisig}/proposals/${nextTxIndex}`
      );
      console.log("=======================================================\n");
      break;
    }

    case "export": {
      console.log(
        `[Export Mode] Generating Squads UI JSON payload for '${commandName}'...`
      );
      const ixs = await builder(effectiveAuthority);
      const innerInstructions = Array.isArray(ixs) ? ixs : [ixs];
      const payload = exportSquadsTransactionJson(
        innerInstructions,
        mode.multisig,
        mode.vaultIndex
      );

      console.log("\n=======================================================");
      console.log("           SQUADS INSTRUCTION EXPORT JSON              ");
      console.log("=======================================================");
      console.log(safeStringify(payload, 2));
      console.log("=======================================================\n");
      break;
    }

    case "dry-run": {
      console.log(
        `[Dry-Run Mode] Simulating transaction for '${commandName}'...`
      );
      const ixs = await builder(effectiveAuthority);
      const innerInstructions = Array.isArray(ixs) ? ixs : [ixs];

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
      let msg = createTransactionMessage({ version: 0 });
      msg = setTransactionMessageFeePayerSigner(signer, msg);
      msg = setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg);
      msg = appendTransactionMessageInstructions(innerInstructions, msg);

      const compiled = compileTransaction(msg);
      const base64Wire = getBase64EncodedWireTransaction(compiled);

      const simRes = await rpc
        .simulateTransaction(base64Wire, {
          encoding: "base64",
          sigVerify: false,
        })
        .send();

      console.log("\n--- Simulation Result ---");
      if (simRes.value.err) {
        console.error(`Simulation Error:`, safeStringify(simRes.value.err, 2));
      } else {
        console.log(
          `Simulation succeeded! CUs Consumed: ${simRes.value.unitsConsumed ?? "N/A"}`
        );
      }
      if (simRes.value.logs) {
        console.log("\n--- Simulation Logs ---");
        simRes.value.logs.forEach((l: string) => console.log(`  ${l}`));
      }
      break;
    }
  }
}

// ─── Compute Unit Instruction Helper ─────────────────────────────────────────

export function buildSetComputeUnitLimitInstruction(
  units: number
): Instruction {
  const COMPUTE_BUDGET_PROGRAM = address(
    "ComputeBudget111111111111111111111111111111"
  );
  const data = new Uint8Array(5);
  data[0] = 2; // SetComputeUnitLimit discriminator
  new DataView(data.buffer).setUint32(1, units, true);
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    accounts: [],
    data,
  };
}

// ─── Squads Subcommand Handlers ───────────────────────────────────────────────

export interface ExecuteSquadsStatusParams {
  rpc: SolanaRpc;
  multisig: Address;
}

/**
 * Handles `squads-status` command.
 */
export async function executeSquadsStatus(
  params: ExecuteSquadsStatusParams
): Promise<void> {
  const { rpc, multisig } = params;
  console.log(`Fetching Squads V4 Multisig status for ${multisig}...`);

  const data = await fetchAccountData(rpc, multisig);
  if (!data) {
    throw new Error(`Squads Multisig account not found at ${multisig}.`);
  }

  const ms = parseMultisigAccount(data, multisig);
  const vault0 = await findMultisigVaultPda(multisig, 0);

  console.log("\n=======================================================");
  console.log("               SQUADS V4 MULTISIG STATUS               ");
  console.log("=======================================================");
  console.log(`Address:               ${ms.address}`);
  console.log(`Create Key:            ${ms.createKey}`);
  console.log(`Config Authority:      ${ms.configAuthority}`);
  console.log(`Threshold:             ${ms.threshold} / ${ms.members.length}`);
  console.log(`Timelock:              ${ms.timeLock} seconds`);
  console.log(`Transaction Index:     #${ms.transactionIndex}`);
  console.log(`Stale Tx Index:        #${ms.staleTransactionIndex}`);
  console.log(`Rent Collector:        ${ms.rentCollector ?? "None (Creator)"}`);
  console.log(`Default Vault (idx 0): ${vault0}`);
  console.log("\nMembers:");
  ms.members.forEach((m, i) => {
    console.log(
      `  ${i + 1}. ${m.key} (permissions: 0x${m.permissions.toString(16)})`
    );
  });
  console.log("=======================================================\n");
}

export interface ExecuteSquadsProposalsParams {
  rpc: SolanaRpc;
  multisig: Address;
  limit?: number;
}

/**
 * Handles `squads-proposals` command.
 */
export async function executeSquadsProposals(
  params: ExecuteSquadsProposalsParams
): Promise<void> {
  const { rpc, multisig, limit = 10 } = params;
  console.log(`Fetching proposal history for Multisig ${multisig}...`);

  const msData = await fetchAccountData(rpc, multisig);
  if (!msData) {
    throw new Error(`Squads Multisig account not found at ${multisig}.`);
  }
  const ms = parseMultisigAccount(msData, multisig);

  if (ms.transactionIndex === 0n) {
    console.log("No proposals found for this multisig.");
    return;
  }

  const start = ms.transactionIndex;
  const count = Number(start > BigInt(limit) ? BigInt(limit) : start);

  console.log(
    `\nListing recent ${count} proposals (up to #${ms.transactionIndex}):\n`
  );
  console.log("Index | Status    | Approvals | Approved At           | PDA");
  console.log(
    "------|-----------|-----------|-----------------------|---------------------------------------------"
  );

  for (let i = 0; i < count; i++) {
    const txIndex = start - BigInt(i);
    const proposalPda = await findProposalPda(multisig, txIndex);
    const pData = await fetchAccountData(rpc, proposalPda);

    if (!pData) {
      console.log(`${String(txIndex).padStart(5)} | [NOT FOUND]`);
      continue;
    }

    try {
      const prop = parseProposalAccount(pData, proposalPda);
      const isStale = prop.transactionIndex <= ms.staleTransactionIndex;
      const statusLabel = isStale ? `${prop.status} [STALE]` : prop.status;
      const approvedAtStr = prop.approvedTimestamp
        ? new Date(Number(prop.approvedTimestamp) * 1000).toISOString()
        : "-";

      console.log(
        `${String(txIndex).padStart(5)} | ${statusLabel.padEnd(9)} | ${String(
          prop.approved.length
        ).padStart(
          2
        )}/${ms.threshold}     | ${approvedAtStr.padEnd(21)} | ${prop.address}`
      );
    } catch (e) {
      console.log(`${String(txIndex).padStart(5)} | [PARSE ERROR] ${e}`);
    }
  }
  console.log("");
}

export interface ExecuteSquadsInspectTxParams {
  rpc: SolanaRpc;
  multisig: Address;
  transactionIndex: bigint;
}

/**
 * Handles `squads-inspect-tx` command.
 */
export async function executeSquadsInspectTx(
  params: ExecuteSquadsInspectTxParams
): Promise<void> {
  const { rpc, multisig, transactionIndex } = params;
  const txPda = await findVaultTransactionPda(multisig, transactionIndex);
  const propPda = await findProposalPda(multisig, transactionIndex);

  console.log(
    `Inspecting Squads Transaction #${transactionIndex} (${txPda})...`
  );

  const txData = await fetchAccountData(rpc, txPda);
  if (!txData) {
    throw new Error(`VaultTransaction account not found at ${txPda}.`);
  }
  const tx = parseVaultTransactionAccount(txData, txPda);

  console.log("\n=======================================================");
  console.log(`      VAULT TRANSACTION #${transactionIndex} DETAILS   `);
  console.log("=======================================================");
  console.log(`Multisig:          ${tx.multisig}`);
  console.log(`Creator:           ${tx.creator}`);
  console.log(`Vault Index:       ${tx.vaultIndex}`);
  console.log(`Proposal PDA:      ${propPda}`);
  console.log(
    `Signers Count:     ${tx.message.numSigners} (${tx.message.numWritableSigners} writable)`
  );
  console.log(`Writable Non-Sign: ${tx.message.numWritableNonSigners}`);
  console.log("\nAccount Keys in Message:");
  tx.message.accountKeys.forEach((k, i) => {
    const isSigner = i < tx.message.numSigners;
    const isWritable =
      i < tx.message.numWritableSigners ||
      (i >= tx.message.numSigners &&
        i < tx.message.numSigners + tx.message.numWritableNonSigners);
    console.log(
      `  [${i}] ${k} (${isSigner ? "Signer" : "Non-Signer"}, ${isWritable ? "Writable" : "Readonly"})`
    );
  });

  console.log(`\nInstructions (${tx.message.instructions.length}):`);
  tx.message.instructions.forEach((ix, i) => {
    const progKey = tx.message.accountKeys[ix.programIdIndex];
    console.log(`  Ix #${i + 1}: Program ${progKey}`);
    console.log(
      `    Accounts: [${ix.accountIndexes.map((idx) => `${idx}:${tx.message.accountKeys[idx]}`).join(", ")}]`
    );
    console.log(`    Data Length: ${ix.data.length} bytes`);
  });
  console.log("=======================================================\n");
}

export interface ExecuteSquadsVoteParams {
  rpc: SolanaRpc;
  signer: KeyPairSigner;
  multisig: Address;
  transactionIndex: bigint;
  memo?: string;
}

/**
 * Handles `squads-approve` command.
 */
export async function executeSquadsApprove(
  params: ExecuteSquadsVoteParams
): Promise<void> {
  const { rpc, signer, multisig, transactionIndex, memo } = params;
  const proposalPda = await findProposalPda(multisig, transactionIndex);

  console.log(
    `Approving Proposal #${transactionIndex} on Multisig ${multisig} as ${signer.address}...`
  );
  const ix = buildProposalApproveInstruction({
    multisig,
    member: signer.address,
    proposalPda,
    memo,
  });

  const sig = await sendTx(rpc, ix, signer);
  console.log(
    `✓ Proposal #${transactionIndex} approved successfully! Tx: ${sig}`
  );
}

/**
 * Handles `squads-reject` command.
 */
export async function executeSquadsReject(
  params: ExecuteSquadsVoteParams
): Promise<void> {
  const { rpc, signer, multisig, transactionIndex, memo } = params;
  const proposalPda = await findProposalPda(multisig, transactionIndex);

  console.log(
    `Rejecting Proposal #${transactionIndex} on Multisig ${multisig} as ${signer.address}...`
  );
  const ix = buildProposalRejectInstruction({
    multisig,
    member: signer.address,
    proposalPda,
    memo,
  });

  const sig = await sendTx(rpc, ix, signer);
  console.log(`✓ Proposal #${transactionIndex} rejected! Tx: ${sig}`);
}

export interface ExecuteSquadsCancelParams {
  rpc: SolanaRpc;
  signer: KeyPairSigner;
  multisig: Address;
  transactionIndex: bigint;
  memo?: string;
}

/**
 * Handles `squads-cancel` command.
 */
export async function executeSquadsCancel(
  params: ExecuteSquadsCancelParams
): Promise<void> {
  const { rpc, signer, multisig, transactionIndex, memo } = params;
  const proposalPda = await findProposalPda(multisig, transactionIndex);

  console.log(
    `Cancelling Proposal #${transactionIndex} on Multisig ${multisig} as ${signer.address}...`
  );
  const ix = buildProposalCancelInstruction({
    multisig,
    member: signer.address,
    proposalPda,
    memo,
  });

  const sig = await sendTx(rpc, ix, signer);
  console.log(`✓ Proposal #${transactionIndex} cancelled! Tx: ${sig}`);
}

export interface ExecuteSquadsCloseParams {
  rpc: SolanaRpc;
  signer: KeyPairSigner;
  multisig: Address;
  transactionIndex: bigint;
  rentCollector?: Address;
}

/**
 * Handles `squads-close` command. Reclaims rent from executed/cancelled proposals.
 */
export async function executeSquadsClose(
  params: ExecuteSquadsCloseParams
): Promise<void> {
  const {
    rpc,
    signer,
    multisig,
    transactionIndex,
    rentCollector = signer.address,
  } = params;
  const proposalPda = await findProposalPda(multisig, transactionIndex);
  const transactionPda = await findVaultTransactionPda(
    multisig,
    transactionIndex
  );

  console.log(
    `Closing Proposal & Transaction #${transactionIndex} to reclaim rent to ${rentCollector}...`
  );
  const ix = buildVaultTransactionCloseInstruction({
    multisig,
    proposalPda,
    transactionPda,
    rentCollector,
  });

  const sig = await sendTx(rpc, ix, signer);
  console.log(`✓ Accounts closed and rent refunded! Tx: ${sig}`);
}

export interface ExecuteSquadsExecuteParams {
  rpc: SolanaRpc;
  signer: KeyPairSigner;
  multisig: Address;
  transactionIndex: bigint;
  cuLimit?: number;
}

/**
 * Handles `squads-execute` command. Executes approved proposal on-chain.
 */
export async function executeSquadsExecute(
  params: ExecuteSquadsExecuteParams
): Promise<void> {
  const { rpc, signer, multisig, transactionIndex, cuLimit = 800_000 } = params;
  const proposalPda = await findProposalPda(multisig, transactionIndex);
  const transactionPda = await findVaultTransactionPda(
    multisig,
    transactionIndex
  );

  console.log(
    `Fetching proposal and transaction accounts for #${transactionIndex}...`
  );

  const [msData, propData, txData] = await Promise.all([
    fetchAccountData(rpc, multisig),
    fetchAccountData(rpc, proposalPda),
    fetchAccountData(rpc, transactionPda),
  ]);

  if (!msData) throw new Error(`Multisig account not found at ${multisig}.`);
  if (!propData)
    throw new Error(`Proposal account not found at ${proposalPda}.`);
  if (!txData)
    throw new Error(`VaultTransaction account not found at ${transactionPda}.`);

  const ms = parseMultisigAccount(msData, multisig);
  const proposal = parseProposalAccount(propData, proposalPda);
  const txAccount = parseVaultTransactionAccount(txData, transactionPda);

  // Timelock & Executability verification against cluster clock
  const clusterTime = await getClusterTimestamp(rpc);
  const execCheck = isProposalExecutable(proposal, ms, clusterTime);
  if (!execCheck.executable) {
    throw new Error(
      `Cannot execute Proposal #${transactionIndex}: ${execCheck.reason}`
    );
  }

  console.log(
    `Executing Proposal #${transactionIndex} on-chain (CU Limit: ${cuLimit})...`
  );

  const cuIx = buildSetComputeUnitLimitInstruction(cuLimit);
  const execIx = await buildVaultTransactionExecuteInstruction({
    multisig,
    proposalPda,
    transactionPda,
    member: signer.address,
    transactionAccount: txAccount,
  });

  const sig = await sendTx(rpc, [cuIx, execIx], signer);
  console.log(
    `✓ Proposal #${transactionIndex} executed successfully! Tx: ${sig}`
  );
}
