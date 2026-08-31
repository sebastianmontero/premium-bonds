import {
  createSolanaRpc,
  address,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  KeyPairSigner,
  getBase58Decoder,
  getBase58Encoder,
  Base58EncodedBytes,
  AccountRole,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  sendTx,
  safeStringify,
  printErrorDetails,
  extractAllLogs,
  readEnvFile,
} from "./utils";
import { parseTransactionError, matchAnchorError } from "../app/lib/errors";
import {
  AdminExecutionMode,
  RawMultisigCliFlags,
  resolveAdminExecutionMode,
  dispatchAdminInstruction,
  executeSquadsStatus,
  executeSquadsProposals,
  executeSquadsInspectTx,
  executeSquadsApprove,
  executeSquadsReject,
  executeSquadsCancel,
  executeSquadsClose,
  executeSquadsExecute,
} from "./squads-cli-utils";
import {
  findMultisigPda,
  findMultisigVaultPda,
  createNoopSigner,
  SQUADS_PROGRAM_ADDRESS,
} from "../app/lib/squads-sdk";

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}
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
  RedemptionType,
  parseTicketRegistry,
  resolveUserTickets,
  findPoolVaultPda,
  findPoolPstVaultPda,
  encodeU32,
  PROGRAM_ID,
  HUMA_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  REGISTRY_INITIAL_SIZE,
  buildPrepareDrawInstruction,
  buildInitializeGlobalInstruction,
  buildUpdateGlobalConfigInstruction,
  buildCreatePoolInstruction,
  buildInitializeHumaLenderInstruction,
  buildResizeRegistryInstruction,
  buildSetPrizeTiersInstruction,
  buildUpdatePoolConfigInstruction,
  buildWithdrawFeesInstruction,
  buildAdminForceUnlockDrawInstruction,
  buildCrankRebindExpiredRandomnessInstruction,
  buildPausePoolInstruction,
  buildUnpausePoolInstruction,
  buildClosePoolInstruction,
  buildAdminVoidPayoutRegistryInstruction,
  parseMockHumaPoolState,
  MockHumaPoolStateInfo,
  findHumaPoolAuthorityPda,
  PrizeTierInput,
  DEFAULT_PRIZE_TIERS,
} from "../app/lib/bonds-sdk";

// Switchboard On-Demand binary account layout constants
const SB_RANDOMNESS_ACCOUNT_SIZE = 408;
const SB_REQUEST_SLOT_OFFSET = 104;
const SB_REVEAL_SLOT_OFFSET = 144;
const SB_SEED_OFFSET = 152;

// ─── Help / Usage & Command Registry ─────────────────────────────────────────

export interface CommandOption {
  flag: string;
  description: string;
  default?: string;
  required?: boolean;
}

export interface CommandMetadata {
  command: string;
  category: "Crank & Operations" | "Admin" | "Query" | "Multisig";
  summary: string;
  description: string;
  options?: CommandOption[];
  positionalArgs?: string;
  examples?: string[];
  requiresSigner?: boolean;
}

export const GLOBAL_OPTIONS: CommandOption[] = [
  { flag: "--pool <number>", description: "Pool ID", default: "1" },
  {
    flag: "--keypair <path>",
    description: "Path to keypair file",
    default: "scripts/admin-key.json",
  },
  {
    flag: "--rpc <url>",
    description: "Solana RPC URL",
    default: "http://127.0.0.1:8899",
  },
  {
    flag: "--multisig <pubkey>",
    description:
      "Squads V4 Multisig account address (or fallback to SQUADS_MULTISIG_ADDRESS)",
  },
  {
    flag: "--vault-index <num>",
    description: "Squads V4 vault index acting as authority",
    default: "0",
  },
  {
    flag: "--propose",
    description:
      "Route execution through Squads V4 multisig proposal submission",
  },
  {
    flag: "--export-ix",
    description:
      "Export instruction data and Squads UI JSON payload without broadcasting",
  },
  {
    flag: "--dry-run",
    description: "Simulate transaction on RPC node without broadcasting",
  },
  {
    flag: "--no-auto-approve",
    description: "Do not automatically approve created proposal",
  },
  { flag: "--help, -h", description: "Show help message" },
];

