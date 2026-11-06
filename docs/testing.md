# Testing

Four layers, from fast and offline to slow and networked.

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm test` | Unit tests in `tests/*.test.ts` | Nothing |
| `npm run test:e2e -- <url>` | The full journey against a running server | A server in demo mode |
| `npm run test:live` | Read-only checks against real networks | Network access |
| `npm run test:mutation` | Breaks 20 protections and expects `npm test` to fail | Nothing |

Also: `npm run typecheck` and `npm run lint`.

## Unit tests

Vitest, configured in `vitest.config.mts`. It aliases `@` to `src`, `paygate-x402` to its source, and replaces `server-only` with a stub.

### `tests/firewall.test.ts`

- **Policy decisions**: auto-approval at $0.02, approval above the threshold, $2.00 blocked even with approval, task budgets including earlier spend, exact limit boundaries, monthly limit, blocklist and allowlist, networks, asset checks including another network's token, price rises, ENS mismatch, invalid amounts, auto-pay off.
- **Atomic reservations**: 50 concurrent $0.30 requests against $1.00, concurrent task budgets, duplicates and the duplicate window, the single-use signing gate, releasing holds, keeping unknown outcomes counted, hold expiry before and after signing, daily and monthly window resets.
- **Human approvals**: decided once even when raced, not by another user, not after expiry.

### `tests/x402.test.ts`

- **Middleware**: 402 with readable terms and no data, delivery with a settlement header, garbage and invalid proofs, replay refused, a raced proof settles once, no charge and a retry allowed when the handler fails, data withheld when settlement fails, distinct proofs, case-insensitive addresses.
- **Buyer quote handling**: cheapest offer on an enabled network, ignoring offers on disabled networks, refusing x402 v1 and unreadable terms.
- **Hedera** transaction ID conversion, **reputation** scoring rules, the **private address** guard, and **money** conversions.

## End-to-end

`scripts/e2e-demo.mjs` drives a running server over HTTP. No keys are needed and no money moves.

```bash
npm run build
PAYGATE_PUBLIC_URL=http://localhost:3100 npx next start -p 3100
npm run test:e2e -- http://localhost:3100
```

State accumulates, so restart the server between runs.

It checks: the seller route's 402 and its rejection of forged, underpaying and garbage proofs; an agent run that reads a $0.05 budget, picks the $0.02 service, pays and returns a simulated receipt; dashboard totals from the ledger; duplicate purchases stopped; a task budget blocking both services with nothing signed; a blocked provider refused; an approval flow that completes, cannot be reused and can be declined; invalid policies and messages rejected; client-supplied totals ignored; and the marketplace serving real catalog data.

To exercise the Claude tool loop without a key, run `node scripts/claude-stub.mjs 3199` and start the app with `ANTHROPIC_BASE_URL=http://localhost:3199` and any `ANTHROPIC_API_KEY`. See [Agent](agent.md#testing-the-tool-loop-without-a-key).

## Live checks

`npm run test:live` runs `scripts/live-check.mts`, then `tests/live/*.live.test.ts`. It uses freshly generated keys with no funds, so it cannot spend anything.

It checks the Arc testnet RPC and USDC decimals, that Circle Gateway supports Arc testnet, accepts PayGate's payment format at verify, refuses to settle an unfunded payment and refuses a tampered signature, ENS forward and reverse resolution, the Hedera facilitator and USDC token, and that Circle discovery lists Arc testnet services.

The live payment-path tests sign a payment Gateway can read and confirm data is withheld because the wallet is empty, and confirm the signer refuses without a reservation or for a different amount.

## Mutation check

`scripts/mutation-check.mjs` proves the tests can fail. For each of 20 protections it edits the source to remove it, runs `npx vitest run`, expects a failure, and restores the file.

The protections include the per-request limit, task budget, approval not waiving hard limits, blocklist, mainnet guard, asset check, price rise, ENS mismatch, reservation budgets, duplicates, the single-use signing gate, keeping unknown outcomes counted, approval ownership, the seller's replay guard, requirement matching, invalid proofs, failed settlement, failed handlers and reputation's minimum sample.

A mutation marked `STALE` means its search pattern no longer exists in the source. Update the pattern when you refactor the code it guards. When you add a protection, add a mutation for it.
