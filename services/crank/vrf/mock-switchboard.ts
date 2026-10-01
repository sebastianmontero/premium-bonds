import {
  Address,
  address,
  getBase58Encoder,
  Instruction,
  AccountRole,
} from "@solana/kit";
import { Slot, RandomnessSeed } from "../types";

export const SWITCHBOARD_ON_DEMAND_DEVNET_PID =
  "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2" as const;
export const SWITCHBOARD_ON_DEMAND_MAINNET_PID =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv" as const;

export function resolveSwitchboardProgramId(): string {
  const isMainnet =
    process.env.SB_ENV === "mainnet" ||
    process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
  return isMainnet
    ? SWITCHBOARD_ON_DEMAND_MAINNET_PID
    : SWITCHBOARD_ON_DEMAND_DEVNET_PID;
}

// Anchor instruction discriminator for global:reveal: sha256("global:reveal")[0..8]
export const MOCK_SWITCHBOARD_REVEAL_IX_DISCRIMINATOR = new Uint8Array([
  9, 35, 59, 190, 167, 249, 76, 115,
]);

export interface BuildMockRevealInstructionParams {
  readonly randomnessAccount: Address;
  readonly seed?: RandomnessSeed;
  readonly programId?: Address;
}

/**
 * Builds the atomic mock-switchboard reveal instruction.
 * Borsh layout:
 * - 8-byte Anchor discriminator
 * - Option<[u8; 32]>:
 *     - If None: 1-byte 0x00 (total length: 9 bytes)
 *     - If Some: 1-byte 0x01 + 32-byte seed (total length: 41 bytes)
 */
export function buildMockSwitchboardRevealInstruction(
  params: BuildMockRevealInstructionParams
): Instruction {
  const programAddress =
    params.programId ?? address(resolveSwitchboardProgramId());

  const data = params.seed ? new Uint8Array(8 + 1 + 32) : new Uint8Array(8 + 1);

  data.set(MOCK_SWITCHBOARD_REVEAL_IX_DISCRIMINATOR, 0);

  if (params.seed) {
    data[8] = 1; // Borsh Option::Some flag
    data.set(params.seed, 9);
  } else {
    data[8] = 0; // Borsh Option::None flag
  }

  return {
    programAddress,
    accounts: [
      {
        address: params.randomnessAccount,
        role: AccountRole.WRITABLE,
      },
    ],
    data,
  };
}

export const SB_RANDOMNESS_ACCOUNT_SIZE = 408;
export const SB_AUTHORITY_OFFSET = 8;
export const SB_REQUEST_SLOT_OFFSET = 104;
export const SB_REVEAL_SLOT_OFFSET = 144;
export const SB_SEED_OFFSET = 152;
export const SWITCHBOARD_RANDOMNESS_DISCRIMINATOR = [
  10, 66, 229, 135, 220, 239, 217, 114,
] as const;

export interface MockSwitchboardRandomnessConfig {
  readonly authority?: Address | string;
  readonly seedSlot?: Slot | bigint | number;
  readonly revealSlot?: Slot | bigint | number;
  readonly value?: Uint8Array;
}

export class MockRandomnessInjectionError extends Error {
  readonly code = "MOCK_RANDOMNESS_INJECTION_FAILED" as const;
  constructor(
    readonly targetAddress: string,
    readonly rpcUrl: string,
    readonly reason: string
  ) {
    super(
      `[MockSwitchboard] Failed to inject mock randomness account state into ${targetAddress} on RPC ${rpcUrl}: ${reason}. ` +
        `Ensure localnet/surfpool validator is running and supports 'surfnet_setAccount'.`
    );
    this.name = "MockRandomnessInjectionError";
  }
}

export function encodeMockSwitchboardRandomness(
  config?: MockSwitchboardRandomnessConfig
): Uint8Array {
  const buffer = new Uint8Array(SB_RANDOMNESS_ACCOUNT_SIZE);
  buffer.set(SWITCHBOARD_RANDOMNESS_DISCRIMINATOR, 0);

  if (config?.authority) {
    const authAddress =
      typeof config.authority === "string"
        ? address(config.authority)
        : config.authority;
    const authBytes = getBase58Encoder().encode(authAddress);
    buffer.set(authBytes, SB_AUTHORITY_OFFSET);
  }

  const view = new DataView(buffer.buffer);

  if (config?.seedSlot !== undefined) {
    view.setBigUint64(SB_REQUEST_SLOT_OFFSET, BigInt(config.seedSlot), true);
  }

  if (config?.revealSlot !== undefined) {
    view.setBigUint64(SB_REVEAL_SLOT_OFFSET, BigInt(config.revealSlot), true);
  }

  if (config?.value) {
    if (config.value.length !== 32) {
      throw new Error(
        `[MockSwitchboard] Invalid randomness value length: expected 32 bytes, got ${config.value.length}`
      );
    }
    buffer.set(config.value, SB_SEED_OFFSET);
  }

  return buffer;
}

export interface SurfnetSetAccountParams {
  readonly rpcUrl: string;
  readonly address: Address | string;
  readonly lamports?: bigint | number;
  readonly data: Uint8Array | string;
  readonly owner?: Address | string;
  readonly executable?: boolean;
  readonly timeoutMs?: number;
}

export async function setSurfnetAccount(
  params: SurfnetSetAccountParams
): Promise<void> {
  const addrStr =
    typeof params.address === "string"
      ? params.address
      : (params.address as string);
  const dataHex =
    typeof params.data === "string"
      ? params.data
      : Buffer.from(params.data).toString("hex");

  const isMainnet =
    process.env.SB_ENV === "mainnet" ||
    process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
  const defaultOwner = isMainnet
    ? SWITCHBOARD_ON_DEMAND_MAINNET_PID
    : SWITCHBOARD_ON_DEMAND_DEVNET_PID;

  const ownerStr =
    params.owner !== undefined
      ? typeof params.owner === "string"
        ? params.owner
        : (params.owner as string)
      : defaultOwner;

  const lamports =
    params.lamports !== undefined
      ? typeof params.lamports === "bigint"
        ? Number(params.lamports)
        : params.lamports
      : 1_000_000_000;

  const executable = params.executable ?? false;
  const timeoutMs = params.timeoutMs ?? 2000;

  let res: Response;
  try {
    res = await fetch(params.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "surfnet_setAccount",
        params: [
          addrStr,
          {
            lamports,
            data: dataHex,
            owner: ownerStr,
            executable,
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MockRandomnessInjectionError(addrStr, params.rpcUrl, msg);
  }

  if (!res.ok) {
    throw new MockRandomnessInjectionError(
      addrStr,
      params.rpcUrl,
      `HTTP status ${res.status} (${res.statusText})`
    );
  }

  const json = (await res.json()) as { error?: unknown };
  if (json.error) {
    const errorMsg =
      typeof json.error === "object" && json.error !== null
        ? JSON.stringify(json.error)
        : String(json.error);
    throw new MockRandomnessInjectionError(addrStr, params.rpcUrl, errorMsg);
  }
}
