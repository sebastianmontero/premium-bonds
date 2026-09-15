import { Address, getBase64Decoder } from "@solana/kit";

export interface MockAccountRecord {
  data: Uint8Array | null;
  lamports?: bigint;
  owner?: Address;
  executable?: boolean;
}

export class MockRpcBuilder {
  private accounts = new Map<string, MockAccountRecord | null>();
  private errors = new Map<string, Error>();
  private currentSlot = 1000n;
  private currentBlockTime = 1700000000n;

  withAccount(
    pubkey: Address | string,
    data: Uint8Array | null,
    owner?: Address,
    lamports = 1_000_000n
  ): this {
    this.accounts.set(
      pubkey.toString(),
      data ? { data, owner, lamports, executable: false } : null
    );
    return this;
  }

  withSlot(slot: bigint): this {
    this.currentSlot = slot;
    return this;
  }

  withBlockTime(blockTime: bigint): this {
    this.currentBlockTime = blockTime;
    return this;
  }

  withAccountError(pubkey: Address | string, error: Error): this {
    this.errors.set(pubkey.toString(), error);
    return this;
  }

  build() {
    const base64Decoder = getBase64Decoder();

    const formatAccount = (
      pubkey: string,
      sliceConfig?: { offset: number; length: number }
    ) => {
      if (this.errors.has(pubkey)) {
        throw this.errors.get(pubkey)!;
      }
      const raw = this.accounts.get(pubkey);
      if (!raw || !raw.data) {
        return null;
      }
      const slice = sliceConfig
        ? raw.data.subarray(
            sliceConfig.offset,
            sliceConfig.offset + sliceConfig.length
          )
        : raw.data;
      return {
        executable: raw.executable ?? false,
        lamports: raw.lamports ?? 1_000_000n,
        owner: raw.owner ?? ("11111111111111111111111111111111" as Address),
        space: BigInt(raw.data.byteLength),
        data: [base64Decoder.decode(slice), "base64" as const],
      };
    };

    return {
      getAccountInfo: (
        pubkey: Address | string,
        config?: { dataSlice?: { offset: number; length: number } }
      ) => ({
        send: async () => ({
          value: formatAccount(pubkey.toString(), config?.dataSlice),
        }),
      }),

      getMultipleAccounts: (
        pubkeys: (Address | string)[],
        config?: { dataSlice?: { offset: number; length: number } }
      ) => ({
        send: async () => ({
          value: pubkeys.map((pk) =>
            formatAccount(pk.toString(), config?.dataSlice)
          ),
        }),
      }),

      getSlot: () => ({
        send: async () => Number(this.currentSlot),
      }),

      getBlockTime: () => ({
        send: async () => Number(this.currentBlockTime),
      }),
    };
  }
}
