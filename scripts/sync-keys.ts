import * as fs from "fs";
import * as path from "path";
import { Address, address, createKeyPairSignerFromBytes } from "@solana/kit";

export interface ProgramKeypairConfig {
  readonly name: string;
  readonly filename: string;
  readonly expectedAddress: Address;
  readonly envVar: string;
}

export const CANONICAL_KEYPAIRS: readonly ProgramKeypairConfig[] = [
  {
    name: "anchor",
    filename: "anchor-keypair.json",
    expectedAddress: address("3GTfYY4nefPvDpeUuyVjqCVUCtvhBMga82RjLVn6MTos"),
    envVar: "DEVNET_ANCHOR_KEYPAIR",
  },
  {
    name: "mock_huma",
    filename: "mock_huma-keypair.json",
    expectedAddress: address("4VSPD3TcxWc98Ed6e6vAYshrqsrpHHqvXCB4W73JQtXg"),
    envVar: "DEVNET_MOCK_HUMA_KEYPAIR",
  },
  {
    name: "mock_kamino",
    filename: "mock_kamino-keypair.json",
    expectedAddress: address("GVkUHNohGv2AqewpZnciXhjwt3diSsLuDAKp1Q1bH1GA"),
    envVar: "DEVNET_MOCK_KAMINO_KEYPAIR",
  },
];

export async function resolveProgramKeypairPath(
  config: ProgramKeypairConfig
): Promise<string> {
  const rootDir = path.resolve(__dirname, "..");
  const keysDir = path.resolve(rootDir, "anchor", "keys");
  let keyPath = path.resolve(keysDir, config.filename);

  if (!fs.existsSync(keyPath)) {
    const envVal = process.env[config.envVar];
    if (envVal) {
      fs.mkdirSync(keysDir, { recursive: true });
      const trimmed = envVal.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        fs.writeFileSync(keyPath, trimmed, { encoding: "utf-8", mode: 0o600 });
      } else if (fs.existsSync(trimmed)) {
        fs.copyFileSync(trimmed, keyPath);
      }
    }
  }

  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Day-1 deploy keypair for ${config.name} missing at ${keyPath}.\n` +
        `Expected address: ${config.expectedAddress}.\n` +
        `Please place the keypair in ${keyPath} or provide ${config.envVar} in your environment.`
    );
  }

  const raw = fs.readFileSync(keyPath, "utf-8");
  const signer = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(raw))
  );
  if (signer.address !== config.expectedAddress) {
    throw new Error(
      `Keypair public key mismatch for ${config.name} in ${keyPath}!\n` +
        `Expected: ${config.expectedAddress}\n` +
        `Actual:   ${signer.address}`
    );
  }

  return keyPath;
}

export async function syncKeypairs(): Promise<void> {
  const rootDir = path.resolve(__dirname, "..");
  const targetDeployDir = path.resolve(rootDir, "anchor", "target", "deploy");
  if (!fs.existsSync(targetDeployDir)) {
    fs.mkdirSync(targetDeployDir, { recursive: true });
  }

  for (const config of CANONICAL_KEYPAIRS) {
    try {
      const keyPath = await resolveProgramKeypairPath(config);
      const targetPath = path.resolve(targetDeployDir, config.filename);
      fs.copyFileSync(keyPath, targetPath);
      console.log(
        `✓ [sync-keys] Synced ${config.name} (${config.expectedAddress}) -> target/deploy/`
      );
    } catch {
      console.log(
        `ℹ [sync-keys] ${config.name} keypair not found in anchor/keys/ or ${config.envVar}. ` +
          `Skipping (not required for local tests or codegen).`
      );
    }
  }
}

async function run(): Promise<void> {
  try {
    await syncKeypairs();
    console.log("✓ Keypair synchronization complete.");
  } catch (err) {
    console.error("Keypair synchronization failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  void run();
}
