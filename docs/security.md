# Security

SPICA moves money on behalf of an AI agent, so it assumes the model can be manipulated. Every protection that matters is enforced in server code or the database, not in a prompt. Paths below are under `src/server/` unless they start with `src/`, `spica/`, `scripts/` or `supabase/`.

## Threats and defenses

### The agent and its inputs

| Threat | Defense | Where |
| --- | --- | --- |
| Prompt injection makes the model overspend | The model's tools take a search term, a service ID and query parameters only. None takes an amount, recipient or approval. The firewall decides every payment | `agent/tools.ts`, `firewall/policy.ts` |
| The model invents a URL or service to pay | Only service IDs found in the same run can be bought. The endpoint, price and recipient come from the catalog and the seller's `402` | `agent/session.ts` |
| A runaway loop buys repeatedly | At most 3 purchases and 3 searches per run, 10 runs a minute per user, duplicate detection within 60 s | `agent/session.ts`, `src/app/api/agent/run/route.ts`, `store/windows.ts` |
| Third-party text instructs the model | Purchased data is wrapped as `untrusted_third_party_data` and cut to 20,000 characters, and the system prompt says to treat it as data | `agent/session.ts`, `agent/tools.ts` |
| A provider's error text reaches the agent or buyer | Failure messages are built from the HTTP status and the listed host only. The provider's body is never passed on | `provider-call.ts` |

### Spending

| Threat | Defense | Where |
| --- | --- | --- |
| Concurrent requests overspend a budget | Atomic reservation with a per-user advisory lock | `store/supabase.ts`, `supabase/migrations/20261105000000_spending_firewall.sql` |
| One approval or reservation signs twice | `beginSigning` moves `held` to `signing` once, for one requirement hash | `store/*`, `signer/index.ts` |
| An approval is reused for a different price | Approvals are bound to the requirement hash, and the purchase re-quotes | `purchase.ts` |
| An approval overrides a hard limit | Approval waives only the threshold and auto-pay checks | `firewall/policy.ts` |
| The seller raises the price after discovery | `price_changed` denial | `firewall/policy.ts` |
| The seller lies about settlement | Independent confirmation through Circle Gateway, the Arc receipt or the Hedera mirror node | `payments/*` |
| A third-party seller claims "not settled" to free the hold | `PAYMENT-NOT-SETTLED` is believed only from SPICA's own seller route | `purchase.ts` |
| An unknown outcome is forgotten and the budget reused | Holds that reached signing are released only when no payment was sent | `purchase.ts`, `store/*` |
| A listing pays the agent's own wallet | Such offers are dropped from the catalog, and providers cannot save the agent's wallet as their payout address | `discovery/catalog.ts`, `src/app/api/provider/route.ts` |
| Mainnet payment attempted | Only Arc Testnet, Hedera testnet and demo exist in the network registry. An offer on any other network is not payable, and an unknown network fails `unsupported_asset` | `src/lib/networks.ts`, `purchase.ts`, `firewall/policy.ts` |
| Demo signatures accepted in live mode | The registry refuses the demo adapter in live mode | `payments/registry.ts` |
| Audit outage undoes a payment | HCS publishing is best effort and runs after the receipt | `audit/record.ts`, `audit/hcs.ts` |

### Selling and provider keys

| Threat | Defense | Where |
| --- | --- | --- |
| A buyer replays a proof against a seller | Proof IDs are claimed once, enforced by a unique key | `spica/src/index.ts`, `payment_proofs` table |
| A buyer pays with a balance they do not have | Sellers settle before releasing data, because Gateway's `verify` checks signatures, not balances | `spica/src/index.ts` |
| A seller charges for a failed response | Delivery runs before settlement. Non-2xx means no settlement | `spica/src/index.ts`, `provider-call.ts` |
| A usage code leaks before payment | It is sent only in a paid response, after settlement, and the buyer reads it only from SPICA listings | `provider-call.ts`, `purchase.ts`, `src/lib/usage-code.ts` |
| A provider's API key leaks from the database | Stored encrypted with AES-256-GCM. The service record holds only a keyed HMAC fingerprint. RLS blocks the anon key | `secrets.ts`, `supabase/migrations/20261106130000_provider_api_keys.sql` |
| A provider's API key leaks to a buyer or another host | Added last to one upstream call, so buyer parameters cannot replace it. No redirects. Never returned to a client. Logs are scrubbed | `secrets.ts`, `provider-call.ts`, `store/types.ts` |
| A catalog or provider URL targets internal services (SSRF) | `https` only, private ranges refused after DNS lookup, no redirects, 20 s timeout and 1 MB cap. Checked when a listing is saved and on every call | `http/guard.ts`, `src/app/api/provider/services/route.ts` |

