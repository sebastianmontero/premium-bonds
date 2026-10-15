# Huma Redemption & Valuation Semantics: Mainnet Evidence (Issue #15)

> **Status**: Q1, Q2, Q3 and Q5 answered from mainnet evidence; Q4 still open
> **Date**: 2026-10-15
> **Method**: Read-only analysis of Huma mainnet state and transactions (`npm run huma:analyze`, `scripts/huma-mainnet-analysis.ts`)
> **Related**: #7 (audit), #8 (Huma account pinning), #9 (redemption accounting), #15 (this question set)

---

## Summary

| #   | Question                                                           | Answer                                                                                                                                                                                                                                                                                                                                                                      | Confidence                                    |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Q1  | Which account does the Sentinel pass as `lender_underlying_token`? | The lender's **canonical USDC ATA** (2,844 / 2,844 pushes, including **288 / 288 for PDA lenders**). Sometimes it passes **None** (the Huma program ID, Anchor's encoding of an omitted optional account): 132 times, only for wallet lenders. No other token account was ever used.                                                                                        | High                                          |
| Q2  | Does a push increase `total_amount_withdrawn`?                     | **Yes.** All 994 lender states that only ever received pushes have `withdrawn == processed`; none has `withdrawn < processed`. Only lenders that were processed with None have outstanding balances, which they then claim with `disburse`.                                                                                                                                 | High                                          |
| Q3  | Request-ID allocation; `next`/`last` when the queue is empty?      | IDs are sequential, and a new request gets **`last_request_id + 1`**. `last_request_id` is the newest assigned ID, and `next_request_id` is the **oldest unprocessed** ID, i.e. the head of the queue. With an empty queue, `next = last + 1` (inferred, not observed). The `redemption_request` PDA seed encodes the ID as a **big-endian** u128.                          | High (empty-queue value inferred)             |
| Q4  | Is `ModeState.assets` already net of `losses`?                     | **Can't be determined on-chain.** `losses` has always been 0, and no `LossDeclaredEvent` or `declare_loss` call exists (the loss authority has signed exactly one transaction).                                                                                                                                                                                             | —                                             |
| Q5  | When is `cancel_redemption_request` used, and where do shares go?  | All 15 cancellations were signed by the **Sentinel** (`Huma3jh5…`, the same key that signs every `process_redemption_request`). They happened 3–14 h after the request, in the same transaction as the queue-processing step that then skips the request. Shares are returned to the lender's **canonical mode-token ATA** (15/15). _Why_ Huma cancels is off-chain policy. | High for the mechanics; the reason is unknown |

**New findings beyond #15, all relevant to #8 and #9:**

