import * as web3 from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import {
  mergeHealthyOracleSnapshots,
  selectRandomnessOracle,
  type HealthyOraclesResponse,
  type HealthyOracleGatewaySnapshot,
} from "@switchboard-xyz/common";
import {
  Address,
  address,
  Instruction,
  AccountRole,
  KeyPairSigner,
  generateKeyPairSigner,
  createKeyPairSignerFromBytes,
  getBase58Decoder,
  createSolanaRpc,
} from "@solana/kit";
import { PoolId, DrawCycleId, Slot, toSlot, RandomnessSeed } from "../types";
import { VRF_FRESHNESS_WINDOW_SLOTS } from "../constants";
import { parseOptionalAddress } from "../../../app/lib/bonds-sdk";
import {
  SWITCHBOARD_ON_DEMAND_DEVNET_PID,
  SWITCHBOARD_ON_DEMAND_MAINNET_PID,
  resolveSwitchboardProgramId,
  MOCK_SWITCHBOARD_REVEAL_IX_DISCRIMINATOR,
  buildMockSwitchboardRevealInstruction,
  type BuildMockRevealInstructionParams,
  SB_RANDOMNESS_ACCOUNT_SIZE,
  SB_AUTHORITY_OFFSET,
  SB_REQUEST_SLOT_OFFSET,
  SB_REVEAL_SLOT_OFFSET,
  SB_SEED_OFFSET,
  SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
  encodeMockSwitchboardRandomness,
  setSurfnetAccount,
  MockRandomnessInjectionError,
  MockSwitchboardRandomnessConfig,
  SurfnetSetAccountParams,
} from "./mock-switchboard";

export {
  SWITCHBOARD_ON_DEMAND_DEVNET_PID,
  SWITCHBOARD_ON_DEMAND_MAINNET_PID,
  resolveSwitchboardProgramId,
  MOCK_SWITCHBOARD_REVEAL_IX_DISCRIMINATOR,
  buildMockSwitchboardRevealInstruction,
  type BuildMockRevealInstructionParams,
  SB_RANDOMNESS_ACCOUNT_SIZE,
  SB_AUTHORITY_OFFSET,
  SB_REQUEST_SLOT_OFFSET,
  SB_REVEAL_SLOT_OFFSET,
  SB_SEED_OFFSET,
  SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
  encodeMockSwitchboardRandomness,
  setSurfnetAccount,
  MockRandomnessInjectionError,
  type MockSwitchboardRandomnessConfig,
  type SurfnetSetAccountParams,
};

export const DEVNET_SB_QUEUE =
  "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7" as const;

export const DEFAULT_GATEWAY_PROBE_TIMEOUT_MS = 1_500;
export const DEFAULT_ORACLE_CACHE_TTL_MS = 60_000;

export interface CachedOracleEntry {
  readonly oracleKey: web3.PublicKey;
  readonly expiresAt: number;
}

export interface OracleResolutionOptions {
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
}

export type SwitchboardProgram = Awaited<
  ReturnType<typeof sb.AnchorUtils.loadProgramFromProvider>
>;

