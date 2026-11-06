import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { SUBDOMAIN_CONTRACT_ADDRESS, SUBDOMAIN_ABI } from '../src/lib/contract';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const RPC_URL = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';

async function test() {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const wallet = process.argv[2] as `0x${string}`;
  if (!wallet) {
    console.error('Please provide a wallet address');
    return;
  }

  console.log(`Checking subdomain for ${wallet}...`);
  console.log(`Contract: ${SUBDOMAIN_CONTRACT_ADDRESS}`);
  console.log(`RPC: ${RPC_URL}`);

  try {
    const subdomain = await publicClient.readContract({
      address: SUBDOMAIN_CONTRACT_ADDRESS as `0x${string}`,
      abi: SUBDOMAIN_ABI,
      functionName: 'getSubdomain',
      args: [wallet],
    });

    console.log(`Result: "${subdomain}"`);
    if (subdomain) {
      console.log(`Found: ${subdomain}.paygate.eth`);
    } else {
      console.log('No subdomain found.');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
