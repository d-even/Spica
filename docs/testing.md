# Testing

Four layers, from fast and offline to slow and networked.

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm test` | Unit tests in `tests/*.test.ts` (`vitest run`) | Nothing |
| `npm run test:e2e -- <url>` | `scripts/e2e-demo.mjs`: the full journey against a running server | A server in demo mode, and internet access |
| `npm run test:live` | `scripts/live-check.mts`, then `tests/live/*.live.test.ts` | Internet access |
| `npm run test:mutation` | `scripts/mutation-check.mjs`: breaks 19 protections and expects `npx vitest run` to fail | Nothing |

Also run `npm run typecheck` and `npm run lint`.

The agent SDK in `packages/agent-sdk/` has its own Vitest suite. The root suite does not run it. See that package's README.

## Unit tests

A run of `npx vitest run` gives **13 test files and 176 tests**, all passing.

Vitest is configured in `vitest.config.mts`. It aliases `@` to `src`, `paygate-x402` to `spica/src/index.ts`, and `server-only` to the empty stub in `tests/stubs/server-only.ts`. It includes `tests/**/*.test.ts` and excludes `tests/live/**`. `vitest.live.config.mts` reuses that config and includes only `tests/live/**/*.live.test.ts`.

| File | Covers |
| --- | --- |
| `tests/firewall.test.ts` | The policy engine, atomic reservations in `MemoryStore`, human approvals, and task budget and network parsing |
| `tests/x402.test.ts` | The `paygate-x402` middleware, buyer quote handling, Hedera references, reputation, the private address guard, money, usage codes and generated developer code |
| `tests/sdk-backend.test.ts` | Agent keys, one payment per idempotency key, `purchaseForAgent`, `budgetFor` and `historyFor` |
| `tests/provider-call.test.ts` | Calling a provider: plain failure messages, key scrubbing, and no charge when the provider fails |
| `tests/settlement.test.ts` | Following `settling` payments, and `SupabaseStore.updateTransactionStatus` |
| `tests/secrets.test.ts` | Sealing and placing provider API keys, and payment proof links |
| `tests/api-keys.test.ts` | Developer API keys |
| `tests/auth.test.ts` | Signed session tokens and wallet user IDs |
| `tests/gemini.test.ts` | The Gemini planner, its schema conversion, and `agentProvider()` |
| `tests/model-fallback.test.ts` | Moving to the next model on an outage |
| `tests/marketplace.test.ts` | Marketplace filters and the UI helpers in `components/marketplace/meta.ts` |
| `tests/quote.test.ts` | `fetchQuote` in `components/marketplace/quote.ts` |
| `tests/provider-wallet.test.ts` | `isAgentWallet`, which stops a provider from listing the agent's own wallet |

### `tests/firewall.test.ts`

- **Policy decisions**: auto-approval at $0.02, approval above the threshold, $2.00 blocked even with approval, task budgets including earlier spend, exact limit boundaries, the monthly limit, blocklist and allowlist, networks, mainnet IDs refused as an unsupported asset, other assets and another network's token, price rises, identity mismatch, invalid amounts, and automatic payments off.
- **Atomic reservations**: 50 concurrent $0.30 requests against $1.00, concurrent task budgets, duplicates and the duplicate window, the single-use signing gate, releasing holds, keeping unknown outcomes counted, hold expiry before and after signing, and daily and monthly window resets.
- **Human approvals**: decided once even when raced, not by another user, not after expiry.
- **Task budget parsing**: amounts read from plain language, prices that are not budgets ignored, and a named network.

### `tests/x402.test.ts`

- **Middleware**: 402 with readable terms and no data, delivery with a settlement header, garbage and invalid proofs, proofs signed for a lower amount, another recipient, token or network, replay refused, a raced proof settles once, no charge and a retry allowed when the handler fails, data withheld when settlement fails, distinct proofs, and case-insensitive addresses.
- **Buyer quote handling**: the cheapest offer on an enabled network, honouring the person's allowed networks, ignoring offers on disabled networks, and refusing x402 v1 and unreadable terms.
- **Also**: Hedera transaction ID conversion, reputation scoring rules, the private address guard, money conversions, the usage code header, and the three-line developer code.

### `tests/sdk-backend.test.ts`

- **Agent keys**: round trip, 30-day expiry, not accepted as developer API keys or the reverse, tampering refused.
- **One key, one payment**: a budget of exactly one payment per key, still refused long after signing started, freed only when no payment was sent, a separate task per key and per user, and the raw key kept out of the task ID.
- **`purchaseForAgent`**: status mapping, only `verified` reads as `settled`, free APIs, replay without a second purchase, no second purchase after a failed or unknown payment, a key reused for another service, pending approvals replayed without asking twice, firewall refusals as 403, duplicates as 409, failures with no record reported as uncertain, unknown and unpayable services, and the price taken from the catalog.
- **`budgetFor`** and **`historyFor`**: remaining amounts never below zero, no provider lists exposed, paging by user, proof links only when they exist, and bad cursors refused.

### `tests/provider-call.test.ts`

- A broken listing is told apart from a passing outage. Keys and long tokens are scrubbed from logs.
- `deliverFromProvider` keeps a failure's status but never passes on the provider's body, never logs the key, turns a status that cannot carry a body into 502, and reports an unreachable provider instead of throwing.
- A failing provider never triggers settlement. The buyer gets the reason, a failed record is written, and the hold is freed.

### `tests/settlement.test.ts`

A `settling` payment becomes `verified` with its onchain reference, stays `settling` while the batch is pending or a lookup fails, and is never checked again once final. Circle is asked about one payment at most every 15 seconds, and one page load checks a capped number of payments while keeping every row. A Supabase status update writes the same columns as a new transaction.

### `tests/secrets.test.ts`

Provider keys are encrypted so only this server can read them, a changed stored key fails to open, hashing is one-way and stable, the key goes where the provider asked (bearer, header or query), and a buyer cannot replace it with a query parameter. Proof links appear for Arc only once a payment is final, each network uses its own explorer, and HashScan links use the format HashScan opens.

### The rest

- `tests/api-keys.test.ts`: a developer API key round-trips its grant, refuses an edited budget or service, expires, and is not interchangeable with a session token.
- `tests/auth.test.ts`: session tokens refuse another purpose, tampering, another secret, expiry and malformed input, need a secret of at least 32 characters, and need a secret at all in live mode. Wallet user IDs are UUIDs, ignore address case and differ between wallets.
- `tests/gemini.test.ts`: `toGeminiSchema` drops keywords Gemini rejects. `agentProvider()` prefers an explicit choice, then whichever key is set. `runGeminiAgent` runs tool calls, sends back the model turn with its thought signature, and turns invalid tool arguments into a message for the model.
- `tests/model-fallback.test.ts`: `generateWithFallback` moves past 429, 503, 404 and no response, stays on the model that answered, stops on 400, 401 and 403, and reports the last failure when every model is out.
- `tests/marketplace.test.ts`: `filterLocal` matches search words, category regardless of case, price cap and network. `paramFields` reads JSON Schema properties. `categoryMeta` falls back to a readable label.
- `tests/quote.test.ts`: `fetchQuote` reads terms from a 402, never treats another status as a quote, and fails cleanly on an empty quote or a network error.
- `tests/provider-wallet.test.ts`: `isAgentWallet` spots the agent's Arc wallet in any letter case, and its Hedera account, and allows every other wallet.

## End-to-end

`scripts/e2e-demo.mjs` drives a running server over HTTP. No keys are needed and no money moves.

```bash
npm run build
PAYGATE_PUBLIC_URL=http://localhost:3100 npx next start -p 3100
npm run test:e2e -- http://localhost:3100
```

State accumulates, so restart the server between runs. The run takes over two minutes, because it waits out the 60-second duplicate window twice.

The marketplace starts empty, so the script first saves a provider profile and lists a $0.02 "Cricket Scores" API whose endpoint is `https://api.github.com/zen`. It then checks:

