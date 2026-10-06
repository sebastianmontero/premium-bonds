/**
 * Squads V4 Multisig Protocol Client Module (@solana/kit native).
 *
 * Lightweight, zero-dependency implementation for Squads V4 Multisig governance.
 * Compatible with Next.js 16, React 19, and @solana/kit.
 */

import {
  Address,
  address,
  Instruction,
  AccountRole,
  KeyPairSigner,
  generateKeyPairSigner,
  getProgramDerivedAddress,
  getBase58Decoder,
  getBase58Encoder,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getBase64EncodedWireTransaction,
  type ReadonlyUint8Array,
  type Blockhash,
} from "@solana/kit";
import { createNoopSigner } from "@solana/signers";
import * as crypto from "crypto";

export { createNoopSigner };

// ─── Squads V4 Program Constants ──────────────────────────────────────────────

export const SQUADS_PROGRAM_ADDRESS = address(
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
);
export const SYSTEM_PROGRAM_ADDRESS = address(
  "11111111111111111111111111111111"
);

/**
 * Anchor 8-byte discriminator helper.
 */
export function getAnchorDiscriminator(
  prefix: string,
  name: string
): Uint8Array {
  return new Uint8Array(
    crypto
      .createHash("sha256")
      .update(`${prefix}:${name}`)
      .digest()
      .subarray(0, 8)
  );
}

// Account Discriminators
export const SQUADS_ACCOUNT_DISCRIMINATORS = {
  Multisig: getAnchorDiscriminator("account", "Multisig"),
  Proposal: getAnchorDiscriminator("account", "Proposal"),
  VaultTransaction: getAnchorDiscriminator("account", "VaultTransaction"),
  ProgramConfig: getAnchorDiscriminator("account", "ProgramConfig"),
} as const;

export const MULTISIG_DISCRIMINATOR = SQUADS_ACCOUNT_DISCRIMINATORS.Multisig;
export const PROPOSAL_DISCRIMINATOR = SQUADS_ACCOUNT_DISCRIMINATORS.Proposal;
export const VAULT_TRANSACTION_DISCRIMINATOR =
  SQUADS_ACCOUNT_DISCRIMINATORS.VaultTransaction;
export const PROGRAM_CONFIG_DISCRIMINATOR =
  SQUADS_ACCOUNT_DISCRIMINATORS.ProgramConfig;

export const PROGRAM_CONFIG_MIN_SIZE = 80;
export const SQUADS_MULTISIG_BASE_SIZE = 132;
export const SQUADS_MULTISIG_MEMBER_SIZE = 33;

export function calculateMultisigAccountSpace(memberCount: number): number {
  return SQUADS_MULTISIG_BASE_SIZE + SQUADS_MULTISIG_MEMBER_SIZE * memberCount;
}

// Instruction Sighashes
export const SQUADS_INSTRUCTION_SIGHASHES = {
  vaultTransactionCreate: getAnchorDiscriminator(
    "global",
    "vault_transaction_create"
  ),
  proposalCreate: getAnchorDiscriminator("global", "proposal_create"),
  proposalApprove: getAnchorDiscriminator("global", "proposal_approve"),
  proposalReject: getAnchorDiscriminator("global", "proposal_reject"),
  proposalCancel: getAnchorDiscriminator("global", "proposal_cancel"),
  vaultTransactionClose: getAnchorDiscriminator(
    "global",
    "vault_transaction_accounts_close"
  ),
  vaultTransactionExecute: getAnchorDiscriminator(
    "global",
    "vault_transaction_execute"
  ),
} as const;

// ─── Data Types & Interfaces ──────────────────────────────────────────────────

export const SquadsPermission = {
  Initiate: 1 << 0, // 1
  Vote: 1 << 1, // 2
  Execute: 1 << 2, // 4
} as const;

export type SquadsPermission =
  (typeof SquadsPermission)[keyof typeof SquadsPermission];
export type SquadsPermissionMask = number;

export const SQUADS_ALL_PERMISSIONS: SquadsPermissionMask =
  SquadsPermission.Initiate | SquadsPermission.Vote | SquadsPermission.Execute; // 7

export const SQUADS_PERMISSION_LABELS: ReadonlyArray<
  readonly [SquadsPermission, string]
> = [
  [SquadsPermission.Initiate, "Initiate"],
  [SquadsPermission.Vote, "Vote"],
  [SquadsPermission.Execute, "Execute"],
] as const;

export function hasSquadsPermission(
  mask: SquadsPermissionMask,
  permission: SquadsPermission
): boolean {
  return (mask & permission) === permission;
}

export function parseSquadsPermissions(mask: SquadsPermissionMask): string[] {
  return SQUADS_PERMISSION_LABELS.filter(([perm]) =>
    hasSquadsPermission(mask, perm)
  ).map(([, label]) => label);
}

export function formatSquadsPermissions(mask: SquadsPermissionMask): string {
  const labels = parseSquadsPermissions(mask);
  return `0x${mask.toString(16)} [${labels.join(", ") || "None"}]`;
}

export type ProposalStatusName =
  | "Draft"
  | "Active"
  | "Rejected"
  | "Approved"
  | "Executing"
  | "Executed"
  | "Cancelled";

export enum ProposalStatusCode {
  Draft = 0,
  Active = 1,
  Rejected = 2,
  Approved = 3,
  Executing = 4,
  Executed = 5,
  Cancelled = 6,
}

export const ProposalStatus = ProposalStatusCode;

export interface MultisigMember {
  key: Address;
  permissions: SquadsPermissionMask;
}

