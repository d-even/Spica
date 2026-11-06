# Development guide

How to find your way around the code and make common changes.

## Setup

```bash
npm install
npm run dev        # http://localhost:3000
npm test
npm run typecheck
npm run lint
```

## Stack

| Piece | Version / library |
| --- | --- |
| Framework | Next.js 16 (App Router, `cacheComponents`), React 19 |
| Styling | Tailwind CSS 4 |
| Validation | zod 4 |
| AI | `@anthropic-ai/sdk` tool runner |
| x402 | `@x402/core`, `@x402/evm`, `@x402/hedera`, `@circle-fin/x402-batching` |
| Chains | viem (Arc, ENS, Sepolia), `@hiero-ledger/sdk` (Hedera Consensus Service) |
| Data | `@supabase/supabase-js` |
| Tests | Vitest |

This Next.js version has breaking changes from older releases. Before writing framework code, read the relevant guide in `node_modules/next/dist/docs/`, as `AGENTS.md` asks. `next.config.ts` keeps `@hiero-ledger/sdk`, `@x402/hedera` and `@circle-fin/x402-batching` out of the bundle because they use Node APIs.

## Conventions

- **Money is `bigint` micro-USD.** Never use floating point for an amount. Convert at the edges with `src/lib/money.ts`. Record shapes that must be JSON-safe store micros as strings.
- **Server code starts with `import 'server-only'`.** Code in `src/lib/` must stay safe for the browser.
- **Routes use `authed()`** from `src/server/http/api.ts`. It takes the user from the session, rate-limits, and turns zod errors into 400 responses. Only `/api/x402/*`, `/api/auth/*` and `/api/subdomain/check` are public.
- **Validate input with zod** at the route.
- **Third-party URLs** go through `assertPublicUrl` and `safeFetch`.
- **New records go through `SpendStore`**, implemented in both `MemoryStore` and `SupabaseStore`, with a migration for Supabase.
- **Keep the policy engine pure.** No I/O in `firewall/policy.ts`.

## Common changes

### Add a policy rule

1. Add a `DenyCode` and the check in `evaluatePolicy`. Put it before the approval checks if it is a hard limit.
2. If it needs a new policy field, add it to `SpendingPolicy` and `DEFAULT_POLICY`, the `PUT /api/policy` schema, both stores, the `spending_policies` table, and the `/controls` page.
3. If it needs new request data, add it to `PaymentRequest` and fill it in `purchase.ts`.
4. Add tests in `tests/firewall.test.ts`, and a mutation in `scripts/mutation-check.mjs`.

### Add a built-in service

1. Add an entry to `BUILTIN` in `src/server/discovery/catalog.ts` with an ID, name, description and price in micros.
2. Handle its ID in `deliver()` in `src/app/api/x402/[serviceId]/route.ts`. Return a non-2xx response when real data is unavailable, so nobody is charged.

### Add an agent tool

Add a method on `AgentSession` and a `betaZodTool` in `buildTools`. Do not give a tool any input that sets an amount, URL, recipient or approval. Wrap third-party text with `asUntrustedData`. Mirror the behavior in the demo planner if it matters for the demo.

### Add a network

See [Networks and adapters](networks-and-adapters.md#adding-a-network).

### Add a store method

Add it to the `SpendStore` interface, implement it in `memory.ts` and `supabase.ts`, and add any table or column to a new migration in `supabase/migrations/`. Keep migrations additive.

### Add an API route

Create `src/app/api/<path>/route.ts`, wrap the handler in `authed()`, validate the body with zod, and add the route to the [API table](../README.md#api).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run wallet:status` | Show the agent's Arc wallet and Gateway balances |
| `npm run wallet:deposit -- <amount>` | Deposit testnet USDC into Gateway. A real onchain transaction |
| `scripts/claude-stub.mjs` | A scripted Claude API for testing the tool loop |
| `scripts/test-ens.ts` | Ad hoc lookups against the PayGate ID registry contract on Sepolia |

See [Testing](testing.md) for the test scripts.
