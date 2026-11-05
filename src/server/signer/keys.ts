import 'server-only';

/**
 * The only module that reads buyer signing keys. Import it only from the rest
 * of `src/server/signer`. Keys never reach a prompt, a tool result, a log or a
 * client bundle.
 */
export function agentEvmKey(): `0x${string}` {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error('AGENT_PRIVATE_KEY is not set.');
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
}

export function agentHederaCredentials() {
  const accountId = process.env.HEDERA_AGENT_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_AGENT_PRIVATE_KEY;
  if (!accountId || !privateKey) throw new Error('HEDERA_AGENT_ACCOUNT_ID and HEDERA_AGENT_PRIVATE_KEY are not set.');
  return { accountId, privateKey };
}
