import * as web3 from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import {
  Address,
  address,
  Instruction,
  AccountRole,
  KeyPairSigner,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  getBase58Decoder,
} from "@solana/kit";
import { PoolId, DrawCycleId, Slot, toSlot } from "../types";

export const SWITCHBOARD_ON_DEMAND_DEVNET_PID =
  "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2" as const;
export const SWITCHBOARD_ON_DEMAND_MAINNET_PID =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv" as const;
export const DEVNET_SB_QUEUE =
  "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7" as const;

export const SB_RANDOMNESS_ACCOUNT_SIZE = 408;
export const SB_AUTHORITY_OFFSET = 8;
export const SB_REQUEST_SLOT_OFFSET = 104;
export const SB_REVEAL_SLOT_OFFSET = 144;
export const SB_SEED_OFFSET = 152;
export const SB_RANDOMNESS_FRESHNESS_SLOT_LIMIT = 1000n;
export const SWITCHBOARD_RANDOMNESS_DISCRIMINATOR = [
  10, 66, 229, 135, 220, 239, 217, 114,
] as const;

export interface SwitchboardRandomnessHeader {
  readonly authority: Address;
  readonly seedSlot: Slot;
  readonly revealSlot: Slot;
}

export class SwitchboardAuthorityMismatchError extends Error {
  readonly code = "SWITCHBOARD_AUTHORITY_MISMATCH" as const;
  constructor(
    readonly randomnessAccount: Address,
    readonly onChainAuthority: Address,
    readonly crankSigner: Address
  ) {
    super(
      `[SwitchboardOnDemandProvider] Configured randomness account ${randomnessAccount} authority (${onChainAuthority}) ` +
        `does not match active crank signer (${crankSigner}). ` +
        `Run 'npm run devnet:randomness' to provision a matching randomness account.`
    );
    this.name = "SwitchboardAuthorityMismatchError";
  }
}

export function parseSwitchboardRandomnessHeader(
  data: Uint8Array | null | undefined
): SwitchboardRandomnessHeader | null {
  if (!data || data.length < SB_RANDOMNESS_ACCOUNT_SIZE) {
    return null;
  }
  for (let i = 0; i < SWITCHBOARD_RANDOMNESS_DISCRIMINATOR.length; i++) {
    if (data[i] !== SWITCHBOARD_RANDOMNESS_DISCRIMINATOR[i]) {
      return null;
    }
  }
  const authorityBytes = data.subarray(
    SB_AUTHORITY_OFFSET,
    SB_AUTHORITY_OFFSET + 32
  );
  const authority = getBase58Decoder().decode(authorityBytes) as Address;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const seedSlot = view.getBigUint64(SB_REQUEST_SLOT_OFFSET, true);
  const revealSlot = view.getBigUint64(SB_REVEAL_SLOT_OFFSET, true);

  return {
    authority,
    seedSlot: toSlot(seedSlot),
    revealSlot: toSlot(revealSlot),
  };
}

export function isRandomnessCommittable(
  header: SwitchboardRandomnessHeader,
  currentSlot: Slot
): boolean {
  const seedSlot = BigInt(header.seedSlot);
  const revealSlot = BigInt(header.revealSlot);
  const current = BigInt(currentSlot);

  return (
    seedSlot === 0n ||
    revealSlot !== 0n ||
    current - seedSlot > SB_RANDOMNESS_FRESHNESS_SLOT_LIMIT
  );
}