export interface MultisigAccount {
  address: Address;
  createKey: Address;
  configAuthority: Address;
  threshold: number;
  timeLock: number;
  transactionIndex: bigint;
  staleTransactionIndex: bigint;
  rentCollector?: Address;
  bump: number;
  members: MultisigMember[];
}

export interface ProposalAccount {
  address: Address;
  multisig: Address;
  transactionIndex: bigint;
  status: ProposalStatusName;
  statusCode: ProposalStatusCode;
  statusTimestamp?: bigint;
  approvedTimestamp?: bigint;
  executedTimestamp?: bigint;
  bump: number;
  approved: Address[];
  rejected: Address[];
  cancelled: Address[];
}

export interface MessageAddressTableLookup {
  accountKey: Address;
  writableIndexes: Uint8Array;
  readonlyIndexes: Uint8Array;
}

export interface VaultInstructionData {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

export interface VaultTransactionMessageData {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: Address[];
  instructions: VaultInstructionData[];
  addressTableLookups: readonly MessageAddressTableLookup[];
}

export interface VaultTransactionAccount {
  address: Address;
  multisig: Address;
  creator: Address;
  index: bigint;
  bump: number;
  vaultIndex: number;
  vaultBump: number;
  ephemeralSignerBumps: Uint8Array;
  ephemeralSigners: number;
  message: VaultTransactionMessageData;
}

export interface SquadsProgramConfig {
  readonly authority: Address;
  readonly multisigCreationFee: bigint;
  readonly treasury: Address;
}

// ─── PDA Derivation Utilities ─────────────────────────────────────────────────

/**
 * Derives the Squads V4 Multisig account PDA.
 * Seeds: [b"multisig", b"multisig", create_key]
 */
export async function findMultisigPda(
  createKey: Address,
  programAddress: Address = SQUADS_PROGRAM_ADDRESS
): Promise<Address> {
  const encoder = getBase58Encoder();
  const createKeyBytes = encoder.encode(createKey);
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [Buffer.from("multisig"), Buffer.from("multisig"), createKeyBytes],
  });
  return pda;
}

/**
 * Derives the Squads V4 Vault PDA.
 * Seeds: [b"multisig", multisig_pda, b"vault", &[vault_index_u8]]
 */
export async function findMultisigVaultPda(
  multisig: Address,
  vaultIndex: number = 0,
  programAddress: Address = SQUADS_PROGRAM_ADDRESS
): Promise<Address> {
  if (vaultIndex < 0 || vaultIndex > 255 || !Number.isInteger(vaultIndex)) {
    throw new Error(
      `Invalid vaultIndex: ${vaultIndex}. Must be an integer between 0 and 255.`
    );
  }
  const encoder = getBase58Encoder();
  const multisigBytes = encoder.encode(multisig);
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [
      Buffer.from("multisig"),
      multisigBytes,
      Buffer.from("vault"),
      new Uint8Array([vaultIndex]),
    ],
  });
  return pda;
}

/**
 * Derives the Squads V4 Vault Transaction PDA.
 * Seeds: [b"multisig", multisig_pda, b"transaction", &tx_index.to_le_bytes()]
 */
export async function findVaultTransactionPda(
  multisig: Address,
  transactionIndex: bigint,
  programAddress: Address = SQUADS_PROGRAM_ADDRESS
): Promise<Address> {
  const encoder = getBase58Encoder();
  const multisigBytes = encoder.encode(multisig);
  const txIndexBytes = new Uint8Array(8);
  const view = new DataView(txIndexBytes.buffer);
  view.setBigUint64(0, transactionIndex, true);

  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [
      Buffer.from("multisig"),
      multisigBytes,
      Buffer.from("transaction"),
      txIndexBytes,
    ],
  });
  return pda;
}

/**
 * Derives the Squads V4 Proposal PDA.
 * Seeds: [b"multisig", multisig_pda, b"transaction", &tx_index.to_le_bytes(), b"proposal"]
 */
export async function findProposalPda(
  multisig: Address,
  transactionIndex: bigint,
  programAddress: Address = SQUADS_PROGRAM_ADDRESS
): Promise<Address> {
  const encoder = getBase58Encoder();
  const multisigBytes = encoder.encode(multisig);
  const txIndexBytes = new Uint8Array(8);
  const view = new DataView(txIndexBytes.buffer);
  view.setBigUint64(0, transactionIndex, true);

  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [
      Buffer.from("multisig"),
      multisigBytes,
      Buffer.from("transaction"),
      txIndexBytes,
      Buffer.from("proposal"),
    ],
  });
  return pda;
}

/**
 * Derives the Squads V4 ProgramConfig PDA.
 * Seeds: [b"multisig", b"program_config"]
 */
export async function findProgramConfigPda(
  programAddress: Address = SQUADS_PROGRAM_ADDRESS
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [Buffer.from("multisig"), Buffer.from("program_config")],
  });
  return pda;
}

// ─── Binary Buffer Helpers ───────────────────────────────────────────────────

function matchesDiscriminator(data: Uint8Array, expected: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) return false;
  }
  return true;
}

function readAddress(data: Uint8Array, offset: number): Address {
  const decoder = getBase58Decoder();
  return decoder.decode(data.subarray(offset, offset + 32)) as Address;
}

// ─── Account Parsers / Decoders ───────────────────────────────────────────────

/**
 * Deserializes a Squads V4 Multisig account, asserting 8-byte discriminator.
 */
