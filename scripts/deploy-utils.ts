import {
  createSolanaRpc,
  Address,
  address,
  getBase58Decoder,
} from "@solana/kit";
import { execFileSync } from "child_process";
import {
  findProgramDataPda,
  decodeAccountBase64Data,
} from "../app/lib/bonds-sdk";
import { fetchAccountInfo } from "./utils";

const PROGRAM_DATA_AUTHORITY_FLAG_OFFSET = 12;
const PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET = 13;
const PUBKEY_LENGTH = 32;
const MIN_PROGRAM_DATA_HEADER_LEN =
  PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET + PUBKEY_LENGTH;

export interface ProgramDeployStatus {
  readonly isDeployed: boolean;
  readonly upgradeAuthority: Address | null;
}

/**
 * Inspects on-chain program deployment and extracts the BPF Loader Upgrade Authority.
 */
export async function getProgramDeployStatus(
  rpc: ReturnType<typeof createSolanaRpc>,
  programAddress: Address
): Promise<ProgramDeployStatus> {
  const account = await fetchAccountInfo(rpc, programAddress);
  if (!account?.value || !account.value.executable) {
    return { isDeployed: false, upgradeAuthority: null };
  }

  const programDataAddress = await findProgramDataPda(programAddress);
  const dataAccount = await fetchAccountInfo(rpc, programDataAddress);
  if (!dataAccount?.value) {
    return { isDeployed: true, upgradeAuthority: null };
  }

  const raw = decodeAccountBase64Data(dataAccount.value);
  if (!raw || raw.length < MIN_PROGRAM_DATA_HEADER_LEN) {
    return { isDeployed: true, upgradeAuthority: null };
  }

  // Verify UpgradeableLoaderState::ProgramData variant tag (3)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(0, true) !== 3) {
    return { isDeployed: true, upgradeAuthority: null };
  }

  const hasAuthority = raw[PROGRAM_DATA_AUTHORITY_FLAG_OFFSET] === 1;
  const authority = hasAuthority
    ? getBase58Decoder().decode(
        raw.subarray(
          PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET,
          PROGRAM_DATA_AUTHORITY_PUBKEY_OFFSET + PUBKEY_LENGTH
        )
      )
    : null;

  return {
    isDeployed: true,
    upgradeAuthority: authority ? address(authority) : null,
  };
}

/**
 * Reclaims SOL from aborted deploy buffers using the Solana CLI.
 */
export function cleanDeployBuffers(
  rpcUrl: string,
  payerKeypairPath: string
): void {
  console.log(
    `Reclaiming unused program deploy buffers with fee payer / authority ${payerKeypairPath}...`
  );
  execFileSync(
    "solana",
    [
      "program",
      "close",
      "--buffers",
      "--fee-payer",
      payerKeypairPath,
      "--url",
      rpcUrl,
    ],
    { stdio: "inherit" }
  );
  console.log("✓ Buffer cleanup complete.");
}
