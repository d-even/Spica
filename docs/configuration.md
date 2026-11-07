# Configuration

All configuration is environment variables. Copy `.env.example` to `.env.local`. With nothing set, SPICA runs in demo mode: no keys, no money and in-memory data.

The `/settings` page shows the mode and which integrations are configured (`integrations()` in `src/server/env.ts`). It lists missing variable names only, never values.

## Required in live mode

Live mode needs all of these. Without them, the app either throws or has nothing it can pay on.

| Variable | What breaks without it |
| --- | --- |
| `PAYGATE_MODE=live` | The app stays in demo mode |
| `PAYGATE_PUBLIC_URL` | Defaults to `http://localhost:3000`. Wallet sign-in rejects any message whose domain is not this URL's host, so a deployment must set it |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `getStore()` throws: live mode has no in-memory store |
| `PAYGATE_SESSION_SECRET` | Sign-in, sessions, developer keys and agent keys all fail. It must be at least 32 characters |
| At least one network's keys | `AGENT_PRIVATE_KEY` for Arc, or `HEDERA_AGENT_ACCOUNT_ID` + `HEDERA_AGENT_PRIVATE_KEY` + `HEDERA_FACILITATOR_URL` for Hedera. With neither, no network is active |

A model key (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) is optional in both modes. Without one, the fixed demo planner runs.

## Variables

These are every variable that code in `src/` and `scripts/` reads.

### Mode

| Variable | Default | Live mode | Effect |
| --- | --- | --- | --- |
| `PAYGATE_MODE` | `demo` | Required | `live` turns on real testnet payments. Any other value is demo. Demo and live never mix in one process |
| `PAYGATE_PUBLIC_URL` | `http://localhost:3000` | Required | The URL the app is reached at. A trailing `/` is removed. Used for: the seller endpoints of listed services (`/api/x402/<id>`), the developer URL given after a purchase (`/api/v1/<id>`), the domain check in wallet sign-in, and the URL guard, which lets SPICA call its own origin even over plain HTTP |

### AI model (the agent)

| Variable | Live mode | Effect |
| --- | --- | --- |
| `GEMINI_API_KEY` | Optional | Gemini plans agent runs, through the Gemini REST API |
| `GEMINI_MODEL` | Optional | Use only this Gemini model. When unset, SPICA tries `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` and `gemini-flash-latest` in that order. It moves to the next model on a rate limit, overload, retired model or no answer, but not on `400`, `401` or `403` |
| `ANTHROPIC_API_KEY` | Optional | Claude (`claude-opus-5-5`) plans agent runs |
| `ANTHROPIC_BASE_URL` | Optional | Read by the Anthropic SDK itself, not by SPICA code. Point it at `scripts/claude-stub.mjs` to test the tool loop without a key |
| `AGENT_PROVIDER` | Optional | `gemini` or `claude`. Picks one when both keys are set |

`agentProvider()` in `src/server/env.ts` decides:

1. `AGENT_PROVIDER=gemini` and `GEMINI_API_KEY` set: Gemini.
2. `AGENT_PROVIDER=claude` and `ANTHROPIC_API_KEY` set: Claude.
3. Otherwise `GEMINI_API_KEY` set: Gemini.
4. Otherwise `ANTHROPIC_API_KEY` set: Claude.
5. Otherwise the demo planner.

If `AGENT_PROVIDER` names a provider whose key is missing, it is ignored.

### Wallet sign-in and signed keys

| Variable | Live mode | Effect |
| --- | --- | --- |
| `PAYGATE_SESSION_SECRET` | Required | HMAC key for every signed token (`src/server/session.ts`). At least 32 characters, for example from `openssl rand -hex 32` |

The secret signs four kinds of token, each with its own purpose so one can never be used as another:

| Token | Where | Lifetime |
| --- | --- | --- |
| Session cookie (`paygate_session`) | `src/server/auth.ts` | 7 days |
| Sign-in nonce cookie (`paygate_siwe_nonce`) | `src/server/auth.ts` | 10 minutes, single use |
| Developer key (`pg_...`), issued after a paid purchase, used at `/api/v1/<serviceId>` | `src/server/api-keys.ts` | 30 days |
| Agent key (`spica_...`), issued at `/api/sdk/v1/keys`, used by the SDK routes | `src/server/api-keys.ts` | 30 days |

Keys are signed, not stored, so they cannot be revoked one by one. Changing the secret signs everyone out and invalidates every developer and agent key.

In demo mode without the secret, a random one is made per process. Sessions and keys then end when the server restarts.

People sign in with a browser wallet using Sign-In with Ethereum on Arc Testnet (chain `5042002`). The wallet code adds Arc Testnet to the wallet if it is missing. Hedera Testnet sign-in is shown as coming soon. The signature is checked over `ARC_TESTNET_RPC_URL` when set, otherwise the chain's default RPC.

### Provider API keys

| Variable | Live mode | Effect |
| --- | --- | --- |
| `PAYGATE_ENCRYPTION_KEY` | Optional | Exactly 64 hex characters (`openssl rand -hex 32`). Encrypts the API keys providers attach to their listings (`src/server/secrets.ts`) |

With the key set, a provider's API key is stored twice: as an AES-256-GCM sealed copy, so SPICA can call the provider after a payment, and as an HMAC-SHA256 fingerprint. The plain key is never stored.

Without the key, adding a listing with an API key fails with `503`. Listings without a key still work. Changing or losing the key makes every stored provider key unreadable, so back it up. `/settings` does not show this variable.

### Supabase

| Variable | Live mode | Effect |
| --- | --- | --- |
| `SUPABASE_URL` | Required | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Server-only database access. Never expose it to a browser |

