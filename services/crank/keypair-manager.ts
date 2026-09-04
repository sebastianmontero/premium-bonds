import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  KeyPairSigner,
  getBase58Encoder,
} from "@solana/kit";
import { CrankConfig } from "./config";

export async function loadSignerKeypair(
  config: CrankConfig
): Promise<KeyPairSigner> {
  // 1. Direct environment variable secret
  if (config.keypairSecret) {
    const raw = config.keypairSecret.trim();
    if (raw.startsWith("[")) {
      const bytes = JSON.parse(raw);
      return await createKeyPairSignerFromBytes(new Uint8Array(bytes));
    }
    // Base58 encoded secret key
    try {
      const base58Encoder = getBase58Encoder();
      const bytes = base58Encoder.encode(raw);
      return await createKeyPairSignerFromBytes(bytes);
    } catch {
      // Fall through
    }
  }

  // 2. File path
  const filePath =
    config.keypairPath || path.join(os.homedir(), ".config/solana/id.json");
  const expandedPath = filePath.startsWith("~")
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath;

  if (fs.existsSync(expandedPath)) {
    const content = fs.readFileSync(expandedPath, "utf-8");
    const bytes = JSON.parse(content);
    return await createKeyPairSignerFromBytes(new Uint8Array(bytes));
  }

  // 3. Fallback for testing / dry-run if no keypair configured
  if (config.dryRun) {
    return await generateKeyPairSigner();
  }

  throw new Error(
    `No valid signer keypair found. Specify KEYPAIR_PATH, JOBS_KEYPAIR_SECRET, or ensure ${expandedPath} exists.`
  );
}