### Identity and access

| Threat | Defense | Where |
| --- | --- | --- |
| A client forges a user ID or spend total | Identity comes from the session cookie or a signed key. Totals are computed on the server | `http/api.ts`, `auth.ts`, `sdk.ts` |
| A sign-in message is replayed or made for another site | One-use nonce, 10-minute window, domain taken from `PAYGATE_PUBLIC_URL` and not from request headers | `auth.ts`, `src/app/api/auth/wallet/route.ts` |
| A key is edited to raise its budget or change its service | `pg_` and `spica_` keys are HMAC-signed. The developer API also checks the key's service against the route | `api-keys.ts`, `session.ts`, `src/app/api/v1/[serviceId]/route.ts` |
| A token is used for the wrong purpose | Every token names its purpose (`session`, `siwe-nonce`, `api_key`, `agent_key`), and each reader accepts one | `session.ts` |
| An agent key changes limits or decides approvals | Agent keys work only on `/api/sdk/v1/*`. Those routes read budgets and history and make purchases. Policy, approvals and key creation need a signed-in session | `sdk.ts`, `http/api.ts`, `src/app/api/sdk/v1/*` |
| An SDK retry pays twice | The idempotency key becomes a task whose budget is one payment, and earlier results are replayed | `sdk.ts` |
| The anon key reads the database | RLS on with no policies, `EXECUTE` revoked on functions | `supabase/migrations/*` |
| A key leaks into a prompt, log or bundle | Signing keys are read in `signer/keys.ts`. Server modules import `server-only`. Integration status shows variable names, never values | `signer/keys.ts`, `env.ts` |

## Keys and secrets

| Variable | Used for | Read in |
| --- | --- | --- |
| `AGENT_PRIVATE_KEY` | Signing Arc payments, and read-only Gateway lookups | `signer/keys.ts`. `env.ts` also reads it to check it is set and to derive the agent's address. `scripts/agent-wallet.mts` |
| `HEDERA_AGENT_PRIVATE_KEY` | Signing Hedera payments | `signer/keys.ts`. `env.ts` checks it is set |
| `SUPABASE_SERVICE_ROLE_KEY` | Database access | `env.ts`, passed to `store/supabase.ts`. `scripts/settle-pending.mts` |
| `HEDERA_OPERATOR_KEY` | HCS audit publishing | `audit/hcs.ts` |
| `PAYGATE_SESSION_SECRET` | Signing session cookies, sign-in nonce cookies, `pg_` developer keys and `spica_` agent keys. At least 32 characters | `session.ts` |
| `PAYGATE_ENCRYPTION_KEY` | Encrypting provider API keys (AES-256-GCM) and keying their fingerprints. 64 hex characters | `secrets.ts` |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | Calling the model that plans agent runs | `env.ts`, `agent/gemini.ts`, the Anthropic SDK |

- Use a new, dedicated wallet for the agent, holding only what you are willing to lose.
- Live mode refuses to start sessions without `PAYGATE_SESSION_SECRET`. Demo mode makes a random one per process, so sessions and keys end when the server restarts.
- Without `PAYGATE_ENCRYPTION_KEY`, providers cannot save an API key (`503`). Changing it makes every stored provider key unreadable.
- Rotating `PAYGATE_SESSION_SECRET` ends every session and invalidates every `pg_` and `spica_` key at once.

See [Configuration](configuration.md) for every variable.

## Sessions

- Sign-in uses [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) on Arc Testnet. There is no email login.
- `POST /api/auth/nonce` issues a random nonce in a signed cookie that lasts 10 minutes. It allows 30 requests per 10 minutes per IP.
- `POST /api/auth/wallet` accepts the signed message only if it is for this site's host (from `PAYGATE_PUBLIC_URL`) and chain `5042002`, carries that nonce, was issued in the last 10 minutes (with 60 s of clock skew), and is signed by its address. EOAs are checked by signature recovery, and smart wallets through the Arc RPC (ERC-1271 and ERC-6492). It allows 20 attempts per 10 minutes per IP.
- Each nonce is deleted when read, so a signed message cannot be replayed.
- The user ID is derived from the wallet address (`walletUserId` in `auth.ts`), so one address is always one user.
- The session is a cookie named `paygate_session` holding the user ID, address and chain, HMAC-signed with `PAYGATE_SESSION_SECRET`, with a 7-day expiry. It is httpOnly, `SameSite=Lax`, and `Secure` in production.
- Sessions are stateless, so `POST /api/auth/logout` clears the cookie but cannot revoke a copied token before it expires.
- The wallet that signs in only proves identity. Payments always come from the server's agent wallet, behind the firewall.
- Without a session, demo mode uses one shared demo user. Live mode requires signing in, and refuses to run without Supabase.
- Approvals can only be decided by their owner, while pending, before they expire.

