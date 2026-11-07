# Spending Firewall

The Spending Firewall decides every payment. It has two layers:

1. **The policy engine**, `evaluatePolicy` in `src/server/firewall/policy.ts`. It is a pure function: same inputs, same decision, no I/O and no model involvement.
2. **The atomic reservation**, `SpendStore.reserve`. The policy engine alone cannot stop two concurrent requests from both passing, so the reservation re-checks budgets inside a locked section.

The model is never consulted, and has no tool that could change either layer.

## The policy

One policy per user, edited on `/controls` or with `PUT /api/policy`.

| Field | Default | Meaning |
| --- | --- | --- |
| `perRequestLimit` | $0.50 | Hard maximum for any single payment |
| `dailyLimit` | $1.00 | Hard maximum per UTC calendar day |
| `monthlyLimit` | $10.00 | Hard maximum per UTC calendar month |
| `approvalThreshold` | $0.20 | Payments above this need a person |
| `autoPayEnabled` | `true` | When `false`, every payment needs a person |
| `allowedNetworks` | `arc-testnet`, `hedera-testnet` | Networks the person allows |
| `allowedProviders` | empty | Provider keys. Empty means any provider not blocked |
| `blockedProviders` | empty | Provider keys that are always refused |

The API also checks that `perRequestLimit <= dailyLimit <= monthlyLimit`.

## Evaluation order

Rules run in this order and the first one that fails decides. Every rule except approval is a **hard limit**: a person's approval cannot override it.

| # | Check | Deny code |
| --- | --- | --- |
| 1 | Amount is above zero | `invalid_amount` |
| 2 | Asset is the USDC token of that network | `unsupported_asset` |
| 4 | Network is in `allowedNetworks` (the demo network is exempt) | `network_not_allowed` |
| 5 | Provider is not blocked | `provider_blocked` |
| 6 | Provider is on the allowlist, if the allowlist has entries | `provider_not_allowlisted` |
| 7 | ENS name does not point somewhere else | `identity_mismatch` |
| 8 | Quote is not above the price listed at discovery | `price_changed` |
| 9 | Amount is within `perRequestLimit` | `per_request_limit` |
| 10 | Task spend plus amount is within the stated task budget | `task_budget` |
| 11 | Today's spend plus amount is within `dailyLimit` | `daily_limit` |
| 12 | This month's spend plus amount is within `monthlyLimit` | `monthly_limit` |
| 13 | Auto-pay is off → **needs approval** | |
| 14 | Amount above `approvalThreshold` → **needs approval** | |
| | Otherwise → **allow** | |

Rules 13 and 14 are skipped when a person already approved this exact quote (`humanApproved`).

Limits are inclusive: spending exactly up to a limit is allowed, and one micro-dollar over is not.

## Worked examples

With the default policy and nothing spent yet:

| Request | Decision | Why |
| --- | --- | --- |
| $0.02 from any service | allow | Under every limit and the threshold |
| $0.15 with threshold lowered to $0.10 | needs approval | Above the threshold, under the hard limits |
| $2.00 from any service | deny, `per_request_limit` | Above $0.50. Approval cannot override it |
| $0.02 when the message said "spend at most 1 cent" | deny, `task_budget` | Above the task budget |
| Anything from a blocked provider | deny, `provider_blocked` | Blocklist is a hard limit |

## Task budgets

A person can state a budget in their message, for example *"Get the cricket scores, spend at most 5 cents"*. `parseTaskBudget` in `src/server/agent/budget.ts` reads it with plain code, never the model, because the model is what the budget constrains.

- The message must contain a budget word: budget, spend, spending, limit, max, maximum, up to, no more than, at most, under or cap.
- Amounts are read as `$0.05`, `0.05 usd`, `0.05 usdc` or `0.05 dollars`.
- With several amounts, the **smallest** wins, so ambiguity errs toward spending less.
- Words like "5 cents" are not recognised. Without a dollar amount, there is no task budget.

The budget applies to the whole run (one `taskId`), across up to three purchases.

## How spend is counted

Spend is computed from **reservations**, not from receipts, so money that is on its way already counts.

| Reservation status | Counts? |
| --- | --- |
| `held`, under 5 minutes old | Yes |
| `held`, over 5 minutes old | No. It never reached signing |
| `signing` | Yes, always. The payment may have gone out |
| `committed` | Yes |
| `released` | No |

Days and months are UTC calendar windows (`src/server/store/windows.ts`).

## Atomic reservations

`reserve()` runs after the policy engine allows a payment. In one atomic step it:

1. Rejects a **duplicate**: the same user, resource, price and recipient within 60 seconds.
2. Re-checks the task budget, then the daily and monthly limits, against fresh totals.
3. Inserts a `held` reservation bound to the requirement hash.

How it stays atomic:

- **Supabase**: the `paygate_reserve_spend` Postgres function takes `pg_advisory_xact_lock` on the user, so one user's reservations run one at a time across every server instance.
- **Memory**: the critical section has no `await`, so on one Node event loop concurrent calls run one after another. It is not safe across several instances.

The test suite fires 50 concurrent $0.30 requests at a $1.00 budget and expects exactly three to succeed.

## The signing gate

A reservation is not permission to sign twice. `beginSigning(reservationId, requirementHash)` moves a reservation from `held` to `signing` only if:

- it is still `held`,
- its requirement hash matches the one about to be signed, and
- in Supabase, it is under 5 minutes old.

It succeeds at most once. `signPayment` refuses to sign without it.

## Approvals

```mermaid
sequenceDiagram
    participant P as purchase()
    participant D as SpendStore
    participant H as Person
    participant R as POST /api/approvals/:id
    P->>D: createApproval(quote, requirement hash, 10 min expiry)
    P-->>H: approval_required event
    H->>R: { decision: "approved" }
    R->>D: decideApproval: pending to approved, once
    R->>P: purchase(service, params, approval)
    P->>P: fresh quote; humanApproved only if the hash matches
    P->>P: hard limits checked again
```

- An approval stores everything needed to replay the purchase: the service, the parameters and the task budget.
- `decideApproval` is an atomic `pending` to decided transition. It fails if the approval is already decided, has expired, or belongs to another user.
- On approval, `purchase()` runs again from the top. If the seller's quote changed, the hash no longer matches, and the new quote needs a fresh approval.
- The agent has no route to approvals. Deciding one needs a signed-in session.
- Approvals expire after 10 minutes.
