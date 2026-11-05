import 'server-only';
import { GatewayClient, type SupportedChainName } from '@circle-fin/x402-batching/client';
import { agentEvmKey } from './keys';

/** Read-only Gateway lookup. GatewayClient requires a key even for reads. */
export function lookupGatewayTransfer(chain: SupportedChainName, rpcUrl: string, id: string) {
  return new GatewayClient({ chain, privateKey: agentEvmKey(), rpcUrl }).getTransferById(id);
}