- The seller route: a 402 with `PAYMENT-REQUIRED` and an x402 v2 quote of 20,000 micros, no data before payment, forged, underpaying and garbage proofs rejected, and 404 for an unknown service.
- An agent run that reads a $0.05 budget, picks the listed service, gets an `allow` decision and a `simulated` receipt, and answers.
- The receipt's fields, and dashboard totals taken from the ledger.
- An identical repeat purchase stopped, a $0.001 budget that signs nothing, and a blocked provider refused.
- An approval that completes the payment and cannot be reused, and a declined approval that spends nothing.
- Invalid and inconsistent policies, an empty agent message, and a client-supplied spend total, all rejected or ignored.
- The public marketplace.

Three checks were written for the built-in services that no longer exist, and are likely to fail until they are updated: "sample data is labelled as sample" expects `"sample":true` in the delivered data, and the last two query `/api/marketplace?query=weather`, which matches nothing unless the Circle catalog is switched on.

## Agent tool loop without a key

`scripts/claude-stub.mjs` is a scripted stand-in for the Claude API. It tests the wiring, not the model's judgment.

```bash
node scripts/claude-stub.mjs 3199
ANTHROPIC_BASE_URL=http://localhost:3199 ANTHROPIC_API_KEY=any AGENT_PROVIDER=claude npm run dev
```

