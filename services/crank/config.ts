import { resolveSolanaRpcUrl } from "../../app/lib/network";

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
  jitoEnabled: boolean;
  jitoTipLamports: bigint;
  jitoBlockEngineUrl?: string;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  pagerDutyRoutingKey?: string;
  dryRun: boolean;
}

export function loadConfig(overrides?: Partial<CrankConfig>): CrankConfig {
  const rpcUrl = resolveSolanaRpcUrl(overrides?.rpcUrl);

  const wsUrl =
    overrides?.wsUrl ||
    process.env.SOLANA_WS_URL ||
    rpcUrl.replace("http://", "ws://").replace("https://", "wss://");

  const rawPoolIds = overrides?.poolIds || parsePoolIds(process.env.POOL_IDS);

  return {
    rpcUrl,
    wsUrl,
    keypairPath:
      overrides?.keypairPath ||
      process.env.KEYPAIR_PATH ||
      process.env.ANCHOR_WALLET,
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
      parseNumber(process.env.MAX_PREPARE_BATCH_SIZE, 200),
    maxReinvestBatchSize:
      overrides?.maxReinvestBatchSize ??
      parseNumber(process.env.MAX_REINVEST_BATCH_SIZE, 5),
    jitoEnabled: overrides?.jitoEnabled ?? process.env.JITO_ENABLED === "true",
    jitoTipLamports:
      overrides?.jitoTipLamports ??
      BigInt(process.env.JITO_TIP_LAMPORTS || "10000"),
    jitoBlockEngineUrl:
      overrides?.jitoBlockEngineUrl || process.env.JITO_BLOCK_ENGINE_URL,
    discordWebhookUrl:
      overrides?.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL,
    telegramBotToken:
      overrides?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: overrides?.telegramChatId || process.env.TELEGRAM_CHAT_ID,
    pagerDutyRoutingKey:
      overrides?.pagerDutyRoutingKey || process.env.PAGERDUTY_ROUTING_KEY,
    dryRun: overrides?.dryRun ?? process.env.DRY_RUN === "true",
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
