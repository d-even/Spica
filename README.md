# SPICA

A spending firewall and payment layer for AI agents. You ask for something in plain language. The agent finds a paid API, your spending rules decide whether it can pay, and you get the result with a receipt.

> Arc helps AI agents discover services. SPICA ensures agents can purchase those services safely, transparently and within the user's budget.

The limits are enforced on the server, outside the AI. The model has no tool that accepts an amount, a recipient or an approval.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000/provider and add an API. It then appears in the marketplace, and the agent page offers it as a one-click example.

With no configuration, SPICA runs in **demo mode**: no keys, no money, data in memory. It runs the real HTTP 402 handshake and the real firewall with a simulated payment rail. Everything it produces is labelled **Simulated**, and discovery still uses the live marketplace.

For how it works inside, see the [documentation](docs/README.md).

## Project status

Last checked on 2026-11-07. SPICA runs in live mode on testnet only. A real Arc payment has settled onchain. A real Hedera payment has not happened yet.

| Area | Status |
| --- | --- |
| App, agent, firewall and approvals | Working in live mode with Supabase |
| Unit tests | 165 of 165 passing, and `tsc` is clean |
| Agent SDK | Built in [`packages/agent-sdk`](packages/agent-sdk), with its own tests. Not published to npm. |
| Arc payments | Working. Gemini bought a service through Circle Gateway, and the payment settled onchain |
| Hedera payments | Accounts are set up and signing works. All 3 attempts failed, and the agent account holds 0 testnet USDC |
| HCS audit | Publishing. Only verified or settling payments are published so far, and the topic has no submit key |
| Circle discovery | Off. Set `PAYGATE_CIRCLE_CATALOG=true` to list the Circle catalog as well |

Not built yet:

- Weekly and per-merchant limits, and pause or revoke controls for an agent
- Multiple agents and agent identity
- The other five agent tools, and provider comparison
- Audit events for rejections, mirror-node verification and an audit dashboard
- Provider SDK
- The remaining API routes

## Steps so far

1. Built the spending firewall, the Arc and Hedera adapters, and the `paygate-x402` seller middleware.
2. Replaced OTP sign-in with wallet sign-in.
3. Moved the agent to Gemini, with fallback between models.
4. Added the service role grants migration.
5. Created a testnet account and an HCS topic with `create-topic.js`.
6. Inspected the repository and checked the facilitators, the Circle catalog and the Arc and Hedera testnets.

Next is Phase 1, a real Hedera x402 payment, once the setup steps below are done.

## What it does

- **AI agent:** Claude plans each request through three tools, with a labelled fixed planner when no key is set.
- **Spending Firewall:** per-request, daily, monthly and per-task limits, provider allowlist and blocklist, network permissions, an approval threshold, and an automatic-payment switch.
- **Discovery:** the marketplace holds only APIs that providers list on SPICA. It starts empty.
- **Payments:** Arc USDC through Circle Gateway nanopayments, and Hedera USDC through an x402 facilitator, behind one adapter interface.
- **Provider wallets:** providers connect a browser wallet (or paste an address) to receive Arc payments, and add a Hedera account ID for Hedera payments. No name service is required.
- **Reputation:** measured from real calls only. Below five calls it says "Not enough data".
- **Receipts and audit:** every payment gets a receipt, with optional Hedera Consensus Service publishing.
- **Provider dashboard:** register an API, set a price, and see revenue, failures and reputation.

## Architecture

```mermaid
flowchart TD
    U[Person] --> A[Agent: Claude or demo planner]
    A -->|discover, inspect| C[Catalog]
    C --> CM[Circle Agent Marketplace]
    C --> PG[SPICA services]
    A -->|purchase by service ID only| P[Purchase orchestrator]
    P -->|unpaid request| S[Seller]
    S -->|402 and terms| P
    P --> F[Policy engine]
    F -->|needs approval| H[Person approves]
    F -->|allowed| R[Atomic reservation]
    H --> R
    R --> K[Signer: single-use gate]
    K -->|signed proof| S
    S -->|data and settlement| P
    P --> V[Independent verification]
    V --> L[(Ledger, receipts, audit)]
    L -.optional.-> HCS[Hedera Consensus Service]
```

