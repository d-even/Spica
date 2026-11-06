/**
 * Read-only checks against real networks. Uses a throwaway key with no funds,
 * so it cannot spend anything. Run: npm run test:live
 */
import { CHAIN_CONFIGS, BatchEvmScheme } from '@circle-fin/x402-batching/client';
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import { createPublicClient, http, erc20Abi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const results: boolean[] = [];

async function check(name: string, run: () => Promise<string>) {
  try {
    console.log(`PASS  ${name}  (${await run()})`);
    results.push(true);
  } catch (error) {
    console.log(`FAIL  ${name}  (${(error as Error).message})`);
    results.push(false);
  }
}

const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const ARC_NETWORK = 'eip155:5042002';
const GATEWAY_URL = 'https://gateway-api-testnet.circle.com';
const arc = createPublicClient({ transport: http('https://rpc.testnet.arc.io') });
const gateway = new BatchFacilitatorClient({ url: GATEWAY_URL });

await check('Arc testnet RPC reports chain 5042002', async () => {
  const id = await arc.getChainId();
  expect(id === 5042002, `chain ${id}`);
  return `block ${await arc.getBlockNumber()}`;
});

await check('Arc USDC ERC-20 interface has 6 decimals', async () => {
  const usdc = CHAIN_CONFIGS.arcTestnet.tokens.USDC!.address;
  const decimals = await arc.readContract({ address: usdc, abi: erc20Abi, functionName: 'decimals' });
  expect(decimals === 6, `${decimals} decimals`);
  return usdc;
});

await check('Circle Gateway supports Arc testnet', async () => {
  const { kinds } = await gateway.getSupported();
  const kind = kinds.find((item) => item.network === ARC_NETWORK);
  expect(Boolean(kind), 'not listed');
  return String(kind?.extra?.verifyingContract);
});

/** A real signed payment from a new, empty wallet. */
async function unfundedPayment() {
  const account = privateKeyToAccount(generatePrivateKey());
  const requirement = {
    scheme: 'exact',
    network: ARC_NETWORK,
    asset: CHAIN_CONFIGS.arcTestnet.tokens.USDC!.address,
    amount: '20000',
    payTo: privateKeyToAccount(generatePrivateKey()).address,
    maxTimeoutSeconds: 604_900,
    extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: CHAIN_CONFIGS.arcTestnet.gatewayWallet },
  };
  const signed = await new BatchEvmScheme(account).createPaymentPayload(2, requirement as never);
  const resource = { url: 'https://paygate.test/x', description: 'check', mimeType: 'application/json' };
  return { requirement, payload: { ...signed, accepted: requirement, resource } };
}

await check('Circle Gateway accepts the format of a PayGate payment at verify', async () => {
  const { requirement, payload } = await unfundedPayment();
  const result = await gateway.verify(payload as never, requirement as never);
  expect(result.isValid, String(result.invalidReason));
  return `valid signature from ${result.payer}`;
});

// Verify checks the signature only. Balance is enforced at settle, which is why
// the middleware releases data after settle and never after verify.
await check('Circle Gateway refuses to settle an unfunded payment', async () => {
  const { requirement, payload } = await unfundedPayment();
  const result = await gateway.settle(payload as never, requirement as never);
  expect(!result.success, 'an unfunded payment settled');
  return String(result.errorReason);
});

await check('Circle Gateway refuses a tampered signature', async () => {
  const { requirement, payload } = await unfundedPayment();
  const inner = payload.payload as { signature: string };
  const flipped = inner.signature.slice(-2) === '00' ? '11' : '00';
  const tampered = { ...payload, payload: { ...inner, signature: `${inner.signature.slice(0, -2)}${flipped}` } };
  const result = await gateway.verify(tampered as never, requirement as never);
  expect(!result.isValid, 'a tampered payment was accepted');
  return String(result.invalidReason);
});

await check('Hedera facilitator supports hedera:testnet', async () => {
  const url = process.env.HEDERA_FACILITATOR_URL ?? 'https://api.testnet.blocky402.com';
  const { kinds } = (await (await fetch(`${url}/supported`)).json()) as { kinds: { network: string; extra?: { feePayer?: string } }[] };
  const kind = kinds.find((item) => item.network === 'hedera:testnet');
  expect(Boolean(kind?.extra?.feePayer), 'no fee payer');
  return `fee payer ${kind?.extra?.feePayer}`;
});

await check('Hedera testnet USDC token exists on the mirror node', async () => {
  const token = (await (await fetch('https://testnet.mirrornode.hedera.com/api/v1/tokens/0.0.429274')).json()) as { symbol: string; decimals: string };
  expect(token.decimals === '6', `decimals ${token.decimals}`);
  return token.symbol;
});

await check('Circle discovery lists Arc testnet services', async () => {
  const body = (await (await fetch('https://api.circle.com/v2/x402/discovery/resources?network=eip155:5042002&limit=1')).json()) as { pagination: { total: number } };
  expect(body.pagination.total > 0, 'empty');
  return `${body.pagination.total} services`;
});

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed` : '\nAll live checks passed');
process.exit(failed ? 1 : 0);
