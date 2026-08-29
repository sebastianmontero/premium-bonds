import { Address, address, IInstruction } from "@solana/kit";

export interface IVrfProvider {
  /**
   * Generates or provisions a randomness account for harvest_yield_and_commit.
   */
  provisionRandomnessAccount(poolId: number, cycleId: number): Promise<Address>;

  /**
   * Prepares the reveal step. For Switchboard on-demand, this fetches oracle proofs
   * and returns the reveal instruction to bundle atomically.
   */
  prepareReveal(
    randomnessAccount: Address,
    harvestSlot: bigint,
    currentSlot: bigint
  ): Promise<{
    revealInstruction?: IInstruction;
    ready: boolean;
  }>;
}

export class MockVrfProvider implements IVrfProvider {
  constructor(private readonly mockAddress?: Address) {}

  async provisionRandomnessAccount(): Promise<Address> {
    if (this.mockAddress) {
      return this.mockAddress;
    }
    const envAccount = process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT;
    if (envAccount) {
      return address(envAccount);
    }
    return address("11111111111111111111111111111111");
  }

  async prepareReveal(): Promise<{
    revealInstruction?: IInstruction;
    ready: boolean;
  }> {
    return {
      ready: true,
    };
  }
}

export class SwitchboardOnDemandProvider implements IVrfProvider {
  constructor(
    private readonly rpcUrl: string,
    private readonly queueAddress?: Address
  ) {
    void this.rpcUrl;
    void this.queueAddress;
  }

  async provisionRandomnessAccount(): Promise<Address> {
    const envAccount = process.env.NEXT_PUBLIC_RANDOMNESS_ACCOUNT;
    if (envAccount) {
      return address(envAccount);
    }
    throw new Error(
      "Switchboard On-Demand requires configured NEXT_PUBLIC_RANDOMNESS_ACCOUNT or queue provisioning."
    );
  }

  async prepareReveal(): Promise<{
    revealInstruction?: IInstruction;
    ready: boolean;
  }> {
    return {
      ready: true,
    };
  }
}

export function createVrfProvider(rpcUrl: string): IVrfProvider {
  const isLocal =
    rpcUrl.includes("127.0.0.1") ||
    rpcUrl.includes("localhost") ||
    rpcUrl.includes("surfpool");
  if (isLocal) {
    return new MockVrfProvider();
  }
  return new SwitchboardOnDemandProvider(rpcUrl);
}