| Path | Responsibility |
| --- | --- |
| `spica/` | The `paygate-x402` package: reusable x402 v2 seller middleware for any Web `Request`/`Response` server |
| `src/server/firewall/policy.ts` | The policy engine, a pure function |
| `src/server/store/` | `SpendStore`: atomic reservations and all records, in memory or Supabase |
| `src/server/signer/` | The only code that reads buyer keys, and the only path to a signature |
| `src/server/payments/` | `PaymentAdapter` with Arc, Hedera and demo implementations |
| `src/server/purchase.ts` | The buyer flow from quote to receipt |
| `src/server/agent/` | Claude tool loop, demo planner and budget parsing |
| `src/server/discovery/` | Circle catalog client and SPICA services |

## Payment flow

1. The agent names a service it discovered in this run. It cannot supply a URL, price or recipient.
2. SPICA requests the resource unpaid and reads the seller's real `402` terms.
3. It chooses the cheapest offer on a network that is enabled and allowed.
4. The policy engine decides: allow, needs approval, or deny.
5. An atomic reservation re-checks budgets and duplicates. This stops concurrent requests overspending.
6. The signer moves that reservation from held to signing exactly once, for that exact requirement, and signs.
7. SPICA retries with `PAYMENT-SIGNATURE`.
8. The seller verifies, runs the handler, settles, and only then releases data.
9. SPICA confirms the payment itself instead of trusting the seller: through Circle Gateway, the Arc receipt, or the Hedera mirror node.
10. The ledger and receipt are written.

A held amount is only released when no money can have moved. If the outcome is unknown, for example the seller vanished after receiving the proof, the amount stays counted until someone reviews it.

Receipt statuses are **Verified** (settled and confirmed), **Settling** (accepted by Gateway, batch pending), **Unverified** (could not be confirmed), **Failed** and **Simulated** (demo).

## Going live on testnet

1. Copy `.env.example` to `.env.local`.
2. Create a Supabase project. Review `supabase/migrations/20261105000000_spending_firewall.sql` against any existing tables, then apply it.
3. Set `PAYGATE_SESSION_SECRET` to a random string of at least 32 characters, for example from `openssl rand -hex 32`. It signs the wallet sign-in cookies.
4. Add `ANTHROPIC_API_KEY`.
5. Create a new EOA wallet for the agent and set `AGENT_PRIVATE_KEY`. Set `PAYGATE_SELLER_ADDRESS` to a different wallet.
6. Get Arc testnet USDC from https://faucet.circle.com, then move it into Gateway:

   ```bash
   npm run wallet:status
   npm run wallet:deposit -- 1
   ```

8. Set `PAYGATE_MODE=live` and restart.

For Hedera, also set the `HEDERA_*` values. The agent and seller accounts must both be associated with the USDC token.

## Network configuration

| Network | CAIP-2 | Token | Rail | Status |
| --- | --- | --- | --- | --- |
| Arc Testnet | `eip155:5042002` | USDC `0x3600…0000` | Circle Gateway | Default |
| Hedera testnet | `hedera:testnet` | USDC `0.0.429274` | x402 facilitator | Default |

Arc and Hedera share nothing: each adapter has its own token, proof format and verification.

Base has been removed.

## API

All routes except `/api/x402/*`, `/api/v1/*` and `/api/auth/*` need a signed-in session. Identity always comes from the session, never the request body.

