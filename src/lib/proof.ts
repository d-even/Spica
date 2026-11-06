import { NETWORKS, hashscanTransaction, type NetworkId } from './networks';

/** A public link anyone can open to check a payment. Safe for client bundles. */
export interface ProofLink {
  label: string;
  url: string;
}

export interface PaymentProof {
  settlement: ProofLink | null;
  audit: ProofLink[];
  /** Settled, but the audit message recording it is still being published. */
  auditPending: boolean;
}

const EXPLORER: Partial<Record<NetworkId, string>> = {
  'arc-testnet': 'Arc Explorer',
  'arc-mainnet': 'Arc Explorer',
  'hedera-testnet': 'HashScan',
  'hedera-mainnet': 'HashScan',
};

/** Null until the payment is final. While settling, the reference is a Gateway ID no explorer knows. */
export function settlementProof(transaction: { network: NetworkId; status: string; reference: string | null }): ProofLink | null {
  const label = EXPLORER[transaction.network];
  if (!label || !transaction.reference || transaction.status !== 'verified') return null;
  const url = NETWORKS[transaction.network].explorerTx?.(transaction.reference);
  return url ? { label: `Settlement on ${label}`, url } : null;
}

/** A Hedera Consensus Service message that records this payment. */
export const auditProof = (status: string, sequence: string, transactionId: string, mainnet = false): ProofLink => ({
  label: `Audit #${sequence} on HashScan (${status})`,
  url: hashscanTransaction(transactionId, mainnet),
});