export function web3InstructionToKit(
  ix: web3.TransactionInstruction
): Instruction {
  return {
    programAddress: address(ix.programId.toBase58()),
    accounts: ix.keys.map((meta) => ({
      address: address(meta.pubkey.toBase58()),
      role: meta.isSigner
        ? meta.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : meta.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: new Uint8Array(ix.data),
  };
}

export interface VrfBinding {
  readonly randomnessAccount: Address;
  readonly instructions: readonly Instruction[];
  readonly signers?: readonly KeyPairSigner[];
  readonly computeUnitsRequired?: number;
}

export interface PrepareHarvestRandomnessParams {
  readonly poolId: PoolId;
  readonly cycleId: DrawCycleId;
}

export interface PrepareRebindRandomnessParams {
  readonly poolId: PoolId;
  readonly cycleId: DrawCycleId;
  readonly staleRandomness: Address;
}

export interface PrepareRevealParams {
  readonly randomnessAccount: Address;
  readonly harvestSlot: Slot;
  readonly currentSlot: Slot;
}

export type VrfRevealResult =
  | { readonly status: "ready"; readonly revealInstruction?: Instruction }
  | {
      readonly status: "pending_oracle";
      readonly reason: string;
      readonly retryAfterMs?: number;
    }
  | {
      readonly status: "uncommitted";
      readonly seedSlot: Slot;
      readonly harvestSlot: Slot;
      readonly reason: string;
    }
  | {
      readonly status: "expired";
      readonly elapsedSlots: Slot;
      readonly reason: string;
    };

export interface IVrfProvider {
  prepareHarvestRandomness(
    params: PrepareHarvestRandomnessParams
  ): Promise<VrfBinding>;
  prepareRebindRandomness(
    params: PrepareRebindRandomnessParams
  ): Promise<VrfBinding>;
  prepareReveal(params: PrepareRevealParams): Promise<VrfRevealResult>;
}

export interface VrfProviderOptions {
  readonly queueAddress?: Address;
  readonly signer?: KeyPairSigner;
}

export class MockVrfProvider implements IVrfProvider {
  private readonly poolRandomness = new Map<PoolId, Address>();

  constructor(
    private readonly mockAddress?: Address,
    private readonly rpcUrl?: string
  ) {}

  async prepareHarvestRandomness(
    params: PrepareHarvestRandomnessParams
  ): Promise<VrfBinding> {
    if (this.mockAddress) {
      return {
        randomnessAccount: this.mockAddress,
        instructions: [],
        computeUnitsRequired: 35_000,
      };
    }
    const registered = this.poolRandomness.get(params.poolId);
    if (registered) {
      return {
        randomnessAccount: registered,
        instructions: [],
        computeUnitsRequired: 35_000,
      };
    }
    const envAccount = process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT;
    if (envAccount) {
      const addr = address(envAccount);
      this.poolRandomness.set(params.poolId, addr);
      return {
        randomnessAccount: addr,
        instructions: [],
        computeUnitsRequired: 35_000,
      };
    }
    const freshSigner = await generateKeyPairSigner();
    this.poolRandomness.set(params.poolId, freshSigner.address);
    return {
      randomnessAccount: freshSigner.address,
      instructions: [],
      signers: [freshSigner],
      computeUnitsRequired: 35_000,
    };
  }

  async prepareRebindRandomness(
    params: PrepareRebindRandomnessParams
  ): Promise<VrfBinding> {
    const freshSigner = await generateKeyPairSigner();
    this.poolRandomness.set(params.poolId, freshSigner.address);
    return {
      randomnessAccount: freshSigner.address,
      instructions: [],
      signers: [freshSigner],
      computeUnitsRequired: 35_000,
    };
  }

  async prepareReveal(params: PrepareRevealParams): Promise<VrfRevealResult> {
    if (
      this.rpcUrl &&
      (this.rpcUrl.includes("127.0.0.1") ||
        this.rpcUrl.includes("localhost") ||
        this.rpcUrl.includes("surfpool"))
    ) {
      try {
        const buffer = new Uint8Array(SB_RANDOMNESS_ACCOUNT_SIZE);
        buffer.set(SWITCHBOARD_RANDOMNESS_DISCRIMINATOR, 0);
        const view = new DataView(buffer.buffer);
        view.setBigUint64(
          SB_REQUEST_SLOT_OFFSET,
          BigInt(params.harvestSlot),
          true
        );
        view.setBigUint64(
          SB_REVEAL_SLOT_OFFSET,
          BigInt(params.harvestSlot) + 1n,
          true
        );
        const seed = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          seed[i] = Math.floor(Math.random() * 256);
        }
        buffer.set(seed, SB_SEED_OFFSET);

        const dataHex = Buffer.from(buffer).toString("hex");
        const sbProgramId =
          process.env.SB_ENV === "mainnet" ||
          process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet"
            ? SWITCHBOARD_ON_DEMAND_MAINNET_PID
            : SWITCHBOARD_ON_DEMAND_DEVNET_PID;

        await fetch(this.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "surfnet_setAccount",
            params: [
              params.randomnessAccount,
              {
                lamports: 1_000_000_000,
                data: dataHex,
                owner: sbProgramId,
                executable: false,
              },
            ],
          }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        // Non-blocking in mock/unit environments
      }
    }
    return { status: "ready" };
  }
}

type SwitchboardProgram = Awaited<
  ReturnType<typeof sb.AnchorUtils.loadProgramFromProvider>
>;

export class SwitchboardOnDemandProvider implements IVrfProvider {
  private readonly activePoolRandomness = new Map<PoolId, Address>();
  private readonly queueAddress: web3.PublicKey;
  private readonly programId: web3.PublicKey;
  private readonly signer?: KeyPairSigner;
  private programPromise?: Promise<SwitchboardProgram>;

  constructor(
    private readonly rpcUrl: string,
    options?: VrfProviderOptions
  ) {
    const isMainnet =
      process.env.SB_ENV === "mainnet" ||
      process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
    this.programId = new web3.PublicKey(
      isMainnet
        ? SWITCHBOARD_ON_DEMAND_MAINNET_PID
        : SWITCHBOARD_ON_DEMAND_DEVNET_PID
    );
    this.queueAddress = new web3.PublicKey(
      options?.queueAddress ||
        process.env.NEXT_PUBLIC_SWITCHBOARD_QUEUE ||
        DEVNET_SB_QUEUE
    );
    this.signer = options?.signer;
  }

  private async getProgram(): Promise<SwitchboardProgram> {
    if (!this.programPromise) {
      this.programPromise = (async () => {
        const connection = new web3.Connection(this.rpcUrl, "confirmed");
        const dummyKeypair = web3.Keypair.generate();
        const wallet = new Wallet(dummyKeypair);
        const provider = new AnchorProvider(connection, wallet, {
          commitment: "confirmed",
        });
        return sb.AnchorUtils.loadProgramFromProvider(provider, this.programId);
      })();
      this.programPromise.catch(() => {
        this.programPromise = undefined;
      });
    }
    return this.programPromise;
  }

  async prepareHarvestRandomness(
    params: PrepareHarvestRandomnessParams
  ): Promise<VrfBinding> {
    if (!this.signer) {
      throw new Error(
        "[SwitchboardOnDemandProvider] Signer is required for harvest randomness authority validation."
      );
    }

    const poolEnvKey = `POOL_${params.poolId}_RANDOMNESS_ACCOUNT`;
    const existing =
      this.activePoolRandomness.get(params.poolId) ||
      (process.env[poolEnvKey]
        ? address(process.env[poolEnvKey]!)
        : undefined) ||
      (process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT
        ? address(process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT)
        : undefined);

    if (!existing) {
      throw new Error(
        `[SwitchboardOnDemandProvider] No randomness account configured for Pool #${params.poolId}. ` +
          `Set ${poolEnvKey} or NEXT_PUBLIC_RANDOMNESS_ACCOUNT, or run 'npm run devnet:randomness'.`
      );
    }

    const connection = new web3.Connection(this.rpcUrl, "confirmed");
    const pubkey = new web3.PublicKey(existing);
    const accountInfo = await connection.getAccountInfo(pubkey);

    if (!accountInfo) {
      throw new Error(
        `[SwitchboardOnDemandProvider] Randomness account ${existing} not found on-chain.`
      );
    }

    if (!accountInfo.owner.equals(this.programId)) {
      throw new Error(
        `[SwitchboardOnDemandProvider] Randomness account ${existing} owned by ${accountInfo.owner.toBase58()}, expected ${this.programId.toBase58()}.`
      );
    }

    const header = parseSwitchboardRandomnessHeader(accountInfo.data);
    if (!header) {
      throw new Error(
        `[SwitchboardOnDemandProvider] Randomness account ${existing} has invalid discriminator or truncated data (< ${SB_RANDOMNESS_ACCOUNT_SIZE} bytes).`
      );
    }

    if (header.authority !== this.signer.address) {
      throw new SwitchboardAuthorityMismatchError(
        existing,
        header.authority,
        this.signer.address
      );
    }

    const currentSlot = await connection.getSlot("confirmed");
    if (!isRandomnessCommittable(header, toSlot(currentSlot))) {
      throw new Error(
        `[SwitchboardOnDemandProvider] Randomness account ${existing} is currently locked in an unrevealed draw cycle ` +
          `(seedSlot=${header.seedSlot}, currentSlot=${currentSlot}). Awaiting reveal or freshness expiry.`
      );
    }

    const program = await this.getProgram();
    const randomness = new sb.Randomness(program, pubkey);
    const signerPubkey = new web3.PublicKey(this.signer.address);
    const commitIx = await randomness.commitIx(this.queueAddress, signerPubkey);
    this.activePoolRandomness.set(params.poolId, existing);

    return {
      randomnessAccount: existing,
      instructions: [web3InstructionToKit(commitIx)],
      computeUnitsRequired: 35_000,
    };
  }

  async prepareRebindRandomness(
    params: PrepareRebindRandomnessParams
  ): Promise<VrfBinding> {
    return this.provisionFreshRandomness(params.poolId);
  }

  private async provisionFreshRandomness(poolId: PoolId): Promise<VrfBinding> {
    if (!this.signer) {
      throw new Error(
        "[SwitchboardOnDemandProvider] Signer is required for provisioning fresh randomness."
      );
    }
    const program = await this.getProgram();
    const kp = web3.Keypair.generate();
    const kitSigner = await createKeyPairSignerFromBytes(kp.secretKey);
    const signerPubkey = new web3.PublicKey(this.signer.address);

    const [, createIx] = await sb.Randomness.create(
      program,
      kp,
      this.queueAddress,
      signerPubkey
    );
    const randomness = new sb.Randomness(program, kp.publicKey);
    const commitIx = await randomness.commitIx(this.queueAddress, signerPubkey);

    const randomnessAccount = kitSigner.address;
    this.activePoolRandomness.set(poolId, randomnessAccount);

    return {
      randomnessAccount,
      instructions: [
        web3InstructionToKit(createIx),
        web3InstructionToKit(commitIx),
      ],
      signers: [kitSigner],
      computeUnitsRequired: 130_000,
    };
  }

  async prepareReveal(params: PrepareRevealParams): Promise<VrfRevealResult> {
    const connection = new web3.Connection(this.rpcUrl, "confirmed");
    const pubkey = new web3.PublicKey(params.randomnessAccount);
    const accountInfo = await connection.getAccountInfo(pubkey);

    const header = parseSwitchboardRandomnessHeader(accountInfo?.data);
    if (!header) {
      return {
        status: "uncommitted",
        seedSlot: toSlot(0n),
        harvestSlot: params.harvestSlot,
        reason: `Randomness account ${params.randomnessAccount} not initialized or missing on-chain.`,
      };
    }

    const seedSlot = BigInt(header.seedSlot);

    if (seedSlot < BigInt(params.harvestSlot)) {
      return {
        status: "uncommitted",
        seedSlot: toSlot(seedSlot),
        harvestSlot: params.harvestSlot,
        reason: `Randomness seed_slot (${seedSlot}) < harvest_slot (${params.harvestSlot}). Commitment missing at state transition.`,
      };
    }

    const elapsedSlots = BigInt(params.currentSlot) - seedSlot;
    if (elapsedSlots > SB_RANDOMNESS_FRESHNESS_SLOT_LIMIT) {
      return {
        status: "expired",
        elapsedSlots: toSlot(elapsedSlots),
        reason: `Randomness freshness window exceeded 1000 slots (${elapsedSlots} slots elapsed).`,
      };
    }

    let timerId: NodeJS.Timeout | undefined;
    try {
      const program = await this.getProgram();
      const randomness = new sb.Randomness(program, pubkey);
      const signerPubkey = this.signer
        ? new web3.PublicKey(this.signer.address)
        : undefined;

      // Fetch oracle signatures from Switchboard Gateway with 10s timeout
      // (Justified: Switchboard SDK has a mandatory 3000ms internal sleep, leaving 7s for Gateway HTTP)
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => reject(new Error("Switchboard Gateway timeout (10000ms)")),
          10000
        );
      });

      const revealIx = await Promise.race([
        randomness.revealIx(signerPubkey),
        timeoutPromise,
      ]);

      return {
        status: "ready",
        revealInstruction: web3InstructionToKit(revealIx),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: "pending_oracle",
        reason: msg,
        retryAfterMs: 2000,
      };
    } finally {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    }
  }
}

export function createVrfProvider(
  rpcUrl: string,
  options?: VrfProviderOptions
): IVrfProvider {
  const isLocal =
    rpcUrl.includes("127.0.0.1") ||
    rpcUrl.includes("localhost") ||
    rpcUrl.includes("surfpool");
  if (isLocal) {
    return new MockVrfProvider(undefined, rpcUrl);
  }
  return new SwitchboardOnDemandProvider(rpcUrl, options);
}