export const COMMAND_REGISTRY: Record<string, CommandMetadata> = {
  // Crank & Operations
  harvest: {
    command: "harvest",
    category: "Crank & Operations",
    summary: "Harvest yield from Huma and commit it to the current draw cycle",
    description:
      "Harvest yield from Huma protocol for the specified prize pool and commit it to the current draw cycle, freezing the pool for draw processing.",
    requiresSigner: true,
    examples: ["npm run pb-cli harvest", "npm run pb-cli harvest -- --pool 1"],
  },
  "prepare-draw": {
    command: "prepare-draw",
    category: "Crank & Operations",
    summary: "Prepare tickets for the draw cycle in batches",
    description:
      "Prepare tickets for the draw cycle in batches, merging pending tickets into active tickets and computing prefix sums across ticket registry entries.",
    requiresSigner: true,
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
      {
        flag: "--batch-size <num>",
        description: "Maximum entries to process per transaction batch",
        default: "1000",
      },
    ],
    examples: [
      "npm run pb-cli prepare-draw -- --pool 1",
      "npm run pb-cli prepare-draw -- --batch-size 500",
    ],
  },
  reveal: {
    command: "reveal",
    category: "Crank & Operations",
    summary: "Reveal the random seed and pick winners for the draw cycle",
    description:
      "Reveal the random seed and pick winners for the draw cycle. Automatically runs batched prepare-draw if preparation is incomplete.",
    requiresSigner: true,
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
      {
        flag: "--seed <hex>",
        description: "32-byte hex string seed for the reveal command",
      },
    ],
    examples: ["npm run pb-cli reveal -- --pool 1"],
  },
  reinvest: {
    command: "reinvest",
    category: "Crank & Operations",
    summary: "Reinvest draw winnings back into principal/tickets",
    description:
      "Reinvest draw winnings back into principal/tickets for unprocessed draw winners.",
    requiresSigner: true,
    positionalArgs: "[winner]",
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
      {
        flag: "--winner <idx|addr>",
        description:
          "Winner index or user public key address to target (default: all unprocessed winners)",
      },
    ],
    examples: [
      "npm run pb-cli reinvest -- --pool 1",
      "npm run pb-cli reinvest -- --winner 0",
    ],
  },

  // Admin Commands
  "init-global": {
    command: "init-global",
    category: "Admin",
    summary: "Initialize global configuration (admin, jobs account)",
    description:
      "Initialize global program configuration specifying admin authority and jobs/crank account.",
    requiresSigner: true,
    positionalArgs: "[jobs]",
    options: [
      {
        flag: "--admin <pubkey>",
        description:
          "Admin authority public key (defaults to deployer/signer authority)",
      },
      {
        flag: "--guardian <pubkey>",
        description:
          "Emergency guardian public key for pause button (defaults to admin authority)",
      },
      {
        flag: "--jobs <pubkey>",
        description:
          "Crank bot/jobs account public key (defaults to admin authority)",
      },
    ],
    examples: [
      "npm run pb-cli init-global",
      "npm run pb-cli init-global -- --guardian <GUARDIAN_PUBKEY> --jobs <JOBS_PUBKEY>",
      "npm run pb-cli init-global -- --admin <ADMIN_PUBKEY> --jobs <JOBS_PUBKEY>",
    ],
  },
  "update-global-config": {
    command: "update-global-config",
    category: "Admin",
    summary: "Update global config (admin, guardian, jobs account)",
    description:
      "Update global configuration parameters including admin authority, guardian authority, and jobs account.",
    requiresSigner: true,
    options: [
      {
        flag: "--new-admin <pubkey>",
        description: "New admin authority address (requires --confirm)",
      },
      {
        flag: "--guardian <pubkey>",
        description: "New emergency guardian authority address",
      },
      {
        flag: "--jobs <pubkey>",
        description: "New crank bot/jobs account public key",
      },
      {
        flag: "--confirm",
        description:
          "Explicit confirmation flag required for changing admin authority",
      },
    ],
    examples: ["npm run pb-cli update-global-config -- --guardian <pubkey>"],
  },
  "create-pool": {
    command: "create-pool",
    category: "Admin",
    summary: "Create a new prize pool and zero-initialize its ticket registry",
    description:
      "Create a new prize pool and zero-initialize its zero-copy ticket registry PDA.",
    requiresSigner: true,
    options: [
      {
        flag: "--bond-price <num>",
        description: "Bond price in base units (e.g. 1000000 = 1 USDC)",
        default: "1000000",
      },
      {
        flag: "--stake-duration <hrs>",
        description: "Staking cycle duration in hours",
        default: "24",
      },
      {
        flag: "--fee-bps <num>",
        description: "Protocol fee rate in basis points (e.g. 100 = 1%)",
        default: "100",
      },
      {
        flag: "--token-mint <pubkey>",
        description: "Underlying token mint address (e.g. USDC)",
      },
      {
        flag: "--pst-mint <pubkey>",
        description: "Huma PST token mint address",
      },
      {
        flag: "--fee-wallet <pubkey>",
        description: "Fee wallet token account address",
      },
      {
        flag: "--min-yield-threshold <num>",
        description:
          "Minimum yield threshold in base units (0 = uncapped/no min)",
        default: "0",
      },
      {
        flag: "--max-yield-bps <num>",
        description:
          "Maximum yield velocity limit in basis points (0 = uncapped)",
        default: "0",
      },
      {
        flag: "--payout-timelock <secs>",
        description: "Payout settlement timelock in seconds (max 86400)",
        default: "300",
      },
      {
        flag: "--tiers <string>",
        description:
          'Prize tiers config (e.g. "1:10000" or "1:5000,2:1500,5:400" or JSON array)',
        default: "1:10000",
      },
    ],
    examples: [
      "npm run pb-cli create-pool -- --pool 1 --bond-price 1000000 --fee-bps 100",
      'npm run pb-cli create-pool -- --pool 1 --tiers "1:5000,2:1500,5:400"',
    ],
  },
  "initialize-huma-lender": {
    command: "initialize-huma-lender",
    category: "Admin",
    summary: "Initialize Huma lender state and $PST vault for a pool",
    description:
      "Initialize Huma lender state account and PST token vault for a pool.",
    requiresSigner: true,
    examples: ["npm run pb-cli initialize-huma-lender -- --pool 1"],
  },
  "resize-registry": {
    command: "resize-registry",
    category: "Admin",
    summary: "Resize zero-copy ticket registry account to add user capacity",
    description:
      "Resize zero-copy ticket registry account to add user capacity.",
    requiresSigner: true,
    examples: ["npm run pb-cli resize-registry -- --pool 1"],
  },
  "set-prize-tiers": {
    command: "set-prize-tiers",
    category: "Admin",
    summary: "Configure prize tier distribution rules for a pool",
    description: "Configure prize tier distribution rules for a pool.",
    requiresSigner: true,
    positionalArgs: "[tiers]",
    options: [
      {
        flag: "--tiers <json|str>",
        description: "Prize tiers config (e.g. '1:5000,5:1000' or JSON array)",
        required: true,
      },
    ],
    examples: [
      "npm run pb-cli set-prize-tiers -- --tiers '1:5000,5:1000' --pool 1",
    ],
  },
  "update-pool-config": {
    command: "update-pool-config",
    category: "Admin",
    summary:
      "Update pool config (fee bps, bond price, fee wallet, duration, min yield, max yield, payout timelock)",
    description:
      "Update pool config parameters (fee bps, bond price, fee wallet address, stake cycle duration, min yield threshold, max yield velocity bps, payout settlement timelock).",
    requiresSigner: true,
    options: [
      {
        flag: "--fee-bps <num>",
        description: "Protocol fee rate in basis points",
      },
      {
        flag: "--bond-price <num>",
        description: "Bond price in base units",
      },
      {
        flag: "--fee-wallet <pubkey>",
        description: "Fee wallet token account address",
      },
      {
        flag: "--stake-duration <hrs>",
        description: "Stake cycle duration in hours (1-8760)",
      },
      {
        flag: "--min-yield-threshold <num>",
        description: "Minimum yield threshold in base units",
      },
      {
        flag: "--max-yield-bps <num>",
        description:
          "Maximum allowable yield spike per cycle in basis points (1-10000)",
      },
      {
        flag: "--payout-timelock <seconds>",
        description:
          "Payout delay timelock in seconds before winners can be processed (0-604800)",
      },
    ],
    examples: [
      "npm run pb-cli update-pool-config -- --pool 1 --fee-bps 200",
      "npm run pb-cli update-pool-config -- --pool 1 --stake-duration 168",
      "npm run pb-cli update-pool-config -- --pool 1 --min-yield-threshold 5000000",
      "npm run pb-cli update-pool-config -- --pool 1 --max-yield-bps 500 --payout-timelock 3600",
    ],
  },
  "withdraw-fees": {
    command: "withdraw-fees",
    category: "Admin",
    summary: "Withdraw accrued protocol fees to designated fee wallet",
    description:
      "Withdraw accrued protocol fees from pool vault to designated fee wallet.",
    requiresSigner: true,
    positionalArgs: "[amount]",
    options: [
      {
        flag: "--amount <num|all>",
        description: "Amount to withdraw in token base units, or 'all'",
        required: true,
      },
      {
        flag: "--confirm",
        description: "Explicit confirmation flag required for fee withdrawal",
        required: true,
      },
    ],
    examples: [
      "npm run pb-cli withdraw-fees -- --amount all --confirm --pool 1",
    ],
  },
  "pause-pool": {
    command: "pause-pool",
    category: "Admin",
    summary: "Emergency pause a prize pool (halts deposits/withdrawals/draws)",
    description:
      "Emergency pause a prize pool. Can be executed by Guardian panic button or Admin cold multisig.",
    requiresSigner: true,
    examples: ["npm run pb-cli pause-pool -- --pool 1"],
  },
  "unpause-pool": {
    command: "unpause-pool",
    category: "Admin",
    summary: "Unpause a paused prize pool (resumes normal operations)",
    description:
      "Unpause a paused prize pool. Can ONLY be executed by Admin cold multisig.",
    requiresSigner: true,
    options: [
      {
        flag: "--confirm",
        description: "Explicit confirmation flag required to unpause pool",
        required: true,
      },
    ],
    examples: ["npm run pb-cli unpause-pool -- --pool 1 --confirm"],
  },
  "close-pool": {
    command: "close-pool",
    category: "Admin",
    summary: "Permanently close and decommission a prize pool",
    description:
      "Permanently close and decommission a prize pool for sunset. Can ONLY be executed by Admin cold multisig.",
    requiresSigner: true,
    options: [
      {
        flag: "--confirm",
        description:
          "Explicit confirmation flag required to permanently close pool",
        required: true,
      },
    ],
    examples: ["npm run pb-cli close-pool -- --pool 1 --confirm"],
  },
  "void-draw": {
    command: "void-draw",
    category: "Admin",
    summary: "Emergency void a draw cycle and roll back allocated prizes",
    description:
      "Emergency void an active draw cycle if no winner payouts have occurred. Can ONLY be executed by Admin cold multisig.",
    requiresSigner: true,
    positionalArgs: "[cycle]",
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
      {
        flag: "--confirm",
        description: "Explicit confirmation flag required to void draw cycle",
        required: true,
      },
    ],
    examples: ["npm run pb-cli void-draw -- --pool 1 --confirm"],
  },
  "force-unlock-draw": {
    command: "force-unlock-draw",
    category: "Admin",
    summary: "Emergency admin force unlock of a frozen/stuck draw cycle",
    description:
      "Emergency admin force unlock of a frozen/stuck draw cycle, resetting pool freeze status.",
    requiresSigner: true,
    positionalArgs: "[cycle]",
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
      {
        flag: "--confirm",
        description: "Explicit confirmation flag required for force unlock",
        required: true,
      },
    ],
    examples: ["npm run pb-cli force-unlock-draw -- --pool 1 --confirm"],
  },
  "rebind-randomness": {
    command: "rebind-randomness",
    category: "Admin",
    summary:
      "Rebind an expired draw cycle to a new Switchboard randomness account",
    description:
      "Rebind an expired draw cycle to a new Switchboard randomness account.",
    requiresSigner: true,
    positionalArgs: "[cycle] [newRandomness]",
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
      {
        flag: "--new-randomness <pubkey>",
        description: "New Switchboard randomness account address",
        required: true,
      },
    ],
    examples: [
      "npm run pb-cli rebind-randomness -- --pool 1 --new-randomness <PUBKEY>",
    ],
  },

  // Query Commands
  "query-config": {
    command: "query-config",
    category: "Query",
    summary: "Query and display the Global Config state",
    description:
      "Query and display the on-chain GlobalConfig state (admin, jobs account).",
    requiresSigner: false,
    examples: ["npm run pb-cli query-config"],
  },
  "query-pool": {
    command: "query-pool",
    category: "Query",
    summary: "Query and display the Prize Pool state",
    description:
      "Query and display the PrizePool state, vault PDAs, deposited principal, status, and fee stats.",
    requiresSigner: false,
    positionalArgs: "[poolId]",
    examples: [
      "npm run pb-cli query-pool",
      "npm run pb-cli query-pool -- --pool 1",
    ],
  },
  "query-draw": {
    command: "query-draw",
    category: "Query",
    summary: "Query and display the current Draw Cycle state",
    description:
      "Query and display the DrawCycle state (status, locked ticket count, prize pot, randomness account, harvest slot).",
    requiresSigner: false,
    positionalArgs: "[cycleId]",
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
    ],
    examples: ["npm run pb-cli query-draw -- --pool 1 --cycle 0"],
  },
  "query-payout": {
    command: "query-payout",
    category: "Query",
    summary: "Query and display the Payout Registry state",
    description:
      "Query and display the PayoutRegistry state and winner list for a draw cycle.",
    requiresSigner: false,
    positionalArgs: "[cycleId]",
    options: [
      {
        flag: "--cycle <number>",
        description:
          "Draw Cycle ID to target (default: pool's currentDrawCycleId - 1)",
      },
    ],
    examples: ["npm run pb-cli query-payout -- --pool 1 --cycle 0"],
  },
  "query-winnings": {
    command: "query-winnings",
    category: "Query",
    summary:
      "Query and display User Winnings (specify user pubkey or omit to list all)",
    description:
      "Query and display User Winnings PDA state for a specific user or list all user winnings for a pool.",
    requiresSigner: false,
    positionalArgs: "[userPubkey]",
    options: [
      { flag: "--user <pubkey>", description: "User public key address" },
    ],
    examples: ["npm run pb-cli query-winnings -- --user <USER_PUBKEY>"],
  },
  "query-redemption": {
    command: "query-redemption",
    category: "Query",
    summary:
      "Query Pending Redemption (specify ID or omit to list all, optionally filter with --user)",
    description:
      "Query Pending Redemption state for a specific redemption ID or list all redemptions.",
    requiresSigner: false,
    positionalArgs: "[redemptionId]",
    options: [
      { flag: "--id <number>", description: "Redemption ID to query" },
      { flag: "--user <pubkey>", description: "User public key filter" },
    ],
    examples: ["npm run pb-cli query-redemption -- --id 1"],
  },
  "query-registry": {
    command: "query-registry",
    category: "Query",
    summary:
      "Query and display the Ticket Registry state (optionally filter with --user)",
    description:
      "Query and display the zero-copy TicketRegistry state and registered user entries.",
    requiresSigner: false,
    positionalArgs: "[userPubkey]",
    options: [
      { flag: "--user <pubkey>", description: "User public key filter" },
    ],
    examples: ["npm run pb-cli query-registry -- --pool 1"],
  },
  "query-mock-huma-pool-state": {
    command: "query-mock-huma-pool-state",
    category: "Query",
    summary:
      "Query and display the Mock Huma Pool state and redemption queue status",
    description:
      "Query and display the Mock Huma Pool state (total assets, mode configuration, PDA authority) and redemption queue status (next/last request IDs, pending count).",
    requiresSigner: false,
    positionalArgs: "[humaPoolStatePubkey]",
    options: [
      {
        flag: "--address <pubkey>",
        description: "Mock Huma Pool State public key address",
      },
    ],
    examples: [
      "npm run pb-cli query-mock-huma-pool-state",
      "npm run pb-cli query-mock-huma-pool-state -- --address <PUBKEY>",
    ],
  },

  // Multisig Commands
  "squads-status": {
    command: "squads-status",
    category: "Multisig",
    summary:
      "Query and display Squads V4 Multisig account status, members, and thresholds",
    description:
      "Query on-chain state for a Squads V4 multisig including threshold, members, timelock, transaction indices, and default vault PDA.",
    requiresSigner: false,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
    ],
    examples: [
      "npm run pb-cli squads-status",
      "npm run pb-cli squads-status -- --multisig <MULTISIG_PDA>",
    ],
  },
  "squads-proposals": {
    command: "squads-proposals",
    category: "Multisig",
    summary: "List recent proposal history with voting and execution status",
    description:
      "Query and list recent proposal accounts for a Squads V4 multisig, displaying status, approval count, timelock, and staleness.",
    requiresSigner: false,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
      {
        flag: "--limit <num>",
        description: "Maximum number of recent proposals to display",
        default: "10",
      },
    ],
    examples: [
      "npm run pb-cli squads-proposals",
      "npm run pb-cli squads-proposals -- --limit 20",
    ],
  },
  "squads-inspect-tx": {
    command: "squads-inspect-tx",
    category: "Multisig",
    summary:
      "Decode and inspect the inner instructions of a Squads vault transaction",
    description:
      "Fetch and decode a VaultTransaction account, displaying its accounts, program IDs, and inner instruction payloads.",
    requiresSigner: false,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
      {
        flag: "--index <num>",
        description: "Transaction index to inspect",
        required: true,
      },
    ],
    examples: ["npm run pb-cli squads-inspect-tx -- --index 1"],
  },
  "squads-approve": {
    command: "squads-approve",
    category: "Multisig",
    summary: "Submit a member approval vote for a pending Squads proposal",
    description:
      "Sign and submit a proposal_approve instruction to Squads V4 for the specified proposal index.",
    requiresSigner: true,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
      {
        flag: "--index <num>",
        description: "Transaction index to approve",
        required: true,
      },
      {
        flag: "--memo <string>",
        description: "Optional memo attached to vote",
      },
    ],
    examples: [
      "npm run pb-cli squads-approve -- --index 1",
      "npm run pb-cli squads-approve -- --index 1 --memo 'Approved pool config update'",
    ],
  },
  "squads-reject": {
    command: "squads-reject",
    category: "Multisig",
    summary: "Submit a member rejection vote for a pending Squads proposal",
    description:
      "Sign and submit a proposal_reject instruction to Squads V4 for the specified proposal index.",
    requiresSigner: true,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
      {
        flag: "--index <num>",
        description: "Transaction index to reject",
        required: true,
      },
      {
        flag: "--memo <string>",
        description: "Optional memo attached to vote",
      },
    ],
    examples: ["npm run pb-cli squads-reject -- --index 1"],
  },
  "squads-cancel": {
    command: "squads-cancel",
    category: "Multisig",
    summary: "Cancel a pending Squads proposal",
    description:
      "Sign and submit a proposal_cancel instruction to Squads V4 (allowed by proposal creator or config authority).",
    requiresSigner: true,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
      {
        flag: "--index <num>",
        description: "Transaction index to cancel",
        required: true,
      },
    ],
    examples: ["npm run pb-cli squads-cancel -- --index 1"],
  },
  "squads-close": {
    command: "squads-close",
    category: "Multisig",
    summary:
      "Reclaim rent from executed or cancelled Squads proposal and transaction accounts",
    description:
      "Close executed or cancelled proposal and transaction accounts, refunding rent lamports to rent collector or caller.",
    requiresSigner: true,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
      {
        flag: "--index <num>",
        description: "Transaction index to close",
        required: true,
      },
      {
        flag: "--rent-collector <pubkey>",
        description:
          "Rent refund recipient address (defaults to keypair signer)",
      },
    ],
    examples: ["npm run pb-cli squads-close -- --index 1"],
  },
  "squads-execute": {
    command: "squads-execute",
    category: "Multisig",
    summary:
      "Execute an approved Squads proposal on-chain with timelock verification",
    description:
      "Execute an approved Squads proposal against the target program CPI with automated remaining accounts resolution and compute budget injection.",
    requiresSigner: true,
    options: [
      {
        flag: "--multisig <pubkey>",
        description: "Squads V4 Multisig account address",
      },
      {
        flag: "--index <num>",
        description: "Transaction index to execute",
        required: true,
      },
      {
        flag: "--cu-limit <num>",
        description: "Compute unit limit for execution transaction",
        default: "800000",
      },
    ],
    examples: [
      "npm run pb-cli squads-execute -- --index 1",
      "npm run pb-cli squads-execute -- --index 1 --cu-limit 1000000",
    ],
  },
};

