import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BorshCoder, BN, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { address, getBase58Decoder } from "@solana/kit";
import { findAtaAddress } from "../app/lib/bonds-sdk";
import humaIdlJson from "../anchor/huma-finance-idl.json";
import {
  HUMA_MAINNET_PROGRAM_ID,
  analyzeQ1,
  analyzeQ2,
  analyzeQ3,
  analyzeQ4,
  analyzeQ5,
  decodeEventBytes,
  decodeHumaTx,
  decodeEvents,
  deriveRedemptionRequestPda,
  eventDiscriminator,
  u128Bytes,
  type DecodedEvent,
  type DecodedIx,
  type HumaTx,
  type RawTx,
  type Snapshot,
  type TokenDelta,
} from "./huma-mainnet-analysis";

const coder = new BorshCoder(humaIdlJson as unknown as Idl);

const LENDER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OTHER = "BPFLoaderUpgradeab1e11111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const POOL_CONFIG = "28hFhD21Nka3stL27a8zZ4nRLgaDVxRYwJgeEVgeakzS";
const MODE_CONFIG = "3FhoMDtZbnYkr4rGo9rhfF5wVXyZ7W4Tj8iUdXjWDzYH";

function encodeEvent(name: string, data: Record<string, unknown>): Buffer {
  return Buffer.concat([
    Buffer.from(eventDiscriminator(name)),
    coder.types.encode(name, data),
  ]);
}

function processedEventBytes(
  requestId: number,
  shares: number,
  amount: number
) {
  return encodeEvent("RedemptionRequestProcessedEvent", {
    request_id: new BN(requestId),
    lender: new PublicKey(LENDER),
    shares_processed: new BN(shares),
    amount_processed: new BN(amount),
  });
}

function rawTx(logs: string[]): RawTx {
  return {
    signature: "sig",
    slot: 1,
    blockTime: 100,
    failed: false,
    accountKeys: [HUMA_MAINNET_PROGRAM_ID],
    instructions: [],
    inner: [],
    logs,
    preTokenBalances: [],
    postTokenBalances: [],
  };
}

function humaTx(
  partial: Partial<HumaTx> & { ixs: DecodedIx[] },
  signature = "sig"
): HumaTx {
  return {
    signature,
    slot: 1,
    blockTime: 100,
    events: [],
    tokenBalances: [],
    ...partial,
  };
}

function ix(
  name: string,
  accounts: Record<string, string>,
  topIndex = 0
): DecodedIx {
  return {
    topIndex,
    inner: false,
    name,
    layout: "current",
    accounts,
    args: null,
  };
}

function event(
  name: string,
  data: DecodedEvent["data"],
  topIndex = 0
): DecodedEvent {
  return { topIndex, name, legacy: false, data };
}

function balance(
  account: string,
  owner: string,
  pre: bigint,
  post: bigint,
  mint = USDC
): TokenDelta {
  return { account, mint, owner, pre, post };
}

function snapshot(partial: Partial<Snapshot> = {}): Snapshot {
  return {
    slot: 1n,
    pools: [
      {
        poolConfig: POOL_CONFIG,
        poolState: "pool_state",
        poolId: "pool_id",
        name: "Test",
        underlyingMint: USDC,
        poolAuthority: "pool_authority",
        poolOwner: "owner",
        lossAuthority: "loss_authority",
        nextRequestId: 10n,
        lastRequestId: 11n,
        modeConfigKeys: [MODE_CONFIG],
        modeStates: [
          {
            assets: 2_000_000n,
            losses: 0n,
            cumulativeYields: 0n,
            assetsRefreshedAt: 0n,
          },
        ],
        operators: ["operator"],
      },
    ],
    modes: [
      {
        modeConfig: MODE_CONFIG,
        poolConfig: POOL_CONFIG,
        name: "Classic",
        modeMint: "mint",
        modeTokenProgram: TOKEN_PROGRAM,
        mintSupply: 1_000_000n,
        poolModeToken: "escrow",
      },
    ],
    lenders: [],
    openRequests: [],
    operatorPdas: [],
    ...partial,
  };
}

