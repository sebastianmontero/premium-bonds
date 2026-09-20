import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import {
  parseTokenAccountBalance,
  decodeAccountBase64Data,
  fetchUserBalances,
  USDC_MINT,
} from "../app/lib/bonds-sdk";
import {
  updateSolBalanceCache,
  updateTokenBalanceCache,
} from "../app/lib/balance-cache";
import { bondsKeys } from "../app/lib/query-keys";
import { getBase64Decoder } from "@solana/kit";

test("parseTokenAccountBalance: binary layout parsing & bounds checking", () => {
  // Empty or short buffer (< 72 bytes) returns 0n
  assert.equal(parseTokenAccountBalance(new Uint8Array([])), 0n);
  assert.equal(parseTokenAccountBalance(new Uint8Array(71)), 0n);

  // Exact 72 bytes buffer with u64 amount at offset 64..72
  const buf72 = new Uint8Array(72);
  const view72 = new DataView(buf72.buffer);
  const expectedAmount = 125_500_000n; // 125.5 USDC
  view72.setBigUint64(64, expectedAmount, true);

  assert.equal(parseTokenAccountBalance(buf72), expectedAmount);

  // Buffer larger than 72 bytes (e.g. Token-2022 account with extensions or 165 byte SPL Token)
  const buf165 = new Uint8Array(165);
  const view165 = new DataView(buf165.buffer);
  const largeAmount = 999_999_000_000n;
  view165.setBigUint64(64, largeAmount, true);

  assert.equal(parseTokenAccountBalance(buf165), largeAmount);
});

test("decodeAccountBase64Data: decoding various RPC formats", () => {
  assert.equal(decodeAccountBase64Data(null), null);
  assert.equal(decodeAccountBase64Data(undefined), null);
  assert.equal(decodeAccountBase64Data({} as any), null);

  // Uint8Array passthrough
  const rawBytes = new Uint8Array([1, 2, 3, 4]);
  assert.deepEqual(
    decodeAccountBase64Data({ data: rawBytes } as any),
    rawBytes
  );

  // Base64 tuple [data, "base64"]
  const b64Decoder = getBase64Decoder();
  const sampleData = new Uint8Array([10, 20, 30, 40]);
  const encoded = b64Decoder.decode(sampleData);
  const decoded = decodeAccountBase64Data({
    data: [encoded, "base64"],
  });
  assert.deepEqual(decoded, sampleData);
});

test("fetchUserBalances: batched RPC fetching and error propagation", async () => {
  const b64Decoder = getBase64Decoder();
  const tokenBuf = new Uint8Array(72);
  new DataView(tokenBuf.buffer).setBigUint64(64, 50_000_000n, true); // 50 USDC
  const tokenB64 = b64Decoder.decode(tokenBuf);

  // Mock successful RPC
  const mockRpc = {
    getMultipleAccounts: (_accounts: any[], _config: any) => ({
      send: async () => ({
        context: { slot: 1500n },
        value: [
          { lamports: 2_000_000_000n, data: ["", "base64"] }, // 2 SOL
          { lamports: 2_039_280n, data: [tokenB64, "base64"] }, // 50 USDC
        ],
      }),
    }),
  };

  const testUser = "11111111111111111111111111111111";
  const result = await fetchUserBalances(mockRpc as any, testUser, USDC_MINT);

  assert.equal(result.slot, 1500n);
  assert.equal(result.solLamports, 2_000_000_000n);
  assert.equal(result.tokenBaseUnits, 50_000_000n);

  // Error propagation: RPC rejection must propagate
  const failingRpc = {
    getMultipleAccounts: () => ({
      send: async () => {
        throw new Error("RPC network failure");
      },
    }),
  };

  await assert.rejects(
    async () => {
      await fetchUserBalances(failingRpc as any, testUser, USDC_MINT);
    },
    { message: "RPC network failure" }
  );
});

test("balance-cache: slot-monotonic reconciliation", () => {
  const queryClient = new QueryClient();
  const queryKey = bondsKeys.userAssetBalances("user-123", USDC_MINT);

  // Initial update at slot 100
  updateSolBalanceCache(queryClient, queryKey, 1_000_000n, 100n);
  updateTokenBalanceCache(queryClient, queryKey, 50_000n, 100n);

  let cached = queryClient.getQueryData<any>(queryKey);
  assert.equal(cached.solLamports, 1_000_000n);
  assert.equal(cached.tokenBaseUnits, 50_000n);
  assert.equal(cached.slot, 100n);

  // Newer update at slot 105: should apply
  updateSolBalanceCache(queryClient, queryKey, 2_000_000n, 105n);
  cached = queryClient.getQueryData<any>(queryKey);
  assert.equal(cached.solLamports, 2_000_000n);
  assert.equal(cached.tokenBaseUnits, 50_000n);
  assert.equal(cached.slot, 105n);

  // Stale update at slot 95 (older than 105): must be discarded!
  updateSolBalanceCache(queryClient, queryKey, 999_999_999n, 95n);
  updateTokenBalanceCache(queryClient, queryKey, 999_999_999n, 95n);
  cached = queryClient.getQueryData<any>(queryKey);
  assert.equal(cached.solLamports, 2_000_000n);
  assert.equal(cached.tokenBaseUnits, 50_000n);
  assert.equal(cached.slot, 105n);
});
