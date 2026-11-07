# Spending Firewall

The Spending Firewall decides every payment SPICA makes. It has two layers:

1. **The policy engine**, `evaluatePolicy` in `src/server/firewall/policy.ts`. It is a pure function: same inputs, same decision, no I/O and no model involvement.
2. **The atomic reservation**, `SpendStore.reserve`. The policy engine alone cannot stop two concurrent requests from both passing, so the reservation re-checks budgets inside a locked section.

Every purchase path runs both layers: the agent, approvals, the marketplace, the developer API and the SDK all call `purchase()`. See [Payment flow](payment-flow.md). The model is never consulted, and has no tool that could change either layer. No route that accepts a `pg_` or `spica_` key can change a policy.

## The policy

One policy per user, edited on `/controls` or with `PUT /api/policy` (signed-in session only). A user with no saved policy gets the defaults (`DEFAULT_POLICY`).

| Field | Default | Meaning |
| --- | --- | --- |
| `perRequestLimit` | $0.50 | Hard maximum for any single payment |
| `dailyLimit` | $1.00 | Hard maximum per UTC calendar day |
| `monthlyLimit` | $10.00 | Hard maximum per UTC calendar month |
| `approvalThreshold` | $0.20 | Payments above this need a person |
| `autoPayEnabled` | `true` | When `false`, every payment needs a person |
| `allowedNetworks` | `arc-testnet`, `hedera-testnet` | Networks the person allows. Only these two can be chosen |
| `allowedProviders` | empty | Provider keys. Empty means any provider not blocked |
| `blockedProviders` | empty | Provider keys that are always refused |

Amounts are sent as decimal strings with up to 6 decimals and stored as micro-USD. The API also checks that `perRequestLimit <= dailyLimit <= monthlyLimit`. Provider lists hold up to 200 keys. A SPICA provider's key is `paygate:<provider id>`.

## Evaluation order

Rules run in this order and the first one that fails decides. Every rule except the approval checks is a **hard limit**: a person's approval cannot override it.

| # | Check | Deny code |
| --- | --- | --- |
| 1 | Amount is above zero | `invalid_amount` |
| 2 | Network is known, and the asset is that network's USDC token | `unsupported_asset` |
| 3 | Network is in `allowedNetworks` (the demo network is exempt) | `network_not_allowed` |
| 4 | Provider is not blocked | `provider_blocked` |
| 5 | Provider is on the allowlist, if the allowlist has entries | `provider_not_allowlisted` |
| 6 | Identity check did not report a mismatch | `identity_mismatch` |
| 7 | Quote is not above the price listed in the catalog | `price_changed` |
| 8 | Amount is within `perRequestLimit` | `per_request_limit` |
| 9 | Task spend plus amount is within the task budget, if there is one | `task_budget` |
| 10 | Today's spend plus amount is within `dailyLimit` | `daily_limit` |
| 11 | This month's spend plus amount is within `monthlyLimit` | `monthly_limit` |
| 12 | Auto-pay is off → **needs approval** | |
| 13 | Amount above `approvalThreshold` → **needs approval** | |
| | Otherwise → **allow** | |

Rules 12 and 13 are skipped when a person already approved this exact quote (`humanApproved`).

Limits are inclusive: spending exactly up to a limit is allowed, and one micro-dollar over is not.

Notes on single rules:

- **Rule 3** rarely fires in practice. `purchase()` already picks an offer only from networks that are active and allowed, and returns `network_not_allowed` itself when none is left.
- **Rule 6** never fires today. `PaymentRequest.identityStatus` is an optional hook for a future identity source. No source is wired in, and `purchase()` does not set it. The earlier ENS check was removed.
- **Rule 7** applies when the catalog lists a price for the chosen network.

## Worked examples

With the default policy and nothing spent yet:

| Request | Decision | Why |
| --- | --- | --- |
| $0.02 from any service | allow | Under every limit and the threshold |
| $0.15 with threshold lowered to $0.10 | needs approval | Above the threshold, under the hard limits |
| $2.00 from any service | deny, `per_request_limit` | Above $0.50. Approval cannot override it |
| $0.02 when the message said "spend at most $0.01" | deny, `task_budget` | Above the task budget |
| $0.03 when the listing said $0.02 | deny, `price_changed` | The seller raised the price after discovery |
| Anything from a blocked provider | deny, `provider_blocked` | Blocklist is a hard limit |

## Task budgets

A task budget caps the total of one task (one `taskId`). Where it comes from depends on the caller:

| Caller | Task budget |
| --- | --- |
| Agent run | Parsed from the person's message, if stated. Covers the whole run, up to 3 purchases |
| Approval | The budget stored on the approval when it was created |
| Marketplace "Try API" | None |
| Developer API (`pg_` key) | The budget signed into the key: the one stated in the chat that bought it. Covers every call made with the key |
| SDK (`spica_` key) | The service's listed price, so one idempotency key pays once |