describe("Huma event decoding", () => {
  it("decodes a Program data log emitted by the Huma program", () => {
    const b64 = processedEventBytes(7, 500, 510).toString("base64");
    const events = decodeEvents(
      rawTx([
        `Program ${HUMA_MAINNET_PROGRAM_ID} invoke [1]`,
        `Program data: ${b64}`,
        `Program ${HUMA_MAINNET_PROGRAM_ID} success`,
      ])
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "RedemptionRequestProcessedEvent");
    assert.equal(events[0].topIndex, 0);
    assert.equal(events[0].data.request_id, 7n);
    assert.equal(events[0].data.amount_processed, 510n);
    assert.equal(events[0].data.lender, LENDER);
  });

  it("ignores identical log data emitted by another program", () => {
    const b64 = processedEventBytes(7, 500, 510).toString("base64");
    const events = decodeEvents(
      rawTx([
        `Program ${HUMA_MAINNET_PROGRAM_ID} invoke [1]`,
        `Program ${OTHER} invoke [2]`,
        `Program data: ${b64}`,
        `Program ${OTHER} success`,
        `Program ${HUMA_MAINNET_PROGRAM_ID} success`,
      ])
    );
    assert.equal(events.length, 0);
  });

  it("attributes events to the correct top-level instruction", () => {
    const b64 = processedEventBytes(8, 1, 1).toString("base64");
    const events = decodeEvents(
      rawTx([
        `Program ${OTHER} invoke [1]`,
        `Program ${OTHER} success`,
        `Program ${HUMA_MAINNET_PROGRAM_ID} invoke [1]`,
        `Program data: ${b64}`,
        `Program ${HUMA_MAINNET_PROGRAM_ID} success`,
      ])
    );
    assert.equal(events[0].topIndex, 1);
  });

  it("decodes the legacy u128 layout of RedemptionRequestProcessedEvent", () => {
    const bytes = Buffer.concat([
      Buffer.from(eventDiscriminator("RedemptionRequestProcessedEvent")),
      Buffer.from(u128Bytes(40_679n, "le")),
      new PublicKey(LENDER).toBuffer(),
      Buffer.from(u128Bytes(4_238_702n, "le")),
      Buffer.from(u128Bytes(4_239_426n, "le")),
    ]);
    const decoded = decodeEventBytes(bytes);
    assert.equal(decoded?.legacy, true);
    assert.equal(decoded?.data.shares_processed, 4_238_702n);
    assert.equal(decoded?.data.amount_processed, 4_239_426n);
  });

  it("keeps the current layout when the payload matches the IDL", () => {
    const decoded = decodeEventBytes(processedEventBytes(1, 2, 3));
    assert.equal(decoded?.legacy, false);
    assert.equal(decoded?.data.amount_processed, 3n);
  });

  it("returns null for unknown discriminators", () => {
    assert.equal(decodeEventBytes(new Uint8Array(16)), null);
  });
});

describe("u128 seed encoding", () => {
  it("encodes little- and big-endian", () => {
    const le = u128Bytes(0x0102n, "le");
    const be = u128Bytes(0x0102n, "be");
    assert.deepEqual([le[0], le[1], le[15]], [0x02, 0x01, 0]);
    assert.deepEqual([be[15], be[14], be[0]], [0x02, 0x01, 0]);
  });
});

describe("Q1: push target account", () => {
  it("classifies canonical ATA, other lender-owned account and foreign account", async () => {
    const ata = await findAtaAddress(LENDER, USDC, address(TOKEN_PROGRAM));
    const accounts = (target: string) => ({
      lender: LENDER,
      lender_underlying_token: target,
      underlying_mint: USDC,
      underlying_token_program: TOKEN_PROGRAM,
    });
    const txs = [
      humaTx(
        {
          ixs: [ix("process_redemption_request", accounts(ata))],
          tokenBalances: [balance(ata, LENDER, 0n, 100n)],
        },
        "a"
      ),
      humaTx(
        {
          ixs: [ix("process_redemption_request", accounts("aux"))],
          tokenBalances: [balance("aux", LENDER, 0n, 5n)],
        },
        "b"
      ),
      humaTx(
        {
          ixs: [ix("process_redemption_request", accounts("foreign"))],
          tokenBalances: [balance("foreign", OTHER, 0n, 5n)],
        },
        "c"
      ),
    ];
    const rows = await analyzeQ1(txs);
    assert.deepEqual(
      rows.map((r) => r.category),
      ["canonical_ata", "other_lender_owned_account", "not_owned_by_lender"]
    );
    assert.equal(rows[0].usdcDelta, 100n);
    assert.equal(rows[0].lenderIsPda, false);
  });
});

