# Concepts

The ideas PayGate is built on, and the words the rest of the docs use.

## The problem

An AI agent that can pay for APIs needs a wallet. A model that holds a wallet can be talked into spending it. Prompt injection in a search result, a confused plan or a hostile API description could all move money.

PayGate takes payment decisions away from the model. The model chooses *which* service would help. Server code decides *whether* to pay, *how much* and *to whom*, using rules the person set. The model has no tool that accepts an amount, a recipient or an approval.

## x402

[x402](https://github.com/coinbase/x402) is a protocol for paying for HTTP requests. PayGate uses version 2.

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
- **Proof** (`PaymentPayload`): the buyer's signed authorization for one requirement, base64-encoded in a header.
- **Facilitator**: a service that verifies and settles proofs for a network. On Arc this is Circle Gateway. On Hedera it is an x402 facilitator such as Blocky402.
- **Settlement** (`SettleResponse`): the facilitator's report that money moved, with a transaction reference.

PayGate acts as both sides: it is a **buyer** when the agent purchases, and a **seller** for its built-in and registered services.

## Money: micro-USD

Every amount is an integer number of **micro-USD**, stored as `bigint`. One USDC is 1,000,000 micros, which matches USDC's 6 decimals, so a micro is one atomic unit of USDC.

| USD | Micros |
| --- | --- |
| $1.00 | `1_000_000n` |
| $0.02 | `20_000n` |
| $0.000001 | `1n` |

Floating point never touches a limit. Convert with `usdToMicros`, `microsToUsd` and `formatUsd` in `src/lib/money.ts`. API request bodies take USD strings like `"0.50"`, and the server converts them.

## Networks and CAIP-2

Networks are named with [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) identifiers in x402 messages, and with short IDs inside PayGate.

| PayGate ID | CAIP-2 | Money |
| --- | --- | --- |
| `arc-testnet` | `eip155:5042002` | Test USDC |
| `hedera-testnet` | `hedera:testnet` | Test USDC |
| `demo` | `paygate:demo` | Simulated, no money |

See [Networks and adapters](networks-and-adapters.md).

## Demo mode and live mode

`PAYGATE_MODE` picks one mode for the whole process. The two never mix.

| | Demo (default) | Live |
| --- | --- | --- |
| Payment rail | Simulated `demo` network | Arc and/or Hedera |
| Money | None | Testnet USDC only |
| Storage | In memory, lost on restart | Supabase (required) |
| Sign-in | Optional wallet sign-in. Otherwise one shared demo user | Wallet sign-in on Arc Testnet, required |
| Receipts | **Simulated** | **Verified**, **Settling**, **Unverified** or **Failed** |

Demo mode still runs the real 402 handshake, the real firewall, real reservations and real receipts. Only the signature and the settlement are simulated.

## Glossary

| Term | Meaning |
| --- | --- |
| **Spending Firewall** | The policy engine plus reservations. It decides every payment |
| **Policy** | One person's limits and lists. See [Spending Firewall](spending-firewall.md) |
| **Task** | One agent run. It gets a `taskId`, and an optional budget the person stated in their message |
| **Reservation** (hold) | An amount set aside before signing, so concurrent requests cannot overspend |
| **Approval** | A held payment waiting for a person to approve or reject it |
| **Requirement hash** | SHA-256 of the requirement plus the resource URL. Reservations and approvals are bound to it |
| **Proof ID** | SHA-256 of a proof's payload. A seller accepts each proof ID once |
| **Receipt** / transaction | The record of one payment and how it was verified |
| **Observation** | One measured call to a service. Reputation is computed only from these |
| **Provider** | Someone selling an API through PayGate |
| **Provider key** | A stable ID for a provider, used in allowlists and blocklists, for example `paygate:builtin` or `catalog:acme` |
| **PayGate ID** | A `name.paygate.eth` label from PayGate's registry contract on Sepolia |
