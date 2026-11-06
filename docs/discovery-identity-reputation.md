# Discovery, identity and reputation

Three separate questions, kept apart everywhere in the product:

- **Discovery**: what services exist, and what do they cost?
- **Identity**: does the name this provider claims actually point at the address being paid?
- **Reputation**: how has this service behaved when PayGate called it?

ENS proves identity only. It says nothing about whether an API is any good. That is reputation's job.

## Discovery

All sources are turned into one shape, `CatalogService` (`src/server/discovery/types.ts`), with an ID, provider key, endpoint, offers per network, listed price, input schema and a `purchasable` flag.

### Sources

| Source | `source` | Where | IDs |
| --- | --- | --- | --- |
| Built-in services | `builtin` | `discovery/catalog.ts` | `cricket-live`, `cricket-pro` |
| Services registered on PayGate | `paygate` | The store | Database UUIDs |
| Circle Agent Marketplace | `circle` | `discovery/circle.ts` | `cat_` + first 16 hex characters of SHA-256 of the resource URL |

Built-in and registered services are served from PayGate's own seller route, `PAYGATE_PUBLIC_URL/api/x402/<id>`.

### How the agent searches

`findServices`:

1. Takes built-in and enabled registered services, and keeps those where any word of the query appears in the name, description or category.
2. Queries the Circle catalog once per active non-demo network, in parallel. A failed page is reported in `failures` rather than failing the search.
3. Puts PayGate services first and removes duplicate IDs.

In demo mode there are no live networks, so agent discovery only sees PayGate's own services. The `/marketplace` page still browses the live Circle catalog in both modes.

### The Circle catalog

- Endpoint: `https://api.circle.com/v2/x402/discovery/resources`, public, no key. Override with `CIRCLE_DISCOVERY_URL`.
- Filters: `query`, `category`, `network` (CAIP-2), `maxUsdPrice`, `limit`, `offset`.
- Categories: `SOCIAL_INTELLIGENCE`, `FINANCIAL_ANALYSIS`, `WEB_SEARCH_RESEARCH`, `PREDICTION_MARKETS`, `CREATIVE`, `INFRASTRUCTURE`.
- Responses are cached for 60 seconds per query.
- Only `http` listings are kept. Offers on networks PayGate does not know are dropped.
- A listing is **not purchasable** if its URL is a path template (contains `{`), if it needs browser sign-in (`siwx`), or if no offer is on a known network.
- Provider keys are `catalog:<slugified provider name>`.

## Identity: ENS

`checkProviderIdentity(claimedName, payTo)` in `src/server/identity/ens.ts`, using Ethereum mainnet ENS (`ENS_RPC_URL`, or a public endpoint).

| Situation | Result |
| --- | --- |
| A name is claimed and resolves to `payTo` | `match` |
| A name is claimed and resolves elsewhere | `mismatch`, and the firewall denies payment |
| A name is claimed and does not resolve | `mismatch`, and the firewall denies payment |
| No name claimed, and `payTo` has a primary name that resolves back to it | `match`, with that name |
| No name claimed, and no verified primary name | `none` |

- Reverse records are confirmed by a forward lookup, so a spoofed reverse record is ignored.
- The check only runs for Arc offers. Hedera and demo offers get `none`.
- Registered providers set their ENS name on their profile. Saving it is refused unless it resolves to the provider's wallet. Circle catalog services claim no name, so they rely on the reverse lookup.
- A matched name is stored on the receipt as `providerEns`.

## PayGate IDs

A provider can claim a free `name.paygate.eth` label when saving their profile.

- The registry is a custom contract on Ethereum Sepolia, at `PAYGATE_SUBDOMAIN_CONTRACT` (default `0xf7f47FE64c7cbc99deDD53F31e1E9E189e1ee3BE`), with `createSubdomain(label, wallet)`, `getWallet(label)` and `getSubdomain(wallet)`.
- Labels are 3 to 32 lowercase letters or digits. Check availability with `GET /api/subdomain/check?label=<label>`.
- Labels are created by PayGate's registrar key (`ADMIN_PRIVATE_KEY`), which is separate from the agent's payment key. An existing label is only returned if it already points at the same wallet.
- `resolvePayGateId` in `src/lib/resolver.ts` turns a PayGate ID into a wallet address.

PayGate IDs are looked up in this registry contract, not through ENS resolution, so the payment-time ENS check above does not use them.

## Reputation

`computeReputation` in `src/server/reputation.ts` scores a service from **observations only**. These are measurements PayGate records on every purchase attempt. There is no self-reported input and no default score.

- With fewer than **5** observations, the result is `not_enough_data`, shown as "Not enough data".
- Measures with no data are left out, and the remaining weights are rescaled.

| Component | Weight | Score |
| --- | --- | --- |
| Uptime | 25% | Calls that reached the service, out of all calls |
| Successful requests | 30% | Successes, out of calls that reached the service |
| Payment history | 20% | Paid calls that delivered data, out of paid calls |
| Response time | 15% | 100 at 500 ms or faster, 0 at 5 s or slower, linear in between |
| Pricing consistency | 10% | Share of quotes equal to the most common quote |

Reputation is per PayGate deployment: it only reflects calls made through this server.
