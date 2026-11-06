# Security

PayGate moves money on behalf of an AI agent, so it assumes the model can be manipulated. Every protection that matters is enforced in server code or the database, not in a prompt.

## Threats and defenses

| Threat | Defense | Where |
| --- | --- | --- |
| Prompt injection makes the model overspend | The model has no tool that takes an amount, recipient or approval. The firewall decides every payment | `agent/claude.ts`, `firewall/policy.ts` |
| The model invents a URL or service to pay | Only service IDs found in the same run can be bought | `agent/session.ts` |
| A runaway loop buys repeatedly | At most 3 purchases per run, 10 runs a minute, duplicate detection within 60 s | `agent/session.ts`, `store/windows.ts` |
| Third-party text instructs the model | Purchased data is wrapped as `untrusted_third_party_data` and truncated, and the system prompt says to treat it as data | `agent/session.ts` |
| Concurrent requests overspend a budget | Atomic reservation with a per-user advisory lock | `store/supabase.ts`, migration |
| One approval or reservation signs twice | `beginSigning` moves `held` to `signing` once, for one requirement hash | `store/*`, `signer/index.ts` |
| An approval is reused for a different price | Approvals are bound to the requirement hash, and the purchase re-quotes | `purchase.ts` |
| An approval overrides a hard limit | Approval waives only the threshold and auto-pay checks | `firewall/policy.ts` |
| The seller raises the price after discovery | `price_changed` denial | `firewall/policy.ts` |
| Payment goes to an impostor | ENS name must resolve to `payTo`. A mismatch is a hard denial | `identity/ens.ts` |
| The seller lies about settlement | Independent confirmation through Gateway, the Arc receipt or the Hedera mirror node | `payments/*` |
| An unknown outcome is forgotten and the budget reused | Holds that reached signing are never released unless no payment was sent | `purchase.ts`, `store/*` |
| A buyer replays a proof against a seller | Proof IDs are claimed once, enforced by a unique key | `paygate-x402`, `payment_proofs` |
| A buyer pays with a balance they do not have | Sellers settle before releasing data, because Gateway's `verify` checks signatures, not balances | `paygate-x402` |
| A seller charges for a failed response | Handler runs before settlement. Non-2xx means no settlement | `paygate-x402` |
| A catalog URL targets internal services (SSRF) | `https` only, private ranges refused after DNS lookup, no redirects, timeout and size cap | `http/guard.ts` |
| A key leaks into a prompt, log or bundle | Keys read only in `signer/keys.ts`. Server modules import `server-only` | `signer/keys.ts` |
| A client forges a user ID or spend total | Identity comes from the session cookie. Totals are computed on the server | `http/api.ts`, `auth.ts` |
| The anon key reads the database | RLS on with no policies, `EXECUTE` revoked on functions | migration |
| Mainnet turned on by mistake | Needs `PAYGATE_ENABLE_MAINNET=true` on the server. Policy cannot override it | `env.ts`, `firewall/policy.ts` |
| Demo signatures accepted in live mode | The registry refuses the demo adapter in live mode | `payments/registry.ts` |
| Audit outage undoes a payment | HCS publishing is best effort and runs after the receipt | `audit/hcs.ts` |

## Keys

| Key | Used for | Read in |
| --- | --- | --- |
| `AGENT_PRIVATE_KEY` | Signing Arc payments, and read-only Gateway lookups | `signer/keys.ts` |
| `HEDERA_AGENT_PRIVATE_KEY` | Signing Hedera payments | `signer/keys.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Database access | `store/supabase.ts` |
| `HEDERA_OPERATOR_KEY` | HCS publishing | `audit/hcs.ts` |
| `ADMIN_PRIVATE_KEY` | Creating PayGate IDs on Sepolia | `lib/subdomain.ts` |
| `PAYGATE_SESSION_SECRET` | Signing session and sign-in cookies | `server/session.ts` |

Use a new, dedicated wallet for the agent, holding only what you are willing to lose. Keep `ADMIN_PRIVATE_KEY` separate from it.

## Sessions

- Sign-in uses [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) on Arc Testnet. `POST /api/auth/nonce` issues a random nonce in a signed cookie that lasts 10 minutes. `POST /api/auth/wallet` accepts the signed message only if it is for this site's host and chain `5042002`, carries that nonce, was issued in the last 10 minutes, and is signed by its address. EOAs are checked by signature recovery, and smart wallets through the Arc RPC (ERC-1271 and ERC-6492).
- Each nonce is deleted when used, so a signed message cannot be replayed.
- The session is a cookie named `paygate_session` holding the user ID, address and chain, HMAC-signed with `PAYGATE_SESSION_SECRET`, with a 7-day expiry. It is httpOnly, `SameSite=Lax`, and `Secure` in production. Every token names its purpose, so a nonce cookie cannot be used as a session.
- Sessions are stateless, so signing out clears the cookie but cannot revoke a copied token before it expires. Rotate `PAYGATE_SESSION_SECRET` to end every session.
- The wallet that signs in only proves identity. Payments always come from the server's agent wallet, behind the firewall.
- Without a session, demo mode uses one shared demo user. Live mode requires signing in, and refuses to run without Supabase.
- Approvals can only be decided by their owner, while pending, before they expire.

## Known limits

- The signer is a module boundary, not a separate process. For production, move it to its own service or a KMS.
- Rate limiting is per server instance. Budgets do not depend on it.
- Unverified payments stay counted, and there is no reconciliation screen yet.
- ENS shows identity only. It says nothing about API quality.
- Reputation reflects calls made through this deployment only.
- A registered provider endpoint without a stored API key can be called directly by anyone who knows its URL. Providers can store a key, encrypted with `PAYGATE_ENCRYPTION_KEY`, which PayGate sends only on paid calls.

## Reviewing a change

If a change touches money, keys or third-party input, check:

- Does any new model-facing tool or field accept an amount, URL, recipient or approval? It must not.
- Does any new path sign without `signPayment`, or release a hold after a proof was sent?
- Does any new route take a user ID from the request instead of the session?
- Does any new third-party fetch skip `assertPublicUrl` and `safeFetch`?
- Does any new module import `signer/keys.ts`?
- Run `npm test` and `npm run test:mutation`. If you added a protection, add a mutation for it.
