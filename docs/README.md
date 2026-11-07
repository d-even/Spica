# PayGate documentation

These docs explain how PayGate works inside. To run it, start with the [project README](../README.md). To plug PayGate into your own project, see [Integrating PayGate](../README.md#integrating-spica).

## Reading order

If you are new to the project, read these in order:

1. [Concepts](concepts.md): x402, micro-USD, demo and live mode, and the terms used everywhere else.
2. [Architecture](architecture.md): the parts of the system, what each owns, and the rules between them.
3. [Payment flow](payment-flow.md): one purchase from quote to receipt, including every failure path.
4. [Spending Firewall](spending-firewall.md): the policy engine, approvals and atomic reservations.

Then read whichever area you are working on:

| Doc | Read it when you are |
| --- | --- |
| [Agent](agent.md) | Changing the Claude tool loop, the demo planner or budget parsing |
| [Networks and adapters](networks-and-adapters.md) | Touching Arc, Hedera or the demo rail, or adding a network |
| [Discovery, identity and reputation](discovery-identity-reputation.md) | Working on the catalog, ENS checks, PayGate IDs or scores |
| [Data model](data-model.md) | Changing the store, the Supabase schema or a record shape |
| [Configuration](configuration.md) | Setting environment variables or switching modes |
| [Security](security.md) | Reviewing a change that touches money, keys or third-party input |
| [Testing](testing.md) | Running or extending the test suites |
| [Development guide](development.md) | Finding your way around the code, or making a common change |

## Where the code lives

| Path | What it is |
| --- | --- |
| `src/app/(app)/` | Signed-in pages: dashboard, agent, spending controls, marketplace, payments, provider, settings |
| `src/app/api/` | HTTP routes. See [API](../README.md#api) |
| `src/server/` | All server-side logic. Nothing here reaches the browser |
| `src/lib/` | Code shared with the browser: money, network facts, PayGate ID lookups |
| `src/components/` | React UI components |
| `spica/` | The `paygate-x402` package: reusable x402 seller middleware |
| `supabase/migrations/` | The database schema for live mode |
| `scripts/` | Wallet tools, end-to-end, live and mutation checks |
| `tests/` | Vitest suites |
