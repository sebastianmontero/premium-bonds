import {
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  KeyPairSigner,
} from "@solana/kit";
import * as fs from "fs";

/**
 * Checks if the RPC node at the given URL is healthy.
 */
export async function checkRpcHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    clearTimeout(id);
    if (!res.ok) return false;
    const json = (await res.json()) as { result?: string };
    return json.result === "ok";
  } catch {
    clearTimeout(id);
    return false;
  }
}

/**
 * Loads an existing keypair from the specified JSON file path.
 * Raises a clear error if the file is missing or invalid.
 */
export async function loadKeypair(filePath: string): Promise<KeyPairSigner> {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Keypair file not found at: ${filePath}. Please ensure your authority keypair is generated and placed there.`
    );
  }
  const content = fs.readFileSync(filePath, "utf-8");
  try {
    const bytes = JSON.parse(content);
    return await createKeyPairSignerFromBytes(new Uint8Array(bytes));
  } catch {
    throw new Error(
      `Failed to parse keypair file at: ${filePath}. Ensure it is a valid JSON byte array.`
    );
  }
}

/**
 * Sends a transaction and polls for its confirmation status.
 */
export async function sendTx(
  rpc: ReturnType<typeof createSolanaRpc>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instruction: any,
  payerSigner: KeyPairSigner
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    setTransactionMessageFeePayerSigner(
      payerSigner,
      appendTransactionMessageInstruction(
        instruction,
        createTransactionMessage({ version: 0 })
      )
    )
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const wireTx = getBase64EncodedWireTransaction(signedTx);
  const signature = await rpc
    .sendTransaction(wireTx, { encoding: "base64" })
    .send();

  console.log(`Transaction sent: ${signature}. Waiting for confirmation...`);

  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const status = await rpc.getSignatureStatuses([signature]).send();
      if (status && status.value && status.value[0]) {
        const err = status.value[0].err;
        if (err) {
          throw new Error(`Transaction failed: ${JSON.stringify(err)}`);
        }
        console.log("Transaction confirmed successfully!");
        return signature;
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("Failed checking signature status:", errMsg);
    }
  }

  console.warn("Transaction signature status check timed out.");
  return signature;
}

/**
 * Updates a matching substring in a text file using RegExp.
 */
export function updateFileContent(
  filePath: string,
  regex: RegExp,
  replacement: string
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const updated = content.replace(regex, replacement);
  fs.writeFileSync(filePath, updated, "utf-8");
}
