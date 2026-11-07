# SPICA documentation

These docs explain how SPICA works inside. To run it, start with the [project README](../README.md). To plug SPICA into your own project, see [Integrating SPICA](../README.md#integrating-spica).

## Reading order

If you are new to the project, read these in order:

1. [Concepts](concepts.md): x402, micro-USD, networks, demo and live mode, and the terms used everywhere else.
2. [Architecture](architecture.md): the parts of the system, what each owns, the rules between them, and every page and API route.
3. [Payment flow](payment-flow.md): one purchase from quote to receipt, every failure path, settlement checks, and the seller route.
4. [Spending Firewall](spending-firewall.md): the policy engine, task budgets, approvals and atomic reservations.

Then read whichever area you are working on:

| Doc | Read it when you are |
| --- | --- |
| [Agent](agent.md) | Changing the Gemini or Claude tool loop, the shared tools and prompt, the demo planner, budget parsing, developer keys or the SDK backend |
| [Discovery and reputation](discovery-identity-reputation.md) | Working on the marketplace, SPICA listings, the optional Circle catalog, quotes and comparison, the provider directory, or reputation scores |
| [Networks and adapters](networks-and-adapters.md) | Touching Arc Testnet, Hedera testnet or the demo rail, signing, confirmation, or adding a network |
| [Data model](data-model.md) | Changing the store, the Supabase schema and migrations, or a record shape |
| [Configuration](configuration.md) | Setting environment variables or switching modes |
| [Security](security.md) | Reviewing a change that touches money, keys, sessions or third-party input |
| [Testing](testing.md) | Running or extending the test suites, the e2e and live checks, or the mutation check |
| [Development guide](development.md) | Finding your way around the code, or making a common change |

## Where the code lives

| Path | What it is |
| --- | --- |
| `src/app/(site)/` | Public pages: landing, marketplace, providers, docs |
| `src/app/(auth)/` | The login page (wallet sign-in) |
| `src/app/(app)/` | Signed-in pages: Home with the agent chat (`/dashboard`), spending limits, transactions, provider, settings |
| `src/app/api/` | HTTP routes. See [API](../README.md#api) |
| `src/server/` | All server-side logic. Nothing here reaches the browser |
| `src/lib/` | Code shared with the browser: money, network facts, proof links, usage-code checks |
| `src/components/` | React UI components, including the SPICA site components in `spica/` |
| `spica/` | The `paygate-x402` package: reusable x402 seller middleware |
| `packages/agent-sdk/` | `spica-agent-sdk`, the TypeScript client for your own agent |
| `supabase/migrations/` | The database schema for live mode |
| `scripts/` | Wallet tools, settlement checks, end-to-end, live and mutation checks |
| `tests/` | Vitest suites |
| `legacy/ens/` | Archived ENS and PayGate ID code. Not built or used |