### Parsing a budget from a message

`parseTaskBudget` in `src/server/agent/budget.ts` reads the budget with plain code, never the model, because the model is what the budget constrains.

- The message must contain a budget word: budget, spend, spending, limit, max, maximum, up to, no more than, at most, under, cap, within, below, less than, cost or costing. "for" or "at" followed by an amount also counts, as in "a weather API for $0.03".
- Amounts are read as `$0.05`, `0.05 usd`, `0.05 usdc`, `0.05 dollar` or `0.05 dollars`.
- If there is no amount with a currency, a bare number right after budget, cost, costing, max, maximum, under or below is read, as in "budget 0.05" or "max of 0.05".
- With several amounts, the **smallest** wins, so ambiguity errs toward spending less.
- Words like "5 cents" are not recognised. Without an amount, there is no task budget.

### Picking a network from a message

`parseTaskNetwork` in the same file reads a network the same way. If the message names "arc" or "hedera" (as whole words) and not both, the purchase uses only that network: `arc-testnet` or `hedera-testnet`. Naming both, or neither, leaves it open. The developer API uses the network signed into its key. The SDK accepts only `arc-testnet`.

## How spend is counted

Spend is computed from **reservations**, not from receipts, so money that is on its way already counts.

| Reservation status | Counts? |
| --- | --- |
| `held`, under 5 minutes old | Yes |
| `held`, over 5 minutes old | No. It never reached signing |
| `signing` | Yes, always. The payment may have gone out |
| `committed` | Yes |
| `released` | No |

Days and months are UTC calendar windows (`src/server/store/windows.ts`). Task spend counts every live reservation with the same `taskId`, whatever its age.

## Atomic reservations

`reserve()` runs after the policy engine allows a payment. In one atomic step it:

1. Rejects a **duplicate**: a live reservation with the same dedupe hash in the last 60 seconds. The hash covers the user and the requirement hash (scheme, network, asset, amount, recipient and resource URL with its query). Developer API and SDK calls add a random value, so they are never duplicates of each other.
2. Re-checks the task budget, then the daily and monthly limits, against fresh totals.
3. Inserts a `held` reservation bound to the requirement hash.

A refusal returns the reason as the deny code: `duplicate`, `task_budget`, `daily_limit` or `monthly_limit`.

How it stays atomic:

- **Supabase**: the `paygate_reserve_spend` Postgres function takes `pg_advisory_xact_lock` on the user, so one user's reservations run one at a time across every server instance.
- **Memory**: the critical section has no `await`, so on one Node event loop concurrent calls run one after another. It is not safe across several instances. It is used in demo mode without Supabase, and in tests.

`tests/firewall.test.ts` fires 50 concurrent $0.30 requests at a $1.00 budget and expects exactly three to succeed.

## The signing gate

A reservation is not permission to sign twice. `beginSigning(reservationId, requirementHash)` moves a reservation from `held` to `signing` only if:

- it is still `held`,
- its requirement hash matches the one about to be signed, and
- in Supabase, it is under 5 minutes old.

It succeeds at most once. `signPayment` in `src/server/signer/index.ts` refuses to sign without it.

## Releasing and committing

- `releaseReservation` frees a `held` reservation. It frees a `signing` one only when the caller passes `paymentNotSent: true`, which `purchase()` does only when it knows no money moved. It never frees a `committed` one.
- `commitReservation` runs once confirmation returns anything other than `failed`.
- Settlement checks that later change a receipt do not change its reservation. See [Payment flow](payment-flow.md#settlement-checking).

## Approvals

```mermaid
sequenceDiagram
    participant P as purchase()
    participant D as SpendStore
    participant H as Person
    participant R as POST /api/approvals/:id
    P->>D: createApproval(quote, requirement hash, 10 min expiry)
    P-->>H: approval shown (agent event, marketplace, SDK 202)
    H->>R: { decision: "approved" }
    R->>D: decideApproval: pending to approved, once
    R->>P: purchase(service, params, approval)
    P->>P: fresh quote; humanApproved only if the hash matches
    P->>P: hard limits checked again
```

- An approval stores everything needed to replay the purchase: the service, the parameters, the task budget and the preferred network. It keeps the original `taskId`.
- Any caller of `purchase()` can create one: the agent, the marketplace, the developer API (which answers `403 needs_approval`) and the SDK (which answers `202 pending_approval`).
- `decideApproval` is an atomic `pending` to decided transition. It fails if the approval is already decided, has expired, or belongs to another user. A rejection only records the decision.
- On approval, `purchase()` runs again from the top, as a signed-in person, and the result goes back to that person. If the seller's quote changed, the hash no longer matches, and the new quote needs a fresh approval.
- Neither the agent nor a `pg_` or `spica_` key can decide an approval. Deciding one needs a signed-in session.
- Approvals expire after 10 minutes (`APPROVAL_TTL_MS`).
