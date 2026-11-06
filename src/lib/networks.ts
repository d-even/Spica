/**
 * Payment network registry. Safe for client bundles: public facts only.
 *
 * Sources:
 *   Arc RPC, chain IDs, USDC, GatewayWallet: docs.arc.io/arc/references/
 *   Hedera CAIP-2 IDs and USDC token IDs: docs.hedera.com/solutions/ai/x402 and
 *   the DEFAULT_ASSETS table shipped in @x402/hedera.
 */
export type NetworkId = 'arc-testnet' | 'hedera-testnet' | 'demo';

export interface NetworkInfo {
  id: NetworkId;
  label: string;
  caip2: string;
  family: 'arc' | 'hedera' | 'demo';
  tokenSymbol: 'USDC';
  tokenAsset: string;
  tokenDecimals: 6;
  explorerTx?: (reference: string) => string;
}

const USDC_ARC = '0x3600000000000000000000000000000000000000';

/** HashScan opens `0.0.1-2-3`. Hedera SDKs print the same ID as `0.0.1@2.3`. */
export const hashscanTransaction = (id: string) =>
  `https://hashscan.io/testnet/transaction/${id.replace('@', '-').replace(/\.(\d+)$/, '-$1')}`;

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
  'arc-testnet': {
    id: 'arc-testnet',
    label: 'Arc Testnet',
    caip2: 'eip155:5042002',
    family: 'arc',
    tokenSymbol: 'USDC',
    tokenAsset: USDC_ARC,
    tokenDecimals: 6,
    explorerTx: (hash) => `https://explorer.testnet.arc.io/tx/${hash}`,
  },
  'hedera-testnet': {
    id: 'hedera-testnet',
    label: 'Hedera testnet',
    caip2: 'hedera:testnet',
    family: 'hedera',
    tokenSymbol: 'USDC',
    tokenAsset: '0.0.429274',
    tokenDecimals: 6,
    explorerTx: (id) => hashscanTransaction(id),
  },
  demo: {
    id: 'demo',
    label: 'Demo (simulated)',
    caip2: 'paygate:demo',
    family: 'demo',
    tokenSymbol: 'USDC',
    tokenAsset: 'DEMO-USDC',
    tokenDecimals: 6,
  },
};

export const SELECTABLE_NETWORKS: NetworkId[] = ['arc-testnet', 'hedera-testnet'];

export function networkByCaip2(caip2: string): NetworkInfo | undefined {
  return Object.values(NETWORKS).find((network) => network.caip2 === caip2);
}
