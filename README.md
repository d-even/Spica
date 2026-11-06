# PayGate

A spending firewall and payment layer for AI agents. You ask for something in plain language. The agent finds a paid API, your spending rules decide whether it can pay, and you get the result with a receipt.

> Arc helps AI agents discover services. PayGate ensures agents can purchase those services safely, transparently and within the user's budget.

The limits are enforced on the server, outside the AI. The model has no tool that accepts an amount, a recipient or an approval.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000/agent and choose **Try the cricket example**.

With no configuration, PayGate runs in **demo mode**: no keys, no money, data in memory. It runs the real HTTP 402 handshake and the real firewall with a simulated payment rail. Everything it produces is labelled **Simulated**, and discovery still uses the live marketplace.

## Project status

Last checked on 2026-11-06. PayGate runs in live mode on testnet. A real Arc payment has settled onchain. A real Hedera payment has not happened yet.

| Area | Status |
| --- | --- |
| App, agent, firewall and approvals | Working in live mode with Supabase |
| Unit tests | 88 of 88 passing, and `tsc` is clean |
| Arc payments | Working. Gemini bought a service through Circle Gateway, and the payment settled onchain |
| Hedera payments | Accounts are set up and signing works. Blocked on testnet USDC: the agent account holds 0 |
| HCS audit | Publishing. Only verified or settling payments are published so far, and the topic has no submit key |
| Circle discovery | Live |

Not built yet:

- Weekly and per-merchant limits, and pause or revoke controls for an agent
- Multiple agents and agent identity
- The other five agent tools, and provider comparison
- Audit events for rejections, mirror-node verification and an audit dashboard
- Provider and agent SDKs
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

- **AI agent:** Gemini plans each request through three tools, with a labelled fixed planner when no key is set.
- **Spending Firewall:** per-request, daily, monthly and per-task limits, provider allowlist and blocklist, network permissions, an approval threshold, and an automatic-payment switch.
- **Discovery:** the live Circle Agent Marketplace, plus services registered on PayGate.
- **Payments:** Arc USDC through Circle Gateway nanopayments, and Hedera USDC through an x402 facilitator, behind one adapter interface.
- **Reputation:** measured from real calls only. Below five calls it says "Not enough data".
- **Receipts and audit:** every payment gets a receipt, with optional Hedera Consensus Service publishing.
- **Built-in APIs:** weather, news, stock quotes and cricket, resold per call. Their upstream keys stay on the server, and a buyer gets a PayGate key.
- **Provider dashboard:** register an API, set a price, and see revenue, failures and reputation.

## Architecture