describe("Q2: push vs total_amount_withdrawn", () => {
  const lenderSnap = (withdrawn: bigint) => ({
    address: "ls",
    lender: LENDER,
    numPending: 0n,
    processed: 100n,
    withdrawn,
    sharesPending: 0n,
  });
  const pushTx = humaTx({
    ixs: [
      ix("process_redemption_request", {
        lender_state: "ls",
        lender_underlying_token: "ata",
      }),
    ],
    tokenBalances: [balance("ata", LENDER, 0n, 100n)],
  });

  it("concludes push counts when push-only lenders have withdrawn == processed", () => {
    const res = analyzeQ2(
      snapshot({ lenders: [lenderSnap(100n)] }),
      [pushTx],
      ["ls"]
    );
    assert.match(res.verdict, /^Push increases total_amount_withdrawn/);
    assert.equal(res.processedInHistory.pushOnlyWithdrawnEqualsProcessed, 1);
    assert.equal(res.sampled[0].pushedInHistory, 100n);
    assert.equal(res.population.withdrawnEqualsProcessed, 1);
  });

  it("reports mixed results when a push-only lender has withdrawn < processed", () => {
    const res = analyzeQ2(
      snapshot({ lenders: [lenderSnap(0n)] }),
      [pushTx],
      ["ls"]
    );
    assert.match(res.verdict, /^Mixed/);
  });

  it("is inconclusive without push-only evidence", () => {
    const res = analyzeQ2(
      snapshot({ lenders: [lenderSnap(100n)] }),
      [],
      ["ls"]
    );
    assert.match(res.verdict, /^Inconclusive/);
  });
});

describe("Q3: request ids", () => {
  async function addTx(id: number, endian: "le" | "be") {
    return humaTx({
      ixs: [
        ix("add_redemption_request_v2", {
          pool_config: POOL_CONFIG,
          redemption_request: await deriveRedemptionRequestPda(
            BigInt(id),
            POOL_CONFIG,
            endian
          ),
        }),
      ],
      events: [
        event("RedemptionRequestAddedEventV2", {
          request_id: BigInt(id),
          mode_config: MODE_CONFIG,
        }),
      ],
    });
  }

  it("detects consecutive ids and little-endian PDA seeds", async () => {
    const [res] = await analyzeQ3(snapshot(), [
      await addTx(9, "le"),
      await addTx(10, "le"),
      await addTx(11, "le"),
    ]);
    assert.deepEqual(res.recentContiguousRun, { from: 9n, to: 11n, count: 3 });
    assert.equal(res.idTimeInversions, 0);
    assert.equal(res.maxAddedId, 11n);
    assert.equal(res.pdaEndianness, "le");
  });

  it("detects gaps and big-endian PDA seeds", async () => {
    const [res] = await analyzeQ3(snapshot(), [
      await addTx(9, "be"),
      await addTx(11, "be"),
    ]);
    assert.deepEqual(res.recentContiguousRun, { from: 11n, to: 11n, count: 1 });
    assert.equal(res.pdaEndianness, "be");
  });
});

describe("Q4: losses", () => {
  it("is not determinable when no losses exist", () => {
    const res = analyzeQ4(snapshot(), []);
    assert.match(res.verdict, /^Not determinable/);
    assert.deepEqual(res.currentPricesPerMillionShares[0], {
      modeConfig: MODE_CONFIG,
      gross: 2_000_000n,
      netOfLosses: 2_000_000n,
    });
  });

  it("separates gross and net prices when losses exist", () => {
    const snap = snapshot();
    snap.pools[0].modeStates[0].losses = 500_000n;
    const res = analyzeQ4(snap, []);
    assert.match(res.verdict, /^Losses observed/);
    assert.equal(res.currentPricesPerMillionShares[0].netOfLosses, 1_500_000n);
  });
});

