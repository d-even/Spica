/**
 * Manages the agent's Circle Gateway balance on Arc testnet.
 *   npm run wallet:status
 *   npm run wallet:deposit -- 1
 * A deposit is a real onchain testnet transaction.
 */
import { config } from 'dotenv';
import { GatewayClient } from '@circle-fin/x402-batching/client';

config({ path: '.env.local' });

const key = process.env.AGENT_PRIVATE_KEY;
if (!key) {
  console.error('Set AGENT_PRIVATE_KEY in .env.local first.');
  process.exit(1);
}

const client = new GatewayClient({
  chain: 'arcTestnet',
  privateKey: (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`,
  rpcUrl: process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io',
});

const [command, amount] = process.argv.slice(2);

if (command === 'deposit') {
  if (!amount || !/^\d+(\.\d+)?$/.test(amount)) {
    console.error('Usage: npm run wallet:deposit -- <USDC amount>');
    process.exit(1);
  }
  const result = await client.deposit(amount);
  console.log(`Deposited ${result.formattedAmount} USDC: ${result.depositTxHash}`);
}

const balances = await client.getBalances();
console.log(`Address: ${client.address}`);
console.log(`Wallet USDC: ${balances.wallet.formatted}`);
console.log(`Gateway available: ${balances.gateway.formattedAvailable}`);
