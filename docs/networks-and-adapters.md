# Networks and adapters

Each payment network is handled by one adapter class. The rest of SPICA only talks to the adapter interface. The networks share nothing: each has its own token, proof format and verification.

SPICA supports testnets only. There are no mainnet networks in the code.

## Networks

Defined in `src/lib/networks.ts`. The file holds only public facts, so it is safe in client bundles.

| ID | Label | Family | CAIP-2 | USDC asset | Rail | Explorer |
| --- | --- | --- | --- | --- | --- | --- |
| `arc-testnet` | Arc Testnet | `arc` | `eip155:5042002` | `0x3600000000000000000000000000000000000000` | Circle Gateway | `explorer.testnet.arc.io` |
| `hedera-testnet` | Hedera testnet | `hedera` | `hedera:testnet` | `0.0.429274` | x402 facilitator | HashScan (testnet) |
| `demo` | Demo (simulated) | `demo` | `paygate:demo` | `DEMO-USDC` | Simulated | None |

Every network uses USDC with 6 decimals.

`SELECTABLE_NETWORKS` is `arc-testnet` and `hedera-testnet`. These are the networks a person can tick in their spending policy, a provider can list a service on, and the marketplace and discovery APIs accept as a filter.

Helpers in the same file:

- `networkByCaip2(caip2)` finds a network by its CAIP-2 ID.
- `hashscanTransaction(id)` builds a HashScan link. It turns the SDK form `0.0.1@2.3` into `0.0.1-2-3`.

### Which networks are active

`activeNetworks()` in `src/server/env.ts`:

- **Demo mode**: only `demo`.
- **Live mode**: the result of `liveNetworks()`:
  - `arc-testnet` when `AGENT_PRIVATE_KEY` is set.
  - `hedera-testnet` when `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` and `HEDERA_FACILITATOR_URL` are all set.

In live mode with none of these keys, no network is active and nothing can be paid.

A payment goes through only on a network that is both active on the server and in the person's `allowedNetworks` (`payableNetworks` in `src/server/purchase.ts`). The `demo` network skips the `allowedNetworks` check.

A provider's listing is offered on the networks it supports that are also active. In demo mode every listing is offered on `demo`. On Hedera the payout goes to the provider's `hederaAccount`; on Arc and demo it goes to the provider's `walletAddress` (`registeredToCatalog` in `src/server/discovery/catalog.ts`). An offer that would pay the agent's own wallet is dropped (`isAgentWallet` in `env.ts`).

## The adapter interface

```ts
// paygate-x402 (spica/src/index.ts): what a seller needs
interface SellerAdapter {
  readonly network: string; // CAIP-2
  buildRequirement(input: { amountAtomic: string; payTo: string }): Promise<PaymentRequirements>;
  verify(payload, requirement): Promise<VerifyResponse>;
  settle(payload, requirement): Promise<SettleResponse>;
}

// src/server/payments/types.ts: what SPICA adds as a buyer
interface PaymentAdapter extends SellerAdapter {
  readonly id: NetworkId;
  readonly info: NetworkInfo;
  confirm(input: { settlement: SettleResponse; requirement: PaymentRequirements }): Promise<Confirmation>;
}
```

The seller middleware lives in the `spica/` folder. Its npm package name is still `paygate-x402`. The app imports it through a path alias in `tsconfig.json` and `vitest.config.mts` that points at `spica/src/index.ts`.

`confirm` is how SPICA checks a seller's settlement claim for itself. It returns a `Confirmation`:

| Field | Meaning |
| --- | --- |
| `status` | `verified`, `settling`, `unverified`, `failed` or `simulated` |
| `reference` | Transaction hash, Gateway transfer ID, Hedera transaction ID or simulated ID. Null if the seller sent none |
| `payer` | The paying account, if known |
| `detail` | A short explanation shown on the receipt |

`getAdapter(id)` in `src/server/payments/registry.ts` builds each adapter once and caches it. It throws for `demo` in live mode.

**Adapters never hold buyer keys.** Signing is a separate step in `src/server/signer`.

## Arc (`src/server/payments/arc.ts`)

Arc payments use Circle Gateway nanopayments. The buyer signs an authorization against USDC already deposited in Gateway, and Gateway settles in batches.

| Method | How |
| --- | --- |
| `buildRequirement` | `scheme: exact`, Arc USDC, `maxTimeoutSeconds: 604_900` (Gateway needs authorizations valid for 7 days), and `extra` with the batching name, version and the Gateway wallet as `verifyingContract` |
| `verify`, `settle` | `BatchFacilitatorClient` from `@circle-fin/x402-batching`, pointed at `ARC_TESTNET_GATEWAY_URL` (default `https://gateway-api-testnet.circle.com`) |
| `confirm` | See below |

`confirm` picks a path from the shape of the reference:

| Reference | Check | Result |
| --- | --- | --- |
| None | None | **unverified** |
| A 32-byte `0x` hash | Read the receipt over `ARC_TESTNET_RPC_URL` (default `https://rpc.testnet.arc.io`). Look for a USDC `Transfer` to `payTo` of at least the amount | Reverted: **failed**. Match: **verified**. No match or read error: **unverified** |
| Anything else | Treat it as a Gateway transfer ID and look it up with Circle (`lookupGatewayTransfer` in `src/server/signer/gateway.ts`). Recipient and exact amount must match | No match or lookup error: **unverified**. `failed`: **failed**. `confirmed` or `completed`: **verified**, with the onchain hash as the new reference. Anything else: **settling** |

The Gateway lookup uses `AGENT_PRIVATE_KEY`, because Circle's `GatewayClient` needs a key even for reads.

