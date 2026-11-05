# paygate-x402

Stripe for x402 — Add payments to any API in 3 lines.

## Install

```bash
npm install paygate-x402
```

## Express Usage

```javascript
import paygate from 'paygate-x402';

app.use(paygate({
  apiKey: 'pg_your_key',
  price: '0.001',
  payTo: '0xYourWallet'
}));
```

## Next.js Usage

```typescript
import { paygateNext } from 'paygate-x402';

export async function GET(request: Request) {
  const check = await paygateNext(request, {
    apiKey: 'pg_your_key',
    price: '0.001',
    payTo: '0xYourWallet'
  });
  
  if (check) return check;
  
  // Your API logic here
  return Response.json({ data: 'Protected content' });
}
```

## How it works

1. Request comes in
2. No payment? → 402 returned automatically
3. Payment header found? → Verified on Base Sepolia
4. Verified? → API access granted

Built on Base Sepolia. Payments in USDC.

## Features

- ✅ 3-line integration
- ✅ On-chain payment verification
- ✅ ERC-20 Transfer event decoding
- ✅ Works with Express and Next.js
- ✅ AI agent compatible
- ✅ TypeScript support

## Configuration

```typescript
interface PaygateConfig {
  apiKey: string;      // Your PayGate API key
  price: string;       // Price in USDC (e.g., '0.001')
  payTo: string;       // Your wallet address
  token?: string;      // Token address (default: USDC)
  network?: string;    // Network (default: 'base-sepolia')
}
```

## Payment Header Format

Clients must include payment proof in the `X-Payment` header:

```
X-Payment: txHash=0x...;from=0x...;to=0x...;amount=0.001;token=0x...;network=base-sepolia
```

## Example: Protected API

```typescript
import express from 'express';
import paygate from 'paygate-x402';

const app = express();

// Protect this route
app.get('/api/data', 
  paygate({
    apiKey: 'pg_your_key',
    price: '0.001',
    payTo: '0xA1B320D8061357efa286Af2629DF6AC554C05d6E'
  }),
  (req, res) => {
    res.json({ data: 'This is protected content!' });
  }
);

app.listen(3000);
```

## Example: AI Agent Client

```typescript
// 1. Call API
const response = await fetch('https://api.example.com/data');

// 2. Got 402? Pay with USDC
if (response.status === 402) {
  const { payment } = await response.json();
  
  // Send USDC on Base Sepolia
  const txHash = await sendUSDC(payment.payTo, payment.amount);
  
  // 3. Retry with payment proof
  const response2 = await fetch('https://api.example.com/data', {
    headers: {
      'X-Payment': `txHash=${txHash};from=${myAddress};to=${payment.payTo};amount=${payment.amount};token=${payment.token};network=base-sepolia`
    }
  });
  
  const data = await response2.json();
}
```

## Network Details

- **Network:** Base Sepolia (testnet)
- **Chain ID:** 84532
- **USDC Contract:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **RPC:** `https://sepolia.base.org`

## Get Test USDC

Visit: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet

## License

MIT

## Links

- **GitHub:** https://github.com/dhruvxop19/paygate
- **Documentation:** https://github.com/dhruvxop19/paygate/blob/main/README.md
- **x402 Protocol:** https://github.com/coinbase/x402

---

Built with ❤️ using the x402 protocol by Coinbase
