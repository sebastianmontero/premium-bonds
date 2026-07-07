import * as crypto from "crypto";
import { createKeyPairSignerFromBytes } from "@solana/kit";

async function main() {
  try {
    const keyPair = crypto.generateKeyPairSync("ed25519");

    // Export private key to PKCS8 DER and slice out the 32-byte secret key (offset 16)
    const pkcs8 = keyPair.privateKey.export({ format: "der", type: "pkcs8" });
    const secretKeyBytes = pkcs8.subarray(16, 48);

    // Export public key to SPKI DER and slice out the 32-byte public key (offset 12)
    const spki = keyPair.publicKey.export({ format: "der", type: "spki" });
    const publicKeyBytes = spki.subarray(12, 44);

    const secretKey = new Uint8Array(64);
    secretKey.set(secretKeyBytes);
    secretKey.set(publicKeyBytes, 32);

    const signer = await createKeyPairSignerFromBytes(secretKey);
    console.log("Success! Generated address:", signer.address);
    console.log("Secret key length:", secretKey.length);
  } catch (e) {
    console.error("error:", e);
  }
}

main();
