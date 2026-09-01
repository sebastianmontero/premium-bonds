import { createKeyPairSignerFromBytes } from "@solana/kit";
import * as fs from "fs";
import * as path from "path";

async function main() {
  try {
    const keyPath = path.resolve(__dirname, "test-key.json");
    const bytes = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    const u8 = new Uint8Array(bytes);
    console.log("Bytes length:", u8.length);
    const signer = await createKeyPairSignerFromBytes(u8);
    console.log("Signer address:", signer.address);
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
