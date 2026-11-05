import 'server-only';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from 'paygate-x402';
import { NETWORKS } from '@/lib/networks';
import type { Confirmation, PaymentAdapter } from './types';

/**
 * Runs the real HTTP 402 handshake with a simulated rail, so the firewall can
 * be demonstrated without funds. It moves no money and every record it produces
 * is `simulated`. The registry refuses it in live mode.
 */
const globals = globalThis as typeof globalThis & { paygateDemoSecret?: Buffer };
const secret = () => (globals.paygateDemoSecret ??= randomBytes(32));

export const DEMO_PAYER = 'demo-agent-wallet';

export function demoSignature(requirement: PaymentRequirements) {
  const message = [requirement.scheme, requirement.network, requirement.asset, requirement.amount, requirement.payTo].join('|');
  return createHmac('sha256', secret()).update(message).digest('hex');
}

export class DemoPaymentAdapter implements PaymentAdapter {
  readonly id = 'demo' as const;
  readonly info = NETWORKS.demo;
  readonly network = NETWORKS.demo.caip2;

  async buildRequirement({ amountAtomic, payTo }: { amountAtomic: string; payTo: string }): Promise<PaymentRequirements> {
    return {
      scheme: 'exact',
      network: this.network as PaymentRequirements['network'],
      asset: this.info.tokenAsset,
      amount: amountAtomic,
      payTo,
      maxTimeoutSeconds: 60,
      extra: { simulated: true },
    };
  }

  async verify(payload: PaymentPayload, requirement: PaymentRequirements) {
    const provided = Buffer.from(String(payload.payload.signature ?? ''));
    const expected = Buffer.from(demoSignature(requirement));
    const isValid = provided.length === expected.length && timingSafeEqual(provided, expected);
    return isValid ? { isValid, payer: DEMO_PAYER } : { isValid, invalidReason: 'invalid_demo_signature' };
  }

  async settle(): Promise<SettleResponse> {
    return {
      success: true,
      transaction: `simulated_${randomUUID()}`,
      network: this.network as SettleResponse['network'],
      payer: DEMO_PAYER,
    };
  }

  async confirm({ settlement }: { settlement: SettleResponse }): Promise<Confirmation> {
    return { status: 'simulated', reference: settlement.transaction, payer: DEMO_PAYER, detail: 'Demo mode: no money moved.' };
  }
}
