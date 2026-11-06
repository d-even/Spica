# Data model

All records go through one interface, `SpendStore` (`src/server/store/types.ts`), with two implementations.

| | `MemoryStore` (`memory.ts`) | `SupabaseStore` (`supabase.ts`) |
| --- | --- | --- |
| Used when | Demo mode without Supabase, and tests | Supabase is configured (required in live mode) |
| Durability | Lost on restart | Postgres |
| Atomic reservation | No `await` in the critical section, safe on one event loop | `paygate_reserve_spend` with a per-user advisory lock, safe across instances |
| Atomic transitions | In-process checks | Conditional `UPDATE ... WHERE status = ...` |
| Replay guard | A `Set` | Unique primary key on `payment_proofs` |

`getStore()` in `store/index.ts` returns one instance per process, kept on `globalThis` so dev reloads reuse it.

## The interface

| Area | Methods |
| --- | --- |
| Agents | `ensureAgent(userId)` |
| Policy | `getPolicy`, `savePolicy`, `getSpendState(userId, taskId)` |
| Reservations | `reserve`, `beginSigning`, `commitReservation`, `releaseReservation` |
| Approvals | `createApproval`, `getApproval`, `listPendingApprovals`, `decideApproval` |
| Receipts | `insertTransaction`, `getTransaction`, `listTransactions`, `listTransactionsForServices` |
| Activity | `appendActivity`, `listActivity` |
| Providers | `getProviderByOwner`, `getProvider`, `saveProvider` |
| Services | `createService`, `getService`, `listServices`, `deleteService` |
| Reputation | `recordObservation`, `listObservations` |
| Seller replay guard | `claimProof`, `releaseProof` |

Reads that belong to a user take the `userId` and filter on it. For example, `getTransaction(userId, id)` returns nothing for another user's receipt.

## Records

### Reservation

| Field | Notes |
| --- | --- |
| `userId`, `taskId` | Whose spend, and which run |
| `amountMicros` | Above zero |
| `dedupeHash` | SHA-256 of `userId` and the requirement hash. Same purchase within 60 s is a duplicate |
| `requirementHash` | The only requirement this reservation can be signed for |
| `status` | `held`, `signing`, `committed`, `released`. See [Payment flow](payment-flow.md#reservation-lifecycle) |

### Transaction (receipt)

| Field | Notes |
| --- | --- |
| `userId`, `agentId`, `taskId` | Who paid, through which agent, in which run |
| `providerKey`, `providerName`, `providerEns` | `providerEns` only when the identity check matched |
| `serviceId`, `serviceName`, `resource` | What was bought, and the exact URL |
| `amountMicros`, `token`, `network` | Always USDC |
| `reference` | Transaction hash, Gateway transfer ID, Hedera transaction ID or simulated ID |
| `payer`, `payTo` | Both sides |
| `status`, `statusDetail` | Verification result and a human-readable explanation |

### Approval

Holds the quote (`amountMicros`, `network`, `requirementHash`, `reason`), the replay `request` (service, params, task budget as a string), `status` (`pending`, `approved`, `rejected`, `expired`) and `expiresAt` (10 minutes).

### Activity event

A free-form audit log: `eventType`, `eventData` JSON and an optional `transactionId`.

| `eventType` | Written by |
| --- | --- |
| `agent_run` | Each agent run |
| `policy_allow`, `policy_needs_approval`, `policy_deny` | Each firewall decision |
| `payment_recorded` | Each receipt |
| `approval_approved`, `approval_rejected` | Each approval decision |
| `hcs_published`, `hcs_failed` | Hedera Consensus Service publishing |
| `sale`, `sale_failed` | PayGate's seller route, for the provider who owns the service |

### Provider and service

A provider has `ownerUserId`, `name`, `email`, `walletAddress`, optional `ensName` and optional `hederaAccount`. A service has `providerId`, `name`, `description`, `endpoint`, `category`, `priceMicros`, `supportedNetworks` and `enabled`.

### Observation

`serviceKey`, `reachable`, `succeeded`, `paid`, `latencyMs` and `quotedMicros`. Used only by [reputation](discovery-identity-reputation.md#reputation).

## Supabase schema

`supabase/migrations/20261105000000_spending_firewall.sql`. It is additive and idempotent: it never drops anything, uses `IF NOT EXISTS` throughout, and extends tables from an earlier PayGate version instead of replacing them. Money columns are `bigint` micro-USD.

| Table | Store concept | Notes |
| --- | --- | --- |
| `developers` | Provider | Earlier table, extended with `owner_user_id` (unique), `name`, `hedera_account` |
| `apis` | Service | Earlier table, extended with `name`, `price_micros`, `supported_networks` |
| `transactions` | Receipt | Earlier table, extended with every receipt field. `api_id` and `tx_hash` made nullable |
| `agents` | Agent | One per user |
| `spending_policies` | Policy | One per user |
| `spend_reservations` | Reservation | `status` checked against the four states, `amount_micros > 0` |
| `payment_approvals` | Approval | |
| `audit_logs` | Activity | |
| `service_observations` | Observation | |
| `payment_proofs` | Replay guard | `id` is the primary key, so a second claim fails with `23505` |

### Functions

- `paygate_spend_totals(user, task, now)`: today's, this month's and this task's spend from live reservations. It excludes `released` reservations and `held` ones older than 5 minutes.
- `paygate_reserve_spend(...)`: takes `pg_advisory_xact_lock` on the user, checks duplicates within 60 seconds, checks the task, daily and monthly limits, then inserts a `held` reservation. Returns `{ ok, reason }` or `{ ok, reservation_id }`.

Both functions have `EXECUTE` revoked from `public`, `anon` and `authenticated`.

### Row-level security

RLS is on for every table, with **no policies**. The browser never talks to these tables. The server uses the service-role key, which bypasses RLS, and checks ownership itself. With RLS on and no policies, the public anon key can read and write nothing.

### Applying it

Review the migration against any existing tables first, then apply it with the Supabase CLI or SQL editor. Supabase Auth is not used: people sign in with a wallet, and PayGate keeps its own signed session cookie.

### User IDs

A user ID is derived from the signed-in wallet: SHA-256 of `paygate:evm:<lowercase address>`, formatted as a UUID. The same wallet always gets the same ID, and the existing `uuid` columns accept it without a migration. The shared demo user is `00000000-0000-4000-8000-000000000001`. Data saved under earlier Supabase Auth user IDs is not linked to wallets.