```mermaid
flowchart TD
    U[Person] --> A[Agent: Gemini or demo planner]
    A -->|discover, inspect| C[Catalog]
    C --> CM[Circle Agent Marketplace]
    C --> PG[PayGate services]
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
| `paygate-x402/` | Reusable x402 v2 seller middleware for any Web `Request`/`Response` server |
| `src/server/firewall/policy.ts` | The policy engine, a pure function |
| `src/server/store/` | `SpendStore`: atomic reservations and all records, in memory or Supabase |
| `src/server/signer/` | The only code that reads buyer keys, and the only path to a signature |
| `src/server/payments/` | `PaymentAdapter` with Arc, Hedera and demo implementations |
| `src/server/purchase.ts` | The buyer flow from quote to receipt |
| `src/server/agent/` | Gemini tool loop, demo planner and budget parsing |
| `src/server/discovery/` | Circle catalog client and PayGate services |

## Payment flow

1. The agent names a service it discovered in this run. It cannot supply a URL, price or recipient.
2. PayGate requests the resource unpaid and reads the seller's real `402` terms.
3. It chooses the cheapest offer on a network that is enabled and allowed.
4. The policy engine decides: allow, needs approval, or deny.
5. An atomic reservation re-checks budgets and duplicates. This stops concurrent requests overspending.
6. The signer moves that reservation from held to signing exactly once, for that exact requirement, and signs.
7. PayGate retries with `PAYMENT-SIGNATURE`.
8. The seller verifies, runs the handler, settles, and only then releases data.
9. PayGate confirms the payment itself instead of trusting the seller: through Circle Gateway, the Arc receipt, or the Hedera mirror node.
10. The ledger and receipt are written.

A held amount is only released when no money can have moved. If the outcome is unknown, for example the seller vanished after receiving the proof, the amount stays counted until someone reviews it.

Receipt statuses are **Verified** (settled and confirmed), **Settling** (accepted by Gateway, batch pending), **Unverified** (could not be confirmed), **Failed** and **Simulated** (demo).

## Going live on testnet

1. Copy `.env.example` to `.env.local`.
2. Create a Supabase project. Review the files in `supabase/migrations/` against any existing tables, then apply them in filename order.
3. Set `PAYGATE_SESSION_SECRET` to a random value of at least 32 characters. People sign in with an Ethereum browser wallet (EOA), using Sign-In with Ethereum.
4. Add `GEMINI_API_KEY`.
5. Create a new EOA wallet for the agent and set `AGENT_PRIVATE_KEY`. Set `PAYGATE_SELLER_ADDRESS` to a different wallet.
6. Get Arc testnet USDC from https://faucet.circle.com, then move it into Gateway:

   ```bash
   npm run wallet:status
   npm run wallet:deposit -- 1
   ```

7. Add `CRICAPI_KEY` from https://cricketdata.org.
8. Set `PAYGATE_MODE=live` and restart.

## Hedera testnet setup

1. Create two testnet accounts at https://portal.hedera.com, one for the agent and one for the seller. They must be different, because a payment to yourself proves nothing.
2. Associate both accounts with testnet USDC, `0.0.429274`, using a Hedera wallet. The repo has no script for this yet.
3. Get testnet USDC for the agent account from https://faucet.circle.com.
4. Set these values in `.env.local`:

   | Variable | Value |
   | --- | --- |
   | `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` | The agent account |
   | `HEDERA_SELLER_ACCOUNT_ID` | The seller account |
   | `HEDERA_FACILITATOR_URL` | A facilitator from the table below |
   | `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | The account that pays for HCS messages. ECDSA keys only for `create-topic.js` |

5. Create the audit topic, then set `HEDERA_HCS_TOPIC_ID` to the ID it prints:

   ```bash
   node create-topic.js
   ```

6. Set `PAYGATE_MODE=live` and restart.

All three facilitators listed `hedera:testnet` on 2026-11-06. Settlement through them has not been tested. PayGate reads the fee payer from `/supported` at runtime, so these values are for reference only:

| Facilitator | Fee payer |
| --- | --- |
| `https://api.testnet.blocky402.com` | `0.0.7162784` |
| `https://x402.org/facilitator` | `0.0.9185802` |
| `https://testnet.facilitator.launa.dev` | `0.0.9839454` |

## Circle catalog on testnet

Of 2,745 unique listings, 134 accept Arc Testnet, all through Gateway. Of those, 132 are on `x402.quicknode.com`, which has not been tested. The other 2 are BotPay endpoints, and both returned a live Gateway 402. None look like research services, so most listings can be browsed but not paid on testnet.

## Network configuration

| Network | CAIP-2 | Token | Rail | Status |
| --- | --- | --- | --- | --- |
| Arc Testnet | `eip155:5042002` | USDC `0x3600…0000` | Circle Gateway | Default |
| Hedera testnet | `hedera:testnet` | USDC `0.0.429274` | x402 facilitator | Default |
| Arc | `eip155:5042` | USDC `0x3600…0000` | Circle Gateway | Off unless `PAYGATE_ENABLE_MAINNET=true` |
| Hedera mainnet | `hedera:mainnet` | USDC `0.0.456858` | x402 facilitator | Off unless `PAYGATE_ENABLE_MAINNET=true` |

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
| `POST /api/auth/challenge`, `/verify`, `/logout` | Wallet sign-in |

## Using the middleware

```ts
import { withPayment } from 'paygate-x402';

export const GET = withPayment(async () => Response.json({ data: 'paid content' }), {
  offers: [{ adapter: arcAdapter, amountAtomic: '20000', payTo: sellerAddress }],
  replayGuard,
});
```

Write a `SellerAdapter` to add a network. The middleware only knows the protocol.

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
- Reputation is computed from calls made through this PayGate deployment.
- Provider revenue counts sales reported by PayGate's seller route.
