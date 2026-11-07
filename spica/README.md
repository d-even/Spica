# paygate-x402

Framework-neutral [x402 v2](https://github.com/coinbase/x402) seller middleware. Wrap any handler that takes a Web `Request` and returns a `Response`, and it only runs after a verified payment. The buyer is only charged when the handler succeeds.

It runs anywhere Web `Request`/`Response` exist: Next.js route handlers, Hono, Bun, Deno and Cloudflare Workers. Express and Fastify handlers use Node's `req`/`res` objects, so they need a bridge first.

The middleware only knows the protocol. Everything specific to a network lives in a `SellerAdapter` you pass in.

## How it works

| Incoming request | What happens |
| --- | --- |
| No payment header | `402` with a `PAYMENT-REQUIRED` header and JSON body listing every offer |
| Header present | Decode it, then check it matches one current offer exactly (scheme, network, amount, asset, `payTo`) |
| Matches | Claim the proof with the replay guard, then `adapter.verify` |
| Verified | Run your handler |
| Handler returns non-`2xx` | Return that response. Nothing is settled and the buyer is not charged |
| Handler succeeds | `adapter.settle`, then return your response with a `PAYMENT-RESPONSE` header |
| Anything fails before settlement | The replay claim is released so the buyer can retry |

The proof is read from `PAYMENT-SIGNATURE`, with `X-PAYMENT` accepted as a fallback.

## Install

This version is not published to npm, so use it from source. A `paygate-x402` package on npm may be an older, incompatible version.

1. Copy `src/index.ts` into your project, or point a TypeScript path alias at it, as the PayGate app does:

   ```jsonc
   // tsconfig.json
   { "compilerOptions": { "paths": { "paygate-x402": ["./spica/src/index.ts"] } } }
   ```

2. Install the peer dependency:

   ```bash
   npm install @x402/core
   ```

## Usage

### Next.js route handler

```ts
// app/api/weather/route.ts
import { withPayment } from 'paygate-x402';
import { arcTestnet } from '@/payments/arc';
import { replayGuard } from '@/payments/replay';

export const GET = withPayment(
  async (request, { payer }) => {
    const city = new URL(request.url).searchParams.get('city') ?? 'London';
    return Response.json({ city, tempC: 18, payer });
  },
  {
    offers: [{ adapter: arcTestnet, amountAtomic: '10000', payTo: '0xYourWallet' }], // $0.01
    replayGuard,
    description: 'Current weather by city',
    onEvent: (event) => console.log('payment event', event.type),
  },
);
```

### Hono

```ts
import { Hono } from 'hono';
import { withPayment } from 'paygate-x402';

const paidWeather = withPayment(async () => Response.json({ tempC: 18 }), { offers, replayGuard });

const app = new Hono();
app.get('/weather', (c) => paidWeather(c.req.raw));
export default app;
```

### Several networks

List one offer per network. The buyer picks the one it can pay:

```ts
offers: [
  { adapter: arcTestnet, amountAtomic: '10000', payTo: '0xYourEvmWallet' },
  { adapter: hederaTestnet, amountAtomic: '10000', payTo: '0.0.1234' },
],
```

USDC has 6 decimals, so `amountAtomic` is the price in millionths of a dollar: `'10000'` is $0.01.

## Adapters

```ts
interface SellerAdapter {
  readonly network: string; // CAIP-2, e.g. 'eip155:5042002' or 'hedera:testnet'
  buildRequirement(input: { amountAtomic: string; payTo: string }): Promise<PaymentRequirements>;
  verify(payload: PaymentPayload, requirement: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirement: PaymentRequirements): Promise<SettleResponse>;
}
```

### Arc testnet through Circle Gateway

This is a cut-down version of PayGate's [`src/server/payments/arc.ts`](../src/server/payments/arc.ts). It needs `npm install @circle-fin/x402-batching`.

```ts
// payments/arc.ts
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import { CIRCLE_BATCHING_NAME, CIRCLE_BATCHING_VERSION } from '@circle-fin/x402-batching';
import type { PaymentRequirements, SellerAdapter, SettleResponse } from 'paygate-x402';

const facilitator = new BatchFacilitatorClient({ url: 'https://gateway-api-testnet.circle.com' });

export const arcTestnet: SellerAdapter = {
  network: 'eip155:5042002',
  async buildRequirement({ amountAtomic, payTo }) {
    return {
      scheme: 'exact',
      network: 'eip155:5042002',
      asset: '0x3600000000000000000000000000000000000000', // USDC on Arc
      amount: amountAtomic,
      payTo,
      maxTimeoutSeconds: 604_900, // Gateway authorizations must stay valid for 7 days
      extra: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        verifyingContract: CHAIN_CONFIGS.arcTestnet.gatewayWallet,
      },
    } as PaymentRequirements;
  },
  verify: (payload, requirement) => facilitator.verify(payload as never, requirement as never),
  settle: (payload, requirement) =>
    facilitator.settle(payload as never, requirement as never) as Promise<SettleResponse>,
};
```

Gateway's `verify` checks the signature, not the buyer's balance. That is why the middleware settles before it releases data.

For Hedera, see [`src/server/payments/hedera.ts`](../src/server/payments/hedera.ts), which uses an x402 facilitator.

## Replay guard

```ts
interface ReplayGuard {
  claim(proofId: string): Promise<boolean>; // atomically claim; false if already used
  release(proofId: string): Promise<void>;  // called when no money moved, so the buyer can retry
}
```

For local development, an in-memory set is enough:

```ts
const used = new Set<string>();
export const replayGuard = {
  async claim(id: string) { if (used.has(id)) return false; used.add(id); return true; },
  async release(id: string) { used.delete(id); },
};
```

In production, use a database unique key so the guard holds across instances and restarts. For example, in Postgres:

```ts
// create table used_proofs (id text primary key, created_at timestamptz default now());
export const replayGuard = {
  async claim(id: string) {
    const rows = await sql`insert into used_proofs (id) values (${id}) on conflict do nothing returning id`;
    return rows.length === 1;
  },
  async release(id: string) {
    await sql`delete from used_proofs where id = ${id}`;
  },
};
```

## Events

`onEvent` sees every outcome. Errors thrown inside it never change the response.

| `type` | Fields |
| --- | --- |
| `payment_required` | none |
| `rejected` | `reason`, `network?` |
| `handler_failed` | `status`, `network` |
| `settled` | `settlement`, `requirement`, `latencyMs` |

Rejection reasons come from the middleware (`invalid_payment_header`, `requirement_mismatch`, `duplicate_payment`) or from the adapter's verify and settle results.

## Exports

`withPayment`, `requirementsMatch`, `proofId`, `X402_VERSION`, and the types `SellerAdapter`, `ReplayGuard`, `PaymentOffer`, `WithPaymentOptions`, `PaymentEvent`, plus the x402 core types it re-exports.

## License

MIT
