import test from "node:test";
import assert from "node:assert/strict";
import { pollSignatureConfirmation } from "../transaction-poller";
import {
  signature as toSignature,
  type Rpc,
  type GetSignatureStatusesApi,
} from "@solana/kit";

const VALID_TEST_SIG = toSignature(
  "2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2"
);

test("transaction-poller: confirms successfully when status is confirmed", async () => {
  let calls = 0;
  const mockRpc = {
    getSignatureStatuses: () => ({
      send: async () => {
        calls++;
        if (calls < 2) {
          return { value: [null] };
        }
        return {
          value: [{ confirmationStatus: "confirmed", err: null }],
        };
      },
    }),
  } as unknown as Rpc<GetSignatureStatusesApi>;

  await pollSignatureConfirmation(mockRpc, VALID_TEST_SIG, {
    initialDelayMs: 10,
    maxDelayMs: 20,
    timeoutMs: 1000,
  });

  assert.equal(calls, 2);
});

test("transaction-poller: throws TransactionError on on-chain execution error", async () => {
  const mockRpc = {
    getSignatureStatuses: () => ({
      send: async () => ({
        value: [
          {
            confirmationStatus: "processed",
            err: { InstructionError: [0, { Custom: 6007 }] },
          },
        ],
      }),
    }),
  } as unknown as Rpc<GetSignatureStatusesApi>;

  await assert.rejects(
    async () => {
      await pollSignatureConfirmation(mockRpc, VALID_TEST_SIG, {
        initialDelayMs: 10,
        timeoutMs: 500,
      });
    },
    (err: unknown) => {
      const errorRecord = err as { name: string; parsed?: { code: number } };
      assert.equal(errorRecord.name, "TransactionError");
      assert.equal(errorRecord.parsed?.code, 6007);
      return true;
    }
  );
});

test("transaction-poller: respects abort signal and throws AbortError", async () => {
  const controller = new AbortController();
  const mockRpc = {
    getSignatureStatuses: () => ({
      send: async () => {
        controller.abort();
        return { value: [null] };
      },
    }),
  } as unknown as Rpc<GetSignatureStatusesApi>;

  await assert.rejects(
    async () => {
      await pollSignatureConfirmation(mockRpc, VALID_TEST_SIG, {
        initialDelayMs: 10,
        timeoutMs: 1000,
        abortSignal: controller.signal,
      });
    },
    (err: unknown) => {
      const errorRecord = err as { name: string };
      assert.equal(errorRecord.name, "AbortError");
      return true;
    }
  );
});
