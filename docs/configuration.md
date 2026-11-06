# Configuration

All configuration is environment variables. Copy `.env.example` to `.env.local`. With nothing set, PayGate runs in demo mode with no keys, no money and in-memory data.

The `/settings` page shows the mode and which integrations are configured. It lists variable names only, never values.

## Variables

### Mode

| Variable | Default | Effect |
| --- | --- | --- |
| `PAYGATE_MODE` | `demo` | `live` turns on real payments. Anything else is demo |
| `PAYGATE_PUBLIC_URL` | `http://localhost:3000` | The URL the app is reached at. Built-in and registered services are served from here, and the URL guard trusts this origin |

### Claude

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude plans agent runs. Without it, the demo planner runs |
| `ANTHROPIC_BASE_URL` | Optional. Point at `scripts/claude-stub.mjs` for testing |

### Supabase (required in live mode)

| Variable | Effect |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access. Never expose it to a browser |

Both must be set for Supabase to be used. Supabase is only the database: sign-in does not use Supabase Auth, and `SUPABASE_ANON_KEY` is no longer needed.

### Wallet sign-in

| Variable | Effect |
| --- | --- |
| `PAYGATE_SESSION_SECRET` | Signs session and sign-in cookies. At least 32 characters, for example from `openssl rand -hex 32`. Required in live mode. In demo mode without it, a random secret is used and sessions end when the server restarts |

People sign in with a browser wallet using Sign-In with Ethereum on Arc Testnet (chain `5042002`). The login page adds Arc Testnet to the wallet if it is missing. Hedera Testnet is shown as coming soon. Changing the secret signs everyone out.

### Arc

| Variable | Effect |
| --- | --- |
| `AGENT_PRIVATE_KEY` | The agent's buyer wallet. A new, dedicated EOA. Enables `arc-testnet` in live mode |
| `PAYGATE_SELLER_ADDRESS` | Receives payments for the built-in cricket services on Arc. Use a different wallet from the agent |
| `ARC_TESTNET_RPC_URL`, `ARC_TESTNET_GATEWAY_URL` | Optional overrides. Defaults: `https://rpc.testnet.arc.io`, `https://gateway-api-testnet.circle.com` |

### Hedera

| Variable | Effect |
| --- | --- |
| `HEDERA_FACILITATOR_URL` | x402 facilitator. Default in `.env.example`: `https://api.testnet.blocky402.com` |
| `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY` | The agent's Hedera account. With the facilitator URL, enables `hedera-testnet` in live mode |
| `HEDERA_SELLER_ACCOUNT_ID` | Receives payments for the built-in services on Hedera |

### Hedera Consensus Service (optional audit trail)

| Variable | Effect |
| --- | --- |
| `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_HCS_TOPIC_ID` | All three turn on audit publishing |

Audit messages hold opaque IDs only: agent ID, provider key, amount, token, network, reference, status and timestamp. Never keys, emails, prompts or API responses.

### ENS and PayGate IDs

| Variable | Effect |
| --- | --- |
| `ENS_RPC_URL` | Ethereum mainnet RPC for ENS. Uses a public endpoint when unset |
| `ADMIN_PRIVATE_KEY` | PayGate ID registrar key on Sepolia. Kept separate from the agent key on purpose |
| `ETHEREUM_SEPOLIA_RPC` | Sepolia RPC. Default: `https://ethereum-sepolia-rpc.publicnode.com` |
| `PAYGATE_SUBDOMAIN_CONTRACT` | Registry contract address. Default: `0xf7f47FE64c7cbc99deDD53F31e1E9E189e1ee3BE` |

### Discovery and data

| Variable | Effect |
| --- | --- |
| `CIRCLE_DISCOVERY_URL` | Override the Circle catalog endpoint |
| `CRICAPI_KEY` | Live scores for the built-in cricket services, from cricketdata.org |

Without `CRICAPI_KEY`, demo mode serves labelled sample data, and live mode refuses the sale rather than charge for nothing.

## Common setups

### Demo, no keys

Nothing to set. Run `npm run dev` and open `/dashboard`.

### Demo with Claude

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### Live on Arc testnet

```bash
PAYGATE_MODE=live
PAYGATE_PUBLIC_URL=https://your-deployment.example
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
PAYGATE_SESSION_SECRET=...     # openssl rand -hex 32
AGENT_PRIVATE_KEY=0x...        # funded from faucet.circle.com, then deposited into Gateway
PAYGATE_SELLER_ADDRESS=0x...   # a different wallet
CRICAPI_KEY=...
```

Then deposit into Gateway with `npm run wallet:deposit -- 1`. Add the `HEDERA_*` values to accept Hedera too.

## Limits that are not configurable

These are constants in code, not settings.

| Limit | Value | Where |
| --- | --- | --- |
| Purchases per agent run | 3 | `agent/session.ts` |
| Data passed to the model | 20,000 characters | `agent/session.ts` |
| Duplicate window | 60 s | `store/windows.ts` |
| Unsigned hold lifetime | 5 min | `store/windows.ts` |
| Approval lifetime | 10 min | `store/windows.ts` |
| Third-party fetch | 20 s timeout, 1 MB, no redirects | `http/guard.ts` |
| Agent runs | 10 / min / user | `api/agent/run` |
| Signed-in routes | 120 / min / user / route | `http/api.ts` |
| Seller route | 120 / min / IP | `api/x402/[serviceId]` |
| Wallet sign-in | 30 nonces and 20 sign-in attempts per IP, per 10 min | `api/auth/*` |
| Sign-in message lifetime | 10 min | `server/auth.ts` |
| Session lifetime | 7 days | `server/auth.ts` |
