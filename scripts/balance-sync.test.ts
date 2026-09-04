import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchUserAtaBalance, USDC_MINT } from "../app/lib/bonds-sdk";
import { formatTokenAmount } from "../app/lib/formatters";

describe("User Token Balance Synchronization Suite", () => {
  it("should parse and decode SPL token ATA balances across success, zero, null, and error conditions", async () => {
    const buildMockTokenAccount = (amount: bigint): Uint8Array => {
      const data = new Uint8Array(165);
      const view = new DataView(data.buffer);
      data.fill(1, 0, 32);
      data.fill(2, 32, 64);
      view.setBigUint64(64, amount, true);
      data[72] = 1;
      return data;
    };

    const dummyUser = "4rQzK5R2YQ2m1bL5x1eK5y9b1P6m1V2b5Q8m2V1b4Q9m";

    // Valid balance of 500,000,000 micro-USDC ($500.00 USDC)
    const rawBytes = buildMockTokenAccount(500_000_000n);
    const base64Str = Buffer.from(rawBytes).toString("base64");

    const mockRpcSuccess = {
      getAccountInfo: () => ({
        send: async () => ({
          value: {
            data: [base64Str, "base64"],
          },
        }),
      }),
    };

    const balance = await fetchUserAtaBalance(
      mockRpcSuccess,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      balance,
      500_000_000,
      `Expected 500_000_000, received ${balance}`
    );

    const formatted = formatTokenAmount(balance, 6, 2, 2);
    assert.strictEqual(
      formatted,
      "500.00",
      `Expected formatted balance '500.00', got '${formatted}'`
    );

    // Zero balance account
    const zeroBytes = buildMockTokenAccount(0n);
    const mockRpcZero = {
      getAccountInfo: () => ({
        send: async () => ({
          value: {
            data: [Buffer.from(zeroBytes).toString("base64"), "base64"],
          },
        }),
      }),
    };
    const zeroBalance = await fetchUserAtaBalance(
      mockRpcZero,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      zeroBalance,
      0,
      `Expected 0 balance, got ${zeroBalance}`
    );

    // Non-existent ATA account (null value from RPC)
    const mockRpcNull = {
      getAccountInfo: () => ({
        send: async () => ({
          value: null,
        }),
      }),
    };
    const nullBalance = await fetchUserAtaBalance(
      mockRpcNull,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      nullBalance,
      0,
      `Expected 0 for null account, got ${nullBalance}`
    );

    // RPC network/connection error
    const mockRpcError = {
      getAccountInfo: () => ({
        send: async () => {
          throw new Error("RPC network timeout");
        },
      }),
    };
    const errorBalance = await fetchUserAtaBalance(
      mockRpcError,
      dummyUser,
      USDC_MINT
    );
    assert.strictEqual(
      errorBalance,
      0,
      `Expected 0 on RPC error, got ${errorBalance}`
    );
  });
});
