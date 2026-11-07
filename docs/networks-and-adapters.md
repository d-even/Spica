# Networks and adapters

Each payment network is handled by one adapter class. The rest of PayGate only talks to the adapter interface, and the networks share nothing: each has its own token, proof format and verification.

## Networks

Defined in `src/lib/networks.ts`. The file contains only public facts, so it is safe in client bundles.

| ID | Label | CAIP-2 | USDC | Rail |
| --- | --- | --- | --- | --- |
| `arc-testnet` | Arc Testnet | `eip155:5042002` | `0x3600000000000000000000000000000000000000` | Circle Gateway |
| `hedera-testnet` | Hedera testnet | `hedera:testnet` | `0.0.429274` | x402 facilitator |
| `demo` | Demo (simulated) | `paygate:demo` | `DEMO-USDC` | Simulated |

### Which networks are active

`activeNetworks()` in `src/server/env.ts`:

- **Demo mode**: only `demo`.
- **Live mode**: `arc-testnet` if `AGENT_PRIVATE_KEY` is set, and `hedera-testnet` if `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` and 

A network must be active on the server **and** in the person's `allowedNetworks` to be paid. Mainnet also passes the firewall's own `mainnet_disabled` check, so a policy cannot turn it on.

## The adapter interface

```ts
// paygate-x402: what a seller needs
interface SellerAdapter {
  readonly network: string; // CAIP-2
  buildRequirement(input: { amountAtomic: string; payTo: string }): Promise<PaymentRequirements>;
  verify(payload, requirement): Promise<VerifyResponse>;
  settle(payload, requirement): Promise<SettleResponse>;
}

// src/server/payments/types.ts: what PayGate as a buyer adds
interface PaymentAdapter extends SellerAdapter {
  readonly id: NetworkId;
  readonly info: NetworkInfo;
  confirm(input: { settlement; requirement }): Promise<Confirmation>;
}
```

`confirm` is how PayGate checks a seller's settlement claim for itself. It returns a status of `verified`, `settling`, `unverified`, `failed` or `simulated`, plus a reference, the payer and a human-readable detail.

`getAdapter(id)` in `registry.ts` builds each adapter once and caches it. It refuses the demo adapter in live mode.

**Adapters never hold buyer keys.** Signing is a separate step, done by `src/server/signer`.

## Arc (`payments/arc.ts`)

Arc payments use Circle Gateway nanopayments: the buyer signs an authorization against USDC already deposited in Gateway, and Gateway settles in batches.

| Method | How |
| --- | --- |
| `buildRequirement` | `scheme: exact`, Arc USDC, `maxTimeoutSeconds: 604_900` (Gateway needs authorizations valid for 7 days), and `extra` with the batching name, version and the Gateway wallet as `verifyingContract` |
| `verify`, `settle` | `BatchFacilitatorClient` from `@circle-fin/x402-batching` |
| `confirm` | If the reference is a transaction hash, read the receipt over RPC and look for a USDC `Transfer` to `payTo` of at least the amount. Otherwise treat it as a Gateway transfer ID and look it up with Circle: matching recipient and amount, then `confirmed`/`completed` is **verified**, `failed` is **failed**, anything else is **settling** |

Gateway's `verify` checks the signature, not the buyer's balance. That is why sellers must settle before releasing data.

The buyer must deposit USDC into Gateway first: `npm run wallet:status` and `npm run wallet:deposit -- <amount>`. Gateway supports EOA wallets only for this flow.

## Hedera (`payments/hedera.ts`)

| Method | How |
| --- | --- |
| `buildRequirement` | `scheme: exact`, Hedera USDC, `maxTimeoutSeconds: 180`, and `extra.feePayer` taken from the facilitator's `/supported` response, never assumed |
| `verify`, `settle` | `HTTPFacilitatorClient` from `@x402/core`, pointed at `HEDERA_FACILITATOR_URL` (Blocky402 by default) |
| `confirm` | Read the transaction from the public mirror node, retrying up to 5 times 1.5 seconds apart for indexing lag. `SUCCESS` with a USDC credit to `payTo` of at least the amount is **verified** |

Transaction IDs are converted for the mirror node: `0.0.123@1700000000.000000000` becomes `0.0.123-1700000000-000000000`. Buyer and seller accounts must both be associated with the USDC token.

## Demo (`payments/demo.ts`)

The demo rail runs the real 402 handshake without moving money.

- The "signature" is an HMAC-SHA256 of the requirement with a random per-process secret, so forged and underpaying proofs are still rejected.
- `settle` returns a `simulated_<uuid>` reference.
- `confirm` always returns **simulated**.

## Signing (`src/server/signer`)

| Network family | Scheme |
| --- | --- |
| Arc | `CompositeEvmScheme(BatchEvmScheme, ExactEvmScheme)` with the agent's EOA, so both Gateway batching and plain onchain x402 sellers can be paid |
| Hedera | `ExactHederaScheme` from `@x402/hedera`, with an ECDSA or DER key |
| Demo | The HMAC above |

The scheme is called directly instead of through `x402Client`, because that client's built-in spend controls reject Arc USDC as a non-default asset. PayGate's firewall is the spend control, and has already decided by the time signing happens.

## Adding a network

1. Add the network to `NetworkId` and `NETWORKS` in `src/lib/networks.ts`, and to `SELECTABLE_NETWORKS` if people should be able to allow it.
2. Write a `PaymentAdapter` in `src/server/payments/`, including a `confirm` that checks the settlement against an independent source.
3. Register it in `registry.ts`.
4. Add a signing scheme in `src/server/signer/index.ts`, with any keys read only in `keys.ts`.
5. Add the network to `liveNetworks()` in `env.ts`, gated on its keys.
6. Decide where built-in services get paid on it in `builtinPayTo` (`discovery/catalog.ts`), and which provider field holds the payout address in `registeredToCatalog`.
7. Add tests, and a read-only check in `scripts/live-check.mts`.
