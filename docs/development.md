# Development guide

How to find your way around the code and make common changes.

## Setup

```bash
npm install
cp .env.example .env.local   # optional: with nothing set, SPICA runs in demo mode
npm run dev                  # http://localhost:3000
npm test
npm run typecheck
npm run lint
```

A fresh demo server has an empty marketplace. List an API on `/provider` before you ask the agent for one. See [Configuration](configuration.md) for every environment variable.

## Stack

Versions are from `package.json`.

| Piece | Version / library |
| --- | --- |
| Framework | Next.js 16.4.5 (App Router, `cacheComponents`, `partialPrefetching`), React 19.3.0 |
| Styling | Tailwind CSS 4 through `@tailwindcss/turbopack`, plus `components/spica/spica.css` for the public site |
| Icons and charts | `lucide-react`, `recharts` |
| Validation | zod 4 |
| AI | Gemini over its REST API with `fetch` (no SDK), or `@anthropic-ai/sdk` 1.x tool runner |
| x402 | `@x402/core`, `@x402/evm`, `@x402/hedera`, `@circle-fin/x402-batching` |
| Chains | viem (Arc Testnet, Sign-In with Ethereum), `@hiero-ledger/sdk` (Hedera Consensus Service) |
| Data | `@supabase/supabase-js` |
| Tests | Vitest 5, `tsx` for scripts |

`@google/genai` is used only by `tests/model-fallback.test.ts`. `@hashgraph/sdk` is used only by `create-topic.js`, a one-off script that creates the Hedera Consensus Service topic.

This Next.js version has breaking changes from older releases. Before writing framework code, read the relevant guide in `node_modules/next/dist/docs/`, as `AGENTS.md` asks. `next.config.ts` keeps `@hiero-ledger/sdk`, `@x402/hedera` and `@circle-fin/x402-batching` out of the bundle, because they use Node APIs.

## Where things live

