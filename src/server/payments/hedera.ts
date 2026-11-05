import 'server-only';
import { HTTPFacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from 'paygate-x402';
import { NETWORKS } from '@/lib/networks';
import type { Confirmation, PaymentAdapter } from './types';

const MIRROR_NODES = {
  'hedera-testnet': 'https://testnet.mirrornode.hedera.com',
  'hedera-mainnet': 'https://mainnet-public.mirrornode.hedera.com',
} as const;

const MAX_TIMEOUT_SECONDS = 180;
const MIRROR_ATTEMPTS = 5;
const MIRROR_DELAY_MS = 1_500;

/** `0.0.123@1700000000.000000000` becomes the mirror node's `0.0.123-1700000000-000000000`. */
export const toMirrorTransactionId = (id: string) => id.replace('@', '-').replace(/\.(\d+)$/, '-$1');

interface MirrorTransaction {
  result: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
}

export class HederaPaymentAdapter implements PaymentAdapter {
  readonly info;
  readonly network;
  private feePayer?: string;

  constructor(readonly id: 'hedera-testnet' | 'hedera-mainnet') {
    this.info = NETWORKS[id];
    this.network = this.info.caip2;
  }

  private facilitator() {
    const url = process.env.HEDERA_FACILITATOR_URL;
    if (!url) throw new Error('HEDERA_FACILITATOR_URL is not set.');
    return new HTTPFacilitatorClient({ url });
  }

  /** The fee payer comes from the facilitator itself, so it is never assumed. */
  private async resolveFeePayer() {
    if (this.feePayer) return this.feePayer;
    const { kinds } = await this.facilitator().getSupported();
    const kind = kinds.find((item) => item.network === this.network && item.scheme === 'exact');
    const feePayer = kind?.extra?.feePayer;
    if (typeof feePayer !== 'string') throw new Error(`The facilitator does not support ${this.network}.`);
    this.feePayer = feePayer;
    return feePayer;
  }

  async buildRequirement({ amountAtomic, payTo }: { amountAtomic: string; payTo: string }): Promise<PaymentRequirements> {
    return {
      scheme: 'exact',
      network: this.network as PaymentRequirements['network'],
      asset: this.info.tokenAsset,
      amount: amountAtomic,
      payTo,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      extra: { feePayer: await this.resolveFeePayer() },
    };
  }

  verify(payload: PaymentPayload, requirement: PaymentRequirements) {
    return this.facilitator().verify(payload, requirement);
  }

  settle(payload: PaymentPayload, requirement: PaymentRequirements) {
    return this.facilitator().settle(payload, requirement);
  }

  /** Reads the public mirror node, which reflects consensus, with a short wait for its lag. */
  async confirm({ settlement, requirement }: { settlement: SettleResponse; requirement: PaymentRequirements }): Promise<Confirmation> {
    const reference = settlement.transaction;
    const payer = settlement.payer ?? null;
    if (!reference) return { status: 'unverified', reference: null, payer, detail: 'The seller returned no transaction ID.' };

    const url = `${MIRROR_NODES[this.id]}/api/v1/transactions/${toMirrorTransactionId(reference)}`;
    for (let attempt = 0; attempt < MIRROR_ATTEMPTS; attempt++) {
      const response = await fetch(url).catch(() => null);
      if (response?.ok) {
        const { transactions } = (await response.json()) as { transactions: MirrorTransaction[] };
        const transaction = transactions[0];
        if (transaction?.result !== 'SUCCESS') {
          return { status: 'failed', reference, payer, detail: `Hedera result: ${transaction?.result ?? 'unknown'}.` };
        }
        const credited = transaction.token_transfers?.some(
          (transfer) =>
            transfer.token_id === requirement.asset &&
            transfer.account === requirement.payTo &&
            BigInt(transfer.amount) >= BigInt(requirement.amount),
        );
        return credited
          ? { status: 'verified', reference, payer, detail: 'Consensus confirmed through the Hedera mirror node.' }
          : { status: 'unverified', reference, payer, detail: 'The transaction has no matching USDC credit.' };
      }
      await new Promise((resolve) => setTimeout(resolve, MIRROR_DELAY_MS));
    }
    return { status: 'unverified', reference, payer, detail: 'The mirror node has not indexed this transaction yet.' };
  }
}
