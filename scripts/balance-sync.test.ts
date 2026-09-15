import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchUserAtaBalance, USDC_MINT } from "../app/lib/bonds-sdk";
import { formatTokenAmount } from "../app/lib/formatters";
import {
  buildMockTokenAccountBytes,
  MockRpcBuilder,
  MOCK_PUBKEY,
} from "../app/lib/test-harness";

describe("User Token Balance Synchronization Suite", () => {
  const dummyUser = "4rQzK5R2YQ2m1bL5x1eK5y9b1P6m1V2b5Q8m2V1b4Q9m";

  it("should decode positive token ATA balance and format currency accurately", async () => {
    const rawBytes = buildMockTokenAccountBytes(500_000_000n);
    const mockRpc = new MockRpcBuilder()
      .withAccount(MOCK_PUBKEY, rawBytes)
      .build();

    // Override getAccountInfo to return the token account data for any ATA derivation
    const rpcAdapter = {
      getAccountInfo: () => mockRpc.getAccountInfo(MOCK_PUBKEY),
    };

    const balance = await fetchUserAtaBalance(
      rpcAdapter as any,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      balance,
      500_000_000,
      "Decoded balance should match exactly 500,000,000 micro-USDC"
    );

    const formatted = formatTokenAmount(balance, 6, 2, 2);
    assert.strictEqual(
      formatted,
      "500.00",
      "Formatted token amount must be '500.00'"
    );
  });

  it("should decode zero balance account correctly", async () => {
    const zeroBytes = buildMockTokenAccountBytes(0n);
    const mockRpc = new MockRpcBuilder()
      .withAccount(MOCK_PUBKEY, zeroBytes)
      .build();

    const rpcAdapter = {
      getAccountInfo: () => mockRpc.getAccountInfo(MOCK_PUBKEY),
    };

    const zeroBalance = await fetchUserAtaBalance(
      rpcAdapter as any,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      zeroBalance,
      0,
      "Decoded balance for 0n token account should equal 0"
    );
  });

  it("should gracefully return 0 for non-existent ATA account", async () => {
    const mockRpc = new MockRpcBuilder().withAccount(MOCK_PUBKEY, null).build();

    const rpcAdapter = {
      getAccountInfo: () => mockRpc.getAccountInfo(MOCK_PUBKEY),
    };

    const nullBalance = await fetchUserAtaBalance(
      rpcAdapter as any,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      nullBalance,
      0,
      "Non-existent ATA (null response) should return 0"
    );
  });

  it("should return 0 upon RPC network or connection timeout", async () => {
    const mockRpc = {
      getAccountInfo: () => ({
        send: async () => {
          throw new Error("RPC network timeout");
        },
      }),
    };

    const errorBalance = await fetchUserAtaBalance(
      mockRpc as any,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      errorBalance,
      0,
      "Network error must safely fallback to 0 balance"
    );
  });
});
