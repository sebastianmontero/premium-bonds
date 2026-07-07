import {
  createSolanaRpc,
  address,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  AccountRole,
} from "@solana/kit";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const url = "http://127.0.0.1:8899";
  const rpc = createSolanaRpc(url);

  // Load admin/payer key
  const keyPath = path.resolve(__dirname, "test-key.json");
  const bytes = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  const u8 = new Uint8Array(bytes);
  const signer = await createKeyPairSignerFromBytes(u8);

  console.log("Payer address:", signer.address);

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  console.log("Blockhash:", latestBlockhash.blockhash);

  // Build a dummy system transfer instruction manually to test
  // System program transfer instruction data layout:
  // - 4 bytes instruction index (2 for Transfer)
  // - 8 bytes lamports
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // transfer index is 2
  view.setBigUint64(4, BigInt(100_000), true); // 100k lamports

  const instruction = {
    programAddress: address("11111111111111111111111111111111"),
    accounts: [
      { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
      {
        address: address("CiHYGYZdpr2GViaWr5YDdDMP3TyN433uNrouQXSoZrvz"),
        role: AccountRole.WRITABLE,
      },
    ],
    data,
  };

  let message = createTransactionMessage({ version: 0 });
  message = appendTransactionMessageInstruction(instruction, message);
  message = setTransactionMessageFeePayerSigner(signer, message);
  message = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    message
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  console.log("Transaction signed successfully.");

  const wireTx = getBase64EncodedWireTransaction(signedTx);
  console.log("Wire transaction base64 length:", wireTx.length);

  const signature = await rpc
    .sendTransaction(wireTx, { encoding: "base64" })
    .send();
  console.log("Transaction sent. Signature:", signature);
}

main().catch(console.error);