describe("Q5: cancellations", () => {
  it("classifies the signer and records returned shares", () => {
    const tx = humaTx({
      blockTime: 400,
      ixs: [
        ix("cancel_redemption_request", {
          signer: "operator",
          pool_config: POOL_CONFIG,
          lender_mode_token: "lmt",
        }),
      ],
      events: [
        event("RedemptionRequestAddedEventV2", {
          request_id: 3n,
          mode_config: MODE_CONFIG,
          payer: LENDER,
        }),
        event("RedemptionRequestCanceledEvent", {
          request_id: 3n,
          mode_config: MODE_CONFIG,
          lender: LENDER,
          shares: 50n,
        }),
      ],
      tokenBalances: [balance("lmt", LENDER, 0n, 50n, "mint")],
    });
    const [row] = analyzeQ5(snapshot(), [tx]);
    assert.equal(row.signerRole, "pool_operator");
    assert.equal(row.sharesReturned, 50n);
    assert.equal(row.lenderModeTokenOwner, LENDER);
    assert.equal(row.secondsSinceRequest, 0);
  });
});

describe("Account layouts", () => {
  const PROCESS_DISC = [211, 90, 36, 251, 91, 185, 216, 35];
  const processIx = (accountCount: number): RawTx => {
    const keys = [
      HUMA_MAINNET_PROGRAM_ID,
      ...Array.from({ length: accountCount }, (_, i) => `acct${i}`),
    ];
    return {
      ...rawTx([]),
      accountKeys: keys,
      instructions: [
        {
          programIdIndex: 0,
          accounts: Array.from({ length: accountCount }, (_, i) => i + 1),
          data: getBase58Decoder().decode(Uint8Array.from(PROCESS_DISC)),
        },
      ],
    };
  };

  it("maps the current 18-account process_redemption_request layout", () => {
    const [ixd] = decodeHumaTx(processIx(18)).ixs;
    assert.equal(ixd.layout, "current");
    assert.equal(ixd.accounts.strategy_manager_wallet, "acct10");
    assert.equal(ixd.accounts.lender_underlying_token, "acct14");
  });

  it("maps the legacy 17-account layout without strategy_manager_wallet", () => {
    const [ixd] = decodeHumaTx(processIx(17)).ixs;
    assert.equal(ixd.layout, "legacy");
    assert.equal(ixd.accounts.strategy_manager_wallet, undefined);
    assert.equal(ixd.accounts.lender_underlying_token, "acct13");
  });

  it("flags unknown layouts and excludes them from Q1", async () => {
    const tx = decodeHumaTx(processIx(16));
    assert.equal(tx.ixs[0].layout, "unknown");
    assert.deepEqual(await analyzeQ1([tx]), []);
  });
});

describe("Q1: omitted optional account", () => {
  it("classifies the program id sentinel as none_passed", async () => {
    const [row] = await analyzeQ1([
      humaTx({
        ixs: [
          ix("process_redemption_request", {
            lender: LENDER,
            lender_underlying_token: HUMA_MAINNET_PROGRAM_ID,
            underlying_mint: USDC,
            underlying_token_program: TOKEN_PROGRAM,
          }),
        ],
      }),
    ]);
    assert.equal(row.category, "none_passed");
    assert.equal(row.usdcDelta, null);
  });
});

describe("Q3: id ordering", () => {
  it("counts ids that decrease over time", async () => {
    const add = (id: bigint, slot: number) =>
      humaTx({
        slot,
        ixs: [ix("add_redemption_request_v2", { pool_config: POOL_CONFIG })],
        events: [
          event("RedemptionRequestAddedEventV2", {
            request_id: id,
            mode_config: MODE_CONFIG,
          }),
        ],
      });
    const [res] = await analyzeQ3(snapshot(), [add(5n, 1), add(4n, 2)]);
    assert.equal(res.idTimeInversions, 1);
    assert.equal(res.pdaEndianness, "unknown");
  });
});

describe("Q5: sentinel cancellations", () => {
  it("labels a signer that also processes redemptions as the sentinel", () => {
    const sentinel = "sentinel";
    const txs = [
      humaTx(
        { ixs: [ix("process_redemption_request", { signer: sentinel })] },
        "p"
      ),
      humaTx(
        {
          ixs: [ix("cancel_redemption_request", { signer: sentinel })],
          events: [
            event("RedemptionRequestCanceledEvent", {
              request_id: 1n,
              mode_config: MODE_CONFIG,
              lender: LENDER,
              shares: 5n,
            }),
          ],
          tokenBalances: [balance("lmt", LENDER, 0n, 5n, "mint")],
        },
        "c"
      ),
    ];
    const [row] = analyzeQ5(snapshot(), txs);
    assert.equal(row.signerRole, "sentinel");
    assert.equal(row.lenderModeToken, "lmt");
  });
});
