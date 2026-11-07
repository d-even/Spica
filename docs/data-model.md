# Data model

All records go through one interface, `SpendStore` (`src/server/store/types.ts`), with two implementations.

| | `MemoryStore` (`memory.ts`) | `SupabaseStore` (`supabase.ts`) |
| --- | --- | --- |
| Used when | Demo mode without Supabase, and tests | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. Required in live mode |
| `kind` | `memory` | `supabase` |
| Durability | Lost on restart | Postgres |
| Atomic reservation | No `await` in the critical section, safe on one event loop | `paygate_reserve_spend` with a per-user advisory lock, safe across instances |
| Atomic transitions | In-process checks | Conditional `UPDATE ... WHERE status = ...` |
| Replay guard | A `Set` | Primary key on `payment_proofs` |
| Provider API keys | A `Map` beside the services | Columns on `apis` |

`getStore()` in `src/server/store/index.ts` returns one instance per process, kept on `globalThis` so dev reloads reuse it. It picks Supabase whenever it is configured, the memory store in demo mode otherwise, and throws in live mode without Supabase. A memory store from before Supabase was configured is replaced on the next call.

## The interface

| Area | Methods |
| --- | --- |
| Agents | `ensureAgent(userId)`: returns the user's agent ID, creating it if needed |
| Policy | `getPolicy`, `savePolicy`, `getSpendState(userId, taskId, now?)` |
| Reservations | `reserve`, `beginSigning`, `commitReservation`, `releaseReservation(id, { paymentNotSent }?)` |
| Approvals | `createApproval`, `getApproval`, `listPendingApprovals`, `decideApproval` |
| Receipts | `insertTransaction`, `updateTransactionStatus`, `getTransaction`, `listTransactions`, `listTransactionsForServices` |
| Activity | `appendActivity`, `listActivity` |
| Providers | `getProviderByOwner`, `getProvider`, `saveProvider` |
| Services | `createService(record, credential?)`, `getServiceCredential`, `getService`, `listServices`, `deleteService` |
| Reputation | `recordObservation`, `listObservations` |
| Seller replay guard | `claimProof`, `releaseProof` |

Reads that belong to a user take the `userId` and filter on it. For example, `getTransaction(userId, id)` returns nothing for another user's receipt. `updateTransactionStatus` takes only the receipt ID: it is called by settlement checks, not by request handlers.

`getServiceCredential` is server only. It returns the sealed provider key for calling the provider. No service record carries it.

Default list sizes: `listTransactions` 100, `listTransactionsForServices` 200, `listActivity` 50, `listObservations` 500.

## Records

### Reservation

| Field | Notes |
| --- | --- |
| `userId`, `taskId` | Whose spend, and which run |
| `amountMicros` | Above zero |
| `dedupeHash` | SHA-256 of `userId` and the requirement hash. The same purchase within 60 s is a duplicate. Metered calls through a developer or agent key add a random value, so identical calls are allowed |
| `requirementHash` | The only requirement this reservation can be signed for. See `src/server/signer/hash.ts` |
| `status` | `held`, `signing`, `committed`, `released`. See [Payment flow](payment-flow.md) |

`reserve` returns `{ ok: true, reservationId }` or `{ ok: false, reason }` with a reason of `duplicate`, `daily_limit`, `monthly_limit` or `task_budget`.

A `held` reservation older than 5 minutes stops counting. A `signing` or `committed` one always counts. `releaseReservation` frees only `held` reservations, unless the caller passes `paymentNotSent: true`, which also frees `signing` ones.

### Transaction (receipt)

| Field | Notes |
| --- | --- |
| `userId`, `agentId`, `taskId` | Who paid, through which agent, in which run |
| `providerKey`, `providerName` | `paygate:<provider id>` for SPICA listings, a slug for Circle listings |
| `serviceId`, `serviceName`, `resource` | What was bought, and the exact URL |
| `amountMicros`, `token`, `network` | Always USDC |
| `reference` | Transaction hash, Gateway transfer ID, Hedera transaction ID or simulated ID |
| `payer`, `payTo` | Both sides |
| `status`, `statusDetail` | `verified`, `settling`, `unverified`, `failed` or `simulated`, and a human-readable explanation |