export function parseGatewayUri(
  gatewayUri: Uint8Array | null | undefined
): string | null {
  if (!gatewayUri || gatewayUri.length === 0) return null;
  try {
    // C-string null termination: truncate at the first null byte
    const nullIdx = gatewayUri.indexOf(0);
    const slice = nullIdx !== -1 ? gatewayUri.subarray(0, nullIdx) : gatewayUri;
    const raw = Buffer.from(slice).toString("utf-8").trim();
    if (!raw) return null;

    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    // Preserve subpath (e.g. /devnet) while stripping trailing slashes
    const cleanPath = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${cleanPath}`;
  } catch {
    return null;
  }
}

export async function resolveHealthyQueueOracle(
  program: SwitchboardProgram,
  queueAddress: web3.PublicKey,
  options?: OracleResolutionOptions
): Promise<{ oracleKey: web3.PublicKey; ttlMs: number }> {
  const queueAccount = new sb.Queue(program, queueAddress);
  const queueData = await queueAccount.loadData();
  const oracleKeys = queueData.oracleKeys.slice(0, queueData.oracleKeysLen);

  if (oracleKeys.length === 0) {
    throw new Error(
      `[SwitchboardOnDemand] No oracle keys registered on queue ${queueAddress.toBase58()}`
    );
  }

  const loadedOracles = await sb.Oracle.loadMany(program, oracleKeys);
  const onChainGatewayUrls = loadedOracles
    .map((data) => parseGatewayUri(data?.gatewayUri))
    .filter((url): url is string => Boolean(url));

  const timeoutMs = options?.timeoutMs ?? DEFAULT_GATEWAY_PROBE_TIMEOUT_MS;
  const fetchImpl = options?.fetchFn ?? globalThis.fetch;

  // Quiet parallel health probes with native fetch and schema validation
  const probeResults = await Promise.all(
    Array.from(new Set(onChainGatewayUrls)).map(
      async (gatewayUrl): Promise<HealthyOracleGatewaySnapshot | null> => {
        try {
          const endpoint = `${gatewayUrl}/gateway/api/v1/healthy_oracles`;
          const res = await fetchImpl(endpoint, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: { Accept: "application/json" },
          });
          if (!res.ok) return null;
          const response = (await res.json()) as HealthyOraclesResponse;
          // Guard against non-array payloads
          if (!response || !Array.isArray(response.oracles)) return null;
          return { gatewayUrl, response };
        } catch {
          return null;
        }
      }
    )
  );

  const validSnapshots = probeResults.filter(
    (s): s is HealthyOracleGatewaySnapshot => s !== null
  );

  const liveHealth = mergeHealthyOracleSnapshots(validSnapshots);

  // Build candidates with fault tolerance (skip unreadable accounts instead of aborting queue)
  type OracleCandidate = ReturnType<
    typeof sb.buildSolanaRandomnessOracleCandidate
  >;
  const candidates: OracleCandidate[] = [];
  for (let i = 0; i < oracleKeys.length; i++) {
    const oracleKey = oracleKeys[i];
    const data = loadedOracles[i];
    if (!data) continue;
    candidates.push(
      sb.buildSolanaRandomnessOracleCandidate({
        oracle: new sb.Oracle(program, oracleKey),
        data,
        liveOracleHealth: liveHealth.byPullOracle.get(oracleKey.toBase58()),
        queueData,
        version: liveHealth.majorityVersion ?? undefined,
      })
    );
  }

  if (candidates.length === 0) {
    throw new Error(
      `[SwitchboardOnDemand] No readable oracle candidate accounts found on queue ${queueAddress.toBase58()}`
    );
  }

  const selection = selectRandomnessOracle(candidates);
  const selectedCandidate = selection.candidate;

  // Dynamically bound TTL by quote expiration and heartbeat timeout
  const now = Date.now();
  const quoteRemainingMs =
    selectedCandidate.validUntilUnix !== undefined
      ? selectedCandidate.validUntilUnix * 1000 - now
      : DEFAULT_ORACLE_CACHE_TTL_MS;
  const lastHeartbeatUnix = selectedCandidate.lastHeartbeatUnix;
  const heartbeatExpiryMs =
    lastHeartbeatUnix !== undefined
      ? (lastHeartbeatUnix + queueData.nodeTimeout.toNumber()) * 1000 - now
      : DEFAULT_ORACLE_CACHE_TTL_MS;
  const ttlMs = Math.max(
    1_000,
    Math.min(DEFAULT_ORACLE_CACHE_TTL_MS, quoteRemainingMs, heartbeatExpiryMs)
  );

  return {
    oracleKey: selectedCandidate.oracle.pubkey,
    ttlMs,
  };
}

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
    current - seedSlot > VRF_FRESHNESS_WINDOW_SLOTS
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
  readonly randomnessAccount?: Address;
}

export interface PrepareRebindRandomnessParams {
  readonly poolId: PoolId;
  readonly cycleId: DrawCycleId;
  readonly staleRandomness: Address;
}

export interface PrepareRevealParams {
  readonly randomnessAccount: Address;
  readonly committedSeedSlot: Slot;
  readonly currentSlot: Slot;
  readonly seed?: RandomnessSeed;
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
      readonly committedSeedSlot: Slot;
      readonly reason: string;
    }
  | {
      readonly status: "mismatch";
      readonly seedSlot: Slot;
      readonly committedSeedSlot: Slot;
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
  readonly randomnessAccount?: Address;
  readonly fetchFn?: typeof fetch;
  readonly gatewayTimeoutMs?: number;
}

export class MockVrfProvider implements IVrfProvider {
  private readonly poolRandomness = new Map<PoolId, Address>();

  constructor(
    private readonly mockAddress?: Address,
    private readonly rpcUrl?: string,
    private readonly signer?: KeyPairSigner
  ) {}

  async prepareHarvestRandomness(
    params: PrepareHarvestRandomnessParams
  ): Promise<VrfBinding> {
    const poolEnvKey = `POOL_${params.poolId}_RANDOMNESS_ACCOUNT`;
    let targetAddress: Address;

    if (params.randomnessAccount) {
      targetAddress = params.randomnessAccount;
      this.poolRandomness.set(params.poolId, targetAddress);
    } else if (this.poolRandomness.has(params.poolId)) {
      targetAddress = this.poolRandomness.get(params.poolId)!;
    } else if (parseOptionalAddress(process.env[poolEnvKey])) {
      targetAddress = parseOptionalAddress(process.env[poolEnvKey])!;
      this.poolRandomness.set(params.poolId, targetAddress);
    } else if (this.mockAddress) {
      targetAddress = this.mockAddress;
      this.poolRandomness.set(params.poolId, targetAddress);
    } else if (
      parseOptionalAddress(process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT)
    ) {
      targetAddress = parseOptionalAddress(
        process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT
      )!;
      this.poolRandomness.set(params.poolId, targetAddress);
    } else if (this.signer) {
      targetAddress = this.signer.address;
      this.poolRandomness.set(params.poolId, targetAddress);
    } else {
      const freshSigner = await generateKeyPairSigner();
      targetAddress = freshSigner.address;
      this.poolRandomness.set(params.poolId, targetAddress);
    }

    if (this.rpcUrl) {
      try {
        const rpc = createSolanaRpc(this.rpcUrl);
        const currentSlot = await rpc.getSlot().send();
        const effectiveSlot = currentSlot === 0n ? 1n : currentSlot;
        const data = encodeMockSwitchboardRandomness({
          authority: this.signer ? this.signer.address : undefined,
          seedSlot: effectiveSlot,
          revealSlot: 0n,
          value: new Uint8Array(32),
        });
        await setSurfnetAccount({
          rpcUrl: this.rpcUrl,
          address: targetAddress,
          data,
        });
      } catch (err: unknown) {
        if (err instanceof MockRandomnessInjectionError) {
          throw err;
        }
      }
    }

    return {
      randomnessAccount: targetAddress,
      instructions: [],
      computeUnitsRequired: 35_000,
    };
  }

  async prepareRebindRandomness(
    params: PrepareRebindRandomnessParams
  ): Promise<VrfBinding> {
    const freshSigner = await generateKeyPairSigner();
    this.poolRandomness.set(params.poolId, freshSigner.address);

    if (this.rpcUrl) {
      try {
        const rpc = createSolanaRpc(this.rpcUrl);
        const currentSlot = await rpc.getSlot().send();
        const effectiveSlot = currentSlot === 0n ? 1n : currentSlot;
        const data = encodeMockSwitchboardRandomness({
          authority: this.signer ? this.signer.address : undefined,
          seedSlot: effectiveSlot,
          revealSlot: 0n,
          value: new Uint8Array(32),
        });
        await setSurfnetAccount({
          rpcUrl: this.rpcUrl,
          address: freshSigner.address,
          data,
        });
      } catch (err: unknown) {
        if (err instanceof MockRandomnessInjectionError) {
          throw err;
        }
      }
    }

    return {
      randomnessAccount: freshSigner.address,
      instructions: [],
      signers: [freshSigner],
      computeUnitsRequired: 35_000,
    };
  }

  async prepareReveal(params: PrepareRevealParams): Promise<VrfRevealResult> {
    const revealInstruction = buildMockSwitchboardRevealInstruction({
      randomnessAccount: params.randomnessAccount,
      seed: params.seed,
    });

    return {
      status: "ready",
      revealInstruction,
    };
  }
}

export class SwitchboardOnDemandProvider implements IVrfProvider {
  private readonly activePoolRandomness = new Map<PoolId, Address>();
  private readonly defaultRandomnessAccount?: Address;
  private readonly queueAddress: web3.PublicKey;
  private readonly programId: web3.PublicKey;
  private readonly signer?: KeyPairSigner;
  private programPromise?: Promise<SwitchboardProgram>;
  private readonly oracleCache = new Map<string, CachedOracleEntry>();
  private readonly inFlightResolutions = new Map<
    string,
    Promise<web3.PublicKey>
  >();
  private readonly fetchFn?: typeof fetch;
  private readonly gatewayTimeoutMs?: number;

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
    this.defaultRandomnessAccount = options?.randomnessAccount;
    this.fetchFn = options?.fetchFn;
    this.gatewayTimeoutMs = options?.gatewayTimeoutMs;
  }

  public invalidateOracleCache(queueAddress?: web3.PublicKey): void {
    if (queueAddress) {
      const key = queueAddress.toBase58();
      this.oracleCache.delete(key);
      this.inFlightResolutions.delete(key);
    } else {
      this.oracleCache.clear();
      this.inFlightResolutions.clear();
    }
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

  private async getHealthyOracle(
    queueAddress: web3.PublicKey = this.queueAddress,
    options?: { forceRefresh?: boolean }
  ): Promise<web3.PublicKey> {
    const queueKey = queueAddress.toBase58();
    const now = Date.now();

    if (!options?.forceRefresh) {
      const cached = this.oracleCache.get(queueKey);
      if (cached && cached.expiresAt > now) {
        return cached.oracleKey;
      }
    }

    const inFlight = this.inFlightResolutions.get(queueKey);
    if (inFlight) {
      return inFlight;
    }

    const resolutionPromise = (async () => {
      const program = await this.getProgram();
      const { oracleKey, ttlMs } = await resolveHealthyQueueOracle(
        program,
        queueAddress,
        {
          fetchFn: this.fetchFn,
          timeoutMs: this.gatewayTimeoutMs,
        }
      );
      this.oracleCache.set(queueKey, {
        oracleKey,
        expiresAt: Date.now() + ttlMs,
      });
      return oracleKey;
    })().finally(() => {
      this.inFlightResolutions.delete(queueKey);
    });

    this.inFlightResolutions.set(queueKey, resolutionPromise);
    return resolutionPromise;
  }

  private async buildCommitInstruction(
    randomnessPubkey: web3.PublicKey,
    signerPubkey: web3.PublicKey
  ): Promise<Instruction> {
    const program = await this.getProgram();
    const randomness = new sb.Randomness(program, randomnessPubkey);
    const selectedOracle = await this.getHealthyOracle();
    const commitIx = await randomness.commitIx(
      this.queueAddress,
      signerPubkey,
      selectedOracle
    );
    return web3InstructionToKit(commitIx);
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
      params.randomnessAccount ||
      this.activePoolRandomness.get(params.poolId) ||
      parseOptionalAddress(process.env[poolEnvKey]) ||
      this.defaultRandomnessAccount ||
      parseOptionalAddress(process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT);

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

    const signerPubkey = new web3.PublicKey(this.signer.address);
    const commitInstruction = await this.buildCommitInstruction(
      pubkey,
      signerPubkey
    );
    this.activePoolRandomness.set(params.poolId, existing);

    return {
      randomnessAccount: existing,
      instructions: [commitInstruction],
      computeUnitsRequired: 35_000,
    };
  }

  async prepareRebindRandomness(
    params: PrepareRebindRandomnessParams
  ): Promise<VrfBinding> {
    this.invalidateOracleCache(this.queueAddress);
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
    const commitInstruction = await this.buildCommitInstruction(
      kp.publicKey,
      signerPubkey
    );

    const randomnessAccount = kitSigner.address;
    this.activePoolRandomness.set(poolId, randomnessAccount);

    return {
      randomnessAccount,
      instructions: [web3InstructionToKit(createIx), commitInstruction],
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
        committedSeedSlot: params.committedSeedSlot,
        reason: `Randomness account ${params.randomnessAccount} not initialized or missing on-chain.`,
      };
    }

    const seedSlot = BigInt(header.seedSlot);

    if (seedSlot === 0n) {
      return {
        status: "uncommitted",
        seedSlot: toSlot(0n),
        committedSeedSlot: params.committedSeedSlot,
        reason: `Randomness account ${params.randomnessAccount} has seed_slot = 0 (uncommitted).`,
      };
    }

    if (seedSlot !== BigInt(params.committedSeedSlot)) {
      return {
        status: "mismatch",
        seedSlot: toSlot(seedSlot),
        committedSeedSlot: params.committedSeedSlot,
        reason: `Randomness seed_slot (${seedSlot}) !== committed_seed_slot (${params.committedSeedSlot}). Commitment mismatch.`,
      };
    }

    const elapsedSlots = BigInt(params.currentSlot) - seedSlot;
    if (elapsedSlots > VRF_FRESHNESS_WINDOW_SLOTS) {
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
      this.invalidateOracleCache(this.queueAddress);
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
    return new MockVrfProvider(
      options?.randomnessAccount,
      rpcUrl,
      options?.signer
    );
  }
  return new SwitchboardOnDemandProvider(rpcUrl, options);
}
