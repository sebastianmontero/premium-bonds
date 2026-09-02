import * as fs from "node:fs";
import * as path from "node:path";

// Load environment variables relative to project root for standalone CLI scripts
const rootDir = path.resolve(__dirname, "..");
const envLocalPath = path.resolve(rootDir, ".env.local");
const envPath = path.resolve(rootDir, ".env");

if (typeof process.loadEnvFile === "function") {
  if (fs.existsSync(envLocalPath)) {
    try {
      process.loadEnvFile(envLocalPath);
    } catch {
      // Ignore parse/read errors in non-standard environments
    }
  }
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore parse/read errors in non-standard environments
    }
  }
}