| Route | Purpose |
| --- | --- |
| `POST /api/agent/run` | Run the agent. Streams newline-delimited JSON events |
| `GET /api/overview` | Dashboard data, computed from the ledger |
| `GET`, `PUT /api/policy` | Read or change the spending policy |
| `POST /api/approvals/:id` | Approve or reject a held payment |
| `GET /api/transactions/:id` | Read a receipt |
| `GET /api/marketplace` | Search the catalog: `query`, `category`, `network`, `offset` |
| `GET`, `PUT /api/provider` | Provider profile, sales and reputation |
| `POST /api/provider/services` | Register an API, with optional code released after payment |
| `DELETE /api/provider/services/:id` | Remove your API |
| `GET /api/x402/:serviceId` | A paid resource, using x402 v2 |
| `GET /api/v1/:serviceId` | The developer API. Send the key from a purchase as `Authorization: Bearer <key>`. Each call pays through the firewall, and query parameters reach the provider |
| `POST /api/auth/nonce`, `/wallet`, `/logout` | Wallet sign-in (Sign-In with Ethereum on Arc Testnet) |
| `GET /api/auth/me` | The signed-in wallet, or null |

## Integrating SPICA

There are four ways in, depending on which side of the payment you are on.

| You want to | Use | Code to write |
| --- | --- | --- |
| Charge for an API you already run, without changing it | [Provider dashboard](#1-sell-an-existing-api-through-spica-no-code) | None |
| Charge for routes inside your own server | [`paygate-x402` middleware](#2-add-payments-to-your-own-server) | A few lines plus an adapter |
| Let your app or agent buy data within spending limits | [SPICA HTTP API](#3-buy-through-spica-from-your-app-or-agent) | An HTTP client |
| Pay a SPICA-hosted API from your own x402 client | [`/api/x402/:serviceId`](#4-pay-spica-services-from-any-x402-client) | An x402 v2 client |

You can also [reuse the policy engine](#reusing-the-firewall-in-your-own-agent) on its own.

### 1. Sell an existing API through SPICA (no code)

SPICA hosts the paywall and proxies paid requests to your API.

1. Sign in with your wallet and open `/provider`.
2. Fill in your provider profile:
   - **Wallet address**: the EVM address that receives USDC on Arc. Connect a browser wallet or paste it.
   - **Hedera account** (optional): needed if you accept Hedera, in the form `0.0.1234`.
3. Register a service with a name, description, public endpoint URL, price in USD (for example `0.02`) and the networks you accept.

Your API is then served at `GET /api/x402/<serviceId>` and appears in the marketplace and in agent discovery. For each call SPICA:

1. Returns `402` with your price and wallet.
2. Verifies the buyer's payment.
3. Calls your endpoint.
4. Settles only if your endpoint returned a `2xx`, then passes your response back.

If your API fails, nobody is charged. Sales, failures and measured reputation show on the provider dashboard.

The same steps work over HTTP. Authenticate as described in [section 3](#3-buy-through-spica-from-your-app-or-agent), then:

```bash
curl -X PUT  "$PAYGATE/api/provider" -b cookies.txt -H 'content-type: application/json' \
  -d '{"name":"Acme Data","walletAddress":"0xYourWallet","ensName":"acme.eth"}'

curl -X POST "$PAYGATE/api/provider/services" -b cookies.txt -H 'content-type: application/json' \
  -d '{"name":"Acme weather","description":"Current weather by city","endpoint":"https://api.acme.com/weather",
       "category":"Weather","price":"0.01","supportedNetworks":["arc-testnet"]}'
```

Requirements for your endpoint:

- It must be a public `https` URL that answers `GET` with JSON. SPICA refuses private and internal addresses.
- If your API needs a key, add it when you register the service, as a bearer token, a header or a query parameter. SPICA stores it encrypted (`PAYGATE_ENCRYPTION_KEY`) and sends it only on paid calls. Without a key, anyone who learns your URL can call it for free.
- Query parameters sent by buyers are passed through to your endpoint.

### 2. Add payments to your own server

[`paygate-x402`](spica/) is x402 v2 seller middleware that works on Web `Request` and `Response`. It runs in Next.js route handlers, Hono, Bun, Deno and Cloudflare Workers. Express and Fastify handlers use Node's `req`/`res` objects, so they need a bridge to Web `Request`/`Response` first.

```ts
import { withPayment } from 'paygate-x402';

export const GET = withPayment(
  async (request, { payer }) => Response.json({ data: 'paid content', payer }),
  {
    offers: [{ adapter: arcTestnet, amountAtomic: '10000', payTo: '0xYourWallet' }], // 10000 = $0.01 USDC
    replayGuard,
    description: 'Current weather by city',
  },
);
```

You supply:

- An **adapter** for each network you accept. It builds the price quote, verifies the buyer's proof and settles the payment.
- A **replay guard**, so one signed payment cannot unlock the resource twice.

Install and build steps, a working Arc adapter, a production replay guard and a Hono example are in [`spica/README.md`](spica/README.md). This repo's adapters are full references: [`arc.ts`](src/server/payments/arc.ts) and [`hedera.ts`](src/server/payments/hedera.ts).

Any x402 v2 buyer can pay you, including SPICA's agent, if your API is in the marketplace.

### 3. Buy through SPICA from your app or agent

Run SPICA (demo or live) and drive it over HTTP. Your app sends a plain-language request, and SPICA discovers, pays within your policy and returns the answer. Your app never holds the agent's payment key.

**Sign in.** In demo mode, signing in is optional: without it, everyone shares one demo user. In live mode, sign in with a wallet using [Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) on Arc Testnet. The wallet only proves who you are. Payments come from the server's agent wallet. Sign-in sets an httpOnly `paygate_session` cookie, valid for 7 days, which you send with later calls:

```ts
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const account = privateKeyToAccount(process.env.MY_WALLET_KEY as `0x${string}`);

// 1. Get a nonce. It comes with a signed cookie that must be sent back.
const nonceRes = await fetch(`${PAYGATE}/api/auth/nonce`, { method: 'POST' });
const nonceCookie = nonceRes.headers.getSetCookie()[0].split(';')[0];
const { nonce } = await nonceRes.json();

// 2. Sign a message for this site and Arc Testnet (chain 5042002).
const message = createSiweMessage({
  address: account.address, chainId: 5042002, domain: new URL(PAYGATE).host, uri: PAYGATE,
  version: '1', nonce, issuedAt: new Date(),
});
const signature = await account.signMessage({ message });

// 3. Exchange it for a session cookie.
const res = await fetch(`${PAYGATE}/api/auth/wallet`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: nonceCookie },
  body: JSON.stringify({ chain: 'arc-testnet', message, signature }),
});
const cookie = res.headers.getSetCookie()[0].split(';')[0]; // send this with later calls
```

The `curl` examples below use `-b cookies.txt`. Put that `paygate_session=...` value in it.

**Set your limits.** Amounts are USD strings:

```bash
curl -X PUT "$PAYGATE/api/policy" -b cookies.txt -H 'content-type: application/json' -d '{
  "perRequestLimit":"0.50","dailyLimit":"1.00","monthlyLimit":"10.00","approvalThreshold":"0.20",
  "autoPayEnabled":true,"allowedNetworks":["arc-testnet"],"allowedProviders":[],"blockedProviders":[]}'
```

**Run the agent.** The response streams newline-delimited JSON events:

```ts
const res = await fetch(`${PAYGATE}/api/agent/run`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ message: 'Latest weather, spend at most 10 cents' }),
});

const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  const lines = buffer.split('\n');
  buffer = lines.pop()!;
  for (const line of lines.filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'approval_required') console.log('Needs approval:', event.approvalId, event.amount);
    if (event.type === 'receipt') console.log('Paid:', event.transaction);
    if (event.type === 'answer') console.log(event.text);
  }
}
```

Event types are `status`, `budget`, `discovered`, `selected`, `quote`, `identity`, `policy`, `payment`, `receipt`, `approval_required`, `data`, `answer` and `error`. See `AgentEvent` in [`session.ts`](src/server/agent/session.ts).

**Approve held payments.** When a payment is above your approval threshold, the run stops with `approval_required`. A person approves or rejects it. Approval re-runs the purchase, and the hard limits are checked again:

```bash
curl -X POST "$PAYGATE/api/approvals/<approvalId>" -b cookies.txt -H 'content-type: application/json' \
  -d '{"decision":"approved"}'
```

Read a receipt with `GET /api/transactions/:id`. The full route list is under [API](#api). Agent runs are limited to 10 per minute per user.

### 4. Pay SPICA services from any x402 client

`GET /api/x402/:serviceId` is a standard x402 v2 resource.

1. Call it with no payment. You get `402` with a `PAYMENT-REQUIRED` header listing the accepted networks, asset, amount and `payTo`.
2. Retry with a signed proof in `PAYMENT-SIGNATURE`. `X-PAYMENT` is also accepted.
3. On success the data comes back with a `PAYMENT-RESPONSE` header holding the settlement.

Use any x402 v2 client that supports the network: Circle Gateway's batching client for Arc, or `@x402/hedera` for Hedera. Payments made this way skip SPICA's buyer firewall, because the firewall protects purchases made through SPICA.

### Reusing the firewall in your own agent

`evaluatePolicy` in [`policy.ts`](src/server/firewall/policy.ts) is a pure function with no I/O. It only depends on `src/lib/networks.ts` and `src/lib/money.ts`, so you can copy it into another agent:

```ts
import { evaluatePolicy, DEFAULT_POLICY } from './firewall/policy';

const decision = evaluatePolicy(
  { ...DEFAULT_POLICY, userId: 'u1' },
  { amountMicros: 20_000n, asset: '0x3600000000000000000000000000000000000000', network: 'arc-testnet',
    providerKey: 'acme', listedAmountMicros: 20_000n, identityStatus: 'match' },
  { spentTodayMicros: 0n, spentThisMonthMicros: 0n, spentThisTaskMicros: 0n },
);
// { outcome: 'allow' | 'needs_approval' | 'deny', reason, code? }
```

On its own it cannot stop two concurrent requests from both passing. Pair it with an atomic reservation, like `SpendStore.reserve` in [`src/server/store/`](src/server/store/). Call the model only after the decision is made, never as part of it.

## Testing

| Command | What it covers |
| --- | --- |
| `npm test` | Policy engine, reservations, approvals, middleware, reputation, URL guard |
| `npm run test:e2e -- <url>` | The full journey against a running server in demo mode |
| `npm run test:live` | Real Arc, Gateway and Hedera, with throwaway unfunded keys. It cannot spend |
| `npm run test:mutation` | Breaks 19 protections one at a time and confirms the tests notice |

## Security

- Spending limits are enforced by server code and the database, never by the model.
- Buyer keys are read only in `src/server/signer/keys.ts`, and never reach a prompt, tool result or client bundle.
- Signing needs a live reservation bound to the exact requirement, and each reservation signs once.
- Each payment proof can be used once, enforced by a unique database key.
- Sellers release data only after settlement, because Gateway's `verify` checks signatures, not balances.
- Third-party text reaches the model marked as untrusted data, and a run can attempt at most three purchases.
- Catalog URLs are checked against private address ranges, with redirects off, a timeout and a size cap.
- Provider API keys are stored as an encrypted copy plus a keyed hash. A hash cannot be reversed, so the encrypted copy is what calls the provider. The key is decrypted only on the server, after payment.
- Row-level security is on with no policies, so the public anon key can read nothing.
- Spend totals and verification status are always computed on the server.

### Known limits

- The signer is a module boundary, not a separate process. For production, move it to its own service or a KMS.
- Rate limiting is per server instance. Budgets do not depend on it.
- Unverified payments stay counted, and there is no reconciliation screen yet.
- Reputation is computed from calls made through this SPICA deployment.
- Provider revenue counts sales reported by SPICA's seller route.
- `paygate-x402` is not published to npm yet. Use it from source.
