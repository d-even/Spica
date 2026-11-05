import 'server-only';
import type { SchemeNetworkClient } from '@x402/core/types';
import { BatchEvmScheme, CompositeEvmScheme } from '@circle-fin/x402-batching/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from 'paygate-x402';
import { networkByCaip2 } from '@/lib/networks';
import { demoSignature } from '@/server/payments/demo';
import type { SpendStore } from '@/server/store/types';
import { requirementHash } from './hash';
import { agentEvmKey, agentHederaCredentials } from './keys';

export { requirementHash };

async function schemeFor(requirement: PaymentRequirements): Promise<SchemeNetworkClient> {
  const network = networkByCaip2(requirement.network);
  if (network?.family === 'arc') {
    const account = privateKeyToAccount(agentEvmKey());
    return new CompositeEvmScheme(new BatchEvmScheme(account), new ExactEvmScheme(account)) as unknown as SchemeNetworkClient;
  }
  if (network?.family === 'hedera') {
    const { PrivateKey, createClientHederaSigner, ExactHederaScheme } = await import('@x402/hedera');
    const { accountId, privateKey } = agentHederaCredentials();
    const key = /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey) ? PrivateKey.fromStringECDSA(privateKey) : PrivateKey.fromString(privateKey);
    return new ExactHederaScheme(createClientHederaSigner(accountId, key, { network: network.caip2 }));
  }
  throw new Error(`No signing scheme for ${requirement.network}`);
}

/**
 * The single signing entry point. It signs only after atomically moving a live
 * reservation from held to signing for this exact requirement, so a payment
 * cannot be signed without the firewall's prior approval, or signed twice.
 */
export async function signPayment(
  store: SpendStore,
  input: { reservationId: string; paymentRequired: PaymentRequired; requirement: PaymentRequirements; resource: string },
): Promise<PaymentPayload> {
  const { reservationId, paymentRequired, requirement, resource } = input;
  const authorized = await store.beginSigning(reservationId, requirementHash(requirement, resource));
  if (!authorized) throw new Error('Signing refused: no matching live reservation.');

  if (networkByCaip2(requirement.network)?.family === 'demo') {
    return {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: requirement,
      payload: { signature: demoSignature(requirement), nonce: reservationId },
    };
  }

  // The scheme is called directly rather than through x402Client, whose built-in
  // spend controls reject Arc USDC as a non-default asset. The firewall is the
  // spend control here, and it has already decided by this point.
  const scheme = await schemeFor(requirement);
  const signed = await scheme.createPaymentPayload(paymentRequired.x402Version, requirement);
  return { ...signed, resource: paymentRequired.resource, accepted: requirement };
}
