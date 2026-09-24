import { CrankConfig } from "../config";

export interface IAlertNotifier {
  notifyAlert(
    event: string,
    message: string,
    poolId?: number,
    severity?: "info" | "warning" | "error" | "critical"
  ): Promise<void>;
  notifyLowBalance(solBalance: number): Promise<void>;
}

export class AlertNotifier implements IAlertNotifier {
  private lastAlertTimestamps: Map<string, number> = new Map();
  private readonly rateLimitWindowMs: number;

  constructor(
    private readonly config: CrankConfig,
    rateLimitWindowMs = 60_000
  ) {
    this.rateLimitWindowMs = rateLimitWindowMs;
  }

  async notifyAlert(
    event: string,
    message: string,
    poolId?: number,
    severity: "info" | "warning" | "error" | "critical" = "error"
  ): Promise<void> {
    const rateLimitKey = `${event}:${poolId ?? "global"}`;
    const now = Date.now();
    const lastTime = this.lastAlertTimestamps.get(rateLimitKey) || 0;

    // Suppress if rate-limited (unless critical)
    if (severity !== "critical" && now - lastTime < this.rateLimitWindowMs) {
      return;
    }
    this.lastAlertTimestamps.set(rateLimitKey, now);

    const timestamp = new Date().toISOString();
    const poolLabel = poolId !== undefined ? ` [Pool #${poolId}]` : "";
    console.error(
      `[AlertNotifier] [${severity.toUpperCase()}]${poolLabel} ${timestamp}: ${event} - ${message}`
    );

    // Fire non-blocking alerts
    this.dispatchDiscord(event, message, poolId, severity, timestamp).catch(
      () => {}
    );
    this.dispatchTelegram(event, message, poolId, severity).catch(() => {});
    this.dispatchPagerDuty(event, message, poolId, severity, timestamp).catch(
      () => {}
    );
  }

  async notifyLowBalance(solBalance: number): Promise<void> {
    if (solBalance >= 0.2 || this.config.dryRun) return;
    await this.notifyAlert(
      "LOW_SOL_BALANCE",
      `Signer SOL balance is critically low: ${solBalance.toFixed(4)} SOL (< 0.2 SOL threshold). Please fund crank account.`,
      undefined,
      "warning"
    );
  }

  private async dispatchDiscord(
    event: string,
    message: string,
    poolId: number | undefined,
    severity: string,
    timestamp: string
  ): Promise<void> {
    if (!this.config.discordWebhookUrl) return;

    const emoji =
      severity === "critical"
        ? "🚨🚨"
        : severity === "error"
          ? "🚨"
          : severity === "warning"
            ? "⚠️"
            : "ℹ️";
    const poolText = poolId !== undefined ? ` (Pool #${poolId})` : "";

    const payload = {
      content: `${emoji} **[YieldBonds Crank Alert: ${event}]**${poolText}\n> ${message}\n*Severity: ${severity.toUpperCase()} | Time: ${timestamp}*`,
    };

    try {
      await fetch(this.config.discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Non-blocking detached failure
    }
  }

  private async dispatchTelegram(
    event: string,
    message: string,
    poolId: number | undefined,
    severity: string
  ): Promise<void> {
    if (!this.config.telegramBotToken || !this.config.telegramChatId) return;

    const emoji =
      severity === "critical"
        ? "🚨🚨"
        : severity === "error"
          ? "🚨"
          : severity === "warning"
            ? "⚠️"
            : "ℹ️";
    const poolText = poolId !== undefined ? ` [Pool #${poolId}]` : "";
    const text = `${emoji} [YieldBonds Crank: ${event}]${poolText}\n${message}`;

    const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.telegramChatId,
          text,
        }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Non-blocking detached failure
    }
  }

  private async dispatchPagerDuty(
    event: string,
    message: string,
    poolId: number | undefined,
    severity: string,
    timestamp: string
  ): Promise<void> {
    if (!this.config.pagerDutyRoutingKey) return;

    const pdSeverity =
      severity === "critical"
        ? "critical"
        : severity === "error"
          ? "error"
          : severity === "warning"
            ? "warning"
            : "info";

    const payload = {
      routing_key: this.config.pagerDutyRoutingKey,
      event_action: "trigger",
      payload: {
        summary: `[YieldBonds Crank] ${event}${poolId !== undefined ? ` (Pool #${poolId})` : ""}: ${message}`,
        severity: pdSeverity,
        source: `yieldbonds-crank-${poolId ?? "global"}`,
        timestamp,
      },
    };

    try {
      await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Non-blocking detached failure
    }
  }
}