1. **The crank can't target a static `redemption_request` address.** Huma creates a new PDA for each request, `["redemption_request", u128_be(last_request_id + 1), pool_config]`, and all 1,905 observed adds (including those made by CPI) matched it. Our crank reads one fixed address from `HUMA_REDEMPTION_REQUEST` (`services/crank/config.ts:201`). On mainnet every submission after the first would almost certainly fail. The mock Huma doesn't check this account, so devnet never caught it.
2. **H2a (#9) is confirmed empirically.** `HumaPoolSnapshot::pending_request_id()` (`anchor/programs/anchor/src/huma.rs:46`) returns the pre-CPI `last_request_id`, which is the _previous_ request's ID. `is_redemption_settled` (`next_request_id > id`) is correct for these semantics.
3. **Cancelled shares would bypass our PST vault.** Shares come back to the lender's canonical mode-token ATA. Our pool sends PST from a PDA vault (`POOL_PST_SEED`), not an ATA, so a cancellation would leave PST in `ATA(pool PDA, PST mint)`, which the program never reads. This is the PST equivalent of C1. A cancelled request also advances `next_request_id` past its ID, so the current `is_redemption_settled` check would treat it as settled with 0 USDC.
4. **Whether Huma accepts a non-ATA `lender_mode_token` on `add_redemption_request_v2` is untested.** All 1,905 observed adds used the lender's canonical ATA. Our crank passes the PDA vault.

---

## Method

- **Program:** `HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn`, on mainnet only. The program doesn't exist on devnet, and our devnet runs use `mock-huma`. That's why the devnet check in #15 couldn't answer these questions.
- **State snapshot (slot 457,287,919):** `getProgramAccounts` filtered by account discriminator:
  - 1 production pool ("Huma 2.0 Genesis", `28hFhD21Nka3stL27a8zZ4nRLgaDVxRYwJgeEVgeakzS`) with modes Classic (`3FhoMD…`) and Maxi (`AcHvC4…`);
  - 59,320 `LenderState` accounts;
  - 4 open `RedemptionRequest` accounts.
- **History (4,930 successful Huma transactions):** the newest ~3,000 signatures of each mode's pool escrow (`pool_mode_token`, which only add/cancel/process touch), plus the loss authority, plus the full history of 40 sampled lender states. Raw transactions are cached as JSONL in the cache directory.
- **Decoding:** Anchor `BorshCoder` with `anchor/huma-finance-idl.json`. Huma has no on-chain Anchor IDL (`anchor idl fetch` → account not found), so the checked-in IDL was checked against real data. The differences found:
  - A legacy test pool (`J9wzhw…`, "Test pool don't deposit…") uses an older `PoolConfig` layout and is skipped.
  - Before slot ~391.0M, `process_redemption_request` had 17 accounts (no `strategy_manager_wallet`). With that layout, all 743 legacy calls map to the lender's ATA, None, or a skipped cancelled request.
  - Before slot ~418.4M, events encoded amounts and shares as **u128** rather than u64. With the widened layout, every `RedemptionRequestProcessedEvent.amount_processed` equals the lender's actual USDC delta (2,829 / 2,829).
  - 9 of the 15 `cancel_redemption_request` calls used an older 11-account layout. For those, only the signer, the events and the token balances are used.
- **Independent check:** I re-fetched the cited signatures with RPC `jsonParsed` (Solana's own parser, not ours) and confirmed the signer, the instruction logs and the token movements.

## Evidence

| Case                           | Signature                                                                                                                     | What it shows                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push to canonical ATA          | [`7SAHovzn…`](https://solscan.io/tx/7SAHovznxkkf7Jv1VACTDi33vuwPPWNftsGYjAgG2ogz6m58HoonwwxzQTCF1iGrxK7fHhigP4iXKcqLkiy519t)  | Request 45683. 9,909.113406 USDC moves from the pool's account (owner = pool authority `9936VFvg…`) to `C88NZoJM…`, owned by the lender `EpjW3rsw…`. The 8,697.006455 escrowed shares are burned.          |
| Push to a PDA lender           | [`a9Ytnng7…`](https://solscan.io/tx/a9Ytnng7XhQVQ4fMsEBQrLW86GQsVL7puPEokB6YN9SGez2ZdraPPWbEdTJLr3i1bknqztMA5yqZ8eXAWKMW3qL)  | Off-curve lender `6KMbL3…` receives 64.028013 USDC in its canonical ATA `7dQakaes…`.                                                                                                                       |
| None passed (no push)          | [`VfoahytL…`](https://solscan.io/tx/VfoahytLeJwrvi1FKjHnSNZ7s6iKxkBGXu6esvcGvWsK1JpsaqtzwWzTkSq6XPUeJzsWeDjkNfc23QeJJmCcCgz)  | Request 45501 is processed for 113.625363 USDC. Shares are burned, no USDC moves, and the amount waits for `disburse`.                                                                                     |
| `disburse`                     | [`5YpP4Dck…`](https://solscan.io/tx/5YpP4DckXuRcsJthtpDEi41yETCYvnDuhBRFg4QvYu9wFn5uF4PhrCzFak4Z4rdwWwRH9xdbW4tMaiEJ9YhiZaK1) | The lender claims 149.779196 USDC into its canonical ATA.                                                                                                                                                  |
| Sentinel cancellation          | [`2rps2k5i…`](https://solscan.io/tx/2rps2k5iPfLPhuwhwrzQpm4TagfhvkXZN1bD9hPQ8hTT2QHdTprRe2GwMYWFZieGnXMqUC7CK4zcWwLc6VuB27Zb) | The Sentinel cancels request 45314, then processing skips it in the same transaction. 17,997.372086 shares go back to the lender's ATA `CBUQAJPY…`.                                                        |
| Add via an integrating program | [`5zvuEqMP…`](https://solscan.io/tx/5zvuEqMPSKo27XvhSkh8ymGPwfFqKymZCFgsJLXdt33yjBHcKdnAq2uY6rZ44RRHBETRahcH6M1XLwFis54iCw2A) | Program `prm1azdDGzyqP76s3Hv2nuG3uLnBgR5u2d7pANwmmzC` (`SubmitRedemptionRequest`) CPIs `add_redemption_request_v2` for PDA lender `6KMbL3…`. The resulting request 45687 = previous `last_request_id` + 1. |

### Q1: push target

- `process_redemption_request` calls by target: 2,844 canonical ATA (2,556 wallet lenders, 288 PDA lenders), 132 None (all wallet lenders), 0 other accounts.
- 2,829 of the ATA calls moved USDC. The other 15 processed cancelled requests (`FullyCanceledRedemptionRequestSkippedEvent`), so nothing moved.
- **Why None?** It isn't simply a missing ATA: in 22 of 25 sampled None cases, the lender's USDC ATA already existed before processing. The rule is off-chain (ask Huma).

### Q2: `total_amount_withdrawn`

- Across all 14,902 lender states with processed redemptions: 14,824 have `withdrawn == processed`, 78 have `withdrawn < processed`, and none has `withdrawn > processed`.
- Lender states processed in the history window:

  | Processing history | `withdrawn == processed` | `withdrawn < processed` |
  | ------------------ | ------------------------ | ----------------------- |
  | Push only          | 994                      | **0**                   |
  | At least one None  | 43                       | 13                      |

- With the full history of sampled lenders: every push-only lender has `withdrawn == processed` and no `disburse`, so the push itself increased `withdrawn`.
- Consequence: after a push, `total_amount_processed − total_amount_withdrawn` is 0, and `disburse` has nothing left to pay.

### Q3: request IDs

- Live check across two snapshots ~1 h apart:
  - first snapshot: open requests 45684 and 45685, `next = 45684`, `last = 45685`;
  - two adds later: open requests 45684–45687, `next = 45684`, `last = 45687`.
- The last processed or skipped ID is 45683, which equals `next − 1`.
- 1,427 consecutive added IDs (44261–45687), and IDs never decrease over time (0 inversions).
- Every observed `redemption_request` address equals `PDA("redemption_request", id.to_be_bytes(), pool_config)`. That's **big-endian**, unlike our own LE seeds.
- Requests are processed strictly in ID order (0 out-of-order events). Cancelled requests stay in the queue until processing reaches them and skips them.

### Q4: losses

- The production pool's current mode states:

  | Mode    | `assets`                | `losses` | Price per 1M shares |
  | ------- | ----------------------- | -------- | ------------------- |
  | Classic | 410,042,626.231071 USDC | 0        | 1,139,404           |
  | Maxi    | 412,562.962394 USDC     | 0        | 1,000,171           |

- `PoolConfig.loss_authority` (`Cpne6RLq…`) has a single signature on mainnet, and no `LossDeclaredEvent` or `LossRecoveredEvent` has ever been observed.
- With `losses = 0`, the gross and net valuations are identical, so on-chain data can't distinguish the two hypotheses.
- Indirect hint: DefiLlama describes `ModeAssetsRefreshedEvent` deltas as yield "net of credit losses". That's about yield accrual, not the `losses` field.
- The program source (`huma-solana-programs`) is private. The Halborn audit (Sept–Oct 2024) is only available as a PDF.

### Q5: cancellations

- 15 cancellations across 9 lenders, all signed by `Huma3jh5pZd1WKKEApB66W5c75vzHfFdRUHM7oMLwdQV`.
  - The same key signs all 2,976 `process_redemption_request` calls, and it paid for 283 of the 1,905 adds, including the cited one submitted through `prm1azd…` (lenders paid for 1,618, others for 4).
  - It isn't registered as a `PoolOperator` for the production pool (no matching PDA).
- Delay from request to cancellation: 3.1 h to 13.9 h (median 8.1 h). No lender has ever cancelled their own request in the observed window.
- Shares go back to the lender's canonical mode-token ATA (15/15). The cancel event is followed in the same transaction by `FullyCanceledRedemptionRequestSkippedEvent`.

## Impact on #8 / #9

1. **C1, USDC.** For a PDA lender (our pool), the Sentinel pushes redemption USDC to `ATA(pool PDA, USDC)` while processing; it doesn't arrive at `disburse`. After the push, `disburse` has nothing to pay (Q2). The ledger-based design in #9 must take value from that ATA. It must also keep the `disburse` path, because None also happens (132 cases so far, none for PDA lenders).
2. **H2a.** Record the request ID as `last_request_id + 1` read before the CPI, or `last_request_id` read after it. Keep `settled ⇔ next_request_id > id`.
3. **Cancellation path (new).** A cancelled request also satisfies `next_request_id > id`, but it pays 0 USDC and returns PST to `ATA(pool PDA, PST mint)`. #9 needs to:
   - detect it (for example, the lender's `shares_pending_redemption` or `num_pending_redemption_requests` decreasing without a matching `total_amount_processed` increase);
   - recover the PST from the ATA;
   - re-queue or unwind the batch.
4. **Redemption request PDA (new, blocks mainnet).**
   - The crank must derive `["redemption_request", u128_be(last + 1), pool_config]` for each submission.
   - The program should verify it in `crank_submit_redemption_batch`, which belongs with H2c's account pinning in #8.
   - Concurrent adds by other lenders race on `last`. A lost race fails the transaction (the PDA doesn't match), and the crank retries.
5. **PST source account (new, unknown).** Every observed add sent PST from the lender's canonical ATA. If Huma requires that, our PDA vault fails at the CPI. Either confirm with Huma or move PST custody to `ATA(pool PDA, PST mint)`, which would also handle the cancellation refund in item 3.

## Questions still for Huma

1. **(Q4)** Is `ModeState.assets` net of `ModeState.losses` when valuing shares and processing redemptions?
2. **(Q1)** When does the Sentinel pass None for `lender_underlying_token` instead of the lender's ATA? Can that happen for PDA lenders?
3. **(Q5)** What policy triggers a Sentinel cancellation (8 h median after the request)?
4. **(new)** Does `add_redemption_request_v2` require `lender_mode_token` to be the lender's canonical ATA?
5. **(new)** Does processing or cancellation ever create the lender's ATA, or does the Sentinel rely on it already existing?

## Reproducing

```bash
# Optional: export MAINNET_RPC_URL=<paid RPC>; the public endpoint works but rate-limits heavily.
npm run huma:analyze -- --skip-history          # state snapshot only (~1 min)
npm run huma:analyze -- --max-signatures 3000   # snapshot + history (public RPC: ~1 h first run, cached afterwards)
npx tsx --test scripts/huma-mainnet-analysis.test.ts
```

Output goes to `$TMPDIR/huma-analysis/{snapshot.json,transactions.jsonl,findings.json}`; `--cache-dir` overrides the location.

## Sources

- Mainnet RPC data (Solana Foundation public endpoint), slots 332,611,711 – 457,287,919
- [Halborn audit – Huma Protocol (Solana program)](https://halborn.com/audits/huma/huma-protocol)
- [DefiLlama – Huma Finance v2 methodology](https://defillama.com/protocol/huma-finance-v2)
