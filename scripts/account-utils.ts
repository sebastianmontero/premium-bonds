import * as fs from "fs";
import * as path from "path";
import { createSolanaRpc, KeyPairSigner, Address, address } from "@solana/kit";
import {
  REGISTRY_INITIAL_SIZE,
  decodeAccountBase64Data,
} from "../app/lib/bonds-sdk";
import {
  loadOrGenerateKeypair,
  generateAndSaveKeypair,
  sendTx,
  fetchAccountInfo,
  buildCreateAccountInstruction,
} from "./utils";

export const HUMA_LENDER_STATE_SPACE = 64n;

export interface EnsureTicketRegistryParams {
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly payer: KeyPairSigner;
  readonly ticketRegistryKeyPath: string;
  readonly anchorProgramId: Address | string;
  readonly poolExistsOnChain?: boolean;
  readonly forceRegenerate?: boolean;
}

export interface EnsureTicketRegistryResult {
  readonly ticketRegistrySigner: KeyPairSigner;
  readonly ticketRegistryAddress: Address;
  readonly isNewlyAllocated: boolean;
}

/**
 * Safely verifies and allocates the Ticket Registry account on-chain.
 * Never silently deletes keypairs: archives conflicting keypairs with timestamps
 * to preserve rent SOL and requires explicit confirmation/flag for regeneration.
 */
export async function ensureTicketRegistryAllocated(
  params: EnsureTicketRegistryParams
): Promise<EnsureTicketRegistryResult> {
  const {
    rpc,
    payer,
    ticketRegistryKeyPath,
    anchorProgramId,
    poolExistsOnChain = false,
    forceRegenerate = false,
  } = params;

  let ticketRegistrySigner = await loadOrGenerateKeypair(
    ticketRegistryKeyPath,
    { overwriteIfInvalid: true, label: "Ticket Registry" }
  );
  let ticketRegistryAddress = ticketRegistrySigner.address;

  let ticketRegistryInfo = await fetchAccountInfo(rpc, ticketRegistryAddress);

  if (ticketRegistryInfo?.value) {
    const isOwnerValid =
      ticketRegistryInfo.value.owner === String(anchorProgramId);
    let isCorruptOrConflicting = !isOwnerValid;

    if (isOwnerValid && !poolExistsOnChain) {
      const rawData = decodeAccountBase64Data(ticketRegistryInfo.value);
      const isZeroed = rawData
        ? rawData.subarray(0, 8).every((b: number) => b === 0)
        : true;
      if (!isZeroed) {
        isCorruptOrConflicting = true;
      }
    }

    if (isCorruptOrConflicting) {
      const lamports = ticketRegistryInfo.value.lamports;
      const lamportsSol = Number(lamports) / 1e9;
      console.warn(
        `⚠️  Existing Ticket Registry account (${ticketRegistryAddress}) is conflicting/invalid.\n` +
          `    Owner: ${ticketRegistryInfo.value.owner} (expected: ${anchorProgramId})\n` +
          `    Balance: ${lamportsSol} SOL (${lamports} lamports)`
      );

      // Safe Archiving: Never call fs.unlinkSync!
      if (fs.existsSync(ticketRegistryKeyPath)) {
        const timestamp = Date.now();
        const dir = path.dirname(ticketRegistryKeyPath);
        const base = path.basename(ticketRegistryKeyPath, ".json");
        const archivePath = path.resolve(
          dir,
          `${base}.orphaned.${timestamp}.json`
        );
        fs.renameSync(ticketRegistryKeyPath, archivePath);
        console.log(
          `🔒 Archived conflicting keypair to ${archivePath} (preserving ${lamportsSol} SOL for recovery).`
        );
      }

      if (!forceRegenerate) {
        throw new Error(
          `Ticket Registry account key collision detected. Conflicting keypair was safely archived.\n` +
            `Please re-run with '--force-regenerate' or '-f' to generate a fresh keypair and allocate.`
        );
      }

      console.log("Generating fresh Ticket Registry keypair...");
      ticketRegistrySigner = await generateAndSaveKeypair(
        ticketRegistryKeyPath
      );
      ticketRegistryAddress = ticketRegistrySigner.address;
      console.log(`New Ticket Registry address: ${ticketRegistryAddress}`);
      ticketRegistryInfo = await fetchAccountInfo(rpc, ticketRegistryAddress);
    }
  }

  let isNewlyAllocated = false;
  if (!ticketRegistryInfo?.value) {
    const space = BigInt(REGISTRY_INITIAL_SIZE);
    const rentExempt = await rpc
      .getMinimumBalanceForRentExemption(space)
      .send();
    console.log(
      `Required rent exemption for Ticket Registry: ${Number(rentExempt) / 1e9} SOL (${space} bytes)`
    );

    const createAccountIx = buildCreateAccountInstruction({
      payer,
      newAccount: ticketRegistrySigner,
      lamports: rentExempt,
      space,
      ownerProgramId: address(anchorProgramId),
    });

    console.log(
      "Allocating Ticket Registry account via SystemProgram::CreateAccount..."
    );
    await sendTx(rpc, createAccountIx, [payer, ticketRegistrySigner]);
    console.log("✓ Ticket Registry account allocated successfully on-chain.");
    isNewlyAllocated = true;
  } else {
    console.log("Ticket Registry account already allocated on-chain.");
  }

  return {
    ticketRegistrySigner,
    ticketRegistryAddress,
    isNewlyAllocated,
  };
}

