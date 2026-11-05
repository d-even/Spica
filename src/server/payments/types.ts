import type { SellerAdapter, SettleResponse, PaymentRequirements } from 'paygate-x402';
import type { NetworkId, NetworkInfo } from '@/lib/networks';
import type { VerificationStatus } from '@/server/store/types';

export interface Confirmation {
  status: VerificationStatus;
  reference: string | null;
  payer: string | null;
  detail: string;
}

/**
 * Everything specific to one payment network. Adapters never hold buyer signing
 * keys: signing goes through `src/server/signer`, behind the firewall.
 */
export interface PaymentAdapter extends SellerAdapter {
  readonly id: NetworkId;
  readonly info: NetworkInfo;
  /** Independently confirms a seller's settlement claim on the buyer's behalf. */
  confirm(input: { settlement: SettleResponse; requirement: PaymentRequirements }): Promise<Confirmation>;
}
