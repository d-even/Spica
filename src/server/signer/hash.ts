import { createHash } from 'node:crypto';
import type { PaymentRequirements } from 'paygate-x402';

/** Fingerprint of what will be signed. Reservations and approvals bind to this. */
export function requirementHash(requirement: PaymentRequirements, resource: string) {
  const { scheme, network, asset, amount, payTo } = requirement;
  return createHash('sha256')
    .update(JSON.stringify({ scheme, network, asset: asset.toLowerCase(), amount, payTo: payTo.toLowerCase(), resource }))
    .digest('hex');
}
