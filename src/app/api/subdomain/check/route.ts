import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { SUBDOMAIN_CONTRACT_ADDRESS, SUBDOMAIN_ABI } from '@/lib/contract';

const RPC_URL = process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const label = searchParams.get('label');

  if (!label || label.length < 3) {
    return NextResponse.json({ available: false, error: 'Label too short' });
  }

  // Validation: Only lowercase letters and numbers
  if (!/^[a-z0-9]+$/.test(label)) {
    return NextResponse.json({ available: false, error: 'Invalid characters' });
  }

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

    const isAvailable = wallet === '0x0000000000000000000000000000000000000000';

    return NextResponse.json({ 
      available: isAvailable,
      address: isAvailable ? null : wallet
    });
  } catch (error) {
    console.error('Error checking subdomain availability:', error);
    return NextResponse.json({ available: false, error: 'Contract call failed' });
  }
}
