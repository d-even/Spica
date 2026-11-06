import 'server-only';
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { SUBDOMAIN_CONTRACT_ADDRESS, SUBDOMAIN_ABI } from './contract';

const RPC_URL = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
// The registrar key is separate from the agent payment key.
const rawKey = process.env.ADMIN_PRIVATE_KEY;
const ADMIN_KEY = (rawKey && !rawKey.startsWith('0x') ? `0x${rawKey}` : rawKey) as `0x${string}`;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});

export async function createENSSubdomain(label: string, wallet: `0x${string}`) {
  if (!ADMIN_KEY) {
    console.error('No admin private key found for ENS subdomain creation');
    return null;
  }

  try {
    const account = privateKeyToAccount(ADMIN_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(RPC_URL),
    });

    // Check if label already exists
    const existingWallet = await publicClient.readContract({
      address: SUBDOMAIN_CONTRACT_ADDRESS,
      abi: SUBDOMAIN_ABI,
      functionName: 'getWallet',
      args: [label],
    });

    if (existingWallet !== '0x0000000000000000000000000000000000000000') {
      return existingWallet.toLowerCase() === wallet.toLowerCase() ? `${label}.paygate.eth` : null;
    }

    const { request } = await publicClient.simulateContract({
      account,
      address: SUBDOMAIN_CONTRACT_ADDRESS,
      abi: SUBDOMAIN_ABI,
      functionName: 'createSubdomain',
      args: [label, wallet],
    });

    const hash = await walletClient.writeContract(request);

    // We don't necessarily need to wait for confirmation for the API to return,
    // but the user might expect it. Let's wait a bit.
    await publicClient.waitForTransactionReceipt({ hash });

    return `${label}.paygate.eth`;
  } catch (error) {
    console.error('Error creating ENS subdomain:', error);
    return null;
  }
}

export async function getSubdomainForWallet(wallet: `0x${string}`) {
  try {
    const subdomain = await publicClient.readContract({
      address: SUBDOMAIN_CONTRACT_ADDRESS,
      abi: SUBDOMAIN_ABI,
      functionName: 'getSubdomain',
      args: [wallet],
    });

    if (!subdomain || subdomain === "") return null;
    return `${subdomain}.paygate.eth`;
  } catch (error) {
    console.error('Error fetching ENS subdomain:', error);
    return null;
  }
}
