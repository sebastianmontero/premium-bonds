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

  private signatureSequences = new Map<
    string,
    Array<{ confirmationStatus: string; err: unknown } | null>
  >();
  private signatureCallIndices = new Map<string, number>();

  private accountSequences = new Map<
    string,
    Array<Uint8Array | null | Error>
  >();
  private accountCallIndices = new Map<string, number>();

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

  withSignatureStatusesSequence(
    signature: string,
    sequence: Array<{ confirmationStatus: string; err: unknown } | null>
  ): this {
    this.signatureSequences.set(signature, sequence);
    this.signatureCallIndices.set(signature, 0);
    return this;
  }

  withAccountSequence(
    pubkey: Address | string,
    sequence: Array<Uint8Array | null | Error>
  ): this {
    const key = pubkey.toString();
    this.accountSequences.set(key, sequence);
    this.accountCallIndices.set(key, 0);
    return this;
  }

  getSignatureCallCount(signature: string): number {
    return this.signatureCallIndices.get(signature) ?? 0;
  }

  getAccountCallCount(pubkey: Address | string): number {
    return this.accountCallIndices.get(pubkey.toString()) ?? 0;
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

      if (this.accountSequences.has(pubkey)) {
        const seq = this.accountSequences.get(pubkey)!;
        const idx = this.accountCallIndices.get(pubkey) ?? 0;
        this.accountCallIndices.set(pubkey, idx + 1);
        const item = seq[Math.min(idx, seq.length - 1)];
        if (item instanceof Error) throw item;
        if (!item) return null;
        const slice = sliceConfig
          ? item.subarray(
              sliceConfig.offset,
              sliceConfig.offset + sliceConfig.length
            )
          : item;
        return {
          executable: false,
          lamports: 1_000_000n,
          owner: "11111111111111111111111111111111" as Address,
          space: BigInt(item.byteLength),
          data: [base64Decoder.decode(slice), "base64" as const],
        };
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

      getSignatureStatuses: (signatures: string[]) => ({
        send: async () => ({
          value: signatures.map((sig) => {
            const seq = this.signatureSequences.get(sig);
            if (!seq) return null;
            const idx = this.signatureCallIndices.get(sig) ?? 0;
            this.signatureCallIndices.set(sig, idx + 1);
            return seq[Math.min(idx, seq.length - 1)];
          }),
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
