/**
 * Spending Firewall policy engine.
 *
 * A pure function: same inputs, same decision. No I/O and no model involvement,
 * so it is fully testable. `SpendStore.reserve` repeats the budget checks inside
 * an atomic section because this evaluation alone cannot stop two concurrent
 * requests from both passing.
 */
import { NETWORKS, type NetworkId } from '@/lib/networks';
import { formatUsd } from '@/lib/money';

export interface SpendingPolicy {
  userId: string;
  perRequestLimitMicros: bigint;
  dailyLimitMicros: bigint;
  monthlyLimitMicros: bigint;
  /** Payments above this need a person. Must be <= the per-request limit to matter. */
  approvalThresholdMicros: bigint;
  /** When false, every payment needs a person. */
  autoPayEnabled: boolean;
  allowedNetworks: NetworkId[];
  /** Provider keys. An empty allowlist means any provider that is not blocked. */
  allowedProviders: string[];
  blockedProviders: string[];
}

export const DEFAULT_POLICY: Omit<SpendingPolicy, 'userId'> = {
  perRequestLimitMicros: 500_000n,
  dailyLimitMicros: 1_000_000n,
  monthlyLimitMicros: 10_000_000n,
  approvalThresholdMicros: 200_000n,
  autoPayEnabled: true,
  allowedNetworks: ['arc-testnet', 'hedera-testnet'],
  allowedProviders: [],
  blockedProviders: [],
};

export interface PaymentRequest {
  amountMicros: bigint;
  /** Asset the seller quoted. Must be the network's USD stablecoin. */
  asset: string;
  network: NetworkId;
  providerKey: string;
  /** Price seen at discovery. A higher quote at payment time is refused. */
  listedAmountMicros?: bigint;
  /** Budget the person stated for this task, if any. */
  taskBudgetMicros?: bigint;
  /** Result of comparing a claimed ENS name with the payment address. */
  identityStatus?: 'match' | 'mismatch' | 'none';
}

export interface SpendState {
  spentTodayMicros: bigint;
  spentThisMonthMicros: bigint;
  spentThisTaskMicros: bigint;
}

export type DenyCode =
  | 'invalid_amount'
  | 'unsupported_asset'
  | 'network_not_allowed'
  | 'mainnet_disabled'
  | 'provider_blocked'
  | 'provider_not_allowlisted'
  | 'identity_mismatch'
  | 'price_changed'
  | 'per_request_limit'
  | 'task_budget'
  | 'daily_limit'
  | 'monthly_limit';

export type PolicyDecision =
  | { outcome: 'allow'; reason: string }
  | { outcome: 'needs_approval'; reason: string }
  | { outcome: 'deny'; code: DenyCode; reason: string };

export interface EvaluateOptions {
  mainnetEnabled: boolean;
  /** A person approved this exact quote. Waives approval only, never a hard limit. */
  humanApproved?: boolean;
}

const deny = (code: DenyCode, reason: string): PolicyDecision => ({ outcome: 'deny', code, reason });

export function evaluatePolicy(
  policy: SpendingPolicy,
  request: PaymentRequest,
  spend: SpendState,
  options: EvaluateOptions,
): PolicyDecision {
  const { amountMicros: amount, network: networkId, providerKey } = request;
  const network = NETWORKS[networkId];

  if (amount <= 0n) return deny('invalid_amount', 'The quoted amount is not a positive value.');
  if (!network || request.asset.toLowerCase() !== network.tokenAsset.toLowerCase()) {
    return deny('unsupported_asset', 'Only USDC on the selected network can be paid.');
  }
  if (network.mainnet && !options.mainnetEnabled) {
    return deny('mainnet_disabled', `${network.label} moves real money and is disabled on this server.`);
  }
  if (networkId !== 'demo' && !policy.allowedNetworks.includes(networkId)) {
    return deny('network_not_allowed', `${network.label} is not an allowed network.`);
  }
  if (policy.blockedProviders.includes(providerKey)) {
    return deny('provider_blocked', 'This provider is on your blocklist.');
  }
  if (policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(providerKey)) {
    return deny('provider_not_allowlisted', 'This provider is not on your allowlist.');
  }
  if (request.identityStatus === 'mismatch') {
    return deny('identity_mismatch', "The provider's ENS name does not resolve to the payment address.");
  }
  if (request.listedAmountMicros !== undefined && amount > request.listedAmountMicros) {
    return deny(
      'price_changed',
      `The provider asked for ${formatUsd(amount)}, above its listed ${formatUsd(request.listedAmountMicros)}.`,
    );
  }
  if (amount > policy.perRequestLimitMicros) {
    return deny(
      'per_request_limit',
      `${formatUsd(amount)} is above your ${formatUsd(policy.perRequestLimitMicros)} per-request limit.`,
    );
  }
  if (
    request.taskBudgetMicros !== undefined &&
    spend.spentThisTaskMicros + amount > request.taskBudgetMicros
  ) {
    return deny(
      'task_budget',
      `${formatUsd(amount)} would exceed this task's ${formatUsd(request.taskBudgetMicros)} budget.`,
    );
  }
  if (spend.spentTodayMicros + amount > policy.dailyLimitMicros) {
    return deny('daily_limit', `This would exceed your ${formatUsd(policy.dailyLimitMicros)} daily limit.`);
  }
  if (spend.spentThisMonthMicros + amount > policy.monthlyLimitMicros) {
    return deny('monthly_limit', `This would exceed your ${formatUsd(policy.monthlyLimitMicros)} monthly limit.`);
  }

  if (!options.humanApproved) {
    if (!policy.autoPayEnabled) {
      return { outcome: 'needs_approval', reason: 'Automatic payments are off, so this needs your approval.' };
    }
    if (amount > policy.approvalThresholdMicros) {
      return {
        outcome: 'needs_approval',
        reason: `${formatUsd(amount)} is above your ${formatUsd(policy.approvalThresholdMicros)} approval threshold.`,
      };
    }
  }
  return { outcome: 'allow', reason: 'Within your spending policy.' };
}