| Path | What it is |
| --- | --- |
| `src/app/(site)/` | Public pages: landing, marketplace, providers, docs |
| `src/app/(auth)/` | The login page |
| `src/app/(app)/` | Signed-in pages: dashboard (with the agent chat), controls, provider, settings, transactions |
| `src/app/api/` | HTTP routes. See [Architecture](architecture.md#api-routes) |
| `src/server/` | All server-side logic. See [Architecture](architecture.md#modules) |
| `src/lib/` | Code shared with the browser: money, networks, proof links, usage codes |
| `src/components/` | React components. `components/spica/` holds the public site's components |
| `spica/` | The `paygate-x402` seller middleware package |
| `packages/agent-sdk/` | The `spica-agent-sdk` TypeScript client, with its own build and tests |
| `supabase/migrations/` | The database schema for live mode |
| `scripts/` | Wallet tools, settlement, end-to-end, live and mutation checks, the Claude stub |
| `tests/` | Vitest suites |
| `legacy/ens/` | Archived ENS code. Not built, typechecked or linted |

## Conventions

- **Money is `bigint` micro-USD.** Never use floating point for an amount. Convert at the edges with `src/lib/money.ts`. Record shapes that must be JSON-safe store micros as strings, and `toJson()` turns `bigint` into strings on the wire.
- **Server code starts with `import 'server-only'`** when it touches secrets, the environment, the network or the store. Code in `src/lib/` must stay safe for the browser.
- **Pick the right route wrapper** from `src/server/http/api.ts` or `src/server/sdk.ts`:
  - `authed()` for signed-in routes. It takes the user from the session, rate-limits per user, and turns zod errors into 400 responses.
  - `open()` for public, read-only routes. It rate-limits per client address.
  - `agentRoute()` for agent SDK routes. It reads an agent key from `Authorization: Bearer`.
  - The `/api/auth/*` routes, `/api/discover`, `/api/x402/[serviceId]` and `/api/v1/[serviceId]` use no wrapper and make their own checks.
- **Identity comes from `currentUser()`** in `src/server/auth.ts`, which reads the signed `paygate_session` cookie. In demo mode a signed-out visitor is the shared demo user. Never read a user ID from a request body.
- **Validate input with zod** at the route.
- **Third-party URLs** go through `assertPublicUrl` and `safeFetch`.
- **Never forward a provider's failure body.** It can echo the provider's key, and an agent would read it as trusted text. Use the plain explanations in `provider-call.ts`.
- **Only `verified` reads as paid.** Do not show `settling`, `unverified` or `simulated` as settled.
- **New records go through `SpendStore`**, implemented in both `MemoryStore` and `SupabaseStore`, with a migration for Supabase.
- **Keep the policy engine pure.** No I/O in `firewall/policy.ts`.
- **Use "SPICA" in user-facing text.** Internal names keep the old prefix: `PAYGATE_*` variables, `paygate_session`, `paygate-x402`, `PAYGATE-USAGE-CODE`, `X-PayGate-*` headers and the `paygate:` network and provider key prefixes.

## Common changes

### List an API on the marketplace

There is no built-in service list. The marketplace holds only the APIs providers list, plus the Circle catalog when `PAYGATE_CIRCLE_CATALOG=true`.

1. Open `/provider` and save a profile: a name, an Arc wallet address and, for Hedera, a Hedera account such as `0.0.1234`. You cannot use the agent's own wallet or account.
2. Under **Register an API**, enter a name, price per request in USD, category, your API's public https URL, networks and a description.
3. Optionally add your API's key, how to send it (bearer, header or query parameter) and its header or parameter name. Storing a key needs `PAYGATE_ENCRYPTION_KEY`, 64 hex characters.
4. Optionally write up to 3 lines of code buyers get after paying. Leave it empty and SPICA gives buyers a snippet with a developer API key.

The same thing over HTTP is `PUT /api/provider`, then `POST /api/provider/services`. `scripts/e2e-demo.mjs` does this at its start. The listing is served at `/api/x402/<service id>` and appears in `/api/marketplace`, `/api/discover` and agent searches. In demo mode without Supabase, listings disappear on restart.

### Change how SPICA calls a provider

Edit `deliverFromProvider` in `src/server/provider-call.ts`. It runs inside `withPayment`, before settlement, so any non-2xx response it returns charges nobody. Keep the provider's key out of logs with `scrubProviderText`, and keep redirects off.

### Add a policy rule

1. Add a `DenyCode` and the check in `evaluatePolicy`. Put it before the approval checks if it is a hard limit.
2. If it needs a new policy field, add it to `SpendingPolicy` and `DEFAULT_POLICY`, the `PUT /api/policy` schema, both stores, the `spending_policies` table in a new migration, and the `/controls` page. Add it to `budgetFor` in `src/server/sdk.ts` if agents should see it.
3. If it needs new request data, add it to `PaymentRequest` and fill it in `purchase.ts`.
4. Add tests in `tests/firewall.test.ts`, and a mutation in `scripts/mutation-check.mjs`.

### Add an agent tool

1. Add a method on `AgentSession` in `src/server/agent/session.ts`.
2. Add an entry to `agentTools()` in `src/server/agent/tools.ts`, with a name, a description, a zod `inputSchema` and `run`. Gemini and Claude both use this list. Gemini gets the schema through `toGeminiSchema`, so check that Gemini accepts it.
3. Do not give a tool any input that sets an amount, URL, recipient or approval. Wrap third-party text with `asUntrustedData`.
4. Update `SYSTEM_PROMPT` if the model needs to know when to use it, and mirror the behavior in `demo.ts` if it matters for the demo.

### Change the Gemini models

Edit `MODELS` in `src/server/agent/gemini.ts`. They are tried in order on rate limits, overload, retired models and timeouts. Setting `GEMINI_MODEL` uses only that model. The Claude model is `AGENT_MODEL` in `claude.ts`.

### Add an agent SDK route

Create `src/app/api/sdk/v1/<path>/route.ts`, wrap the handler in `agentRoute()`, and put the logic in `src/server/sdk.ts` so it can be tested without HTTP. No agent SDK route may change a limit. Add tests in `tests/sdk-backend.test.ts`, and update the client in `packages/agent-sdk/` if it should call the route.

### Add a network

Touch `NetworkId`, `NETWORKS` and `SELECTABLE_NETWORKS` in `src/lib/networks.ts`, an adapter in `src/server/payments/` registered in `registry.ts`, a signing scheme in `schemeFor` in `src/server/signer/index.ts`, `liveNetworks()` in `src/server/env.ts`, and the explorer list in `src/lib/proof.ts`. See [Networks and adapters](networks-and-adapters.md).

### Add a store method

Add it to the `SpendStore` interface, implement it in `memory.ts` and `supabase.ts`, and add any table or column to a new migration in `supabase/migrations/`. Keep migrations additive.

### Add an API route

Create `src/app/api/<path>/route.ts`, wrap the handler in `authed()` or `open()`, validate input with zod, and add the route to the table in [Architecture](architecture.md#api-routes) and the [API table in the README](../README.md#api).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev`, `build`, `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit`. Excludes `legacy/`, `packages/` and `spica/dist` |
| `npm run lint` | ESLint with the Next.js config. Ignores `legacy/` and `packages/*/dist` |
| `npm run wallet:status` | Show the agent's Arc wallet and Gateway balances |
| `npm run wallet:deposit -- <amount>` | Deposit testnet USDC into Gateway. A real onchain transaction |
| `npm run payments:settle` | Ask Circle about every payment still `settling` in Supabase |
| `node scripts/claude-stub.mjs [port]` | A scripted Claude API for testing the tool loop |

See [Testing](testing.md) for `npm test`, `test:e2e`, `test:live` and `test:mutation`.
