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
} from "@solana/kit";
import {
  PoolId,
  DrawCycleId,
  Slot,
  toSlot,
} from "../types";

export const SWITCHBOARD_ON_DEMAND_DEVNET_PID =
  "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2" as const;
export const SWITCHBOARD_ON_DEMAND_MAINNET_PID =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv" as const;
export const DEVNET_SB_QUEUE =
  "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7" as const;

export const SB_RANDOMNESS_ACCOUNT_SIZE = 408;
export const SB_REQUEST_SLOT_OFFSET = 104;
export const SB_REVEAL_SLOT_OFFSET = 144;
export const SB_SEED_OFFSET = 152;
export const SWITCHBOARD_RANDOMNESS_DISCRIMINATOR = [
  10, 66, 229, 135, 220, 239, 217, 114,
] as const;

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
        view.setBigUint64(SB_REQUEST_SLOT_OFFSET, BigInt(params.harvestSlot), true);
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

  constructor(
    private readonly rpcUrl: string,
    queueAddress?: Address
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
      queueAddress ||
        process.env.NEXT_PUBLIC_SWITCHBOARD_QUEUE ||
        DEVNET_SB_QUEUE
    );
  }

  private async getProgram(): Promise<SwitchboardProgram> {
    const connection = new web3.Connection(this.rpcUrl, "confirmed");
    const dummyKeypair = web3.Keypair.generate();
    const wallet = new Wallet(dummyKeypair);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    return sb.AnchorUtils.loadProgramFromProvider(provider, this.programId);
  }




  async prepareHarvestRandomness(
    params: PrepareHarvestRandomnessParams
  ): Promise<VrfBinding> {
    const connection = new web3.Connection(this.rpcUrl, "confirmed");
    const existing =
      this.activePoolRandomness.get(params.poolId) ||
      (process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT
        ? address(process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT)
        : undefined);

    if (existing) {
      try {
        const pubkey = new web3.PublicKey(existing);
        const accountInfo = await connection.getAccountInfo(pubkey);
        if (
          accountInfo &&
          accountInfo.owner.equals(this.programId) &&
          accountInfo.data.length >= SB_RANDOMNESS_ACCOUNT_SIZE
        ) {
          const view = new DataView(
            accountInfo.data.buffer,
            accountInfo.data.byteOffset,
            accountInfo.data.byteLength
          );
          const seedSlot = view.getBigUint64(SB_REQUEST_SLOT_OFFSET, true);
          const revealSlot = view.getBigUint64(SB_REVEAL_SLOT_OFFSET, true);
          const currentSlot = await connection.getSlot("confirmed");

          const isCommittable =
            seedSlot === 0n ||
            revealSlot !== 0n ||
            BigInt(currentSlot) - seedSlot > 1000n;

          if (isCommittable) {
            const program = await this.getProgram();
            const randomness = new sb.Randomness(program, pubkey);
            const commitIx = await randomness.commitIx(this.queueAddress);
            this.activePoolRandomness.set(params.poolId, existing);
            return {
              randomnessAccount: existing,
              instructions: [web3InstructionToKit(commitIx)],
              computeUnitsRequired: 35_000,
            };
          }
        }
      } catch (err) {
        console.warn(
          `[SwitchboardOnDemandProvider] Failed to check existing randomness committability: ${err instanceof Error ? err.message : String(err)}. Provisioning fresh account.`
        );
      }
    }

    // Provision fresh randomness account with bundled commit
    const program = await this.getProgram();
    const kp = web3.Keypair.generate();
    const kitSigner = await createKeyPairSignerFromBytes(kp.secretKey);
    const [, createIx] = await sb.Randomness.create(
      program,
      kp,
      this.queueAddress
    );
    const randomness = new sb.Randomness(program, kp.publicKey);
    const commitIx = await randomness.commitIx(this.queueAddress);

    const randomnessAccount = kitSigner.address;
    this.activePoolRandomness.set(params.poolId, randomnessAccount);

    return {
      randomnessAccount,
      instructions: [web3InstructionToKit(createIx), web3InstructionToKit(commitIx)],
      signers: [kitSigner],
      computeUnitsRequired: 130_000,
    };
  }

  async prepareRebindRandomness(
    params: PrepareRebindRandomnessParams
  ): Promise<VrfBinding> {
    const program = await this.getProgram();
    const kp = web3.Keypair.generate();
    const kitSigner = await createKeyPairSignerFromBytes(kp.secretKey);

    const [, createIx] = await sb.Randomness.create(
      program,
      kp,
      this.queueAddress
    );
    const randomness = new sb.Randomness(program, kp.publicKey);
    const commitIx = await randomness.commitIx(this.queueAddress);

    const randomnessAccount = kitSigner.address;
    this.activePoolRandomness.set(params.poolId, randomnessAccount);

    return {
      randomnessAccount,
      instructions: [web3InstructionToKit(createIx), web3InstructionToKit(commitIx)],
      signers: [kitSigner],
      computeUnitsRequired: 130_000,
    };
  }

  async prepareReveal(params: PrepareRevealParams): Promise<VrfRevealResult> {
    const connection = new web3.Connection(this.rpcUrl, "confirmed");
    const pubkey = new web3.PublicKey(params.randomnessAccount);
    const accountInfo = await connection.getAccountInfo(pubkey);

    if (!accountInfo || accountInfo.data.length < SB_RANDOMNESS_ACCOUNT_SIZE) {
      return {
        status: "uncommitted",
        seedSlot: toSlot(0n),
        harvestSlot: params.harvestSlot,
        reason: `Randomness account ${params.randomnessAccount} not initialized or missing on-chain.`,
      };
    }

    const view = new DataView(
      accountInfo.data.buffer,
      accountInfo.data.byteOffset,
      accountInfo.data.byteLength
    );
    const seedSlot = view.getBigUint64(SB_REQUEST_SLOT_OFFSET, true);

    if (seedSlot < BigInt(params.harvestSlot)) {
      return {
        status: "uncommitted",
        seedSlot: toSlot(seedSlot),
        harvestSlot: params.harvestSlot,
        reason: `Randomness seed_slot (${seedSlot}) < harvest_slot (${params.harvestSlot}). Commitment missing at state transition.`,
      };
    }

    if (BigInt(params.currentSlot) - seedSlot > 1000n) {
      return {
        status: "expired",
        elapsedSlots: toSlot(BigInt(params.currentSlot) - seedSlot),
        reason: `Randomness freshness window exceeded 1000 slots (${BigInt(params.currentSlot) - seedSlot} slots elapsed).`,
      };
    }

    try {
      const program = await this.getProgram();
      const randomness = new sb.Randomness(program, pubkey);

      // Fetch oracle signatures from Switchboard Gateway with 5s timeout
      const revealIx = await Promise.race([
        randomness.revealIx(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Switchboard Gateway timeout (5000ms)")),
            5000
          )
        ),
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
    }
  }
}

export function createVrfProvider(
  rpcUrl: string,
  queueAddress?: Address
): IVrfProvider {
  const isLocal =
    rpcUrl.includes("127.0.0.1") ||
    rpcUrl.includes("localhost") ||
    rpcUrl.includes("surfpool");
  if (isLocal) {
    return new MockVrfProvider(undefined, rpcUrl);
  }
  return new SwitchboardOnDemandProvider(rpcUrl, queueAddress);
}
