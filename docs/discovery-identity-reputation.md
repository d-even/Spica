# Discovery, identity and reputation

SPICA keeps three questions apart:

- **Discovery**: what services exist, and what do they cost?
- **Identity**: who gets paid?
- **Reputation**: how has this service behaved when SPICA called it?

## Discovery

Every source becomes one shape, `CatalogService` (`src/server/discovery/types.ts`).

| Field | Meaning |
| --- | --- |
| `id` | Service ID. A database UUID for SPICA listings, `cat_…` for Circle |
| `source` | `paygate` (listed on SPICA) or `circle` |
| `providerName`, `providerKey` | Display name, and the key the firewall's allow and block lists use |
| `endpoint`, `method` | The URL that answers 402 with x402 terms |
| `offers` | One per payable network: `network`, `amountMicros`, `payTo`, `asset` |
| `listedMicros`, `listedUsd` | The listed price. The firewall refuses a 402 quote above it |
| `allNetworks` | Every network the listing names, as CAIP-2 |
| `inputSchema` | Query parameters, when the source describes them. Always `null` for SPICA listings |
| `purchasable` | Whether this server can pay it |
| `supportsGateway` | Whether it settles through Circle Gateway |

### Sources

There are no built-in services. The marketplace holds only what providers list, plus the Circle catalog when it is switched on.

| Source | `source` | Code | IDs | Provider key |
| --- | --- | --- | --- | --- |
| Services providers list on SPICA | `paygate` | `registeredToCatalog`, `localServices` in `catalog.ts` | Database UUIDs | `paygate:<provider id>` |
| Circle Agent Marketplace | `circle` | `discover` in `circle.ts` | `cat_` + first 16 hex characters of SHA-256 of the resource URL | `catalog:<slugified provider name>` |

### SPICA listings

`localServices()` returns every enabled service, built by `registeredToCatalog`:

- The endpoint is SPICA's own seller route, `PAYGATE_PUBLIC_URL/api/x402/<id>`. The method is `GET`.
- In demo mode every listing is offered on the simulated `demo` network. In live mode it is offered on each network the provider chose that is also active here.
- Arc offers pay the provider's wallet address. Hedera offers pay the provider's Hedera account.
- An offer with no payout address, or one that pays the agent's own wallet, is dropped. A listing with no offers left is not purchasable.

### The Circle catalog

The Circle catalog is off by default. Set `PAYGATE_CIRCLE_CATALOG=true` to include it.

- Endpoint: `https://api.circle.com/v2/x402/discovery/resources`, public, no key. Override with `CIRCLE_DISCOVERY_URL`.
- Filters: `query`, `category`, `network` (CAIP-2), `maxUsdPrice`, `limit` (up to 200), `offset`.
- Categories: `SOCIAL_INTELLIGENCE`, `FINANCIAL_ANALYSIS`, `WEB_SEARCH_RESEARCH`, `PREDICTION_MARKETS`, `CREATIVE`, `INFRASTRUCTURE`.
- Responses are cached for 60 seconds per query. Requests time out after 15 seconds.
- Only `http` listings are kept. Offers on networks SPICA does not know are dropped.
- A listing is **not purchasable** if its URL is a path template (contains `{`), if it needs browser sign-in (`siwx`), or if no offer is on a known network.

Every listing Circle returns is remembered for 30 minutes (up to 2,000 entries). `recentlyDiscovered(id)` returns it. This lets a person buy a Circle listing they saw in the marketplace: the browser sends only the ID, and the server uses what Circle returned.

### Shared helpers

| Function | File | Job |
| --- | --- | --- |
| `localServices()` | `catalog.ts` | All enabled SPICA listings |
| `filterLocal(services, { query, category, maxUsdPrice, network })` | `catalog.ts` | Applies Circle's filters to SPICA listings. The query matches if any word appears in the name, description or category |
| `resolveService(id)` | `catalog.ts` | Finds one service by ID. IDs starting `cat_` come from `recentlyDiscovered`. Others are read fresh from the store, and only if enabled |
| `findServices(input)` | `catalog.ts` | The agent's search, below |

### How the agent searches

`findServices`:

1. Filters SPICA listings with `filterLocal`, using the query and price cap.
2. If the Circle catalog is on, queries it once per active non-demo network, in parallel (10 results each by default). A failed page goes into `failures` and does not fail the search.
3. Puts SPICA listings first and removes duplicate IDs.

In demo mode there are no live networks, so the agent sees only SPICA listings. See [Agent](agent.md) for how the session limits searches.

### HTTP routes

