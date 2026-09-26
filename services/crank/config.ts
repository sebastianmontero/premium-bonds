import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Address, address } from "@solana/kit";
import { resolveSolanaRpcUrl, resolveNetwork } from "../../app/lib/network";
import { readEnvFile } from "../../scripts/env-utils";

let isEnvLoaded = false;

export function ensureEnvLoaded(): void {
  if (isEnvLoaded) return;
  const envLocal = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envLocal)) {
    isEnvLoaded = true;
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (process as any).loadEnvFile === "function") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).loadEnvFile(envLocal);
      isEnvLoaded = true;
      return;
    } catch (err) {
      console.warn("[CrankConfig] Warning: process.loadEnvFile failed:", err);
    }
  }
  try {
    const parsed = readEnvFile(envLocal);
    for (const [key, val] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn(
      "[CrankConfig] Warning: Failed fallback parsing of .env.local:",
      err
    );
  }
  isEnvLoaded = true;
}

export function parseOptionalAddress(val?: string | null): Address | undefined {
  if (!val || typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (trimmed === "" || trimmed === "11111111111111111111111111111111")
    return undefined;
  try {
    return address(trimmed);
  } catch {
    return undefined;
  }
}

export function parsePoolHumaLenderStates(
  env: NodeJS.ProcessEnv = process.env
): Record<number, Address> {
  const result: Record<number, Address> = {};
  for (const [key, val] of Object.entries(env)) {
    if (!val) continue;
    let poolId: number | undefined;
    const match1 = key.match(/^POOL_(\d+)_HUMA_LENDER_STATE$/);
    if (match1) {
      poolId = parseInt(match1[1], 10);
    } else {
      const match2 = key.match(/^HUMA_LENDER_STATE_(\d+)$/);
      if (match2) {
        poolId = parseInt(match2[1], 10);
      }
    }
    if (poolId !== undefined && !isNaN(poolId)) {
      const parsed = parseOptionalAddress(val);
      if (parsed) {
        result[poolId] = parsed;
      }
    }
  }
  return result;
}

export interface CrankConfig {
  rpcUrl: string;
  wsUrl: string;
  keypairPath?: string;
  keypairSecret?: string;
  poolIds: number[];
  pollIntervalMs: number;
  activeWindowPollIntervalMs: number;
  metricsPort: number;
  enableAutoDisburse: boolean;
  maxPrepareBatchSize: number;
  maxReinvestBatchSize: number;
  instanceIndex: number;
  instanceJitterMs: number;
  jitoEnabled: boolean;
  jitoTipLamports: bigint;
  maxJitoTipLamports: bigint;
  jitoBlockEngineUrl?: string;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  pagerDutyRoutingKey?: string;
  pstMint?: Address;
  humaConfig?: Address;
  humaPoolConfig?: Address;
  humaPoolState?: Address;
  humaModeConfig?: Address;
  humaLenderState?: Address;
  poolHumaLenderStates?: Record<number, Address>;
  humaPoolUnderlyingToken?: Address;
  dryRun: boolean;
  allowNonJobsSigner?: boolean;
}

export function loadConfig(overrides?: Partial<CrankConfig>): CrankConfig {
  ensureEnvLoaded();
  const rpcUrl = resolveSolanaRpcUrl(overrides?.rpcUrl);

  const wsUrl =
    overrides?.wsUrl ||
    process.env.SOLANA_WS_URL ||
    rpcUrl.replace("http://", "ws://").replace("https://", "wss://");

  const rawPoolIds = overrides?.poolIds || parsePoolIds(process.env.POOL_IDS);

  const pstMintStr = process.env.PST_MINT || process.env.NEXT_PUBLIC_PST_MINT;
  const humaConfig =
    overrides?.humaConfig ||
    parseOptionalAddress(process.env.HUMA_CONFIG) ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_CONFIG);
  const humaPoolConfig =
    overrides?.humaPoolConfig ||
    parseOptionalAddress(process.env.HUMA_POOL_CONFIG) ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_POOL_CONFIG);
  const humaPoolState =
    overrides?.humaPoolState ||
    parseOptionalAddress(process.env.HUMA_POOL_STATE) ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_POOL_STATE);
  const humaModeConfig =
    overrides?.humaModeConfig ||
    parseOptionalAddress(process.env.HUMA_MODE_CONFIG) ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_MODE_CONFIG);
  const humaLenderState =
    overrides?.humaLenderState ||
    parseOptionalAddress(process.env.HUMA_LENDER_STATE) ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_LENDER_STATE);
  const poolHumaLenderStates =
    overrides?.poolHumaLenderStates || parsePoolHumaLenderStates(process.env);
  const humaPoolUnderlyingToken =
    overrides?.humaPoolUnderlyingToken ||
    parseOptionalAddress(process.env.HUMA_POOL_UNDERLYING_TOKEN) ||
    parseOptionalAddress(process.env.NEXT_PUBLIC_HUMA_POOL_UNDERLYING_TOKEN);

  const network = resolveNetwork(process.env.NEXT_PUBLIC_ENVIRONMENT, rpcUrl);
  const devKeypair = path.resolve(
    os.homedir(),
    ".config/solana/crank-keypair-dev.json"
  );
  const keypairPath =
    overrides?.keypairPath ||
    process.env.KEYPAIR_PATH ||
    (network.cluster === "devnet" && fs.existsSync(devKeypair)
      ? devKeypair
      : process.env.ANCHOR_WALLET);

  return {
    rpcUrl,
    wsUrl,
    keypairPath,
    keypairSecret: overrides?.keypairSecret || process.env.JOBS_KEYPAIR_SECRET,
    poolIds: rawPoolIds.length > 0 ? rawPoolIds : [1],
    pollIntervalMs:
      overrides?.pollIntervalMs ??
      parseNumber(process.env.POLL_INTERVAL_MS, 15000),
    activeWindowPollIntervalMs:
      overrides?.activeWindowPollIntervalMs ??
      parseNumber(process.env.ACTIVE_POLL_INTERVAL_MS, 1000),
    metricsPort:
      overrides?.metricsPort ?? parseNumber(process.env.METRICS_PORT, 9090),
    enableAutoDisburse:
      overrides?.enableAutoDisburse ??
      process.env.ENABLE_AUTO_DISBURSE !== "false",
    maxPrepareBatchSize:
      overrides?.maxPrepareBatchSize ??
      parseNumber(process.env.MAX_PREPARE_BATCH_SIZE, 500),
    maxReinvestBatchSize:
      overrides?.maxReinvestBatchSize ??
      parseNumber(process.env.MAX_REINVEST_BATCH_SIZE, 5),
    instanceIndex:
      overrides?.instanceIndex ??
      parseNumber(process.env.CRANK_INSTANCE_INDEX, 0),
    instanceJitterMs:
      overrides?.instanceJitterMs ??
      parseNumber(process.env.CRANK_INSTANCE_JITTER_MS, 1200),
    jitoEnabled: overrides?.jitoEnabled ?? process.env.JITO_ENABLED === "true",
    jitoTipLamports:
      overrides?.jitoTipLamports ??
      BigInt(process.env.JITO_TIP_LAMPORTS || "10000"),
    maxJitoTipLamports:
      overrides?.maxJitoTipLamports ??
      BigInt(process.env.MAX_JITO_TIP_LAMPORTS || "100000"),
    jitoBlockEngineUrl:
      overrides?.jitoBlockEngineUrl || process.env.JITO_BLOCK_ENGINE_URL,
    discordWebhookUrl:
      overrides?.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL,
    telegramBotToken:
      overrides?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: overrides?.telegramChatId || process.env.TELEGRAM_CHAT_ID,
    pagerDutyRoutingKey:
      overrides?.pagerDutyRoutingKey || process.env.PAGERDUTY_ROUTING_KEY,
    pstMint:
      overrides?.pstMint || (pstMintStr ? address(pstMintStr) : undefined),
    humaConfig,
    humaPoolConfig,
    humaPoolState,
    humaModeConfig,
    humaLenderState,
    poolHumaLenderStates,
    humaPoolUnderlyingToken,
    dryRun: overrides?.dryRun ?? process.env.DRY_RUN === "true",
    allowNonJobsSigner:
      overrides?.allowNonJobsSigner ??
      process.env.ALLOW_NON_JOBS_SIGNER === "true",
  };
}

function parsePoolIds(raw?: string): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

function parseNumber(raw: string | undefined, defaultValue: number): number {
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
