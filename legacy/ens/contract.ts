// PayGate ID subdomain contract on Ethereum Sepolia.
export const SUBDOMAIN_CONTRACT_ADDRESS = (
  process.env.PAYGATE_SUBDOMAIN_CONTRACT || '0xf7f47FE64c7cbc99deDD53F31e1E9E189e1ee3BE'
) as `0x${string}`

export const SUBDOMAIN_ABI = [
  {
    name: 'createSubdomain',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'getWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getSubdomain',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const
