import 'server-only';
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';
import { CIRCLE_BATCHING_NAME, CIRCLE_BATCHING_VERSION } from '@circle-fin/x402-batching';
import { createPublicClient, http, parseAbiItem, parseEventLogs } from 'viem';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from 'paygate-x402';
import { NETWORKS } from '@/lib/networks';
import { lookupGatewayTransfer } from '@/server/signer/gateway';
import type { Confirmation, PaymentAdapter } from './types';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/** Gateway authorizations must stay valid for 7 days. The buffer matches GatewayEvmScheme. */
const GATEWAY_MAX_TIMEOUT_SECONDS = 604_900;

const CONFIG = {
  'arc-testnet': {
    chain: 'arcTestnet',
    gatewayUrl: () => process.env.ARC_TESTNET_GATEWAY_URL ?? 'https://gateway-api-testnet.circle.com',
    rpcUrl: () => process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io',
  },
} as const;

export class ArcPaymentAdapter implements PaymentAdapter {
  readonly info;
  readonly network;
  private facilitator: BatchFacilitatorClient;
  private config;

  constructor(readonly id: 'arc-testnet') {
    this.info = NETWORKS[id];
    this.network = this.info.caip2;
    this.config = CONFIG[id];
    this.facilitator = new BatchFacilitatorClient({ url: this.config.gatewayUrl() });
  }

  async buildRequirement({ amountAtomic, payTo }: { amountAtomic: string; payTo: string }): Promise<PaymentRequirements> {
    const chain = CHAIN_CONFIGS[this.config.chain];
    return {
      scheme: 'exact',
      network: this.network as PaymentRequirements['network'],
      asset: this.info.tokenAsset,
      amount: amountAtomic,
      payTo,
      maxTimeoutSeconds: GATEWAY_MAX_TIMEOUT_SECONDS,
      extra: { name: CIRCLE_BATCHING_NAME, version: CIRCLE_BATCHING_VERSION, verifyingContract: chain.gatewayWallet },
    };
  }

  verify(payload: PaymentPayload, requirement: PaymentRequirements) {
    return this.facilitator.verify(payload as never, requirement as never);
  }

  settle(payload: PaymentPayload, requirement: PaymentRequirements) {
    return this.facilitator.settle(payload as never, requirement as never) as Promise<SettleResponse>;
  }

  async confirm({ settlement, requirement }: { settlement: SettleResponse; requirement: PaymentRequirements }): Promise<Confirmation> {
    const reference = settlement.transaction;
    const payer = settlement.payer ?? null;
    if (!reference) return { status: 'unverified', reference: null, payer, detail: 'The seller returned no payment reference.' };
    return /^0x[0-9a-fA-F]{64}$/.test(reference)
      ? this.confirmOnchain(reference as `0x${string}`, requirement, payer)
      : this.confirmGateway(reference, requirement, payer);
  }

  /** Vanilla x402: the reference is a transaction hash, so read the ledger directly. */
  private async confirmOnchain(hash: `0x${string}`, requirement: PaymentRequirements, payer: string | null): Promise<Confirmation> {
    const client = createPublicClient({ transport: http(this.config.rpcUrl()) });
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      if (receipt.status !== 'success') return { status: 'failed', reference: hash, payer, detail: 'The transaction reverted.' };
      const paid = parseEventLogs({ abi: [TRANSFER], logs: receipt.logs }).some(
        (log) =>
          log.address.toLowerCase() === requirement.asset.toLowerCase() &&
          log.args.to.toLowerCase() === requirement.payTo.toLowerCase() &&
          log.args.value >= BigInt(requirement.amount),
      );
      return paid
        ? { status: 'verified', reference: hash, payer, detail: 'USDC transfer confirmed in the transaction receipt.' }
        : { status: 'unverified', reference: hash, payer, detail: 'The transaction has no matching USDC transfer.' };
    } catch (error) {
      return { status: 'unverified', reference: hash, payer, detail: `Could not read the receipt: ${(error as Error).message}` };
    }
  }

  /** Nanopayments: the reference is a Gateway transfer ID, confirmed with Circle rather than the seller. */
  private async confirmGateway(id: string, requirement: PaymentRequirements, payer: string | null): Promise<Confirmation> {
    try {
      const transfer = await lookupGatewayTransfer(this.config.chain, this.config.rpcUrl(), id);
      const matches =
        transfer.toAddress.toLowerCase() === requirement.payTo.toLowerCase() &&
        BigInt(transfer.amount) === BigInt(requirement.amount);
      if (!matches) {
        return { status: 'unverified', reference: id, payer, detail: 'The Gateway transfer does not match the quoted payment.' };
      }
      if (transfer.status === 'failed') return { status: 'failed', reference: id, payer, detail: 'Gateway reports this transfer failed.' };
      const onchain = typeof transfer.txHash === 'string' ? transfer.txHash : id;
      return transfer.status === 'confirmed' || transfer.status === 'completed'
        ? { status: 'verified', reference: onchain, payer: transfer.fromAddress, detail: 'Settled onchain by Circle Gateway.' }
        : {
            status: 'settling',
            reference: id,
            payer: transfer.fromAddress,
            detail: `Accepted by Circle Gateway, batch settlement pending (${transfer.status}).`,
          };
    } catch (error) {
      return { status: 'unverified', reference: id, payer, detail: `Could not reach Circle Gateway: ${(error as Error).message}` };
    }
  }
}
