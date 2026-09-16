import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchUserAtaBalance,
  findAtaAddress,
  USDC_MINT,
} from "../app/lib/bonds-sdk";
import { formatTokenAmount } from "../app/lib/formatters";
import {
  buildMockTokenAccountBytes,
  MockRpcBuilder,
  TEST_ADDRESSES,
} from "../app/lib/test-harness";

describe("User Token Balance Synchronization Suite", () => {
  const dummyUser = TEST_ADDRESSES.USER;

  it("should decode positive token ATA balance and format currency accurately", async () => {
    const userAta = await findAtaAddress(dummyUser, USDC_MINT);
    const rawBytes = buildMockTokenAccountBytes(
      500_000_000n,
      USDC_MINT,
      dummyUser
    );
    const mockRpc = new MockRpcBuilder().withAccount(userAta, rawBytes).build();

    const balance = await fetchUserAtaBalance(
      mockRpc as any,
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
    const userAta = await findAtaAddress(dummyUser, USDC_MINT);
    const zeroBytes = buildMockTokenAccountBytes(0n, USDC_MINT, dummyUser);
    const mockRpc = new MockRpcBuilder()
      .withAccount(userAta, zeroBytes)
      .build();

    const zeroBalance = await fetchUserAtaBalance(
      mockRpc as any,
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
    const userAta = await findAtaAddress(dummyUser, USDC_MINT);
    const mockRpc = new MockRpcBuilder().withAccount(userAta, null).build();

    const nullBalance = await fetchUserAtaBalance(
      mockRpc as any,
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
    const userAta = await findAtaAddress(dummyUser, USDC_MINT);
    const mockRpc = new MockRpcBuilder()
      .withAccountError(userAta, new Error("RPC network timeout"))
      .build();

    const errorBalance = await fetchUserAtaBalance(
      mockRpc as any,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(errorBalance, 0, "RPC error should gracefully return 0");
  });
});