export function resolveHelpRequest(args: string[]): {
  isHelp: boolean;
  command?: string;
} {
  if (args.length === 0) return { isHelp: true };

  if (args[0] === "help") {
    return { isHelp: true, command: args[1] };
  }

  const hasHelpFlag = args.includes("--help") || args.includes("-h");
  if (!hasHelpFlag) return { isHelp: false };

  const command = args.find((arg) => !arg.startsWith("-"));
  return { isHelp: true, command };
}

function showHelp() {
  const categories: Array<CommandMetadata["category"]> = [
    "Crank & Operations",
    "Admin",
    "Multisig",
    "Query",
  ];

  let helpTxt = `YieldBonds CLI (pb-cli)\n\nUsage:\n  pb-cli [command] [options]\n\n`;

  for (const cat of categories) {
    helpTxt += `${cat} Commands:\n`;
    const cmds = Object.values(COMMAND_REGISTRY).filter(
      (c) => c.category === cat
    );
    for (const c of cmds) {
      const positional = c.positionalArgs ? ` ${c.positionalArgs}` : "";
      const cmdStr = `${c.command}${positional}`;
      helpTxt += `  ${cmdStr.padEnd(24)} ${c.summary}\n`;
    }
    helpTxt += `\n`;
  }

  helpTxt += `Global Options:\n`;
  for (const opt of GLOBAL_OPTIONS) {
    helpTxt += `  ${opt.flag.padEnd(24)} ${opt.description}${
      opt.default ? ` (default: ${opt.default})` : ""
    }\n`;
  }

  helpTxt += `\nEnvironments & Usage Examples:\n`;
  helpTxt += `  npm run pb-cli query-pool\n`;
  helpTxt += `  npm run pb-cli set-prize-tiers -- --tiers "1:5000,5:1000" --pool 1\n`;
  helpTxt += `  npm run pb-cli withdraw-fees -- --amount all --confirm --pool 1\n`;
  helpTxt += `  npm run pb-cli harvest -- --help\n`;

  console.log(helpTxt);
}

function showCommandHelp(commandName: string) {
  const meta = COMMAND_REGISTRY[commandName];
  if (!meta) {
    console.error(`Error: Unknown command "${commandName}".\n`);
    showHelp();
    process.exit(1);
  }

  const positional = meta.positionalArgs ? ` ${meta.positionalArgs}` : "";
  let helpTxt = `YieldBonds CLI (pb-cli) - Command Help: ${meta.command}\n\n`;
  helpTxt += `Description:\n  ${meta.description}\n\n`;
  helpTxt += `Category:\n  ${meta.category}\n\n`;
  helpTxt += `Usage:\n  pb-cli ${meta.command}${positional} [options]\n\n`;

  const allOptions = [...(meta.options || [])];
  for (const gOpt of GLOBAL_OPTIONS) {
    if (
      !allOptions.some((o) => o.flag.split(" ")[0] === gOpt.flag.split(" ")[0])
    ) {
      allOptions.push(gOpt);
    }
  }

  if (allOptions.length > 0) {
    helpTxt += `Options:\n`;
    for (const opt of allOptions) {
      const reqTag = opt.required ? " [Required]" : "";
      const defTag = opt.default ? ` (default: ${opt.default})` : "";
      helpTxt += `  ${opt.flag.padEnd(26)} ${opt.description}${reqTag}${defTag}\n`;
    }
    helpTxt += `\n`;
  }

  if (meta.examples && meta.examples.length > 0) {
    helpTxt += `Examples:\n`;
    for (const ex of meta.examples) {
      helpTxt += `  ${ex}\n`;
    }
    helpTxt += `\n`;
  }

  console.log(helpTxt);
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function formatAmount(amount: bigint | number): string {
  const val = Number(amount) / 1_000_000;
  return val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function formatTimestamp(seconds: number | bigint): string {
  const date = new Date(Number(seconds) * 1000);
  return `${date.toLocaleString()} (Local) | ${date.toISOString()} (UTC)`;
}

function loadAddresses(isDevnet: boolean): Record<string, string> {
  const stateDir = isDevnet ? "devnet-state" : "localnet-state";
  const filePath = path.resolve(__dirname, stateDir, "addresses.json");
  const env = readEnvFile(path.resolve(process.cwd(), ".env.local"));
  let fileAddresses: Record<string, string> = {};
  if (fs.existsSync(filePath)) {
    try {
      fileAddresses = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      console.warn(
        `Failed to parse ${stateDir}/addresses.json, using defaults:`,
        err
      );
    }
  }
  return { ...env, ...fileAddresses };
}

function loadEnvLocal(): Record<string, string> {
  return readEnvFile(path.resolve(process.cwd(), ".env.local"));
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
      `RPC Error setting account ${addr}: ${safeStringify(json.error)}`
    );
  }
}

// ─── Exported Action Handlers ────────────────────────────────────────────────

export interface ExecuteHarvestParams {
  poolId?: number;
  rpcUrl?: string;
  signer: KeyPairSigner;
}

export async function executeHarvest({
  poolId = 1,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
}: ExecuteHarvestParams): Promise<{ drawCycleId: number }> {
  console.log(`Harvesting yield for pool ${poolId}...`);
  const isDevnet = rpcUrl.includes("devnet") || rpcUrl.includes("api.devnet");
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();
  const stateAddresses = loadAddresses(isDevnet);

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found on-chain.`);
  }
  const poolBytes = new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]));
  const poolState = parsePrizePool(poolBytes);

  if (poolState.prizeTiers.length === 0) {
    throw new Error(
      `Prize tiers have not been configured for pool ${poolId}. Please configure prize tiers before harvesting (e.g., 'npm run localnet set-prize-tiers').`
    );
  }

  const pstMintStr = stateAddresses.pstMint;
  const humaPoolStateStr = stateAddresses.humaPoolState;
  if (!pstMintStr || !humaPoolStateStr) {
    throw new Error(
      `Missing pstMint or humaPoolState in ${isDevnet ? "devnet" : "localnet"} state addresses.`
    );
  }

  const env = loadEnvLocal();
  const randomnessAccountStr = env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT;
  if (!randomnessAccountStr) {
    throw new Error(
      `Missing NEXT_PUBLIC_RANDOMNESS_ACCOUNT in .env.local. Please run 'npm run ${isDevnet ? "devnet" : "localnet"} init' first.`
    );
  }

  const targetCycleId = poolState.currentDrawCycleId;

  if (poolState.isFrozenForDraw) {
    const frozenCycleId =
      poolState.currentDrawCycleId > 1 ? poolState.currentDrawCycleId - 1 : 1;
    console.log(
      `Notice: Pool ${poolId} is already frozen for draw cycle ${frozenCycleId}. Harvest yield has already been committed.`
    );
    return { drawCycleId: frozenCycleId };
  }

  console.log(`Pool Details:
  Current Draw Cycle ID: ${targetCycleId}
  Ticket Registry: ${poolState.ticketRegistry}
  PST Mint: ${pstMintStr}
  Huma Pool State: ${humaPoolStateStr}
  Randomness Account: ${randomnessAccountStr}
`);

  const ix = await buildHarvestYieldAndCommitInstruction({
    crank: signer.address,
    poolId,
    ticketRegistry: address(poolState.ticketRegistry),
    currentDrawCycleId: targetCycleId,
    pstMint: address(pstMintStr),
    humaPoolState: address(humaPoolStateStr),
    randomnessAccount: address(randomnessAccountStr),
  });

  await sendTx(rpc, ix, signer);
  return { drawCycleId: targetCycleId };
}

export interface ExecutePrepareDrawParams {
  poolId?: number;
  cycleId?: number;
  batchSize?: number;
  rpcUrl?: string;
  signer: KeyPairSigner;
}

export async function executePrepareDraw({
  poolId = 1,
  cycleId,
  batchSize = 1000,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
}: ExecutePrepareDrawParams) {
  if (isNaN(batchSize) || batchSize <= 0) {
    throw new Error("Batch size must be a positive integer.");
  }

  console.log(
    `Preparing draw for pool ${poolId} with batch size ${batchSize}...`
  );
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found on-chain.`);
  }
  const poolBytes = new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]));
  const poolState = parsePrizePool(poolBytes);

  if (!poolState.isFrozenForDraw) {
    console.log(
      `Notice: PrizePool ${poolId} is not frozen for draw (isFrozenForDraw is false). Skipping draw preparation.`
    );
    return;
  }

  const targetCycleId =
    cycleId !== undefined ? cycleId : poolState.currentDrawCycleId - 1;
  if (targetCycleId >= 0) {
    const drawCyclePda = await findDrawCyclePda(poolId, targetCycleId);
    const drawCycleAcc = await rpc
      .getAccountInfo(drawCyclePda, { encoding: "base64" })
      .send();
    if (drawCycleAcc && drawCycleAcc.value) {
      const drawCycleBytes = new Uint8Array(
        base64Encoder.encode(drawCycleAcc.value.data[0])
      );
      const drawCycleState = parseDrawCycle(drawCycleBytes);
      if (drawCycleState.status !== "AwaitingRandomness") {
        console.log(
          `Notice: Draw cycle ${targetCycleId} status is '${drawCycleState.status}' (expected 'AwaitingRandomness'). Skipping draw preparation.`
        );
        return;
      }
    }
  }

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
    return;
  }

  while (registryState.drawPreparedUpTo < registryState.userCount) {
    console.log(
      `Sending batch transaction for entries ${registryState.drawPreparedUpTo} to ${Math.min(
        registryState.drawPreparedUpTo + batchSize,
        registryState.userCount
      )}...`
    );

    const ix = await buildPrepareDrawInstruction({
      crank: signer.address,
      poolId,
      currentDrawCycleId: targetCycleId,
      ticketRegistry: address(registryAddr),
      batchSize,
    });

    await sendTx(rpc, ix, signer);

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
}

export interface ExecuteRevealParams {
  poolId?: number;
  cycleId?: number;
  seedHex?: string;
  rpcUrl?: string;
  signer: KeyPairSigner;
}

