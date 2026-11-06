import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { SUBDOMAIN_CONTRACT_ADDRESS, SUBDOMAIN_ABI } from './contract';

const RPC_URL = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';

export async function resolvePayGateId(id: string): Promise<`0x${string}` | null> {
  // Check if it's a PayGate ID (e.g. rahul.paygate.eth)
  if (!id.endsWith('.paygate.eth')) {
    // If it looks like a wallet address already, just return it
    if (id.startsWith('0x') && id.length === 42) {
      return id as `0x${string}`;
    }
    return null;
  }

  const label = id.replace('.paygate.eth', '').toLowerCase();
  
  try {
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(RPC_URL),
    });

    const wallet = await publicClient.readContract({
      address: SUBDOMAIN_CONTRACT_ADDRESS,
      abi: SUBDOMAIN_ABI,
      functionName: 'getWallet',
      args: [label],
    });

    if (wallet === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    return wallet as `0x${string}`;
  } catch (error) {
    console.error('Error resolving PayGate ID:', error);
    return null;
  }
}
