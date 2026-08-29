import { CrankConfig } from "../config";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerEvent {
  poolId: number;
  type: "TRIP" | "RESET" | "PROBE";
  reason: string;
  timestamp: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private nextProbeTime = 0;
  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;

  constructor(
    private readonly config: CrankConfig,
    failureThreshold = 5,
    cooldownPeriodMs = 60_000
  ) {
    this.failureThreshold = failureThreshold;
    this.cooldownPeriodMs = cooldownPeriodMs;
  }

  getState(): CircuitBreakerState {
    if (this.state === "OPEN" && Date.now() >= this.nextProbeTime) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  canExecute(): boolean {
    const current = this.getState();
    return current === "CLOSED" || current === "HALF_OPEN";
  }

  recordSuccess(): void {
    if (this.state !== "CLOSED") {
      this.notifyAlert("RESET", "Circuit breaker recovered to CLOSED");
    }
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
  }

  async recordFailure(reason: string, isFatal = false): Promise<void> {
    this.consecutiveFailures += 1;

    if (isFatal || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
      this.nextProbeTime = Date.now() + this.cooldownPeriodMs;
      await this.notifyAlert(
        "TRIP",
        `Circuit breaker tripped to OPEN. Reason: ${reason} (consecutive failures: ${this.consecutiveFailures})`
      );
    }
  }

  private async notifyAlert(
    event: "TRIP" | "RESET",
    message: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    console.error(`[CircuitBreaker] [${event}] ${timestamp}: ${message}`);

    // Discord Webhook
    if (this.config.discordWebhookUrl) {
      try {
        await fetch(this.config.discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `🚨 **[YieldBonds Crank Alert]** ${event}\n> ${message}\n*Time: ${timestamp}*`,
          }),
        });
      } catch {}
    }

    // Telegram Alert
    if (this.config.telegramBotToken && this.config.telegramChatId) {
      try {
        const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.config.telegramChatId,
            text: `🚨 [YieldBonds Crank] ${event}: ${message}`,
          }),
        });
      } catch {}
    }
  }
}
