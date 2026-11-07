# Concepts

The ideas SPICA is built on, and the words the rest of the docs use.

## The problem

An AI agent that can pay for APIs needs a wallet. A model that holds a wallet can be talked into spending it. Prompt injection in an API response, a confused plan or a hostile service description could all move money.

SPICA takes payment decisions away from the model. The model chooses *which* service would help. Server code decides *whether* to pay, *how much* and *to whom*, using rules the person set on the Spending limits page. The model has no tool that accepts an amount, a recipient or an approval.

## Who uses SPICA

| Role | What they do | Where |
| --- | --- | --- |
| Buyer | Sets spending limits, asks the agent for an API, approves held payments, reads receipts | `/dashboard`, `/controls`, `/transactions` |
| Developer | Calls a bought API from their own code with a developer API key, or buys from their own agent with an agent key | `/api/v1/[serviceId]`, `/api/sdk/v1/*` |
| Provider | Lists an existing API with a price, and gets paid per call | `/provider` |

## x402

[x402](https://github.com/coinbase/x402) is a protocol for paying for HTTP requests. SPICA uses version 2, and refuses version 1 terms.

```
Buyer                                  Seller
  | GET /resource                        |
  |------------------------------------->|
  |   402 Payment Required               |
  |   PAYMENT-REQUIRED: <terms>          |
  |<-------------------------------------|
  | GET /resource                        |
  | PAYMENT-SIGNATURE: <signed proof>    |
  |------------------------------------->|   verify, run handler, settle
  |   200 OK + data                      |
  |   PAYMENT-RESPONSE: <settlement>     |
  |<-------------------------------------|
```

- **Payment terms** (`PaymentRequired`): what the seller accepts. It has a list of `accepts` entries, called *requirements*.
- **Requirement** (`PaymentRequirements`): one way to pay, made of `scheme`, `network`, `asset`, `amount` and `payTo`, plus network-specific `extra` fields.
- **Proof** (`PaymentPayload`): the buyer's signed authorization for one requirement, base64-encoded in a header. The seller middleware also reads the older `X-PAYMENT` header name.
- **Facilitator**: a service that verifies and settles proofs for a network. On Arc this is Circle Gateway. On Hedera it is an x402 facilitator such as Blocky402.
- **Settlement** (`SettleResponse`): the facilitator's report that money moved, with a transaction reference.

SPICA is a **buyer** when its agent, the marketplace "Try" button, a developer API key or an agent key buys a call. It is a **seller** for every API a provider lists, at `/api/x402/[serviceId]`. The seller route calls the provider's real API only after the proof is verified, and settles only if that call succeeded.

## Money: micro-USD

Every amount is an integer number of **micro-USD**, stored as `bigint`. One USDC is 1,000,000 micros, which matches USDC's 6 decimals, so a micro is one atomic unit of USDC.

| USD | Micros |
| --- | --- |
| $1.00 | `1_000_000n` |
| $0.02 | `20_000n` |
| $0.000001 | `1n` |

Floating point never touches a limit. Convert with `usdToMicros`, `microsToUsd` and `formatUsd` in `src/lib/money.ts`. API request bodies take USD strings like `"0.50"`, and the server converts them. JSON responses send micros as strings, through `toJson()`.

## Networks and CAIP-2

Networks are named with [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) identifiers in x402 messages, and with short IDs inside SPICA. The list is in `src/lib/networks.ts`. There are no mainnet networks.

| SPICA ID | CAIP-2 | Money | Token |
| --- | --- | --- | --- |
| `arc-testnet` | `eip155:5042002` | Test USDC | `0x3600000000000000000000000000000000000000` |
| `hedera-testnet` | `hedera:testnet` | Test USDC | `0.0.429274` |
| `demo` | `paygate:demo` | Simulated, no money | `DEMO-USDC` |

A live network is enabled when its keys are set: `AGENT_PRIVATE_KEY` for Arc, and `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` and `HEDERA_FACILITATOR_URL` for Hedera. The agent SDK purchase route accepts only `arc-testnet`. Hedera Consensus Service holds the optional audit trail. See [Networks and adapters](networks-and-adapters.md).

## Demo mode and live mode

`PAYGATE_MODE` picks one mode for the whole process. The two never mix.

| | Demo (default) | Live |
| --- | --- | --- |
| Payment rail | Simulated `demo` network | Arc Testnet and/or Hedera testnet |
| Money | None | Testnet USDC only |
| Storage | Supabase if configured, otherwise in memory and lost on restart | Supabase, required |
| Sign-in | Optional wallet sign-in. Otherwise one shared demo user | Wallet sign-in on Arc Testnet, required |
| Session secret | `PAYGATE_SESSION_SECRET`, or a random one per process | `PAYGATE_SESSION_SECRET`, required |
| Receipts | **Simulated** | **Verified**, **Settling**, **Unverified** or **Failed** |

Demo mode still runs the real 402 handshake, the real firewall, real reservations and real receipts. The seller route still calls the provider's real API. Only the signature and the settlement are simulated.

Two settings are independent of the mode:

- **The planner.** Gemini or Claude plan agent runs when their key is set. Without either, a fixed demo planner runs the same discovery, firewall and payment path without reasoning.
- **The Circle catalog.** It is off unless `PAYGATE_CIRCLE_CATALOG=true`. Without it, the marketplace holds only what providers list on SPICA, so a fresh server starts with an empty marketplace.

## Keys and codes

SPICA issues several kinds of key and code. They are easy to mix up.

| Name | Looks like | Who gets it | What it does |
| --- | --- | --- | --- |
| Session | `paygate_session` cookie | A person who signed in with a wallet | Identifies the person to the app's own routes. Lasts 7 days |
| Developer API key | `pg_...` | The buyer, after a paid purchase of a SPICA listing | Calls one API at `/api/v1/[serviceId]`. Each call is a new payment under the owner's limits and the budget signed into the key. Lasts 30 days |
| Agent key | `spica_...` | A signed-in person, from the Settings page | Lets their own agent buy through `/api/sdk/v1/*`. It cannot change limits. Shown once, lasts 30 days |
| Usage code | Up to 3 lines of code | The buyer, in the paid response | Shows how to call the bought API. The provider writes it, or SPICA generates one that uses the developer API key |
| Provider credential | Sealed in the store | Nobody outside the server | The provider's own API key. SPICA adds it to each upstream call |

Keys are signed tokens, not stored records, so the server cannot revoke one before it expires. Each type has its own purpose inside the signature, so one can never stand in for another.

## Glossary

| Term | Meaning |
| --- | --- |
| **Spending Firewall** | The policy engine plus reservations. It decides every payment. See [Spending Firewall](spending-firewall.md) |
| **Policy** | One person's limits and lists: per-request, daily and monthly limits, approval threshold, automatic payments on or off, allowed networks, allowed and blocked providers. Defaults are $0.50, $1.00, $10.00 and $0.20 |
| **Task** | A group of payments that share a budget. An agent run, a developer API key and an SDK idempotency key each have their own `taskId` |
| **Task budget** | A limit for one task. The agent reads it from the person's message in plain code (`parseTaskBudget`), never from the model |
| **Reservation** (hold) | An amount set aside before signing, so concurrent requests cannot overspend. It moves through `held`, `signing`, then `committed` or `released` |
| **Approval** | A held payment waiting for a person to approve or reject it. It expires after 10 minutes |
| **Requirement hash** | SHA-256 of the requirement plus the resource URL. Reservations and approvals are bound to it |
| **Proof ID** | SHA-256 of a proof's payload. The seller accepts each proof ID once |
| **Receipt** / transaction | The record of one payment and how it was verified |
| **Verification status** | `verified` (confirmed), `settling` (accepted by Circle Gateway, waiting for batch settlement), `unverified` (could not be confirmed), `failed` or `simulated` (demo). Only `verified` counts as paid |
| **Settling** | An Arc payment Circle Gateway accepted but has not yet settled onchain. SPICA keeps asking until it gets a final answer |
| **Observation** | One measured call to a service. Reputation is computed only from these, and needs at least 5 |
| **Provider** | Someone selling an API through SPICA. Arc payments go to their wallet address, Hedera payments to their Hedera account |
| **Provider key** | A stable ID for a provider, used in allowlists and blocklists: `paygate:<provider id>` for SPICA listings, `catalog:<name>` for Circle listings |
| **Listing** / service | One API a provider sells, with a price, networks, an endpoint and optional key and usage code |
| **Agent** | The buyer identity SPICA keeps for each person (`ensureAgent`). All purchases pay from the server's agent wallet |
| **Agent wallet** | The Arc wallet from `AGENT_PRIVATE_KEY` and the Hedera account from `HEDERA_AGENT_ACCOUNT_ID`. A provider cannot use either to receive payments |
| **Idempotency key** | A key the agent SDK sends with each purchase. One idempotency key can pay at most once |
| **Audit event** | A message about a verified or settling payment, published to a Hedera Consensus Service topic when one is configured |
| **Demo user** | The shared user that demo mode uses when nobody is signed in |