export async function executeReveal({
  poolId = 1,
  cycleId,
  seedHex,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
}: ExecuteRevealParams) {
  console.log(`Revealing and picking winners for pool ${poolId}...`);
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found on-chain.`);
  }
  const poolBytes = new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]));
  const poolState = parsePrizePool(poolBytes);

  const targetCycleId =
    cycleId !== undefined ? cycleId : poolState.currentDrawCycleId - 1;
  if (targetCycleId < 0) {
    throw new Error(
      `Invalid Draw Cycle ID: ${targetCycleId}. No draw cycle has been created yet.`
    );
  }

  const drawCyclePda = await findDrawCyclePda(poolId, targetCycleId);
  const drawCycleAcc = await rpc
    .getAccountInfo(drawCyclePda, { encoding: "base64" })
    .send();
  if (!drawCycleAcc || !drawCycleAcc.value) {
    throw new Error(
      `Draw Cycle account for ID ${targetCycleId} not found on-chain.`
    );
  }
  const drawCycleBytes = new Uint8Array(
    base64Encoder.encode(drawCycleAcc.value.data[0])
  );
  const drawCycleState = parseDrawCycle(drawCycleBytes);

  if (drawCycleState.status !== "AwaitingRandomness") {
    console.log(
      `Notice: Draw cycle ${targetCycleId} status is '${drawCycleState.status}' (expected 'AwaitingRandomness'). Skipping reveal.`
    );
    return;
  }

  // Check and prepare draw if needed
  const registryAddr = poolState.ticketRegistry;
  const registryAcc = await rpc
    .getAccountInfo(address(registryAddr), { encoding: "base64" })
    .send();
  if (!registryAcc || !registryAcc.value) {
    throw new Error(`Ticket registry at ${registryAddr} not found.`);
  }
  const registryBytes = new Uint8Array(
    base64Encoder.encode(registryAcc.value.data[0])
  );
  const registryState = parseTicketRegistry(registryBytes);

  if (registryState.drawPreparedUpTo < registryState.userCount) {
    console.log(
      `Draw preparation incomplete (${registryState.drawPreparedUpTo}/${registryState.userCount}). Starting automatic batched preparation...`
    );
    await executePrepareDraw({
      poolId,
      cycleId: targetCycleId,
      batchSize: 1000,
      rpcUrl,
      signer,
    });
  }

  let seed = crypto.randomBytes(32);
  if (seedHex) {
    if (seedHex.length !== 64) {
      throw new Error("Seed must be a 64-character (32-byte) hex string.");
    }
    seed = Buffer.from(seedHex, "hex");
  }

  console.log(`Using Random Seed (hex): ${seed.toString("hex")}`);
  console.log(`Targeting Draw Cycle ID: ${targetCycleId}`);
  const randomnessAccountStr = drawCycleState.randomnessAccount;
  console.log(`Extracted locked randomness account: ${randomnessAccountStr}`);

  const ix = await buildRevealAndPickWinnersInstruction({
    crank: signer.address,
    poolId,
    currentDrawCycleId: targetCycleId,
    ticketRegistry: address(poolState.ticketRegistry),
    randomnessAccount: address(randomnessAccountStr),
  });

  const isLocalnet =
    rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost");
  if (isLocalnet) {
    console.log("Localnet detected. Injecting mock resolved randomness...");

    const currentSlot = await rpc.getSlot().send();
    console.log(`Current slot: ${currentSlot}`);

    const buffer = new Uint8Array(SB_RANDOMNESS_ACCOUNT_SIZE);
    const view = new DataView(buffer.buffer);
    const discriminator = [10, 66, 229, 135, 220, 239, 217, 114];
    buffer.set(discriminator, 0);
    buffer.set(new Uint8Array(seed), SB_SEED_OFFSET);

    const sbProgramId =
      process.env.SB_ENV === "devnet"
        ? "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2"
        : "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv";

    const offsets = [1n, 2n, 0n, 3n];
    let confirmed = false;
    let lastError: unknown = null;

    for (const offset of offsets) {
      const currentSlot = await rpc.getSlot().send();
      const baseSlot =
        currentSlot >= drawCycleState.harvestSlot
          ? currentSlot
          : drawCycleState.harvestSlot;
      const targetSlot = baseSlot + offset;

      view.setBigUint64(SB_REQUEST_SLOT_OFFSET, baseSlot, true);
      view.setBigUint64(SB_REVEAL_SLOT_OFFSET, targetSlot, true);

      const dataHex = Buffer.from(buffer).toString("hex");

      await setAccount(
        rpcUrl,
        randomnessAccountStr,
        1_000_000_000,
        dataHex,
        sbProgramId,
        false
      );

      console.log(
        `Mock randomness account injected (seed_slot: ${baseSlot}, reveal_slot: ${targetSlot}). Submitting reveal transaction...`
      );

      try {
        await sendTx(rpc, ix, signer);
        confirmed = true;
        break;
      } catch (err: unknown) {
        lastError = err;
        const parsed = parseTransactionError(err);
        const errStr = `${String(err)} ${safeStringify(err)} ${parsed.message}`;
        if (
          parsed.code === 6030 ||
          parsed.code === 6031 ||
          errStr.includes("RandomnessNotResolved") ||
          errStr.includes("StaleRandomnessRequest") ||
          errStr.includes("6030") ||
          errStr.includes("6031") ||
          errStr.includes("0x178e") ||
          errStr.includes("0x178f")
        ) {
          console.log(
            `Randomness resolution retry needed (attempt offset +${offset} resulted in ${parsed.title}). Retrying next slot offset...`
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        throw err;
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
    await sendTx(rpc, ix, signer);
  }
}

export interface ExecuteReinvestParams {
  poolId?: number;
  cycleId?: number;
  winnerOption?: string;
  rpcUrl?: string;
  signer: KeyPairSigner;
}

export async function executeReinvest({
  poolId = 1,
  cycleId,
  winnerOption,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
}: ExecuteReinvestParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found on-chain.`);
  }
  const poolBytes = new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]));
  const poolState = parsePrizePool(poolBytes);

  const targetCycleId =
    cycleId !== undefined ? cycleId : poolState.currentDrawCycleId - 1;
  if (targetCycleId < 0) {
    throw new Error(
      `Invalid Draw Cycle ID: ${targetCycleId}. No draw cycle has been created yet.`
    );
  }

  const payoutRegistryPda = await findPayoutRegistryPda(poolId, targetCycleId);
  console.log(
    `Fetching Payout Registry ${targetCycleId} for Pool ${poolId} at ${payoutRegistryPda}...`
  );

  const payoutRegistryAcc = await rpc
    .getAccountInfo(payoutRegistryPda, { encoding: "base64" })
    .send();
  if (!payoutRegistryAcc || !payoutRegistryAcc.value) {
    console.log(
      `Payout Registry account for cycle ${targetCycleId} does not exist.`
    );
    return;
  }

  const bytes = new Uint8Array(
    base64Encoder.encode(payoutRegistryAcc.value.data[0])
  );
  const state = parsePayoutRegistry(bytes);

  if (state.status === 1) {
    throw new Error(
      `Cannot reinvest winners: Draw cycle ${targetCycleId} has been voided by the administrator.`
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const unlockTime =
    Number(state.revealedAt) + Number(poolState.payoutTimelockSeconds);
  if (now < unlockTime) {
    const remaining = unlockTime - now;
    console.warn(
      `Notice: Payout timelock is active (${remaining}s remaining). Reinvest instruction will fail on-chain if timelock is not elapsed.`
    );
  }

  let targetWinnerIndices: number[] = [];

  if (winnerOption) {
    const parsedIdx = parseInt(winnerOption, 10);
    if (!isNaN(parsedIdx)) {
      if (parsedIdx < 0 || parsedIdx >= state.winnersCount) {
        throw new Error(
          `Winner index ${parsedIdx} out of range (0-${state.winnersCount - 1})`
        );
      }
      targetWinnerIndices = [parsedIdx];
    } else {
      const index = state.winners
        .slice(0, state.winnersCount)
        .findIndex((w) => w.winner === winnerOption);
      if (index === -1) {
        throw new Error(
          `Winner address ${winnerOption} not found in payout registry winners.`
        );
      }
      targetWinnerIndices = [index];
    }
  } else {
    targetWinnerIndices = state.winners
      .slice(0, state.winnersCount)
      .map((w, idx) => ({ ...w, idx }))
      .filter((w) => !w.processed)
      .map((w) => w.idx);
  }

  if (targetWinnerIndices.length === 0) {
    console.log("No unprocessed winners found to reinvest.");
    return;
  }

  console.log(
    `Starting reinvestment for ${targetWinnerIndices.length} winner(s)...`
  );

  for (const winnerIndex of targetWinnerIndices) {
    const currentRegistryAcc = await rpc
      .getAccountInfo(payoutRegistryPda, { encoding: "base64" })
      .send();
    if (!currentRegistryAcc || !currentRegistryAcc.value) {
      throw new Error("Payout Registry not found during execution.");
    }
    const currentBytes = new Uint8Array(
      base64Encoder.encode(currentRegistryAcc.value.data[0])
    );
    const currentRegistry = parsePayoutRegistry(currentBytes);
    const winnerEntry = currentRegistry.winners[winnerIndex];
    const winnerOwner = winnerEntry.winner;

    if (!winnerOwner) {
      throw new Error(
        `Winner address not found in PayoutRegistry for winner index ${winnerIndex}`
      );
    }

    if (winnerEntry.processed) {
      console.log(
        `Winner ${winnerOwner} (index ${winnerIndex}) is already processed (+${winnerEntry.bondsBought} bonds bought).`
      );
      continue;
    }

    console.log(
      `Processing atomic reinvestment for Winner ${winnerOwner} (index ${winnerIndex}, Owed: ${formatAmount(
        winnerEntry.amountOwed
      )})...`
    );

    const ix = await buildReinvestWinningsInstruction({
      crank: signer.address,
      winner: winnerOwner,
      poolId,
      cycleId: targetCycleId,
      winnerIndex,
      ticketRegistry: address(poolState.ticketRegistry),
    });

    console.log("Submitting reinvestment transaction...");
    await sendTx(rpc, ix, signer);
  }
  console.log("Reinvestment process completed successfully!");
}

// ─── Admin Action Handlers ───────────────────────────────────────────────────

export interface ExecuteInitGlobalParams {
  adminAccount?: string;
  guardianAccount?: string;
  jobsAccount?: string;
  rpcUrl?: string;
  signer: KeyPairSigner;
}

export async function executeInitGlobal({
  adminAccount,
  guardianAccount,
  jobsAccount,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
}: ExecuteInitGlobalParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const configPda = await findGlobalConfigPda();

  const acc = await rpc
    .getAccountInfo(configPda, { encoding: "base64" })
    .send();
  if (acc && acc.value) {
    throw new Error(
      `GlobalConfig account already exists at ${configPda}. Use 'update-global-config' to modify settings.`
    );
  }

  const admin = adminAccount ? address(adminAccount) : signer.address;
  const guardian = guardianAccount ? address(guardianAccount) : admin;
  const jobs = jobsAccount ? address(jobsAccount) : admin;
  console.log(`Initializing Global Config:
  Deployer Authority (Signer): ${signer.address}
  Admin: ${admin}
  Guardian (Pause Authority): ${guardian}
  Jobs Account (Crank): ${jobs}
  PDA: ${configPda}
`);

  const ix = await buildInitializeGlobalInstruction({
    authority: signer,
    admin,
    guardian,
    jobsAccount: jobs,
  });

  const sig = await sendTx(rpc, ix, signer);
  console.log(`✓ Global config initialized successfully! Tx: ${sig}`);
}

export async function getGlobalAdmin(rpc: SolanaRpc): Promise<Address> {
  const configPda = await findGlobalConfigPda();
  const acc = await rpc
    .getAccountInfo(configPda, { encoding: "base64" })
    .send();
  if (!acc || !acc.value) {
    throw new Error(
      `GlobalConfig account not found at ${configPda}. Run 'init-global' first.`
    );
  }
  const bytes = new Uint8Array(getBase64Encoder().encode(acc.value.data[0]));
  const state = parseGlobalConfig(bytes);
  return state.admin;
}

export interface ExecuteUpdateGlobalConfigParams {
  newAdmin?: string;
  guardianAccount?: string;
  jobsAccount?: string;
  confirm?: boolean;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeUpdateGlobalConfig({
  newAdmin,
  guardianAccount,
  jobsAccount,
  confirm = false,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteUpdateGlobalConfigParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();
  const configPda = await findGlobalConfigPda();

  const acc = await rpc
    .getAccountInfo(configPda, { encoding: "base64" })
    .send();
  if (!acc || !acc.value) {
    throw new Error(
      `GlobalConfig account does not exist at ${configPda}. Run 'init-global' first.`
    );
  }

  const state = parseGlobalConfig(
    new Uint8Array(base64Encoder.encode(acc.value.data[0]))
  );

  if (!newAdmin && !guardianAccount && !jobsAccount) {
    throw new Error(
      "No update parameters specified. Pass --new-admin, --guardian, or --jobs."
    );
  }

  if (newAdmin && !confirm) {
    throw new Error(
      `CAUTION: Transferring admin authority to "${newAdmin}" cannot be undone unless the new key signs future transactions. Pass --confirm to proceed.`
    );
  }

  console.log(`Updating Global Config:
  Current Admin: ${state.admin}
  Current Guardian: ${state.guardian}
  ${newAdmin ? `New Admin: ${newAdmin}` : ""}
  ${guardianAccount ? `New Guardian: ${guardianAccount}` : ""}
  ${jobsAccount ? `New Jobs Account: ${jobsAccount}` : ""}
`);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: state.admin,
    mode,
    commandName: "update-global-config",
    builder: async (auth) => {
      return await buildUpdateGlobalConfigInstruction({
        admin: auth,
        newAdmin: newAdmin ? address(newAdmin) : undefined,
        newGuardian: guardianAccount ? address(guardianAccount) : undefined,
        newJobsAccount: jobsAccount ? address(jobsAccount) : undefined,
      });
    },
  });
}

/**
 * Parses and validates prize tier configuration from either a comma-separated string
 * ("1:5000,2:1500,5:400") or a JSON string. Returns a clean PrizeTierInput array.
 */
export function parseAndValidatePrizeTiers(
  tiersString?: string
): PrizeTierInput[] {
  if (!tiersString || tiersString.trim().length === 0) {
    return DEFAULT_PRIZE_TIERS;
  }

  let parsedTiers: PrizeTierInput[] = [];

  if (tiersString.trim().startsWith("[")) {
    const raw = JSON.parse(tiersString);
    parsedTiers = raw.map((item: Record<string, unknown>) => ({
      numWinners: Number(
        item.numWinners ?? item.num_winners ?? item.winners ?? 0
      ),
      basisPoints: Number(
        item.basisPoints ?? item.basis_points ?? item.bps ?? 0
      ),
    }));
  } else {
    parsedTiers = tiersString.split(",").map((part) => {
      const [w, b] = part.split(":").map((v) => parseInt(v.trim(), 10));
      if (isNaN(w) || isNaN(b)) {
        throw new Error(
          `Invalid tier format in "${part}". Expected "numWinners:basisPoints".`
        );
      }
      return { numWinners: w, basisPoints: b };
    });
  }

  if (parsedTiers.length === 0 || parsedTiers.length > 10) {
    throw new Error(`Number of prize tiers must be between 1 and 10.`);
  }

  let totalWinners = 0;
  let totalBps = 0;
  parsedTiers.forEach((t, idx) => {
    if (
      !t.numWinners ||
      !t.basisPoints ||
      t.numWinners <= 0 ||
      t.basisPoints <= 0
    ) {
      throw new Error(
        `Tier ${idx + 1} must have numWinners > 0 and basisPoints > 0.`
      );
    }
    totalWinners += t.numWinners;
    totalBps += t.numWinners * t.basisPoints;
  });

  if (totalWinners > 50) {
    throw new Error(
      `Total winners (${totalWinners}) exceeds maximum allowed on-chain limit (50).`
    );
  }

  if (totalBps !== 10000) {
    throw new Error(
      `Total tier basis points product (${totalBps}) must equal exactly 10,000 (100.00%).`
    );
  }

  return parsedTiers;
}

export interface ExecuteCreatePoolParams {
  poolId?: number;
  bondPrice?: bigint | number;
  stakeCycleDurationHrs?: number;
  feeBasisPoints?: number;
  minYieldThreshold?: bigint | number;
  maxYieldBasisPoints?: number;
  payoutTimelockSeconds?: number;
  tiersString?: string;
  tokenMint?: string;
  pstMint?: string;
  feeWallet?: string;
  ticketRegistryAccount?: string;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeCreatePool({
  poolId = 1,
  bondPrice = 1_000_000,
  stakeCycleDurationHrs = 24,
  feeBasisPoints = 100,
  minYieldThreshold = 0n,
  maxYieldBasisPoints = 0,
  payoutTimelockSeconds = 300,
  tiersString = "1:10000",
  tokenMint,
  pstMint,
  feeWallet,
  ticketRegistryAccount,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteCreatePoolParams) {
  const isDevnet = rpcUrl.includes("devnet") || rpcUrl.includes("api.devnet");
  const rpc = createSolanaRpc(rpcUrl);
  const stateAddresses = loadAddresses(isDevnet);

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (poolAcc && poolAcc.value) {
    throw new Error(
      `PrizePool account for pool ${poolId} already exists at ${poolPda}.`
    );
  }

  if (BigInt(bondPrice) <= 0n) throw new Error("bondPrice must be > 0.");
  if (BigInt(stakeCycleDurationHrs) <= 0n)
    throw new Error("stakeCycleDurationHrs must be > 0.");
  if (feeBasisPoints < 0 || feeBasisPoints > 10000)
    throw new Error("feeBasisPoints must be between 0 and 10000.");
  if (BigInt(minYieldThreshold) < 0n)
    throw new Error("minYieldThreshold must be non-negative.");
  if (maxYieldBasisPoints < 0 || maxYieldBasisPoints > 10000)
    throw new Error("maxYieldBasisPoints must be between 0 and 10000.");
  if (payoutTimelockSeconds < 0 || payoutTimelockSeconds > 86400)
    throw new Error("payoutTimelockSeconds must be between 0 and 86400.");

  const prizeTiers = parseAndValidatePrizeTiers(tiersString);

  const resolvedTokenMint =
    tokenMint ||
    stateAddresses.usdcMint ||
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const resolvedPstMint = pstMint || stateAddresses.pstMint;
  const resolvedFeeWallet =
    feeWallet || stateAddresses.feeWallet || signer.address;

  if (!resolvedPstMint) {
    throw new Error(`Missing pstMint in state addresses or options.`);
  }

  let registryAddress: Address;
  let registrySignerToPass: KeyPairSigner | undefined;

  if (ticketRegistryAccount) {
    registryAddress = address(ticketRegistryAccount);
  } else {
    const ticketRegistrySigner = await generateKeyPairSigner();
    registryAddress = ticketRegistrySigner.address;
    registrySignerToPass = ticketRegistrySigner;

    const space = REGISTRY_INITIAL_SIZE;
    const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();

    if (mode.kind !== "direct") {
      console.log(
        `Pre-allocating Ticket Registry account at ${registryAddress}...`
      );
      const createRegistryIx = {
        programAddress: SYSTEM_PROGRAM_ID,
        accounts: [
          {
            address: signer.address,
            role: AccountRole.WRITABLE_SIGNER,
            signer,
          },
          {
            address: ticketRegistrySigner.address,
            role: AccountRole.WRITABLE_SIGNER,
            signer: ticketRegistrySigner,
          },
        ],
        data: buildSystemCreateAccountData(BigInt(lamports), space, PROGRAM_ID),
      };
      await sendTxWithSigners(rpc, [createRegistryIx], signer, [
        signer,
        ticketRegistrySigner,
      ]);
      console.log(
        `✓ Ticket registry account allocated and zeroed at ${registryAddress}`
      );
    }
  }

  const globalAdmin = await getGlobalAdmin(rpc);

  console.log(`Creating Prize Pool ${poolId}:
  Pool PDA: ${poolPda}
  Ticket Registry Account: ${registryAddress}
  Bond Price: ${formatAmount(bondPrice)}
  Stake Cycle Duration (Hrs): ${stakeCycleDurationHrs}
  Fee Basis Points: ${feeBasisPoints} (${feeBasisPoints / 100}%)
  Min Yield Threshold: ${formatAmount(minYieldThreshold)}
  Max Yield Basis Points: ${maxYieldBasisPoints} (${maxYieldBasisPoints / 100}%)
  Payout Timelock (Secs): ${payoutTimelockSeconds}s
  Prize Tiers: ${prizeTiers.map((t) => `${t.numWinners} winner(s) @ ${t.basisPoints / 100}%`).join(", ")}
  Token Mint: ${resolvedTokenMint}
  PST Mint: ${resolvedPstMint}
  Fee Wallet: ${resolvedFeeWallet}
`);

  if (mode.kind === "direct" && registrySignerToPass) {
    const space = REGISTRY_INITIAL_SIZE;
    const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();

    const createRegistryIx = {
      programAddress: SYSTEM_PROGRAM_ID,
      accounts: [
        {
          address: signer.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer,
        },
        {
          address: registrySignerToPass.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer: registrySignerToPass,
        },
      ],
      data: buildSystemCreateAccountData(BigInt(lamports), space, PROGRAM_ID),
    };

    const createPoolIx = await buildCreatePoolInstruction({
      admin: signer.address,
      poolId,
      bondPrice,
      stakeCycleDurationHrs,
      feeBasisPoints,
      minYieldThreshold: BigInt(minYieldThreshold),
      maxYieldBasisPoints,
      payoutTimelockSeconds,
      prizeTiers,
      tokenMint: address(resolvedTokenMint),
      pstMint: address(resolvedPstMint),
      ticketRegistry: registryAddress,
      feeWallet: address(resolvedFeeWallet),
    });

    await sendTxWithSigners(rpc, [createRegistryIx, createPoolIx], signer, [
      signer,
      registrySignerToPass,
    ]);
  } else {
    await dispatchAdminInstruction({
      rpc,
      signer,
      expectedAdmin: globalAdmin,
      mode,
      commandName: "create-pool",
      builder: async (auth) => {
        return await buildCreatePoolInstruction({
          admin: auth,
          poolId,
          bondPrice,
          stakeCycleDurationHrs,
          feeBasisPoints,
          minYieldThreshold: BigInt(minYieldThreshold),
          maxYieldBasisPoints,
          payoutTimelockSeconds,
          prizeTiers,
          tokenMint: address(resolvedTokenMint),
          pstMint: address(resolvedPstMint),
          ticketRegistry: registryAddress,
          feeWallet: address(resolvedFeeWallet),
        });
      },
    });
  }
}

export interface ExecuteInitializeHumaLenderParams {
  poolId?: number;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeInitializeHumaLender({
  poolId = 1,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteInitializeHumaLenderParams) {
  const isDevnet = rpcUrl.includes("devnet") || rpcUrl.includes("api.devnet");
  const rpc = createSolanaRpc(rpcUrl);
  const stateAddresses = loadAddresses(isDevnet);

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }

  const globalAdmin = await getGlobalAdmin(rpc);

  console.log(`Initializing Huma Lender State for Pool ${poolId}...`);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "initialize-huma-lender",
    builder: async (auth) => {
      return await buildInitializeHumaLenderInstruction({
        admin: auth,
        poolId,
        humaStateAddresses: stateAddresses,
      });
    },
  });
}

export interface ExecuteResizeRegistryParams {
  poolId?: number;
  rpcUrl?: string;
  signer: KeyPairSigner;
}

export async function executeResizeRegistry({
  poolId = 1,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
}: ExecuteResizeRegistryParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  if (poolState.isFrozenForDraw) {
    throw new Error(
      `Cannot resize registry while pool ${poolId} is frozen for draw.`
    );
  }

  const registryAddr = poolState.ticketRegistry;
  const registryAcc = await rpc
    .getAccountInfo(address(registryAddr), { encoding: "base64" })
    .send();
  if (!registryAcc || !registryAcc.value) {
    throw new Error(`TicketRegistry account at ${registryAddr} not found.`);
  }
  const registryState = parseTicketRegistry(
    new Uint8Array(base64Encoder.encode(registryAcc.value.data[0]))
  );

  console.log(`Resizing Ticket Registry for Pool ${poolId} at ${registryAddr}:
  Current Capacity: ${registryState.capacity} users
  User Count: ${registryState.userCount} users
  Current Space: ${registryAcc.value.data[0].length} bytes
`);

  const ix = await buildResizeRegistryInstruction({
    payer: signer.address,
    poolId,
    ticketRegistry: address(registryAddr),
  });

  await sendTx(rpc, ix, signer);
}

export interface ExecuteSetPrizeTiersParams {
  poolId?: number;
  tiersString?: string;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeSetPrizeTiers({
  poolId = 1,
  tiersString,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteSetPrizeTiersParams) {
  if (!tiersString) {
    throw new Error(
      `Missing --tiers argument. Format: "numWinners:basisPoints,..." (e.g. "1:5000,5:1000") or JSON array.`
    );
  }

  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  if (poolState.isFrozenForDraw) {
    throw new Error(
      `Cannot update prize tiers while pool ${poolId} is frozen for draw.`
    );
  }

  const parsedTiers = parseAndValidatePrizeTiers(tiersString);
  const totalWinners = parsedTiers.reduce((acc, t) => acc + t.numWinners, 0);
  const totalBps = parsedTiers.reduce(
    (acc, t) => acc + t.numWinners * t.basisPoints,
    0
  );

  console.log(`Setting Prize Tiers for Pool ${poolId}:`);
  parsedTiers.forEach((t, i) => {
    console.log(
      `  Tier ${i + 1}: ${t.numWinners} winner(s) @ ${t.basisPoints} bps (${t.basisPoints / 100}% each)`
    );
  });
  console.log(
    `  Total Winners: ${totalWinners}, Total Basis Points: ${totalBps}`
  );

  const globalAdmin = await getGlobalAdmin(rpc);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "set-prize-tiers",
    builder: async (auth) => {
      return await buildSetPrizeTiersInstruction({
        admin: auth,
        poolId,
        tiers: parsedTiers,
      });
    },
  });
}

export interface ExecuteUpdatePoolConfigParams {
  poolId?: number;
  feeBasisPoints?: number;
  bondPrice?: bigint | number;
  feeWallet?: string;
  minYieldThreshold?: bigint | number;
  stakeDurationHrs?: bigint | number;
  maxYieldBasisPoints?: number;
  payoutTimelockSeconds?: number;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeUpdatePoolConfig({
  poolId = 1,
  feeBasisPoints,
  bondPrice,
  feeWallet,
  minYieldThreshold,
  stakeDurationHrs,
  maxYieldBasisPoints,
  payoutTimelockSeconds,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteUpdatePoolConfigParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  if (
    feeBasisPoints === undefined &&
    bondPrice === undefined &&
    !feeWallet &&
    minYieldThreshold === undefined &&
    stakeDurationHrs === undefined &&
    maxYieldBasisPoints === undefined &&
    payoutTimelockSeconds === undefined
  ) {
    throw new Error(
      "No update options provided. Pass --fee-bps, --bond-price, --fee-wallet, --stake-duration, --min-yield-threshold, --max-yield-bps, or --payout-timelock."
    );
  }

  if (
    feeBasisPoints !== undefined &&
    (feeBasisPoints < 0 || feeBasisPoints > 10000)
  ) {
    throw new Error("feeBasisPoints must be between 0 and 10000.");
  }
  if (bondPrice !== undefined && BigInt(bondPrice) <= 0n) {
    throw new Error("bondPrice must be a positive integer.");
  }
  if (
    stakeDurationHrs !== undefined &&
    (BigInt(stakeDurationHrs) < 1n || BigInt(stakeDurationHrs) > 8760n)
  ) {
    throw new Error("stakeDurationHrs must be between 1 and 8760 hours.");
  }
  if (minYieldThreshold !== undefined && BigInt(minYieldThreshold) < 0n) {
    throw new Error("minYieldThreshold must be non-negative.");
  }
  if (
    maxYieldBasisPoints !== undefined &&
    (maxYieldBasisPoints < 1 || maxYieldBasisPoints > 10000)
  ) {
    throw new Error("maxYieldBasisPoints must be between 1 and 10000.");
  }
  if (
    payoutTimelockSeconds !== undefined &&
    (payoutTimelockSeconds < 0 || payoutTimelockSeconds > 604800)
  ) {
    throw new Error(
      "payoutTimelockSeconds must be between 0 and 604800 (7 days)."
    );
  }

  console.log(`Updating Prize Pool ${poolId} Config:
  Current Fee Basis Points: ${poolState.feeBasisPoints} ${feeBasisPoints !== undefined ? `-> New: ${feeBasisPoints}` : ""}
  Current Bond Price: ${formatAmount(poolState.bondPrice)} ${bondPrice !== undefined ? `-> New: ${formatAmount(bondPrice)}` : ""}
  Current Fee Wallet: ${poolState.feeWallet} ${feeWallet ? `-> New: ${feeWallet}` : ""}
  Current Stake Cycle Duration (Hrs): ${poolState.stakeCycleDurationHrs} ${stakeDurationHrs !== undefined ? `-> New: ${stakeDurationHrs}` : ""}
  Current Min Yield Threshold: ${formatAmount(poolState.minYieldThreshold)} ${minYieldThreshold !== undefined ? `-> New: ${formatAmount(minYieldThreshold)}` : ""}
  Current Max Yield Basis Points: ${poolState.maxYieldBasisPoints} ${maxYieldBasisPoints !== undefined ? `-> New: ${maxYieldBasisPoints}` : ""}
  Current Payout Timelock (Seconds): ${poolState.payoutTimelockSeconds}s ${payoutTimelockSeconds !== undefined ? `-> New: ${payoutTimelockSeconds}s` : ""}
`);

  const globalAdmin = await getGlobalAdmin(rpc);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "update-pool-config",
    builder: async (auth) => {
      return await buildUpdatePoolConfigInstruction({
        admin: auth,
        poolId,
        newFeeBasisPoints: feeBasisPoints,
        newBondPrice: bondPrice,
        newFeeWallet: feeWallet ? address(feeWallet) : undefined,
        newMinYieldThreshold: minYieldThreshold,
        newStakeCycleDurationHrs: stakeDurationHrs,
        newMaxYieldBasisPoints: maxYieldBasisPoints,
        newPayoutTimelockSeconds: payoutTimelockSeconds,
      });
    },
  });
}

export interface ExecuteWithdrawFeesParams {
  poolId?: number;
  amountOption?: string;
  confirm?: boolean;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeWithdrawFees({
  poolId = 1,
  amountOption,
  confirm = false,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteWithdrawFeesParams) {
  const isDevnet = rpcUrl.includes("devnet") || rpcUrl.includes("api.devnet");
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();
  const stateAddresses = loadAddresses(isDevnet);

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  if (poolState.isFrozenForDraw) {
    throw new Error(
      `Cannot withdraw fees while pool ${poolId} is frozen for draw.`
    );
  }

  const availableFees =
    poolState.totalFeesAccrued - poolState.totalFeesWithdrawn;
  if (availableFees <= 0n) {
    throw new Error(
      `No accrued protocol fees available for withdrawal. Total Accrued: ${formatAmount(
        poolState.totalFeesAccrued
      )}, Withdrawn: ${formatAmount(poolState.totalFeesWithdrawn)}`
    );
  }

  let withdrawAmount = availableFees;
  if (amountOption && amountOption !== "all") {
    const val = BigInt(amountOption);
    if (val <= 0n || val > availableFees) {
      throw new Error(
        `Invalid withdrawal amount ${val}. Must be > 0 and <= available fees (${formatAmount(availableFees)}).`
      );
    }
    withdrawAmount = val;
  }

  if (!confirm) {
    console.log(`Withdraw Fees Details:
  Pool ID: ${poolId}
  Available Fees: ${formatAmount(availableFees)}
  Requested Withdrawal: ${formatAmount(withdrawAmount)}
  Fee Wallet: ${poolState.feeWallet}
`);
    throw new Error(
      `Please re-run with --confirm to execute fee withdrawal transaction.`
    );
  }

  console.log(
    `Executing Fee Withdrawal of ${formatAmount(withdrawAmount)} for Pool ${poolId}...`
  );

  const globalAdmin = await getGlobalAdmin(rpc);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "withdraw-fees",
    preflightCheck: async ({ mode: activeMode }) => {
      if (activeMode.kind === "propose") {
        console.warn(
          `[WARNING] Dynamic PDA Drift Risk: It is strongly recommended to pause the pool ('pb-cli pause-pool --propose') prior to or in conjunction with fee withdrawal so user bond sales do not increment next_redemption_id during the voting window.`
        );
      }
    },
    builder: async (auth) => {
      return await buildWithdrawFeesInstruction({
        admin: auth,
        poolId,
        amount: withdrawAmount,
        tokenMint: address(poolState.tokenMint),
        feeWallet: address(poolState.feeWallet),
        nextRedemptionId: poolState.nextRedemptionId,
        humaStateAddresses: stateAddresses,
      });
    },
  });
}

export interface ExecutePausePoolParams {
  poolId?: number;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executePausePool({
  poolId = 1,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecutePausePoolParams) {
  const rpc = createSolanaRpc(rpcUrl);
  console.log(`Executing emergency pause for Pool ${poolId}...`);

  const configPda = await findGlobalConfigPda();
  const acc = await rpc
    .getAccountInfo(configPda, { encoding: "base64" })
    .send();
  let expectedAdmin = signer.address;
  if (acc && acc.value) {
    const bytes = new Uint8Array(getBase64Encoder().encode(acc.value.data[0]));
    const cfg = parseGlobalConfig(bytes);
    expectedAdmin = cfg.admin;
  }

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin,
    mode,
    commandName: "pause-pool",
    builder: async (auth) => {
      return await buildPausePoolInstruction({
        signer: createNoopSigner(auth),
        poolId,
      });
    },
  });
  console.log(`Pool ${poolId} has been successfully paused.`);
}

export interface ExecuteUnpausePoolParams {
  poolId?: number;
  confirm?: boolean;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeUnpausePool({
  poolId = 1,
  confirm = false,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteUnpausePoolParams) {
  const rpc = createSolanaRpc(rpcUrl);
  if (!confirm) {
    throw new Error(
      `Unpause resumes deposits, sales, and draws. Re-run with --confirm to proceed.`
    );
  }
  console.log(`Executing unpause for Pool ${poolId}...`);
  const globalAdmin = await getGlobalAdmin(rpc);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "unpause-pool",
    builder: async (auth) => {
      return await buildUnpausePoolInstruction({
        admin: createNoopSigner(auth),
        poolId,
      });
    },
  });
  console.log(`Pool ${poolId} has been successfully unpaused.`);
}

export interface ExecuteClosePoolParams {
  poolId?: number;
  confirm?: boolean;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeClosePool({
  poolId = 1,
  confirm = false,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteClosePoolParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();
  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  if (poolState.isFrozenForDraw) {
    throw new Error(
      `Cannot close pool while a draw is in flight and frozen. Please run reveal or force-unlock-draw first.`
    );
  }

  if (!confirm) {
    console.log(`PERMANENT POOL DECOMMISSION PREVIEW:
  Pool ID: ${poolId}
  Current Status: ${poolState.status}
  Total Deposited Principal: ${formatAmount(poolState.totalDepositedPrincipal)}
`);
    throw new Error(
      `Closing a pool is permanent and disables all new deposits and draws. Re-run with --confirm to proceed.`
    );
  }

  console.log(`Executing permanent close for Pool ${poolId}...`);
  const globalAdmin = await getGlobalAdmin(rpc);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "close-pool",
    builder: async (auth) => {
      return await buildClosePoolInstruction({
        admin: createNoopSigner(auth),
        poolId,
      });
    },
  });
  console.log(`Pool ${poolId} has been permanently closed for orderly sunset.`);
}

export interface ExecuteVoidDrawParams {
  poolId?: number;
  cycleId?: number;
  confirm?: boolean;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeVoidDraw({
  poolId = 1,
  cycleId,
  confirm = false,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteVoidDrawParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  const targetCycleId =
    cycleId !== undefined
      ? cycleId
      : poolState.currentDrawCycleId > 1
        ? poolState.currentDrawCycleId - 1
        : 1;

  const drawCyclePda = await findDrawCyclePda(poolId, targetCycleId);
  const drawCycleAcc = await rpc
    .getAccountInfo(drawCyclePda, { encoding: "base64" })
    .send();
  if (!drawCycleAcc || !drawCycleAcc.value) {
    throw new Error(`DrawCycle account for cycle ${targetCycleId} not found.`);
  }
  const drawCycleState = parseDrawCycle(
    new Uint8Array(base64Encoder.encode(drawCycleAcc.value.data[0]))
  );

  const payoutRegistryPda = await findPayoutRegistryPda(poolId, targetCycleId);
  const payoutRegistryAcc = await rpc
    .getAccountInfo(payoutRegistryPda, { encoding: "base64" })
    .send();
  if (!payoutRegistryAcc || !payoutRegistryAcc.value) {
    throw new Error(
      `PayoutRegistry account for cycle ${targetCycleId} not found.`
    );
  }
  const payoutState = parsePayoutRegistry(
    new Uint8Array(base64Encoder.encode(payoutRegistryAcc.value.data[0]))
  );

  if (!confirm) {
    console.log(`VOID DRAW CYCLE PREVIEW:
  Pool ID: ${poolId}
  Cycle ID: ${targetCycleId}
  Draw Status: ${drawCycleState.status}
  Payout Status: ${payoutState.status}
  Winners Drawn: ${payoutState.winnersCount}
  Payouts Completed: ${payoutState.payoutsCompleted}
  Committed Prize Pot: ${formatAmount(drawCycleState.prizePot)}
  Committed Cycle Fee: ${formatAmount(drawCycleState.cycleFeeCollected)}
`);
    throw new Error(
      `Voiding a draw cancels all pending winner prize claims and rolls back allocated prizes. Re-run with --confirm to proceed.`
    );
  }

  console.log(
    `Executing void draw for Pool ${poolId}, Cycle ${targetCycleId}...`
  );
  const globalAdmin = await getGlobalAdmin(rpc);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "void-draw",
    builder: async (auth) => {
      return await buildAdminVoidPayoutRegistryInstruction({
        admin: createNoopSigner(auth),
        poolId,
        cycleId: targetCycleId,
      });
    },
  });
  console.log(
    `Draw cycle ${targetCycleId} for Pool ${poolId} has been successfully voided.`
  );
}

export interface ExecuteForceUnlockDrawParams {
  poolId?: number;
  cycleId?: number;
  confirm?: boolean;
  rpcUrl?: string;
  signer: KeyPairSigner;
  mode?: AdminExecutionMode;
}

export async function executeForceUnlockDraw({
  poolId = 1,
  cycleId,
  confirm = false,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
  mode = { kind: "direct" },
}: ExecuteForceUnlockDrawParams) {
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  const targetCycleId =
    cycleId !== undefined
      ? cycleId
      : poolState.currentDrawCycleId > 1
        ? poolState.currentDrawCycleId - 1
        : 1;

  const drawCyclePda = await findDrawCyclePda(poolId, targetCycleId);
  const drawCycleAcc = await rpc
    .getAccountInfo(drawCyclePda, { encoding: "base64" })
    .send();
  if (!drawCycleAcc || !drawCycleAcc.value) {
    throw new Error(`DrawCycle account for cycle ${targetCycleId} not found.`);
  }
  const drawCycleState = parseDrawCycle(
    new Uint8Array(base64Encoder.encode(drawCycleAcc.value.data[0]))
  );

  if (!confirm) {
    console.log(`EMERGENCY FORCE UNLOCK PREVIEW:
  Pool ID: ${poolId}
  Cycle ID: ${targetCycleId}
  Pool Frozen: ${poolState.isFrozenForDraw}
  Draw Status: ${drawCycleState.status}
  Committed Prize Pot: ${formatAmount(drawCycleState.prizePot)}
  Committed Cycle Fee: ${formatAmount(drawCycleState.cycleFeeCollected)}
`);
    throw new Error(
      `Force unlock resets draw status and unfreezes pool. Re-run with --confirm to proceed.`
    );
  }

  console.log(
    `Executing Emergency Force Unlock for Pool ${poolId}, Cycle ${targetCycleId}...`
  );
  const globalAdmin = await getGlobalAdmin(rpc);

  await dispatchAdminInstruction({
    rpc,
    signer,
    expectedAdmin: globalAdmin,
    mode,
    commandName: "force-unlock-draw",
    builder: async (auth) => {
      return await buildAdminForceUnlockDrawInstruction({
        admin: auth,
        poolId,
        cycleId: targetCycleId,
      });
    },
  });
}

export interface ExecuteRebindRandomnessParams {
  poolId?: number;
  cycleId?: number;
  newRandomnessAccount: string;
  rpcUrl?: string;
  signer: KeyPairSigner;
}

export async function executeRebindRandomness({
  poolId = 1,
  cycleId,
  newRandomnessAccount,
  rpcUrl = "http://127.0.0.1:8899",
  signer,
}: ExecuteRebindRandomnessParams) {
  if (!newRandomnessAccount) {
    throw new Error("Missing --new-randomness <pubkey> argument.");
  }

  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  const poolPda = await findPrizePoolPda(poolId);
  const poolAcc = await rpc
    .getAccountInfo(poolPda, { encoding: "base64" })
    .send();
  if (!poolAcc || !poolAcc.value) {
    throw new Error(`PrizePool account for pool ${poolId} not found.`);
  }
  const poolState = parsePrizePool(
    new Uint8Array(base64Encoder.encode(poolAcc.value.data[0]))
  );

  const targetCycleId =
    cycleId !== undefined
      ? cycleId
      : poolState.currentDrawCycleId > 1
        ? poolState.currentDrawCycleId - 1
        : 1;

  console.log(
    `Rebinding Expired Randomness for Pool ${poolId}, Cycle ${targetCycleId} to ${newRandomnessAccount}...`
  );

  const ix = await buildCrankRebindExpiredRandomnessInstruction({
    crank: signer.address,
    poolId,
    cycleId: targetCycleId,
    newRandomnessAccount: address(newRandomnessAccount),
  });

  await sendTx(rpc, ix, signer);
}

function buildSystemCreateAccountData(
  lamports: bigint,
  space: bigint,
  ownerProgramId: string
): Uint8Array {
  const data = new Uint8Array(4 + 8 + 8 + 32);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, true);
  view.setBigUint64(4, lamports, true);
  view.setBigUint64(12, space, true);
  data.set(getBase58Encoder().encode(address(ownerProgramId)), 20);
  return data;
}

export async function sendTxWithSigners(
  rpc: ReturnType<typeof createSolanaRpc>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instructions: any[],
  feePayer: KeyPairSigner,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _signers: KeyPairSigner[]
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let baseMsg: any = createTransactionMessage({ version: 0 });
  for (const ix of instructions) {
    baseMsg = appendTransactionMessageInstruction(ix, baseMsg);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feePayerMsg: any = (setTransactionMessageFeePayerSigner as any)(
    feePayer,
    baseMsg
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message: any = (setTransactionMessageLifetimeUsingBlockhash as any)(
    latestBlockhash,
    feePayerMsg
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
          throw new Error(`Transaction failed: ${safeStringify(err)}`);
        }
        console.log("Transaction confirmed successfully!");
        return signature;
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("Failed checking signature status:", errMsg);
    }
  }

  console.warn("Transaction signature status check timed out.");
  return signature;
}

export interface ExecuteQueryMockHumaPoolStateParams {
  rpcUrl?: string;
  addressStr?: string;
}

export async function executeQueryMockHumaPoolState({
  rpcUrl = "http://127.0.0.1:8899",
  addressStr,
}: ExecuteQueryMockHumaPoolStateParams = {}): Promise<
  MockHumaPoolStateInfo & { address: string; authorityPda: string }
> {
  const isDevnet = rpcUrl.includes("devnet") || rpcUrl.includes("api.devnet");
  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();
  const stateAddresses = loadAddresses(isDevnet);
  const env = loadEnvLocal();

  const targetAddressStr =
    addressStr ||
    stateAddresses.humaPoolState ||
    env.NEXT_PUBLIC_HUMA_POOL_STATE;

  if (!targetAddressStr) {
    throw new CliArgumentError(
      "Mock Huma Pool State address not provided. Pass --address <pubkey>, specify positional argument, or define 'humaPoolState' in state JSON / .env.local."
    );
  }

  let targetAddr;
  try {
    targetAddr = address(targetAddressStr);
  } catch {
    throw new CliArgumentError(
      `Invalid Mock Huma Pool State public key address: "${targetAddressStr}"`
    );
  }

  console.log(`Querying Mock Huma Pool State at ${targetAddr}...`);
  const accountInfo = await rpc
    .getAccountInfo(targetAddr, { encoding: "base64" })
    .send();

  if (!accountInfo || !accountInfo.value) {
    throw new Error(
      `Mock Huma Pool State account at ${targetAddr} not found on-chain.`
    );
  }

  const accountOwner = accountInfo.value.owner;
  if (accountOwner !== HUMA_PROGRAM_ID.toString()) {
    console.warn(
      `Warning: Account owner (${accountOwner}) does not match expected Mock Huma Program ID (${HUMA_PROGRAM_ID}).`
    );
  }

  const rawBytes = new Uint8Array(
    base64Encoder.encode(accountInfo.value.data[0])
  );
  const state = parseMockHumaPoolState(rawBytes);
  const authorityPda = await findHumaPoolAuthorityPda(targetAddr);

  console.log(`
Mock Huma Pool State Details (${targetAddr}):
  Owner: ${accountOwner}
  Pool Authority PDA: ${authorityPda}
  Total Assets: ${formatAmount(state.totalAssets)} USDC (${state.totalAssets.toLocaleString("en-US")} base units)
  Num Modes: ${state.numModes.toLocaleString("en-US")}
  Num Config Keys: ${state.numConfigKeys.toLocaleString("en-US")}

Redemption Queue Status:
  next_request_id: ${state.nextRequestId.toLocaleString("en-US")}
  last_request_id: ${state.lastRequestId.toLocaleString("en-US")}
  Pending Requests: ${state.pendingRequests.toLocaleString("en-US")}
`);

  // Query related auxiliary accounts if known in state addresses
  if (stateAddresses.pstMint) {
    try {
      const pstAcc = await rpc
        .getAccountInfo(address(stateAddresses.pstMint), { encoding: "base64" })
        .send();
      if (pstAcc && pstAcc.value) {
        console.log(`Auxiliary Accounts:
  PST Mint: ${stateAddresses.pstMint}`);
      }
    } catch {
      // Ignore optional auxiliary query failure
    }
  }

  if (stateAddresses.humaLenderState) {
    try {
      const lenderAcc = await rpc
        .getAccountInfo(address(stateAddresses.humaLenderState), {
          encoding: "base64",
        })
        .send();
      if (lenderAcc && lenderAcc.value) {
        const lenderBytes = new Uint8Array(
          base64Encoder.encode(lenderAcc.value.data[0])
        );
        if (lenderBytes.length >= 16) {
          const view = new DataView(
            lenderBytes.buffer,
            lenderBytes.byteOffset,
            lenderBytes.byteLength
          );
          const owedAmount = view.getBigUint64(8, true);
          console.log(
            `  Huma Lender State (${stateAddresses.humaLenderState}) Owed: ${formatAmount(owedAmount)} USDC`
          );
        }
      }
    } catch {
      // Ignore optional auxiliary query failure
    }
  }

  return {
    ...state,
    address: targetAddr,
    authorityPda,
  };
}

// ─── Main CLI Logic ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const helpReq = resolveHelpRequest(args);
  if (helpReq.isHelp) {
    if (helpReq.command) {
      showCommandHelp(helpReq.command);
    } else {
      showHelp();
    }
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

  const rawMultisigFlags: RawMultisigCliFlags = {
    multisig: options["--multisig"],
    vaultIndex: options["--vault-index"],
    propose: options["--propose"] === "true",
    exportIx: options["--export-ix"] === "true",
    dryRun: options["--dry-run"] === "true",
    noAutoApprove: options["--no-auto-approve"] === "true",
  };
  const adminMode = resolveAdminExecutionMode(rawMultisigFlags);

  const rpc = createSolanaRpc(rpcUrl);
  const base64Encoder = getBase64Encoder();

  // Load keypair if performing writes
  let signer: KeyPairSigner | null = null;
  const writeCommands = new Set(
    Object.values(COMMAND_REGISTRY)
      .filter((c) => c.requiresSigner)
      .map((c) => c.command)
  );

  if (writeCommands.has(command)) {
    if (!fs.existsSync(keypairPath)) {
      throw new Error(`Keypair file not found at ${keypairPath}`);
    }
    const bytes = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    signer = await createKeyPairSignerFromBytes(new Uint8Array(bytes));
    console.log(`Loaded Keypair Address: ${signer.address}`);
  }

  switch (command) {
    case "init-global": {
      const adminAccount = options["--admin"];
      const guardianAccount = options["--guardian"];
      const jobsAccount = options["--jobs"] || positionals[0];
      await executeInitGlobal({
        adminAccount,
        guardianAccount,
        jobsAccount,
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "update-global-config": {
      const newAdmin = options["--new-admin"];
      const guardianAccount = options["--guardian"];
      const jobsAccount = options["--jobs"];
      const confirm = options["--confirm"] === "true";
      await executeUpdateGlobalConfig({
        newAdmin,
        guardianAccount,
        jobsAccount,
        confirm,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "create-pool": {
      const bondPrice = options["--bond-price"]
        ? BigInt(options["--bond-price"])
        : 1_000_000n;
      const stakeCycleDurationHrs = options["--stake-duration"]
        ? parseInt(options["--stake-duration"], 10)
        : 24;
      const feeBasisPoints = options["--fee-bps"]
        ? parseInt(options["--fee-bps"], 10)
        : 100;
      const minYieldThreshold = options["--min-yield-threshold"]
        ? BigInt(options["--min-yield-threshold"])
        : 0n;
      const maxYieldBasisPoints = options["--max-yield-bps"]
        ? parseInt(options["--max-yield-bps"], 10)
        : 0;
      const payoutTimelockSeconds = options["--payout-timelock"]
        ? parseInt(options["--payout-timelock"], 10)
        : 300;
      const tiersString = options["--tiers"] || positionals[0] || "1:10000";
      await executeCreatePool({
        poolId,
        bondPrice,
        stakeCycleDurationHrs,
        feeBasisPoints,
        minYieldThreshold,
        maxYieldBasisPoints,
        payoutTimelockSeconds,
        tiersString,
        tokenMint: options["--token-mint"],
        pstMint: options["--pst-mint"],
        feeWallet: options["--fee-wallet"],
        ticketRegistryAccount: options["--ticket-registry"],
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "initialize-huma-lender": {
      await executeInitializeHumaLender({
        poolId,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "resize-registry": {
      await executeResizeRegistry({
        poolId,
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "set-prize-tiers": {
      const tiersString = options["--tiers"] || positionals[0];
      if (!tiersString) {
        console.error("Error: Missing required option --tiers\n");
        showCommandHelp("set-prize-tiers");
        process.exit(1);
      }
      await executeSetPrizeTiers({
        poolId,
        tiersString,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "update-pool-config": {
      const feeBasisPoints = options["--fee-bps"]
        ? parseInt(options["--fee-bps"], 10)
        : undefined;
      const bondPrice = options["--bond-price"]
        ? BigInt(options["--bond-price"])
        : undefined;
      const feeWallet = options["--fee-wallet"];
      const stakeDurationHrs = options["--stake-duration"]
        ? BigInt(options["--stake-duration"])
        : undefined;
      const minYieldThreshold = options["--min-yield-threshold"]
        ? BigInt(options["--min-yield-threshold"])
        : undefined;
      const maxYieldBasisPoints = options["--max-yield-bps"]
        ? parseInt(options["--max-yield-bps"], 10)
        : undefined;
      const payoutTimelockSeconds = options["--payout-timelock"]
        ? parseInt(options["--payout-timelock"], 10)
        : undefined;
      await executeUpdatePoolConfig({
        poolId,
        feeBasisPoints,
        bondPrice,
        feeWallet,
        minYieldThreshold,
        stakeDurationHrs,
        maxYieldBasisPoints,
        payoutTimelockSeconds,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "withdraw-fees": {
      const amountOption = options["--amount"] || positionals[0];
      const confirm = options["--confirm"] === "true";
      if (!amountOption) {
        console.error("Error: Missing required option --amount\n");
        showCommandHelp("withdraw-fees");
        process.exit(1);
      }
      if (!confirm) {
        console.error("Error: Missing required flag --confirm\n");
        showCommandHelp("withdraw-fees");
        process.exit(1);
      }
      await executeWithdrawFees({
        poolId,
        amountOption,
        confirm,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "pause-pool": {
      await executePausePool({
        poolId,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "unpause-pool": {
      const confirm = options["--confirm"] === "true";
      if (!confirm) {
        console.error("Error: Missing required flag --confirm\n");
        showCommandHelp("unpause-pool");
        process.exit(1);
      }
      await executeUnpausePool({
        poolId,
        confirm,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "close-pool": {
      const confirm = options["--confirm"] === "true";
      if (!confirm) {
        console.error("Error: Missing required flag --confirm\n");
        showCommandHelp("close-pool");
        process.exit(1);
      }
      await executeClosePool({
        poolId,
        confirm,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "void-draw": {
      let cycleId = options["--cycle"]
        ? parseInt(options["--cycle"], 10)
        : undefined;
      if (cycleId === undefined && positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) cycleId = val;
      }
      const confirm = options["--confirm"] === "true";
      if (!confirm) {
        console.error("Error: Missing required flag --confirm\n");
        showCommandHelp("void-draw");
        process.exit(1);
      }
      await executeVoidDraw({
        poolId,
        cycleId,
        confirm,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "force-unlock-draw": {
      let cycleId = options["--cycle"]
        ? parseInt(options["--cycle"], 10)
        : undefined;
      if (cycleId === undefined && positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) cycleId = val;
      }
      const confirm = options["--confirm"] === "true";
      if (!confirm) {
        console.error("Error: Missing required flag --confirm\n");
        showCommandHelp("force-unlock-draw");
        process.exit(1);
      }
      await executeForceUnlockDraw({
        poolId,
        cycleId,
        confirm,
        rpcUrl,
        signer: signer!,
        mode: adminMode,
      });
      break;
    }

    case "rebind-randomness": {
      let cycleId = options["--cycle"]
        ? parseInt(options["--cycle"], 10)
        : undefined;
      if (cycleId === undefined && positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) cycleId = val;
      }
      const newRandomnessAccount =
        options["--new-randomness"] || positionals[1] || positionals[0];
      if (!newRandomnessAccount) {
        console.error("Error: Missing required option --new-randomness\n");
        showCommandHelp("rebind-randomness");
        process.exit(1);
      }
      await executeRebindRandomness({
        poolId,
        cycleId,
        newRandomnessAccount,
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "harvest": {
      await executeHarvest({ poolId, rpcUrl, signer: signer! });
      break;
    }

    case "reveal": {
      let cycleId = options["--cycle"]
        ? parseInt(options["--cycle"], 10)
        : undefined;
      if (cycleId === undefined && positionals.length > 0) {
        const val = parseInt(positionals[0], 10);
        if (!isNaN(val)) cycleId = val;
      }
      await executeReveal({
        poolId,
        cycleId,
        seedHex: options["--seed"],
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "prepare-draw": {
      const batchSize = parseInt(options["--batch-size"] || "1000", 10);
      const cycleId = options["--cycle"]
        ? parseInt(options["--cycle"], 10)
        : undefined;
      await executePrepareDraw({
        poolId,
        cycleId,
        batchSize,
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "reinvest": {
      const cycleId = options["--cycle"]
        ? parseInt(options["--cycle"], 10)
        : undefined;
      const winnerOption = options["--winner"] || positionals[0];
      await executeReinvest({
        poolId,
        cycleId,
        winnerOption,
        rpcUrl,
        signer: signer!,
      });
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
  Guardian (Pause Authority): ${state.guardian}
  Jobs Account (Crank): ${state.jobsAccount}
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
  Min Yield Threshold: ${formatAmount(state.minYieldThreshold)}
  Max Yield Basis Points: ${state.maxYieldBasisPoints} (${state.maxYieldBasisPoints / 100}%)
  Payout Timelock (Seconds): ${state.payoutTimelockSeconds}s
  Status: ${state.status}
  Total Deposited Principal: ${formatAmount(state.totalDepositedPrincipal)}
  Current Cycle End At: ${formatTimestamp(state.currentCycleEndAt)}
  Is Frozen For Draw: ${state.isFrozenForDraw}
  Current Draw Cycle ID: ${state.currentDrawCycleId}
  Prize Tiers: ${safeStringify(state.prizeTiers)}
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

      console.log(`Payout Registry for Pool ${poolId}, Cycle ${cycleId}:
  Pool ID: ${state.poolId}
  Cycle ID: ${state.cycleId}
  Winners Count: ${state.winnersCount}
  Payouts Completed: ${state.payoutsCompleted}
  Payout Progress: ${state.payoutsCompleted} / ${state.winnersCount} processed
  Winners:`);

      state.winners.slice(0, state.winnersCount).forEach((w, idx) => {
        totalOwed += w.amountOwed;

        console.log(`    [${idx}] Winner: ${w.winner}
        Tier Index: ${w.tierIndex}
        Amount Owed: ${formatAmount(w.amountOwed)}
        Bonds Bought: ${w.bondsBought}
        Processed: ${w.processed}`);
      });

      console.log(`
  Totals:
    Total Amount Owed: ${formatAmount(totalOwed)}
`);
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
          { dataSize: 138n },
          {
            memcmp: {
              offset: 32n,
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
  Type: ${RedemptionType[state.redemptionType] ?? state.redemptionType}
  Amount (USD/USDC): ${formatAmount(state.amount)}
  PST Shares Locked: ${formatAmount(state.pstSharesLocked)}
  Requested At: ${formatTimestamp(state.requestedAt)}
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
          { dataSize: 159n },
          {
            memcmp: {
              offset: 88n,
              bytes: poolIdBase58 as Base58EncodedBytes,
              encoding: "base58" as const,
            },
          },
        ];

        if (userOption) {
          filters.push({
            memcmp: {
              offset: 56n,
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
          console.log(
            `    Type: ${RedemptionType[state.redemptionType] ?? state.redemptionType}`
          );
          console.log(`    Amount (USD/USDC): ${formatAmount(state.amount)}`);
          console.log(
            `    PST Shares Locked: ${formatAmount(state.pstSharesLocked)}`
          );
          console.log(
            `    Requested At: ${formatTimestamp(state.requestedAt)}`
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
          const {
            activeTicketsCount: activeVal,
            pendingTicketsCount: pendingVal,
            isStale,
          } = resolveUserTickets(
            entry,
            registryState.drawCycleId,
            poolState.isFrozenForDraw
          );
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
  Pool Frozen for Draw: ${poolState.isFrozenForDraw}
`);

        console.log("Registered User Entries:");
        if (registryState.entries.length === 0) {
          console.log("  No registered users found.");
        } else {
          console.table(
            registryState.entries.map((e, index) => {
              const {
                activeTicketsCount: activeVal,
                pendingTicketsCount: pendingVal,
                isStale,
              } = resolveUserTickets(
                e,
                registryState.drawCycleId,
                poolState.isFrozenForDraw
              );
              return {
                Index: index,
                Owner: e.owner.slice(0, 8) + "...",
                Active: activeVal,
                Pending: pendingVal,
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

    case "query-mock-huma-pool-state": {
      const addressOption = options["--address"] || positionals[0];
      await executeQueryMockHumaPoolState({
        rpcUrl,
        addressStr: addressOption,
      });
      break;
    }

    // ─── Squads Multisig Subcommands ─────────────────────────────────────────

    case "squads-status": {
      const multisigOption = options["--multisig"] || positionals[0];
      await executeSquadsStatus({
        multisigAddressStr: multisigOption,
        rpcUrl,
      });
      break;
    }

    case "squads-proposals": {
      const multisigOption = options["--multisig"];
      const limit = options["--limit"] ? parseInt(options["--limit"], 10) : 10;
      await executeSquadsProposals({
        multisigAddressStr: multisigOption,
        limit,
        rpcUrl,
      });
      break;
    }

    case "squads-inspect-tx": {
      const multisigOption = options["--multisig"];
      const indexStr = options["--index"] || positionals[0];
      if (!indexStr) {
        throw new CliArgumentError(
          "Missing required transaction index. Pass --index <number> (e.g. --index 1)."
        );
      }
      await executeSquadsInspectTx({
        multisigAddressStr: multisigOption,
        transactionIndex: BigInt(indexStr),
        rpcUrl,
      });
      break;
    }

    case "squads-approve": {
      const multisigOption = options["--multisig"];
      const indexStr = options["--index"] || positionals[0];
      if (!indexStr) {
        throw new CliArgumentError(
          "Missing required transaction index. Pass --index <number> (e.g. --index 1)."
        );
      }
      await executeSquadsApprove({
        multisigAddressStr: multisigOption,
        transactionIndex: BigInt(indexStr),
        memo: options["--memo"],
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "squads-reject": {
      const multisigOption = options["--multisig"];
      const indexStr = options["--index"] || positionals[0];
      if (!indexStr) {
        throw new CliArgumentError(
          "Missing required transaction index. Pass --index <number> (e.g. --index 1)."
        );
      }
      await executeSquadsReject({
        multisigAddressStr: multisigOption,
        transactionIndex: BigInt(indexStr),
        memo: options["--memo"],
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "squads-cancel": {
      const multisigOption = options["--multisig"];
      const indexStr = options["--index"] || positionals[0];
      if (!indexStr) {
        throw new CliArgumentError(
          "Missing required transaction index. Pass --index <number> (e.g. --index 1)."
        );
      }
      await executeSquadsCancel({
        multisigAddressStr: multisigOption,
        transactionIndex: BigInt(indexStr),
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "squads-close": {
      const multisigOption = options["--multisig"];
      const indexStr = options["--index"] || positionals[0];
      if (!indexStr) {
        throw new CliArgumentError(
          "Missing required transaction index. Pass --index <number> (e.g. --index 1)."
        );
      }
      await executeSquadsClose({
        multisigAddressStr: multisigOption,
        transactionIndex: BigInt(indexStr),
        rentCollectorStr: options["--rent-collector"],
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    case "squads-execute": {
      const multisigOption = options["--multisig"];
      const indexStr = options["--index"] || positionals[0];
      if (!indexStr) {
        throw new CliArgumentError(
          "Missing required transaction index. Pass --index <number> (e.g. --index 1)."
        );
      }
      const cuLimit = options["--cu-limit"]
        ? parseInt(options["--cu-limit"], 10)
        : undefined;
      await executeSquadsExecute({
        multisigAddressStr: multisigOption,
        transactionIndex: BigInt(indexStr),
        cuLimit,
        rpcUrl,
        signer: signer!,
      });
      break;
    }

    default:
      console.error(`Error: Unknown command "${command}".\n`);
      showHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    if (err instanceof CliArgumentError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    printErrorDetails(err, "CLI Execution Error");
    process.exit(1);
  });
}