export interface ExpectedPoolAddresses {
  readonly tokenMint: Address | string;
  readonly ticketRegistry: Address | string;
  readonly feeWallet: Address | string;
}

export type PoolAddressBundle = ExpectedPoolAddresses;

/**
 * Reconciles on-chain Prize Pool configuration against expected local addresses.
 */
export function reconcilePoolState(
  onChainPool: {
    tokenMint: Address | string;
    ticketRegistry: Address | string;
    feeWallet: Address | string;
  },
  expected: ExpectedPoolAddresses
): { isMatch: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  if (String(onChainPool.tokenMint) !== String(expected.tokenMint)) {
    mismatches.push(
      `tokenMint mismatch: on-chain=${onChainPool.tokenMint} vs local=${expected.tokenMint}`
    );
  }
  if (String(onChainPool.ticketRegistry) !== String(expected.ticketRegistry)) {
    mismatches.push(
      `ticketRegistry mismatch: on-chain=${onChainPool.ticketRegistry} vs local=${expected.ticketRegistry}`
    );
  }
  if (String(onChainPool.feeWallet) !== String(expected.feeWallet)) {
    mismatches.push(
      `feeWallet mismatch: on-chain=${onChainPool.feeWallet} vs local=${expected.feeWallet}`
    );
  }
  return { isMatch: mismatches.length === 0, mismatches };
}

export interface EnsureHumaLenderStateParams {
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly payer: KeyPairSigner;
  readonly lenderStateSigner: KeyPairSigner;
  readonly humaProgramId: Address | string;
}

/**
 * Idempotently verifies and allocates the Huma lender_state account on-chain.
 */
export async function ensureHumaLenderStateOnChain(
  params: EnsureHumaLenderStateParams
): Promise<boolean> {
  const accountInfo = await fetchAccountInfo(
    params.rpc,
    params.lenderStateSigner.address
  );

  if (accountInfo?.value) {
    const isOwnerValid =
      accountInfo.value.owner === String(params.humaProgramId);
    const rawData = decodeAccountBase64Data(accountInfo.value);
    const isSpaceValid = (rawData?.length ?? 0) >= 16;

    if (isOwnerValid && isSpaceValid) {
      console.log(
        `Huma lender state account ${params.lenderStateSigner.address} already allocated on-chain.`
      );
      return false;
    }
    if (!isOwnerValid) {
      throw new Error(
        `Existing Huma lender state account ${params.lenderStateSigner.address} is owned by ${accountInfo.value.owner}, expected ${params.humaProgramId}. Please re-run init to generate a fresh keypair.`
      );
    }
    console.warn(
      `⚠️  Existing Huma lender state account has truncated space (${rawData?.length ?? 0}). Re-allocating...`
    );
  }

  console.log(
    `Allocating Huma lender state account (${params.lenderStateSigner.address}) on-chain...`
  );
  const rentExempt = await params.rpc
    .getMinimumBalanceForRentExemption(HUMA_LENDER_STATE_SPACE)
    .send();

  const createAccountIx = buildCreateAccountInstruction({
    payer: params.payer,
    newAccount: params.lenderStateSigner,
    lamports: rentExempt,
    space: HUMA_LENDER_STATE_SPACE,
    ownerProgramId: address(params.humaProgramId),
  });

  await sendTx(params.rpc, createAccountIx, [
    params.payer,
    params.lenderStateSigner,
  ]);
  console.log("✓ Huma lender state account allocated successfully on-chain.");
  return true;
}