A `settling` receipt is updated later by `src/server/settlement.ts` or `npm run payments:settle`. See [Networks and adapters](networks-and-adapters.md#settlement-checks).

### Approval

Holds the quote (`serviceId`, `serviceName`, `providerName`, `amountMicros`, `network`, `requirementHash`, `reason`), the replay `request` (the catalog service, optional params, task budget as a string and preferred network), `status` (`pending`, `approved`, `rejected`, `expired`) and `expiresAt` (10 minutes after creation).

`decideApproval` moves `pending` to `approved` or `rejected` once, and only before `expiresAt`. `listPendingApprovals` leaves out expired ones.

### Activity event

A free-form audit log: `eventType`, `eventData` JSON and an optional `transactionId`.

| `eventType` | Written by |
| --- | --- |
| `agent_run` | Each agent run (`src/server/agent/index.ts`) |
| `policy_allow`, `policy_needs_approval`, `policy_deny` | Each firewall decision (`src/server/purchase.ts`) |
| `policy_updated` | Saving the spending policy (`/api/policy`) |
| `approval_requested` | A marketplace or SDK purchase that needs approval. `eventData.source` is `marketplace` or `sdk` |
| `approval_approved`, `approval_rejected` | Each approval decision (`/api/approvals/[id]`) |
| `payment_recorded` | Each receipt |
| `usage_code` | The usage code given to the buyer after a paid purchase. `eventData.code` holds it |
| `hcs_published`, `hcs_failed` | Hedera Consensus Service publishing (`src/server/audit/record.ts`) |
| `sale`, `sale_failed` | SPICA's seller route, for the provider who owns the service |

### Provider

`ownerUserId`, `name`, `walletAddress` (payouts on Arc) and optional `hederaAccount` (payouts on Hedera). Each user has at most one provider: `saveProvider` upserts on `ownerUserId`.

### Service

| Field | Notes |
| --- | --- |
| `providerId` | Owning provider |
| `name`, `description`, `category` | Shown in the marketplace |
| `endpoint` | The provider's own API. Buyers call SPICA's seller route instead |
| `priceMicros` | Price per call |
| `supportedNetworks` | Any of `arc-testnet`, `hedera-testnet` |
| `enabled` | Disabled services are not listed or sold |
| `usageCode` | Up to 3 lines and 600 characters, written by the provider for buyers. Released only after payment, never in a listing or a 402 |
| `apiKeyHash` | HMAC fingerprint of the provider's API key, if it has one. The key itself is never on this record |

The provider's API key travels separately as a `ServiceCredential` (`src/server/secrets.ts`): `sealedKey` (AES-256-GCM, format `v1.<iv>.<tag>.<body>`), `placement` (`bearer`, `header` or `query`) and `name` (the header or query parameter name; null for `bearer`). Sealing and hashing need `PAYGATE_ENCRYPTION_KEY`. See [Configuration](configuration.md#provider-api-keys).

### Observation

`serviceKey` (the service ID), `reachable`, `succeeded`, `paid`, `latencyMs` and `quotedMicros`. Used only by reputation (`src/server/reputation.ts`).

## Supabase schema

The schema is in `supabase/migrations/`. Apply the files in filename order.

| File | What it does |
| --- | --- |
| `20261105000000_spending_firewall.sql` | Creates or extends every table, the two functions, and turns on RLS. Revokes function access from `public`, `anon` and `authenticated` |
| `20261106000000_developers_owner_unique.sql` | Drops the partial unique index on `developers.owner_user_id` and adds a plain unique constraint `developers_owner_user_id_key`. Postgres cannot use a partial index as an `ON CONFLICT` target, so `saveProvider` failed without this |
| `20261106000000_service_role_grants.sql` | Grants `select, insert, update, delete` on every table, and `execute` on both functions, to `service_role` only. Newer Supabase projects do not grant this by default |
| `20261106120000_usage_code.sql` | Adds `apis.usage_code` |
| `20261106130000_provider_api_keys.sql` | Adds `apis.api_key_hash`, `api_key_encrypted`, `api_key_placement` and `api_key_name`, with a check that `api_key_placement` is null, `bearer`, `header` or `query` |

The first migration declares the earlier PayGate tables with `IF NOT EXISTS` and extends them with `ADD COLUMN IF NOT EXISTS`, so it is safe to run against an existing database. The later ones drop only two things: the partial owner index, which a constraint replaces, and the placement check, which is added again at once. The last two end with `notify pgrst, 'reload schema'` so the API sees new columns at once. Money columns added for SPICA are `bigint` micro-USD.

### Tables

| Table | Store concept | Key constraints |
| --- | --- | --- |
| `developers` | Provider | `owner_user_id` unique |
| `apis` | Service | `developer_id` references `developers(id)` on delete cascade |
| `transactions` | Receipt | `api_id` references `apis(id)` on delete set null |
| `agents` | Agent | `user_id` unique: one per user |
| `spending_policies` | Policy | `user_id` unique: one per user |
| `spend_reservations` | Reservation | `amount_micros > 0`, `status` in the four states |
| `payment_approvals` | Approval | `status` in `pending`, `approved`, `rejected`, `expired` |
| `audit_logs` | Activity | |
| `service_observations` | Observation | `id` is an identity column |
| `payment_proofs` | Replay guard | `id` is the primary key, so a second claim fails with `23505` |

### Columns

Columns marked *legacy* come from the earlier PayGate tables. Some are still written to satisfy `NOT NULL`; *unused* means no code reads or writes it.

**`developers`**

| Column | Store field | Notes |
| --- | --- | --- |
| `id` | `id` | `uuid`, generated |
| `owner_user_id` | `ownerUserId` | `uuid`, unique |
| `name` | `name` | |
| `wallet_address` | `walletAddress` | `NOT NULL` |
| `hedera_account` | `hederaAccount` | |
| `email` | | Legacy `NOT NULL`. Written as `''` |
| `ens_name` | | Legacy, unused |
| `created_at` | `createdAt` | |

**`apis`**

| Column | Store field | Notes |
| --- | --- | --- |
| `id` | `id` | `uuid`, generated |
| `developer_id` | `providerId` | |
| `name` | `name` | Falls back to `endpoint` when null |
| `description`, `category` | `description`, `category` | `category` defaults to `Other` |
| `endpoint` | `endpoint` | |
| `price_micros` | `priceMicros` | `bigint`. Rows where it is null are left out of `listServices` |
| `supported_networks` | `supportedNetworks` | `text[]`, default `{}` |
| `enabled` | `enabled` | |
| `usage_code` | `usageCode` | Written only when non-empty |
| `api_key_hash` | `apiKeyHash` | |
| `api_key_encrypted`, `api_key_placement`, `api_key_name` | `ServiceCredential` | Read only by `getServiceCredential` |
| `price` | | Legacy `NOT NULL` text. Written with the micro-USD amount |
| `pay_to` | | Legacy `NOT NULL`. Written with the provider's wallet at creation. Payouts use the provider record instead |
| `is_public` | | Legacy. Written as `true` |
| `tags` | | Legacy, unused |
| `created_at` | `createdAt` | |

**`transactions`**

| Column | Store field | Notes |
| --- | --- | --- |
| `id` | `id` | |
| `user_id`, `agent_id`, `task_id` | `userId`, `agentId`, `taskId` | Index on `(user_id, created_at desc)` |
| `provider_key`, `provider_name` | `providerKey`, `providerName` | |
| `service_id`, `service_name`, `resource` | `serviceId`, `serviceName`, `resource` | Index on `service_id` |
| `amount_micros` | `amountMicros` | |
| `token`, `network` | `token`, `network` | |
| `tx_hash` | `reference` | Nullable |
| `from_address`, `to_address` | `payer`, `payTo` | |
| `status`, `status_detail` | `status`, `statusDetail` | |
| `verified` | | Legacy. Written as `status = 'verified'` |
| `amount` | | Legacy `NOT NULL` text. Written with the micro-USD amount |
| `api_id` | | Legacy, nullable, unused |
| `provider_ens` | | Added by the first migration, now unused |
| `created_at` | `createdAt` | |

**`agents`**: `id`, `user_id` (unique), `name` (default `PayGate Agent`), `status` (default `active`), `created_at`. `ensureAgent` upserts on `user_id` and returns `id`.

**`spending_policies`**: `id`, `user_id` (unique), `per_request_limit`, `daily_limit`, `monthly_limit`, `approval_threshold` (all `bigint` micro-USD), `auto_pay_enabled`, `allowed_networks`, `allowed_providers`, `blocked_providers` (all `text[]`), `updated_at`. With no row, `getPolicy` returns `DEFAULT_POLICY` from `src/server/firewall/policy.ts`.

**`spend_reservations`**: `id`, `user_id`, `task_id`, `amount_micros`, `dedupe_hash`, `requirement_hash`, `status` (default `held`), `created_at`. Index on `(user_id, created_at desc)`.

**`payment_approvals`**: `id`, `user_id`, `task_id`, `service_id`, `service_name`, `provider_name`, `amount_micros`, `network`, `requirement_hash`, `reason`, `request` (`jsonb`), `status` (default `pending`), `created_at`, `expires_at`.

**`audit_logs`**: `id`, `user_id`, `transaction_id`, `event_type`, `event_data` (`jsonb`, default `{}`), `created_at`. Index on `(user_id, created_at desc)`.

**`service_observations`**: `id`, `service_key`, `reachable`, `succeeded`, `paid`, `latency_ms`, `quoted_micros`, `created_at`. Index on `(service_key, created_at desc)`.

**`payment_proofs`**: `id` (`text`, primary key), `created_at`.

### Functions

- `paygate_spend_totals(p_user uuid, p_task text, p_now timestamptz)`: returns `today`, `month` and `task` spend from live reservations. Days and months are UTC. It excludes `released` reservations and `held` ones older than 5 minutes.
- `paygate_reserve_spend(p_user, p_task, p_amount, p_daily_limit, p_monthly_limit, p_task_budget, p_dedupe_hash, p_requirement_hash)`: takes `pg_advisory_xact_lock` on the user, rejects a duplicate within 60 seconds, checks the task budget, then the daily and monthly limits, then inserts a `held` reservation. Returns `{ ok: false, reason }` or `{ ok: true, reservation_id }`.

`EXECUTE` on both is revoked from `public`, `anon` and `authenticated`, and granted to `service_role`.

### Row-level security

RLS is on for every table, with **no policies**. The browser never talks to these tables. The server uses the service-role key, which bypasses RLS, and checks ownership itself. Only `service_role` has table grants from the migrations, and with RLS on and no policies, the public anon key can read and write nothing.

### Applying it

Review the migrations against any existing tables, then apply them in filename order with the Supabase CLI or the SQL editor. Supabase Auth is not used: people sign in with a wallet, and SPICA keeps its own signed session cookie.

## User IDs

A user ID comes from the signed-in wallet (`walletUserId` in `src/server/auth.ts`): SHA-256 of `paygate:evm:<lowercase address>`, formatted as a UUID. The same EVM address always gets the same ID, whichever EVM chain it signed in on, and the existing `uuid` columns accept it without a migration.

In demo mode, a request without a session uses the shared demo user `00000000-0000-4000-8000-000000000001`. Data saved under earlier Supabase Auth user IDs is not linked to wallets.
