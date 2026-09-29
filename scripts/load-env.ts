import * as fs from "node:fs";
import * as path from "node:path";
import { readEnvFile } from "./env-utils";

// Load environment variables relative to project root for standalone CLI scripts
const rootDir = path.resolve(__dirname, "..");
const envLocalPath = path.resolve(rootDir, ".env.local");
const envPath = path.resolve(rootDir, ".env");

function loadEnvIntoProcess(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(filePath);
      return;
    } catch {
      // Fall back to readEnvFile parser below
    }
  }
  const parsed = readEnvFile(filePath);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// .env.local takes precedence over .env
loadEnvIntoProcess(envLocalPath);
loadEnvIntoProcess(envPath);