Gateway's `verify` checks the signature, not the buyer's balance. That is why sellers must settle before releasing data.

The buyer must deposit USDC into Gateway first: `npm run wallet:status` and `npm run wallet:deposit -- <amount>`. Gateway supports EOA wallets only for this flow.

### Settlement checks

Gateway settles after the receipt is written, so a receipt can stay `settling` for minutes. `src/server/settlement.ts` asks again:

| Function | When it runs |
| --- | --- |
| `watchSettlement` | In the background after a purchase. Every 15 seconds for up to 30 minutes |
| `refreshTransactions` | When a page lists receipts. Checks at most 8 `settling` receipts, oldest first |
| `refreshTransaction` | One receipt. Asks Circle at most once every 15 seconds per receipt |

A receipt changes only when `confirm` returns `verified` or `failed`. A failed lookup leaves it as it was. Each change is written with `updateTransactionStatus` and published to the Hedera Consensus Service audit topic if that is configured.

A page load only refreshes its owner's receipts. To check every `settling` receipt in the database, run `npm run payments:settle` (`scripts/settle-pending.mts`). It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` and prints a count per resulting status.

## Hedera (`src/server/payments/hedera.ts`)

| Method | How |
| --- | --- |
| `buildRequirement` | `scheme: exact`, Hedera USDC, `maxTimeoutSeconds: 180`, and `extra.feePayer` taken from the facilitator's `/supported` response, never assumed. The fee payer is cached after the first call |
| `verify`, `settle` | `HTTPFacilitatorClient` from `@x402/core`, pointed at `HEDERA_FACILITATOR_URL`. Throws if it is not set |
| `confirm` | Read the transaction from the testnet mirror node (`testnet.mirrornode.hedera.com`), retrying up to 5 times, 1.5 seconds apart, for indexing lag |

`confirm` results:

| Mirror node says | Result |
| --- | --- |
| Not `SUCCESS` | **failed** |
| `SUCCESS` with a USDC credit to `payTo` of at least the amount | **verified** |
| `SUCCESS` without that credit | **unverified** |
| Not indexed after 5 tries, or no reference | **unverified** |

Transaction IDs are converted for the mirror node by `toMirrorTransactionId`: `0.0.123@1700000000.000000000` becomes `0.0.123-1700000000-000000000`. Buyer and seller accounts must both be associated with the USDC token.

## Demo (`src/server/payments/demo.ts`)

The demo rail runs the real 402 handshake without moving money.

- `buildRequirement` uses `maxTimeoutSeconds: 60` and `extra.simulated: true`.
- The "signature" is an HMAC-SHA256 of the requirement's scheme, network, asset, amount and `payTo`, with a random per-process secret. Forged and underpaying proofs are still rejected.
- `settle` returns a `simulated_<uuid>` reference. The payer is always `demo-agent-wallet`.
- `confirm` always returns **simulated**.

## Signing (`src/server/signer`)

| File | Job |
| --- | --- |
| `index.ts` | `signPayment`, the only signing entry point |
| `keys.ts` | The only module that reads buyer keys (`AGENT_PRIVATE_KEY`, `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY`) |
| `hash.ts` | `requirementHash`: SHA-256 of scheme, network, lowercased asset, amount, lowercased `payTo` and the resource URL |
| `gateway.ts` | Read-only Circle Gateway transfer lookup |

`signPayment` first calls `store.beginSigning(reservationId, requirementHash)`. That moves a live reservation from `held` to `signing` exactly once, and only for the same requirement hash. If it fails, nothing is signed.

| Network family | Scheme |
| --- | --- |
| Arc | `CompositeEvmScheme(BatchEvmScheme, ExactEvmScheme)` with the agent's EOA, so both Gateway batching and plain onchain x402 sellers can be paid |
| Hedera | `ExactHederaScheme` from `@x402/hedera`. A 64-hex-character key is read as ECDSA; anything else goes through `PrivateKey.fromString` |
| Demo | The HMAC above |

The scheme is called directly instead of through `x402Client`, because that client's built-in spend controls reject Arc USDC as a non-default asset. SPICA's firewall is the spend control, and it has already decided by the time signing happens.

## Adding a network

1. Add the ID to `NetworkId`, an entry to `NETWORKS` (with a new `family` if needed) in `src/lib/networks.ts`, and the ID to `SELECTABLE_NETWORKS` if people should be able to allow it.
2. Write a `PaymentAdapter` in `src/server/payments/`, with a `confirm` that checks the settlement against a source other than the seller.
3. Register it in the `build` map in `src/server/payments/registry.ts`.
4. Add a signing scheme for the family in `schemeFor` in `src/server/signer/index.ts`. Read any keys only in `src/server/signer/keys.ts`.
5. Add the network to `liveNetworks()` in `src/server/env.ts`, gated on its keys. Add an entry to `integrations()` so `/settings` shows it, and extend `isAgentWallet` if the agent has an account on it.
6. Decide which provider field holds the payout address in `registeredToCatalog` (`src/server/discovery/catalog.ts`). Add a field to `ProviderRecord` and a column to `developers` if none fits. See [Data model](data-model.md).
7. If the network settles later, make sure `confirm` returns `settling` until it is final. `src/server/settlement.ts` and `npm run payments:settle` then pick it up.
8. Add the ID to `DEFAULT_POLICY.allowedNetworks` in `src/server/firewall/policy.ts` if people without a saved policy should be able to pay on it.
9. Document its variables in [Configuration](configuration.md) and `.env.example`. Add tests, and a read-only check in `scripts/live-check.mts`.