| Route | Auth | What it returns |
| --- | --- | --- |
| `GET /api/discover` | None | Purchasable listings as x402 endpoints, cheapest first, for agents outside SPICA. Filters: `query`, `category`, `maxUsdPrice`, `network`, `limit` (1 to 50, default 20). 60 requests a minute per client. `sources.circle` is `ok`, `unavailable` or `off` |
| `GET /api/marketplace` | None | The marketplace page's data: SPICA listings, then a page of 24 Circle listings, each with its reputation. Filters: `query`, `category`, `source`, `network`, `maxUsdPrice`, `offset`. If Circle is unreachable, SPICA listings still show with a `circleError` note |
| `POST /api/marketplace/<id>/buy` | Session | Buys one call. Body: optional `params` (up to 10 string values) |
| `GET /api/providers` | None | The provider directory, built from live SPICA listings |
| `GET /api/sdk/v1/services/<id>` | None | One catalog entry with its offers and reputation |

### The marketplace page

`/marketplace` (`src/app/(site)/marketplace/page.tsx`) is public. Anyone can browse. Buying needs a sign-in. Components live in `src/components/marketplace/`.

- **Browse.** Search, filter by category, network and price cap, and sort by cheapest, most trusted or name. Each card (`ApiCard` in `src/components/spica/ApiCard.tsx`) shows price, networks, a Circle Gateway tag and a trust badge. The badge reads "New" until the service has a score.
- **Get a quote** (`quote.ts`). For a SPICA listing, the browser calls `/api/x402/<id>` without paying and reads the terms from the 402. Nothing is charged. For a Circle listing, it shows the terms from the catalog entry.
- **Compare** (`compare-dialog.tsx`). Pick two or three services. The table shows price, provider, category, networks, Circle Gateway support, measured calls and trust.
- **Try it** (`try-dialog.tsx`). Shows details, the quote and input fields read from the listing's input schema. "Pay → Get access" calls `POST /api/marketplace/<id>/buy`. A "For AI agents" tab shows a `curl` for the quote and the matching `/api/discover` URL.

The buy route runs the same `purchase()` as the agent, with a new `marketplace-<uuid>` task and no task budget. The browser names only a service ID and parameters. The endpoint, price and recipient come from the server's catalog and the seller's 402, and the Spending Firewall applies. The response holds the outcome, the purchase events and the data (cut to 50,000 characters). The dialog shows:

| Outcome | Shown |
| --- | --- |
| `delivered` | "Paid and delivered" (or "answered without charging"), the receipt, the firewall decision and the data |
| `needs_approval` | The amount and reason, and a link to approve on Home |
| `denied` with code `duplicate` | "Already bought a moment ago". Identical repeat payments are refused |
| `denied` | The firewall's reason and a link to spending limits |
| `failed` | The reason and the receipt, if one was recorded |

A paid marketplace purchase also issues the developer API code described in [Agent](agent.md#what-a-purchase-gives-the-developer). The dialog does not show it, but the receipt page at `/transactions/<id>` does.

### The provider directory

`/providers` (`src/app/(site)/providers/page.tsx`) is public. It lists every provider with at least one enabled listing, built by `GET /api/providers` from `localServices()`. Each entry shows the provider's networks, Circle Gateway support and its services with price and category. It links to `/provider` to become a provider.

## Identity

SPICA does not use a name service. ENS checks and PayGate IDs (`name.paygate.eth` subdomains on Sepolia) were removed. Their code is archived in `legacy/ens/`, which is excluded from the build, typecheck and lint. Nothing in `src/` uses it.

Providers identify by where they get paid. On `/provider` they save:

| Field | Rule |
| --- | --- |
| Wallet address | Required. Receives Arc payments. Connect a browser wallet or paste a `0x` address |
| Hedera account | Optional, in the form `0.0.1234`. Required before listing a service on Hedera |

`PUT /api/provider` refuses either one if it is the agent's own wallet or account, because the agent cannot pay itself.

The firewall keeps an optional `identityStatus` field (`match`, `mismatch` or `none`) on the payment request. A `mismatch` denies with `identity_mismatch`. No identity source sets it today, so this rule never fires. It is kept for a future source such as Hedera HCS-14.

## Reputation

`computeReputation` in `src/server/reputation.ts` scores a service from **observations only**. SPICA records one on every purchase attempt, whatever started it: the agent, the marketplace, a developer API key or the SDK. There is no self-reported input and no default score. Each lookup reads the latest 500 observations for the service.

- With fewer than **5** observations (`MIN_OBSERVATIONS`), the result is `not_enough_data`. The UI shows "Not enough data" or a "New" badge.
- Measures with no data are left out, and the remaining weights are rescaled.

| Component | Weight | Score |
| --- | --- | --- |
| Uptime | 25% | Calls that reached the service, out of all calls |
| Successful requests | 30% | Successes, out of calls that reached the service |
| Payment history | 20% | Paid calls that delivered data, out of paid calls |
| Response time | 15% | 100 at 500 ms or faster, 0 at 5 s or slower, linear in between |
| Pricing consistency | 10% | Share of quotes equal to the most common quote |

Reputation appears in the marketplace, the compare table, the agent's `inspect_service` tool, the SDK service route and the provider dashboard.

Reputation is per SPICA deployment: it only reflects calls made through this server.
