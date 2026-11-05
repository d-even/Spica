import 'server-only';

/** Opaque IDs only. Never keys, emails, prompts or API responses. */
export interface HcsAuditEvent {
  agentId: string;
  providerKey: string;
  amountMicros: string;
  token: string;
  network: string;
  reference: string | null;
  status: string;
  timestamp: string;
}

export const hcsConfigured = () =>
  Boolean(process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY && process.env.HEDERA_HCS_TOPIC_ID);

/**
 * Publishes to Hedera Consensus Service. Optional and best effort: an audit
 * outage must not undo a payment that already happened, so callers record a
 * failure instead of throwing.
 */
export async function publishAuditEvent(event: HcsAuditEvent): Promise<{ topicId: string; sequence: string } | null> {
  if (!hcsConfigured()) return null;
  const { Client, PrivateKey, TopicMessageSubmitTransaction } = await import('@hiero-ledger/sdk');
  const topicId = process.env.HEDERA_HCS_TOPIC_ID!;
  const rawKey = process.env.HEDERA_OPERATOR_KEY!;
  const key = /^(0x)?[0-9a-fA-F]{64}$/.test(rawKey) ? PrivateKey.fromStringECDSA(rawKey) : PrivateKey.fromString(rawKey);
  const client = (process.env.HEDERA_HCS_NETWORK === 'mainnet' ? Client.forMainnet() : Client.forTestnet()).setOperator(
    process.env.HEDERA_OPERATOR_ID!,
    key,
  );
  try {
    const response = await new TopicMessageSubmitTransaction({ topicId, message: JSON.stringify(event) }).execute(client);
    const receipt = await response.getReceipt(client);
    return { topicId, sequence: receipt.topicSequenceNumber?.toString() ?? '' };
  } finally {
    client.close();
  }
}
