import 'server-only';
import type { NetworkId } from '@/lib/networks';
import { mode } from '@/server/env';
import { ArcPaymentAdapter } from './arc';
import { DemoPaymentAdapter } from './demo';
import { HederaPaymentAdapter } from './hedera';
import type { PaymentAdapter } from './types';

const cache = new Map<NetworkId, PaymentAdapter>();

const build: Record<NetworkId, () => PaymentAdapter> = {
  'arc-testnet': () => new ArcPaymentAdapter('arc-testnet'),
  'arc-mainnet': () => new ArcPaymentAdapter('arc-mainnet'),
  'hedera-testnet': () => new HederaPaymentAdapter('hedera-testnet'),
  'hedera-mainnet': () => new HederaPaymentAdapter('hedera-mainnet'),
  demo: () => new DemoPaymentAdapter(),
};

export function getAdapter(id: NetworkId): PaymentAdapter {
  if (id === 'demo' && mode() === 'live') throw new Error('The demo rail is not available in live mode.');
  let adapter = cache.get(id);
  if (!adapter) {
    adapter = build[id]();
    cache.set(id, adapter);
  }
  return adapter;
}