Supabase is used only when both are set. In demo mode it is optional: without it, data lives in memory. Supabase is only the database. Sign-in does not use Supabase Auth, and no anon key is needed. See [Data model](data-model.md).

### Arc

| Variable | Live mode | Effect |
| --- | --- | --- |
| `AGENT_PRIVATE_KEY` | Required for Arc | The agent's buyer wallet. Use a new, dedicated EOA. Turns on `arc-testnet`. Also used for read-only Gateway lookups when checking settlement, and by `npm run wallet:*` |
| `ARC_TESTNET_RPC_URL` | Optional | Default `https://rpc.testnet.arc.io` |
| `ARC_TESTNET_GATEWAY_URL` | Optional | Circle Gateway API. Default `https://gateway-api-testnet.circle.com` |

### Hedera

| Variable | Live mode | Effect |
| --- | --- | --- |
| `HEDERA_FACILITATOR_URL` | Required for Hedera | x402 facilitator. `.env.example` sets `https://api.testnet.blocky402.com`. Code has no default, except `scripts/live-check.mts` |
| `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` | Required for Hedera | The agent's Hedera account. With the facilitator URL, turns on `hedera-testnet` |

### Hedera Consensus Service (optional audit trail)

| Variable | Live mode | Effect |
| --- | --- | --- |
| `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_HCS_TOPIC_ID` | Optional | All three turn on audit publishing to the topic on Hedera testnet |

A message is published when a payment is accepted (`verified` or `settling`), and again when a settling payment becomes final. It holds opaque IDs only: agent ID, provider key, amount, token, network, reference, status and timestamp. Never keys, emails, prompts or API responses. Publishing is best effort: a failure is logged as an `hcs_failed` activity event and does not undo the payment.

### Discovery

| Variable | Live mode | Effect |
| --- | --- | --- |
| `PAYGATE_CIRCLE_CATALOG` | Optional | `true` adds Circle Agent Marketplace listings to the marketplace page, `/api/discover` and agent search. Off by default, so only listings made on SPICA appear. Agent search asks Circle only for active live networks, so in demo mode the agent finds no Circle services |
| `CIRCLE_DISCOVERY_URL` | Optional | Override the Circle catalog endpoint. Default `https://api.circle.com/v2/x402/discovery/resources` |

### Runtime

| Variable | Effect |
| --- | --- |
| `NODE_ENV` | Set by Next.js. When `production`, session and nonce cookies are marked `Secure` |

## Common setups

### Demo, no keys

Nothing to set. Run `npm run dev` and open `/dashboard`.

### Demo with a model

```bash
GEMINI_API_KEY=...
# or
ANTHROPIC_API_KEY=sk-ant-...
```

### Live on Arc testnet

```bash
PAYGATE_MODE=live
PAYGATE_PUBLIC_URL=https://your-deployment.example
GEMINI_API_KEY=...             # or ANTHROPIC_API_KEY. Optional
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
PAYGATE_SESSION_SECRET=...     # openssl rand -hex 32
PAYGATE_ENCRYPTION_KEY=...     # openssl rand -hex 32. Optional, needed for provider API keys
AGENT_PRIVATE_KEY=0x...        # funded from faucet.circle.com, then deposited into Gateway
```

Then deposit into Gateway with `npm run wallet:deposit -- 1`. Add `HEDERA_FACILITATOR_URL`, `HEDERA_AGENT_ACCOUNT_ID` and `HEDERA_AGENT_PRIVATE_KEY` to pay on Hedera too.

Apply the migrations in `supabase/migrations/` first. Run `npm run payments:settle` from time to time to finish Gateway payments that nobody has reopened.

## Limits that are not configurable

These are constants in code, not settings. Rate limits are kept in memory per server instance.

| Limit | Value | Where |
| --- | --- | --- |
| Purchases per agent run | 3 | `src/server/agent/session.ts` |
| Searches per agent run | 3 | `src/server/agent/session.ts` |
| Data passed to the model | 20,000 characters | `src/server/agent/session.ts` |
| Data returned by a marketplace purchase | 50,000 characters | `src/app/api/marketplace/[id]/buy/route.ts` |
| Duplicate window | 60 s | `src/server/store/windows.ts` |
| Unsigned hold lifetime | 5 min | `src/server/store/windows.ts` |
| Approval lifetime | 10 min | `src/server/store/windows.ts` |
| Third-party fetch | 20 s timeout, 1 MB, no redirects | `src/server/http/guard.ts` |
| Gemini call | 30 s timeout, 10 steps | `src/server/agent/gemini.ts` |
| Agent runs | 10 / min / user | `src/app/api/agent/run/route.ts` |
| Signed-in routes | 120 / min / user / route and method | `authed` in `src/server/http/api.ts` |
| Public read routes | 120 / min / IP / route | `open` in `src/server/http/api.ts` |
| Discovery API | 60 / min / IP | `src/app/api/discover/route.ts` |
| Seller route | 120 / min / IP | `src/app/api/x402/[serviceId]/route.ts` |
| Developer key route | 60 / min / task | `src/app/api/v1/[serviceId]/route.ts` |
| SDK routes (agent key) | 60 / min / user / route, by default | `agentRoute` in `src/server/sdk.ts` |
| Wallet sign-in | 30 nonces and 20 sign-in attempts per IP, per 10 min | `src/app/api/auth/nonce`, `src/app/api/auth/wallet` |
| Sign-in message lifetime | 10 min | `src/server/auth.ts` |
| Session lifetime | 7 days | `src/server/auth.ts` |
| Developer and agent key lifetime | 30 days | `src/server/api-keys.ts` |
| Settlement re-check | Every 15 s, background watch for 30 min, 8 receipts per page load | `src/server/settlement.ts` |