export function parseMultisigAccount(
  data: Uint8Array,
  accountAddress: Address = address("11111111111111111111111111111111")
): MultisigAccount {
  if (data.length < 100) {
    throw new Error(
      `Invalid Multisig account data size: ${data.length} bytes (minimum 100).`
    );
  }

  if (!matchesDiscriminator(data, SQUADS_ACCOUNT_DISCRIMINATORS.Multisig)) {
    throw new Error(
      `Invalid account discriminator for Multisig account at ${accountAddress}. Expected ${Buffer.from(
        SQUADS_ACCOUNT_DISCRIMINATORS.Multisig
      ).toString("hex")}`
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;

  const createKey = readAddress(data, offset);
  offset += 32;
  const configAuthority = readAddress(data, offset);
  offset += 32;
  const threshold = view.getUint16(offset, true);
  offset += 2;
  const timeLock = view.getUint32(offset, true);
  offset += 4;
  const transactionIndex = view.getBigUint64(offset, true);
  offset += 8;
  const staleTransactionIndex = view.getBigUint64(offset, true);
  offset += 8;

  // rentCollector: Option<Pubkey>
  const hasRentCollector = view.getUint8(offset) !== 0;
  offset += 1;
  let rentCollector: Address | undefined;
  if (hasRentCollector) {
    rentCollector = readAddress(data, offset);
    offset += 32;
  }

  const bump = view.getUint8(offset);
  offset += 1;

  // members: Vec<Member>
  const membersLen = view.getUint32(offset, true);
  offset += 4;
  const members: MultisigMember[] = [];
  for (let i = 0; i < membersLen; i++) {
    const key = readAddress(data, offset);
    offset += 32;
    const permissions = view.getUint8(offset);
    offset += 1;
    members.push({ key, permissions });
  }

  return {
    address: accountAddress,
    createKey,
    configAuthority,
    threshold,
    timeLock,
    transactionIndex,
    staleTransactionIndex,
    rentCollector,
    bump,
    members,
  };
}

/**
 * Deserializes a Squads V4 Proposal account, asserting 8-byte discriminator.
 */
export function parseProposalAccount(
  data: Uint8Array,
  accountAddress: Address = address("11111111111111111111111111111111")
): ProposalAccount {
  if (!matchesDiscriminator(data, SQUADS_ACCOUNT_DISCRIMINATORS.Proposal)) {
    throw new Error(
      `Invalid account discriminator for Proposal account at ${accountAddress}. Expected ${Buffer.from(
        SQUADS_ACCOUNT_DISCRIMINATORS.Proposal
      ).toString("hex")}`
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;

  const multisig = readAddress(data, offset);
  offset += 32;
  const transactionIndex = view.getBigUint64(offset, true);
  offset += 8;

  // status: ProposalStatus (Anchor data enum)
  const rawStatus = view.getUint8(offset);
  offset += 1;

  let statusTimestamp: bigint | undefined;
  // Variant 4 is Executing (unit / scalar without timestamp)
  if (rawStatus !== 4) {
    statusTimestamp = view.getBigInt64(offset, true);
    offset += 8;
  }

  const bump = view.getUint8(offset);
  offset += 1;

  const statusMap: Record<number, ProposalStatusName> = {
    0: "Draft",
    1: "Active",
    2: "Rejected",
    3: "Approved",
    4: "Executing",
    5: "Executed",
    6: "Cancelled",
  };

  const status = statusMap[rawStatus] ?? "Active";
  const statusCode = (
    rawStatus in statusMap ? rawStatus : ProposalStatusCode.Active
  ) as ProposalStatusCode;

  const approvedTimestamp =
    rawStatus === ProposalStatusCode.Approved ||
    rawStatus === ProposalStatusCode.Executed
      ? statusTimestamp
      : undefined;
  const executedTimestamp =
    rawStatus === ProposalStatusCode.Executed ? statusTimestamp : undefined;

  // approved: Vec<Pubkey>
  const approvedLen = view.getUint32(offset, true);
  offset += 4;
  const approved: Address[] = [];
  for (let i = 0; i < approvedLen; i++) {
    approved.push(readAddress(data, offset));
    offset += 32;
  }

  // rejected: Vec<Pubkey>
  const rejectedLen = view.getUint32(offset, true);
  offset += 4;
  const rejected: Address[] = [];
  for (let i = 0; i < rejectedLen; i++) {
    rejected.push(readAddress(data, offset));
    offset += 32;
  }

  // cancelled: Vec<Pubkey>
  const cancelledLen = view.getUint32(offset, true);
  offset += 4;
  const cancelled: Address[] = [];
  for (let i = 0; i < cancelledLen; i++) {
    cancelled.push(readAddress(data, offset));
    offset += 32;
  }

  return {
    address: accountAddress,
    multisig,
    transactionIndex,
    status,
    statusCode,
    statusTimestamp,
    approvedTimestamp,
    executedTimestamp,
    bump,
    approved,
    rejected,
    cancelled,
  };
}

/**
 * Deserializes a Squads V4 VaultTransaction account, asserting 8-byte discriminator.
 */
export function parseVaultTransactionAccount(
  data: Uint8Array,
  accountAddress: Address = address("11111111111111111111111111111111")
): VaultTransactionAccount {
  if (
    !matchesDiscriminator(data, SQUADS_ACCOUNT_DISCRIMINATORS.VaultTransaction)
  ) {
    throw new Error(
      `Invalid account discriminator for VaultTransaction account at ${accountAddress}. Expected ${Buffer.from(
        SQUADS_ACCOUNT_DISCRIMINATORS.VaultTransaction
      ).toString("hex")}`
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;

  const multisig = readAddress(data, offset);
  offset += 32;
  const creator = readAddress(data, offset);
  offset += 32;
  const index = view.getBigUint64(offset, true);
  offset += 8;
  const bump = view.getUint8(offset);
  offset += 1;
  const vaultIndex = view.getUint8(offset);
  offset += 1;
  const vaultBump = view.getUint8(offset);
  offset += 1;

  // ephemeralSignerBumps: Vec<u8> (bytes)
  const ephemeralSignersLen = view.getUint32(offset, true);
  offset += 4;
  const ephemeralSignerBumps = new Uint8Array(
    data.buffer,
    data.byteOffset + offset,
    ephemeralSignersLen
  );
  offset += ephemeralSignersLen;

  // message: VaultTransactionMessage
  const numSigners = view.getUint8(offset);
  offset += 1;
  const numWritableSigners = view.getUint8(offset);
  offset += 1;
  const numWritableNonSigners = view.getUint8(offset);
  offset += 1;

  const accountKeysLen = view.getUint32(offset, true);
  offset += 4;
  const accountKeys: Address[] = [];
  for (let i = 0; i < accountKeysLen; i++) {
    accountKeys.push(readAddress(data, offset));
    offset += 32;
  }

  const instructionsLen = view.getUint32(offset, true);
  offset += 4;
  const instructions: VaultInstructionData[] = [];
  for (let i = 0; i < instructionsLen; i++) {
    const programIdIndex = view.getUint8(offset);
    offset += 1;

    const accountIndexesLen = view.getUint32(offset, true);
    offset += 4;
    const accountIndexes: number[] = [];
    for (let j = 0; j < accountIndexesLen; j++) {
      accountIndexes.push(view.getUint8(offset));
      offset += 1;
    }

    const dataLen = view.getUint32(offset, true);
    offset += 4;
    const ixData = new Uint8Array(
      data.buffer,
      data.byteOffset + offset,
      dataLen
    );
    offset += dataLen;

    instructions.push({ programIdIndex, accountIndexes, data: ixData });
  }

  // addressTableLookups
  const altLen = view.getUint32(offset, true);
  offset += 4;
  const addressTableLookups: MessageAddressTableLookup[] = [];
  for (let i = 0; i < altLen; i++) {
    const accountKey = readAddress(data, offset);
    offset += 32;

    const writableLen = view.getUint32(offset, true);
    offset += 4;
    const writableIndexes = new Uint8Array(
      data.buffer,
      data.byteOffset + offset,
      writableLen
    );
    offset += writableLen;

    const readonlyLen = view.getUint32(offset, true);
    offset += 4;
    const readonlyIndexes = new Uint8Array(
      data.buffer,
      data.byteOffset + offset,
      readonlyLen
    );
    offset += readonlyLen;

    addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
  }

  return {
    address: accountAddress,
    multisig,
    creator,
    index,
    bump,
    vaultIndex,
    vaultBump,
    ephemeralSignerBumps,
    ephemeralSigners: ephemeralSignersLen,
    message: {
      numSigners,
      numWritableSigners,
      numWritableNonSigners,
      accountKeys,
      instructions,
      addressTableLookups,
    },
  };
}

/**
 * Deserializes a Squads V4 ProgramConfig account, asserting 8-byte discriminator.
 */
export function parseProgramConfigAccount(
  data: Uint8Array,
  accountAddress?: Address
): SquadsProgramConfig {
  if (data.length < PROGRAM_CONFIG_MIN_SIZE) {
    throw new Error(
      `Invalid Squads ProgramConfig account size: ${data.length} bytes.`
    );
  }
  if (!matchesDiscriminator(data, PROGRAM_CONFIG_DISCRIMINATOR)) {
    throw new Error(
      `Invalid account discriminator for ProgramConfig account${
        accountAddress ? ` at ${accountAddress}` : ""
      }.`
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const authority = readAddress(data, 8);
  const multisigCreationFee = view.getBigUint64(40, true);
  const treasury = readAddress(data, 48);
  return { authority, multisigCreationFee, treasury };
}

// ─── Domain Helper Functions ──────────────────────────────────────────────────

/**
 * Checks if a given candidate public key is an authorized multisig member.
 */
export function isMultisigMember(
  multisig: MultisigAccount,
  candidate: Address
): boolean {
  return multisig.members.some((m) => m.key === candidate);
}

/**
 * Checks if a proposal is executable given on-chain state, approvals, and current timestamp.
 */
export function isProposalExecutable(
  proposal: ProposalAccount,
  multisig: MultisigAccount,
  currentTimestamp: bigint
): { executable: boolean; reason?: string } {
  if (proposal.status === "Executed") {
    return { executable: false, reason: "Proposal already executed." };
  }
  if (proposal.status === "Cancelled" || proposal.status === "Rejected") {
    return {
      executable: false,
      reason: `Proposal has been ${proposal.status.toLowerCase()}.`,
    };
  }
  if (proposal.transactionIndex <= multisig.staleTransactionIndex) {
    return {
      executable: false,
      reason: "Proposal references a stale transaction index.",
    };
  }
  if (proposal.approved.length < multisig.threshold) {
    return {
      executable: false,
      reason: `Proposal approvals (${proposal.approved.length}) do not satisfy threshold (${multisig.threshold}).`,
    };
  }
  if (proposal.approvedTimestamp !== undefined && multisig.timeLock > 0) {
    const executeAfter = proposal.approvedTimestamp + BigInt(multisig.timeLock);
    if (currentTimestamp < executeAfter) {
      const remainingSeconds = Number(executeAfter - currentTimestamp);
      return {
        executable: false,
        reason: `Timelock active: ${remainingSeconds}s remaining before execution is permitted.`,
      };
    }
  }
  return { executable: true };
}

// ─── Borsh Compilation & Account Sorting ──────────────────────────────────────

interface AccountMetaAccumulator {
  address: Address;
  isSigner: boolean;
  isWritable: boolean;
}

/**
 * Compiles pure Instructions into a canonical VaultTransactionMessageData struct
 * with 4-group account sorting, deduplication, and index remapping.
 */
export function compileVaultTransactionMessage(
  instructions: Instruction[],
  addressTableLookups: readonly MessageAddressTableLookup[] = []
): VaultTransactionMessageData {
  const accountMap = new Map<Address, AccountMetaAccumulator>();

  for (const ix of instructions) {
    // Add program ID as readonly non-signer if not already registered
    if (!accountMap.has(ix.programAddress)) {
      accountMap.set(ix.programAddress, {
        address: ix.programAddress,
        isSigner: false,
        isWritable: false,
      });
    }

    for (const acc of ix.accounts ?? []) {
      const isSigner =
        acc.role === AccountRole.WRITABLE_SIGNER ||
        acc.role === AccountRole.READONLY_SIGNER;
      const isWritable =
        acc.role === AccountRole.WRITABLE_SIGNER ||
        acc.role === AccountRole.WRITABLE;

      const existing = accountMap.get(acc.address);
      if (!existing) {
        accountMap.set(acc.address, {
          address: acc.address,
          isSigner,
          isWritable,
        });
      } else {
        // Elevate privileges
        if (isSigner) existing.isSigner = true;
        if (isWritable) existing.isWritable = true;
      }
    }
  }

  // 4 Canonical Solana Groups:
  // 1. Writable Signers
  // 2. Readonly Signers
  // 3. Writable Non-Signers
  // 4. Readonly Non-Signers
  const writableSigners: Address[] = [];
  const readonlySigners: Address[] = [];
  const writableNonSigners: Address[] = [];
  const readonlyNonSigners: Address[] = [];

  for (const acc of accountMap.values()) {
    if (acc.isSigner && acc.isWritable) writableSigners.push(acc.address);
    else if (acc.isSigner && !acc.isWritable) readonlySigners.push(acc.address);
    else if (!acc.isSigner && acc.isWritable)
      writableNonSigners.push(acc.address);
    else readonlyNonSigners.push(acc.address);
  }

  const accountKeys = [
    ...writableSigners,
    ...readonlySigners,
    ...writableNonSigners,
    ...readonlyNonSigners,
  ];

  const numWritableSigners = writableSigners.length;
  const numSigners = writableSigners.length + readonlySigners.length;
  const numWritableNonSigners = writableNonSigners.length;

  const compiledInstructions: VaultInstructionData[] = instructions.map(
    (ix) => {
      const programIdIndex = accountKeys.indexOf(ix.programAddress);
      if (programIdIndex === -1) {
        throw new Error(
          `Failed to map program ID ${ix.programAddress} in accountKeys.`
        );
      }

      const accountIndexes = (ix.accounts ?? []).map((acc) => {
        const idx = accountKeys.indexOf(acc.address);
        if (idx === -1) {
          throw new Error(
            `Failed to map account address ${acc.address} in accountKeys.`
          );
        }
        return idx;
      });

      return {
        programIdIndex,
        accountIndexes,
        data: ix.data ? new Uint8Array(ix.data) : new Uint8Array(0),
      };
    }
  );

  return {
    numSigners,
    numWritableSigners,
    numWritableNonSigners,
    accountKeys,
    instructions: compiledInstructions,
    addressTableLookups,
  };
}

/**
 * Serializes VaultTransactionMessageData into Borsh binary bytes using Squads V4 SmallVec schema.
 */
export function serializeVaultTransactionMessage(
  msg: VaultTransactionMessageData
): Uint8Array {
  const encoder = getBase58Encoder();
  const buffers: (Uint8Array | ReadonlyUint8Array)[] = [];

  // Header (3 bytes)
  buffers.push(
    new Uint8Array([
      msg.numSigners,
      msg.numWritableSigners,
      msg.numWritableNonSigners,
    ])
  );

  // accountKeys: SmallVec<u8, Pubkey>
  if (msg.accountKeys.length > 255) {
    throw new Error(
      `accountKeys length ${msg.accountKeys.length} exceeds u8 SmallVec limit (255)`
    );
  }
  buffers.push(new Uint8Array([msg.accountKeys.length]));
  for (const k of msg.accountKeys) {
    buffers.push(encoder.encode(k));
  }

  // instructions: SmallVec<u8, CompiledInstruction>
  if (msg.instructions.length > 255) {
    throw new Error(
      `instructions length ${msg.instructions.length} exceeds u8 SmallVec limit (255)`
    );
  }
  buffers.push(new Uint8Array([msg.instructions.length]));

  for (const ix of msg.instructions) {
    // programIdIndex (u8)
    buffers.push(new Uint8Array([ix.programIdIndex]));

    // accountIndexes: SmallVec<u8, u8>
    if (ix.accountIndexes.length > 255) {
      throw new Error(
        `accountIndexes length ${ix.accountIndexes.length} exceeds u8 SmallVec limit (255)`
      );
    }
    buffers.push(new Uint8Array([ix.accountIndexes.length]));
    buffers.push(new Uint8Array(ix.accountIndexes));

    // data: SmallVec<u16, u8>
    if (ix.data.length > 65535) {
      throw new Error(
        `instruction data length ${ix.data.length} exceeds u16 SmallVec limit (65535)`
      );
    }
    const dataLen = new Uint8Array(2);
    new DataView(dataLen.buffer).setUint16(0, ix.data.length, true);
    buffers.push(dataLen);
    buffers.push(ix.data);
  }

  // addressTableLookups: SmallVec<u8, MessageAddressTableLookup>
  if (msg.addressTableLookups.length > 255) {
    throw new Error(
      `addressTableLookups length ${msg.addressTableLookups.length} exceeds u8 SmallVec limit (255)`
    );
  }
  buffers.push(new Uint8Array([msg.addressTableLookups.length]));

  for (const alt of msg.addressTableLookups) {
    buffers.push(encoder.encode(alt.accountKey));

    if (alt.writableIndexes.length > 255) {
      throw new Error(
        `writableIndexes length ${alt.writableIndexes.length} exceeds u8 SmallVec limit (255)`
      );
    }
    buffers.push(new Uint8Array([alt.writableIndexes.length]));
    buffers.push(alt.writableIndexes);

    if (alt.readonlyIndexes.length > 255) {
      throw new Error(
        `readonlyIndexes length ${alt.readonlyIndexes.length} exceeds u8 SmallVec limit (255)`
      );
    }
    buffers.push(new Uint8Array([alt.readonlyIndexes.length]));
    buffers.push(alt.readonlyIndexes);
  }

  // Combine buffers
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const b of buffers) {
    out.set(b, pos);
    pos += b.length;
  }
  return out;
}

// ─── Instruction Builders ─────────────────────────────────────────────────────

export interface BuildVaultTxCreateParams {
  multisig: Address;
  transactionPda: Address;
  creator: Address;
  rentPayer?: Address;
  vaultIndex?: number;
  ephemeralSigners?: number;
  message: VaultTransactionMessageData;
  memo?: string;
  programAddress?: Address;
}

/**
 * Builds `vault_transaction_create` instruction.
 */
export function buildVaultTransactionCreateInstruction(
  params: BuildVaultTxCreateParams
): Instruction {
  const {
    multisig,
    transactionPda,
    creator,
    rentPayer = creator,
    vaultIndex = 0,
    ephemeralSigners = 0,
    message,
    memo,
    programAddress = SQUADS_PROGRAM_ADDRESS,
  } = params;

  const sighash = SQUADS_INSTRUCTION_SIGHASHES.vaultTransactionCreate;
  const serializedMessage = serializeVaultTransactionMessage(message);

  const msgLen = new Uint8Array(4);
  new DataView(msgLen.buffer).setUint32(0, serializedMessage.length, true);

  const buffers: Uint8Array[] = [
    sighash,
    new Uint8Array([vaultIndex]),
    new Uint8Array([ephemeralSigners]),
    msgLen,
    serializedMessage,
  ];

  if (memo) {
    const memoBytes = new TextEncoder().encode(memo);
    const memoLen = new Uint8Array(4);
    new DataView(memoLen.buffer).setUint32(0, memoBytes.length, true);
    buffers.push(new Uint8Array([1])); // Option::Some
    buffers.push(memoLen);
    buffers.push(memoBytes);
  } else {
    buffers.push(new Uint8Array([0])); // Option::None
  }

  const totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
  const data = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of buffers) {
    data.set(b, pos);
    pos += b.length;
  }

  return {
    programAddress,
    accounts: [
      { address: multisig, role: AccountRole.WRITABLE },
      { address: transactionPda, role: AccountRole.WRITABLE },
      { address: creator, role: AccountRole.READONLY_SIGNER },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data,
  };
}

export interface BuildProposalCreateParams {
  multisig: Address;
  proposalPda: Address;
  creator: Address;
  rentPayer?: Address;
  transactionIndex: bigint;
  draft?: boolean;
  programAddress?: Address;
}

/**
 * Builds `proposal_create` instruction.
 */
export function buildProposalCreateInstruction(
  params: BuildProposalCreateParams
): Instruction {
  const {
    multisig,
    proposalPda,
    creator,
    rentPayer = creator,
    transactionIndex,
    draft = false,
    programAddress = SQUADS_PROGRAM_ADDRESS,
  } = params;

  const sighash = SQUADS_INSTRUCTION_SIGHASHES.proposalCreate;
  const data = new Uint8Array(8 + 8 + 1);
  data.set(sighash, 0);
  const view = new DataView(data.buffer);
  view.setBigUint64(8, transactionIndex, true);
  data[16] = draft ? 1 : 0;

  return {
    programAddress,
    accounts: [
      { address: multisig, role: AccountRole.READONLY },
      { address: proposalPda, role: AccountRole.WRITABLE },
      { address: creator, role: AccountRole.WRITABLE_SIGNER },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data,
  };
}

export interface BuildProposalVoteParams {
  multisig: Address;
  member: Address;
  proposalPda: Address;
  memo?: string;
  programAddress?: Address;
}

/**
 * Builds `proposal_approve` instruction.
 */
export function buildProposalApproveInstruction(
  params: BuildProposalVoteParams
): Instruction {
  const {
    multisig,
    member,
    proposalPda,
    memo,
    programAddress = SQUADS_PROGRAM_ADDRESS,
  } = params;
  const sighash = SQUADS_INSTRUCTION_SIGHASHES.proposalApprove;

  const buffers: Uint8Array[] = [sighash];
  if (memo) {
    const memoBytes = new TextEncoder().encode(memo);
    const memoLen = new Uint8Array(4);
    new DataView(memoLen.buffer).setUint32(0, memoBytes.length, true);
    buffers.push(new Uint8Array([1]));
    buffers.push(memoLen);
    buffers.push(memoBytes);
  } else {
    buffers.push(new Uint8Array([0]));
  }

  const totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
  const data = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of buffers) {
    data.set(b, pos);
    pos += b.length;
  }

  return {
    programAddress,
    accounts: [
      { address: multisig, role: AccountRole.READONLY },
      { address: member, role: AccountRole.WRITABLE_SIGNER },
      { address: proposalPda, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

/**
 * Builds `proposal_reject` instruction.
 */
export function buildProposalRejectInstruction(
  params: BuildProposalVoteParams
): Instruction {
  const {
    multisig,
    member,
    proposalPda,
    memo,
    programAddress = SQUADS_PROGRAM_ADDRESS,
  } = params;
  const sighash = SQUADS_INSTRUCTION_SIGHASHES.proposalReject;

  const buffers: Uint8Array[] = [sighash];
  if (memo) {
    const memoBytes = new TextEncoder().encode(memo);
    const memoLen = new Uint8Array(4);
    new DataView(memoLen.buffer).setUint32(0, memoBytes.length, true);
    buffers.push(new Uint8Array([1]));
    buffers.push(memoLen);
    buffers.push(memoBytes);
  } else {
    buffers.push(new Uint8Array([0]));
  }

  const totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
  const data = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of buffers) {
    data.set(b, pos);
    pos += b.length;
  }

  return {
    programAddress,
    accounts: [
      { address: multisig, role: AccountRole.READONLY },
      { address: member, role: AccountRole.WRITABLE_SIGNER },
      { address: proposalPda, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

/**
 * Builds `proposal_cancel` instruction.
 */
export function buildProposalCancelInstruction(
  params: BuildProposalVoteParams
): Instruction {
  const {
    multisig,
    member,
    proposalPda,
    memo,
    programAddress = SQUADS_PROGRAM_ADDRESS,
  } = params;
  const sighash = SQUADS_INSTRUCTION_SIGHASHES.proposalCancel;

  const buffers: Uint8Array[] = [sighash];
  if (memo) {
    const memoBytes = new TextEncoder().encode(memo);
    const memoLen = new Uint8Array(4);
    new DataView(memoLen.buffer).setUint32(0, memoBytes.length, true);
    buffers.push(new Uint8Array([1]));
    buffers.push(memoLen);
    buffers.push(memoBytes);
  } else {
    buffers.push(new Uint8Array([0]));
  }

  const totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
  const data = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of buffers) {
    data.set(b, pos);
    pos += b.length;
  }

  return {
    programAddress,
    accounts: [
      { address: multisig, role: AccountRole.READONLY },
      { address: member, role: AccountRole.WRITABLE_SIGNER },
      { address: proposalPda, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export interface BuildVaultTxCloseParams {
  multisig: Address;
  proposalPda: Address;
  transactionPda: Address;
  rentCollector: Address;
  programAddress?: Address;
}

/**
 * Builds `vault_transaction_close` instruction to reclaim rent from executed/cancelled proposals.
 */
export function buildVaultTransactionCloseInstruction(
  params: BuildVaultTxCloseParams
): Instruction {
  const {
    multisig,
    proposalPda,
    transactionPda,
    rentCollector,
    programAddress = SQUADS_PROGRAM_ADDRESS,
  } = params;
  const sighash = SQUADS_INSTRUCTION_SIGHASHES.vaultTransactionClose;

  return {
    programAddress,
    accounts: [
      { address: multisig, role: AccountRole.READONLY },
      { address: proposalPda, role: AccountRole.WRITABLE },
      { address: transactionPda, role: AccountRole.WRITABLE },
      { address: rentCollector, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: sighash,
  };
}

export interface BuildVaultTxExecuteParams {
  multisig: Address;
  member: Address;
  transactionIndex?: bigint;
  proposalPda?: Address;
  transactionPda?: Address;
  transactionAccount?: VaultTransactionAccount;
  vaultTransactionMessage?: VaultTransactionMessageData;
  programAddress?: Address;
}

/**
 * Builds `vault_transaction_execute` instruction with resolved remaining accounts.
 */
export async function buildVaultTransactionExecuteInstruction(
  params: BuildVaultTxExecuteParams
): Promise<Instruction> {
  const { multisig, member, programAddress = SQUADS_PROGRAM_ADDRESS } = params;

  let proposalPda = params.proposalPda;
  let transactionPda = params.transactionPda;

  if (
    (!proposalPda || !transactionPda) &&
    params.transactionIndex !== undefined
  ) {
    if (!proposalPda)
      proposalPda = await findProposalPda(
        multisig,
        params.transactionIndex,
        programAddress
      );
    if (!transactionPda)
      transactionPda = await findVaultTransactionPda(
        multisig,
        params.transactionIndex,
        programAddress
      );
  }

  if (!proposalPda || !transactionPda) {
    throw new Error(
      "Missing proposalPda or transactionPda, and transactionIndex was not provided."
    );
  }

  const msg =
    params.vaultTransactionMessage || params.transactionAccount?.message;
  if (!msg) {
    throw new Error(
      "Missing vaultTransactionMessage or transactionAccount in buildVaultTransactionExecuteInstruction."
    );
  }

  const sighash = SQUADS_INSTRUCTION_SIGHASHES.vaultTransactionExecute;

  // Construct remaining accounts in exact message order
  // All accounts demoted to non-signers in outer transaction
  const remainingAccounts = msg.accountKeys.map((acc, index) => {
    // Check if writable in message
    const isWritable =
      index < msg.numWritableSigners ||
      (index >= msg.numSigners &&
        index < msg.numSigners + msg.numWritableNonSigners);

    return {
      address: acc,
      role: isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    };
  });

  return {
    programAddress,
    accounts: [
      { address: multisig, role: AccountRole.READONLY },
      { address: proposalPda, role: AccountRole.WRITABLE },
      { address: transactionPda, role: AccountRole.READONLY },
      {
        address: member,
        role: AccountRole.READONLY_SIGNER,
      },
      ...remainingAccounts,
    ],
    data: sighash,
  };
}

// ─── Wire Size Calculation & Atomic Proposal Helper ───────────────────────────

export const SOLANA_WIRE_TX_MTU = 1232;
export const SQUADS_PROPOSAL_WIRE_SIZE_LIMIT = 1100;

export interface AtomicProposeResult {
  isSingleTransaction: boolean;
  isSplit: boolean;
  tx1Instructions: Instruction[];
  tx2Instructions?: Instruction[];
  instructions: Instruction[];
  secondaryInstructions?: Instruction[];
  estimatedWireLength: number;
  transactionPda: Address;
  proposalPda: Address;
  transactionIndex: bigint;
}

export interface AtomicProposeParams {
  multisig: Address;
  creator?: Address;
  signer?: KeyPairSigner;
  transactionIndex: bigint;
  vaultIndex?: number;
  instructions?: Instruction[];
  innerInstructions?: Instruction[];
  autoApprove?: boolean;
  memo?: string;
  recentBlockhash?: string;
}

/**
 * Estimates wire size of a transaction with given instructions and signer.
 */
export async function estimateTransactionWireLength(
  instructions: Instruction[],
  feePayer?: KeyPairSigner,
  blockhash: string = "11111111111111111111111111111111"
): Promise<number> {
  const payer = feePayer || (await generateKeyPairSigner());
  const dummyLifetime = {
    blockhash: blockhash as Blockhash,
    lastValidBlockHeight: 0n,
  };
  const msg = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      dummyLifetime,
      setTransactionMessageFeePayerSigner(
        payer,
        createTransactionMessage({ version: 0 })
      )
    )
  );

  const compiled = compileTransaction(msg);
  const base64Wire = getBase64EncodedWireTransaction(compiled);
  return Buffer.from(base64Wire, "base64").length;
}

/**
 * Builds atomic proposal instructions with exact wire size estimation and 2-phase split if > 1100B.
 */
export async function buildAtomicProposeInstructions(
  params: AtomicProposeParams
): Promise<AtomicProposeResult> {
  const {
    multisig,
    signer,
    transactionIndex,
    vaultIndex = 0,
    autoApprove = true,
    memo,
    recentBlockhash,
  } = params;

  const creatorAddress = params.creator || signer?.address;
  if (!creatorAddress) {
    throw new Error(
      "Missing creator or signer in buildAtomicProposeInstructions."
    );
  }

  const targetInstructions = params.instructions || params.innerInstructions;
  if (!targetInstructions) {
    throw new Error(
      "Missing instructions or innerInstructions in buildAtomicProposeInstructions."
    );
  }

  const transactionPda = await findVaultTransactionPda(
    multisig,
    transactionIndex
  );
  const proposalPda = await findProposalPda(multisig, transactionIndex);

  const messageData = compileVaultTransactionMessage(targetInstructions);

  const createTxIx = buildVaultTransactionCreateInstruction({
    multisig,
    transactionPda,
    creator: creatorAddress,
    vaultIndex,
    message: messageData,
    memo,
  });

  const createProposalIx = buildProposalCreateInstruction({
    multisig,
    proposalPda,
    creator: creatorAddress,
    transactionIndex,
    draft: false,
  });

  const bundledInstructions: Instruction[] = [createTxIx, createProposalIx];

  let approveIx: Instruction | undefined;
  if (autoApprove) {
    approveIx = buildProposalApproveInstruction({
      multisig,
      member: creatorAddress,
      proposalPda,
      memo,
    });
    bundledInstructions.push(approveIx);
  }

  const wireLength = await estimateTransactionWireLength(
    bundledInstructions,
    signer,
    recentBlockhash
  );

  if (wireLength <= SQUADS_PROPOSAL_WIRE_SIZE_LIMIT || !approveIx) {
    return {
      isSingleTransaction: true,
      isSplit: false,
      tx1Instructions: bundledInstructions,
      instructions: bundledInstructions,
      estimatedWireLength: wireLength,
      transactionPda,
      proposalPda,
      transactionIndex,
    };
  }

  // Split into 2 Transactions
  const tx1Instructions = [createTxIx, createProposalIx];
  const tx2Instructions = [approveIx];

  return {
    isSingleTransaction: false,
    isSplit: true,
    tx1Instructions,
    instructions: tx1Instructions,
    tx2Instructions,
    secondaryInstructions: tx2Instructions,
    estimatedWireLength: wireLength,
    transactionPda,
    proposalPda,
    transactionIndex,
  };
}

// ─── Export Helpers ───────────────────────────────────────────────────────────

export interface SquadsExportPayload {
  version: string;
  multisig: string;
  vaultIndex: number;
  instructions: {
    programId: string;
    accounts: {
      pubkey: string;
      isSigner: boolean;
      isWritable: boolean;
    }[];
    data: string; // Base64
  }[];
}

/**
 * Exports instruction details into a clean JSON structure compatible with Squads Web App.
 */
export function exportSquadsTransactionJson(
  instructions: Instruction[],
  multisig: Address,
  vaultIndex: number = 0
): SquadsExportPayload {
  return {
    version: "1.0.0",
    multisig: multisig.toString(),
    vaultIndex,
    instructions: instructions.map((ix) => ({
      programId: ix.programAddress.toString(),
      accounts: (ix.accounts ?? []).map((acc) => ({
        pubkey: acc.address.toString(),
        isSigner:
          acc.role === AccountRole.WRITABLE_SIGNER ||
          acc.role === AccountRole.READONLY_SIGNER,
        isWritable:
          acc.role === AccountRole.WRITABLE_SIGNER ||
          acc.role === AccountRole.WRITABLE,
      })),
      data: ix.data ? Buffer.from(ix.data).toString("base64") : "",
    })),
  };
}
