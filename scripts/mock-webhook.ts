import { serializeAnchorEvent } from "../app/lib/anchor-event-serializer";
import type { HeliusTransactionPayload } from "../app/lib/types/webhook";

export interface MockEventOptions {
  targetUrl?: string;
  secret?: string;
  signature?: string;
  slot?: number;
  programId?: string;
}

export async function sendMockWebhookEvent(
  eventType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventData: Record<string, any>,
  options: MockEventOptions = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const targetUrl =
    options.targetUrl ||
    process.env.WEBHOOK_URL ||
    "http://127.0.0.1:3000/api/webhooks/solana";
  const secret =
    options.secret ||
    process.env.HELIUS_WEBHOOK_SECRET ||
    "pb_webhook_secret_local_dev_123";
  const programId =
    options.programId ||
    process.env.NEXT_PUBLIC_PROGRAM_ID ||
    "CRLD15aDrBh12cNn149dAjaqdV2sWkccFM7y1HKqKZx";

  const logString = serializeAnchorEvent(eventType, eventData);
  const sig =
    options.signature ||
    `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const slot = options.slot || Math.floor(Date.now() / 400);

  const payload: HeliusTransactionPayload = {
    signature: sig,
    slot,
    timestamp: Math.floor(Date.now() / 1000),
    err: null,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      logMessages: [
        `Program ${programId} invoke [1]`,
        logString,
        `Program ${programId} success`,
      ],
      innerInstructions: [],
    },
  };

  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify([payload]),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Webhook request failed (${res.status}): ${JSON.stringify(json)}`
    );
  }
  return json;
}

export async function sendMockWebhookFixture(
  fixtureName: string,
  options: MockEventOptions = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  switch (fixtureName) {
    case "bonds-purchase":
    case "buy":
      return sendMockWebhookEvent(
        "BondsPurchased",
        {
          user: "User111111111111111111111111111111111111111",
          poolId: 1,
          bonds: 10,
          amount: 50000000n,
        },
        options
      );

    case "draw-complete":
    case "draw-completed":
      return sendMockWebhookEvent(
        "DrawCompleted",
        {
          poolId: 1,
          cycleId: 1,
          prizePot: 100000000n,
          winnersCount: 2,
        },
        options
      );

    case "harvest":
    case "yield-harvested":
      return sendMockWebhookEvent(
        "YieldHarvested",
        {
          poolId: 1,
          cycleId: 1,
          rawYield: 10000000n,
          fee: 250000n,
          prizePot: 9750000n,
          lockedTicketCount: 500,
          randomnessAccount: "Rand111111111111111111111111111111111111111",
        },
        options
      );

    case "draw-voided":
      return sendMockWebhookEvent(
        "DrawVoided",
        {
          poolId: 1,
          cycleId: 1,
          admin: "Admin11111111111111111111111111111111111111",
          prizesReversed: 100000000n,
          feesReversed: 2500000n,
        },
        options
      );

    default:
      throw new Error(`Unknown fixture name: ${fixtureName}`);
  }
}

// ─── CLI Entrypoint ──────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);

  const getArg = (flag: string, fallback?: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const fixture = getArg("--fixture");
  const event = getArg("--event");
  const targetUrl = getArg(
    "--target",
    process.env.WEBHOOK_URL || "http://127.0.0.1:3000/api/webhooks/solana"
  );
  const secret = getArg(
    "--secret",
    process.env.HELIUS_WEBHOOK_SECRET || "pb_webhook_secret_local_dev_123"
  );

  async function run() {
    console.log(`[Mock Webhook] Target: ${targetUrl}`);
    if (fixture) {
      console.log(`[Mock Webhook] Dispatching fixture: ${fixture}`);
      const res = await sendMockWebhookFixture(fixture, { targetUrl, secret });
      console.log("[Mock Webhook] Response:", res);
      return;
    }

    if (event) {
      const user =
        getArg("--user") || "User111111111111111111111111111111111111111";
      const poolId = Number(getArg("--pool", "1"));
      const cycleId = Number(getArg("--cycle", "1"));
      const bonds = Number(getArg("--bonds", "10"));
      const amount = BigInt(getArg("--amount", "50000000"));
      const prizePot = BigInt(getArg("--pot", "100000000"));
      const fee = BigInt(getArg("--fee", "2500000"));
      const winnersCount = Number(getArg("--winners", "1"));
      const randomnessAccount =
        getArg("--randomness") || "Rand111111111111111111111111111111111111111";
      const admin =
        getArg("--admin") || "Admin11111111111111111111111111111111111111";

      const eventData = {
        user,
        winner: user,
        admin,
        poolId,
        cycleId,
        bonds,
        bondsBought: bonds,
        amount,
        principal: amount,
        amountReinvested: amount,
        rawYield: amount,
        threshold: amount,
        fee,
        prizePot,
        cycleFeeCollected: fee,
        lockedTicketCount: bonds * 10,
        winnersCount,
        randomnessAccount,
        prizesReversed: prizePot,
        feesReversed: fee,
      };

      console.log(`[Mock Webhook] Dispatching event: ${event}`);
      const res = await sendMockWebhookEvent(event, eventData, {
        targetUrl,
        secret,
      });
      console.log("[Mock Webhook] Response:", res);
      return;
    }

    console.log(`
Usage:
  npx tsx scripts/mock-webhook.ts --fixture <fixture-name>
  npx tsx scripts/mock-webhook.ts --event <EventName> [options]

Fixtures:
  buy, draw-complete, harvest, draw-voided

Events:
  BondsPurchased, BondsSold, YieldHarvested, DrawCompleted, WinningsClaimed,
  RedemptionClaimed, DrawForceUnlocked, DrawVoided, DrawSkipped

Options:
  --target <url>       Webhook URL (default: http://127.0.0.1:3000/api/webhooks/solana)
  --secret <secret>   Webhook Secret
  --user <pubkey>     User public key
  --pool <number>     Pool ID (default: 1)
  --cycle <number>    Cycle ID (default: 1)
  --bonds <number>    Bond count (default: 10)
  --amount <number>   Amount in micro-units (e.g. 50000000)
  --pot <number>      Prize pot in micro-units
`);
  }

  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Mock Webhook Error]:", err);
      process.exit(1);
    });
}