Set `AGENT_PROVIDER=claude`, or leave `GEMINI_API_KEY` unset, because Gemini wins when both keys exist. The stub answers four requests in order: `discover_services` for "cricket", `purchase_service` with a URL as the service ID, `purchase_service` with `test-service`, then a final text answer. Both purchases should be refused, because neither ID was found in the run. `GET /__seen` on the stub returns what each request carried: model, effort, fallbacks, beta headers, tool names, tool input keys and the last tool result. See [Agent](agent.md).

## Live checks

`npm run test:live` runs `scripts/live-check.mts`, then `vitest run --config vitest.live.config.mts`. It uses freshly generated keys with no funds, so it cannot spend anything.

`scripts/live-check.mts` checks:

1. The Arc Testnet RPC reports chain 5042002.
2. Arc USDC has 6 decimals.
3. Circle Gateway supports Arc Testnet.
4. Gateway accepts the format of a SPICA payment at verify.
5. Gateway refuses to settle an unfunded payment.
6. Gateway refuses a tampered signature.
7. The Hedera facilitator supports `hedera:testnet` and has a fee payer.
8. The Hedera testnet USDC token exists on the mirror node with 6 decimals.
9. Circle discovery lists Arc Testnet services.

`tests/live/payment-path.live.test.ts` runs SPICA's real signer, adapters and middleware. On Arc, it signs a payment Gateway can read and confirms data is withheld because the wallet is empty, and it confirms the signer refuses without a reservation or for a different amount. On Hedera, it builds real terms and expects a structured refusal from the facilitator, not a format error.

## Mutation check

`scripts/mutation-check.mjs` proves the tests can fail. For each of 19 protections it edits the source to remove it, runs `npx vitest run`, expects a failure, and restores the file.

| File | Protections |
| --- | --- |
| `src/server/firewall/policy.ts` | Per-request limit, task budget, approval not waiving hard limits, blocklist, asset check, price rise, identity mismatch |
| `src/server/store/memory.ts` | Daily budget in the reservation, task budget in the reservation, duplicates, the single-use signing gate, keeping unknown outcomes counted, approval ownership |
| `spica/src/index.ts` | Replay guard, requirement matching, invalid proofs, failed settlement, failed handlers |
| `src/server/reputation.ts` | The minimum sample before a score |

A mutation marked `STALE` means its search pattern no longer exists in the source, and it counts as a failure. Update the pattern when you refactor the code it guards. When you add a protection, add a mutation for it. The newer protections in `provider-call.ts`, `secrets.ts`, `sdk.ts` and `settlement.ts` have unit tests but no mutations yet.

## Other scripts

| Script | Purpose |
| --- | --- |
| `npm run payments:settle` | `scripts/settle-pending.mts`: asks Circle about every payment still `settling` in Supabase, for all users. Needs Supabase |
| `npm run wallet:status` | `scripts/agent-wallet.mts status`: the agent's Arc wallet and Gateway balances |
| `npm run wallet:deposit -- <amount>` | Deposits testnet USDC into Gateway. A real onchain testnet transaction |
