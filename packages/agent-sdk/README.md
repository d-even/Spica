# spica-agent-sdk

A TypeScript client that lets AI agents find APIs, compare them, get quotes and buy calls through SPICA's Spending Firewall.

The SDK holds no payment keys and makes no payment decisions. Your agent asks, and the SPICA server checks your limits, pays on Arc and records the audit trail on Hedera.

## Quick start

```bash
npm install spica-agent-sdk
```

Create an agent key under **Settings → Agent SDK key** in SPICA, then set:

```bash
SPICA_API_KEY=spica_...              # Keep this secret
SPICA_BASE_URL=http://localhost:3000 # Your SPICA server
```

```ts
import { SPICA } from 'spica-agent-sdk';

const spica = new SPICA({
  apiKey: process.env.SPICA_API_KEY,
  baseUrl: process.env.SPICA_BASE_URL,
  network: 'arc-testnet',
});

const services = await spica.discover({ query: 'weather', maxPrice: '0.05' });
const quote = await spica.quote({ serviceId: services[0].id });
console.log(`Costs $${quote.price.usd} on ${quote.network}`);

const result = await spica.purchase({ serviceId: services[0].id, idempotencyKey: 'weather-pune-0001' });
if (result.status === 'settled') console.log(result.data, result.proofUrl);
```

Keep the key on your server. Never ship it to a browser. Off your own machine, `baseUrl` must use https.

## Methods

| Method | What it does | Needs a key |
| --- | --- | --- |
| `discover({ query, category, maxPrice, limit })` | Searches the marketplace, cheapest first | No |
| `inspect(serviceId)` | Reads one service and its measured reputation | No |
| `compare(services)` | Lines up services by ID or from `inspect`. It doesn't choose or pay. | No |
| `quote({ serviceId })` | Reads the seller's live terms. Costs nothing. | No |
| `purchase({ serviceId, idempotencyKey?, params? })` | Asks SPICA to buy one call | Yes |
| `getBudget()` | Reads your limits and what's left | Yes |
| `history({ limit, cursor })` | Lists payments, newest first, with proof links | Yes |

Prices are exact strings: `{ usd: '0.01', micros: '10000' }`. Compare `micros` as `BigInt`, not as floats.

## Reading a purchase result

A quote isn't a payment, and a requested purchase isn't a settled one. Always check `status`.

| `status` | Meaning | What to do |
| --- | --- | --- |
| `settled` | The network confirmed it. This is the only status that means the money moved. | Use `data` |
| `settling` | Accepted, but not final. `data` is included if the API answered. | Repeat with the same key later |
| `pending_approval` | Above your approval threshold. Nothing has been paid. | A person approves it in SPICA, then repeat with the same key |
| `free` | The API didn't ask for payment | Use `data` |
| `simulated` | The server is in demo mode, so no money exists | Don't treat it as paid |

Repeating a key never pays again. It reports the current status, with `replayed: true`. API responses aren't stored, so `data` is `null` on a replay.

## Handling errors

Refusals and failed payments throw. Every error extends `SpicaError` and has a `code`.

```ts
import { BudgetExceededError, DuplicateRequestError, PaymentFailedError, PaymentUncertainError, PolicyDeniedError, SPICA } from 'spica-agent-sdk';

try {
  await spica.purchase({ serviceId, idempotencyKey });
} catch (error) {
  if (error instanceof BudgetExceededError) {
    // A spending limit would be exceeded. Nothing was paid.
  } else if (error instanceof PolicyDeniedError) {
    // Another spending rule refused it. Nothing was paid.
  } else if (error instanceof DuplicateRequestError) {
    // The key is in use. Wait and repeat it. Don't switch to a new key.
  } else if (error instanceof PaymentFailedError) {
    // It failed. Repeating this key won't retry it, so use a new key to try again.
  } else if (error instanceof PaymentUncertainError) {
    // Unknown, and money may have moved. Repeat with error.idempotencyKey.
  }
}
```

The other errors are `AuthenticationError`, `ValidationError`, `NotFoundError`, `RateLimitError`, `ConnectionError` and `ServerError`.

## Payment safety

- **One key, one payment:** the server enforces this atomically, so it holds across retries, parallel calls and crashes.
- **Use meaningful keys:** derive `idempotencyKey` from the job, such as `report-42-weather`, so a restarted agent reuses it. If you leave it out, a key is generated and returned, and it's on every error too.
- **Nothing retries a payment:** the SDK sends each purchase once. A dropped connection, a timeout or a 5xx is `PaymentUncertainError`, never a failure, because the request may have arrived.
- **Agents can't change their limits:** an agent key has no route to do so. People change limits in SPICA.
- **The price comes from the server:** you name a service, and the amount and recipient come from the catalog and the seller.

An agent key lasts 30 days and can't be cancelled early, so treat it like a password.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` | `SPICA_API_KEY` | Starts `spica_` |
| `baseUrl` | `SPICA_BASE_URL` | https, except on localhost |
| `network` | `arc-testnet` | The only supported network |
| `timeoutMs` | 30 seconds | For reads |
| `purchaseTimeoutMs` | 2 minutes | A timeout here is reported as uncertain |
| `fetch` | Global `fetch` | For tests or custom transports |

Requires Node 18 or newer. There are no runtime dependencies. This package is ESM only.

## Local development

```bash
cd packages/agent-sdk
npm run build
npm test
npm run typecheck
```

To try it from another project:

```bash
npm pack                                   # Creates spica-agent-sdk-0.1.0.tgz
npm install /path/to/spica-agent-sdk-0.1.0.tgz
```

See [examples/buy-api.ts](https://github.com/d-even/PayGate/blob/main/packages/agent-sdk/examples/buy-api.ts) for a full purchase flow.
