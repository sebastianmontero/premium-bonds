import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { syncVercelEnvs } from "./sync-vercel-envs";
import { upsertEnvFile } from "./env-utils";

describe("Vercel Environment Synchronization Tooling (sync-vercel-envs)", () => {
  let testDir: string;
  let testEnvFile: string;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-vercel-test-"));
    testEnvFile = path.join(testDir, ".env.test");
  });

  after(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should successfully parse remote DATABASE_URL and dry-run preview sync without errors", async () => {
    const mockVars = {
      NEXT_PUBLIC_ENVIRONMENT: "devnet",
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://api.devnet.solana.com",
      NEXT_PUBLIC_PROGRAM_ID: "3GTfYY4nefPvDpeUuyVjqCVUCtvhBMga82RjLVn6MTos",
      NEXT_PUBLIC_HUMA_PROGRAM_ID:
        "XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw",
      NEXT_PUBLIC_USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      NEXT_PUBLIC_PST_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      NEXT_PUBLIC_TICKET_REGISTRY:
        "B5qU6YvA6RzXf5eD8xG3nK2m9vP1sL4jW8k7h6f5d4c3",
      NEXT_PUBLIC_ADMIN_ADDRESS: "7FEoVqfhcANGrejxH7SYxuUqGpJKcCdmGk7DoiUZRM8T",
      NEXT_PUBLIC_FEE_WALLET: "9XJWqjgrmpWhe5FoUUBLwj2ZayqAuUNiAg9TyM213def",
      NEXT_PUBLIC_RANDOMNESS_ACCOUNT:
        "2puduKxvHBpBodjkBsfgeHPkpofDkiQoaaeKFcXcube2",
      NEXT_PUBLIC_HUMA_CONFIG: "XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw",
      NEXT_PUBLIC_HUMA_POOL_CONFIG:
        "XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw",
      NEXT_PUBLIC_HUMA_POOL_STATE:
        "3GTfYY4nefPvDpeUuyVjqCVUCtvhBMga82RjLVn6MTos",
      NEXT_PUBLIC_HUMA_MODE_CONFIG:
        "XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw",
      NEXT_PUBLIC_HUMA_LENDER_STATE:
        "XqwsiCfGf9UBm3vvkCeL9xCqceHDmBP38T3zRzQicBw",
      NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN:
        "7FEoVqfhcANGrejxH7SYxuUqGpJKcCdmGk7DoiUZRM8T",
      NEXT_PUBLIC_HUMA_MODE_MINT:
        "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      NEXT_PUBLIC_HUMA_POOL_MODE_TOKEN:
        "9XJWqjgrmpWhe5FoUUBLwj2ZayqAuUNiAg9TyM213def",
      NEXT_PUBLIC_HUMA_REDEMPTION_REQUEST:
        "2puduKxvHBpBodjkBsfgeHPkpofDkiQoaaeKFcXcube2",
      DATABASE_URL:
        "postgresql://user:pass@ep-cool-cloud-12345.us-east-2.aws.neon.tech/neondb?sslmode=require",
    };

    upsertEnvFile(testEnvFile, mockVars);

    // Run dry-run with test env file
    await syncVercelEnvs([
      "--dry-run",
      "--environment",
      "preview",
      `--envFile=${testEnvFile}`,
    ]);
  });
});