## API keys and agent keys

Both kinds are signed tokens, not database rows. They last 30 days and cannot be revoked one at a time. Code: `api-keys.ts`.

| | `pg_` developer key | `spica_` agent key |
| --- | --- | --- |
| Issued | Automatically, after a paid purchase of a SPICA listing whose provider wrote no usage code. Not for SDK or developer API calls | By a signed-in person, with `POST /api/sdk/v1/keys` (5 a minute). Shown once |
| Grants | One service, one task, an optional budget and network, for one user and agent | Purchases for one user and agent |
| Accepted by | `GET /api/v1/:serviceId` for that service only | `/api/sdk/v1/purchases`, `/budget` and `/history` |
| Spending bound | The owner's policy, plus the budget signed into the key | The owner's policy, plus one payment per idempotency key |
| Rate limit | 60 calls a minute per key task | 60 a minute per user and route, 10 purchases a minute |

Anyone who holds either key can spend the owner's money within those bounds. Neither key works where a session is needed, and a session cookie does not work on the SDK purchase, budget and history routes.

## Rate limits

All limits use the in-memory sliding window in `http/rate-limit.ts`.

| Route | Limit | Keyed by |
| --- | --- | --- |
| Signed-in routes (`authed`) | 120 a minute unless set lower | User, path and method |
| `POST /api/agent/run`, `POST /api/marketplace/:id/buy` | 10 a minute | User, path and method |
| Public routes (`open`) | 120 a minute | Client IP and path |
| `GET /api/x402/:serviceId` | 120 a minute | Client IP |
| `GET /api/v1/:serviceId` | 60 a minute | Key task |
| SDK routes | 60 a minute; purchases 10 | User and path |
| Sign-in | Nonce 30, wallet 20, per 10 minutes | Client IP |

The client IP is the first `x-forwarded-for` entry, which a client can set unless a proxy overwrites it. Budgets do not depend on any of these limits.

## Known limits

- The signer is a module boundary, not a separate process. For production, move it to its own service or a KMS.
- Rate limiting is per server instance, and IP-keyed limits trust `x-forwarded-for`.
- The memory store is atomic on one process only. Live mode requires Supabase.
- `unverified` payments stay counted, are never re-checked, and there is no reconciliation screen.
- A `settling` payment that later fails keeps its committed reservation, so the amount stays counted.
- There is no provider identity check. A provider's payout address is whatever its owner saved. The `identityStatus` hook in `firewall/policy.ts` has no source wired in.
- Reputation reflects calls made through this deployment only.
- A registered provider endpoint without a stored API key can be called directly by anyone who knows its URL.
- `pg_` and `spica_` keys cannot be revoked one at a time. Rotating `PAYGATE_SESSION_SECRET` revokes all of them and ends every session.
- A `pg_` key is part of the usage code, which is stored in plain text as a `usage_code` activity event and shown on the receipt.
- `assertPublicUrl` exempts SPICA's own origin, including plain `http`, so that the buyer can reach SPICA's seller route.

## Reviewing a change

If a change touches money, keys or third-party input, check:

- Does any new model-facing tool or field accept an amount, URL, recipient or approval? It must not.
- Does any new path sign without `signPayment`, or release a hold after a proof was sent?
- Does any new purchase path skip `purchase()`, and so skip the firewall or the reservation?
- Does any new route take a user ID from the request instead of the session or a signed key?
- Does any new route accept a `pg_` or `spica_` key for something that needs a person: policy, approvals or key creation?
- Does any new third-party fetch skip `assertPublicUrl` and `safeFetch`?
- Does any new provider call return the provider's body on failure, or log it unscrubbed?
- Does any new code return a `ServiceCredential` or decrypted key to a client?
- Does any new module import `signer/keys.ts`?
- Run `npm test` and `npm run test:mutation`. If you added a protection, add a mutation for it.
