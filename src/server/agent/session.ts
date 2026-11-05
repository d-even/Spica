import 'server-only';
import { randomUUID } from 'node:crypto';
import { formatUsd } from '@/lib/money';
import { findServices } from '@/server/discovery/catalog';
import type { CatalogService } from '@/server/discovery/types';
import { purchase, type PurchaseContext, type PurchaseEvent, type PurchaseResult } from '@/server/purchase';
import { computeReputation } from '@/server/reputation';
import type { SpendStore } from '@/server/store/types';

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'budget'; amount: string }
  | { type: 'discovered'; services: ServiceSummary[]; failures: string[] }
  | { type: 'selected'; service: ServiceSummary }
  | { type: 'approval_required'; approvalId: string; service: string; amount: string; reason: string }
  | { type: 'data'; service: string; data: string }
  | { type: 'answer'; text: string; source: 'claude' | 'demo' }
  | { type: 'error'; message: string }
  | PurchaseEvent;

export interface ServiceSummary {
  id: string;
  name: string;
  provider: string;
  price: string | null;
  source: string;
  purchasable: boolean;
}

export const summarize = (service: CatalogService): ServiceSummary => ({
  id: service.id,
  name: service.name,
  provider: service.providerName,
  price: service.listedMicros === null ? null : formatUsd(service.listedMicros),
  source: service.source,
  purchasable: service.purchasable,
});

const MAX_PURCHASES_PER_RUN = 3;
/** Provider text reaches the model only inside this envelope, marked as data. */
const MAX_DATA_FOR_MODEL = 20_000;

export const asUntrustedData = (text: string) =>
  JSON.stringify({ untrusted_third_party_data: text.slice(0, MAX_DATA_FOR_MODEL), truncated: text.length > MAX_DATA_FOR_MODEL });

/**
 * One agent run. The tools the model can call are thin methods on this class.
 * It can only name a service found in this run: URLs, amounts and recipients all
 * come from server-side state and the seller's 402, never from model output.
 */
export class AgentSession {
  readonly taskId = randomUUID();
  private services = new Map<string, CatalogService>();
  private purchases = 0;

  constructor(
    private store: SpendStore,
    private userId: string,
    private agentId: string,
    private taskBudgetMicros: bigint | undefined,
    readonly emit: (event: AgentEvent) => void,
  ) {}

  async discover(input: { query: string; category?: string; max_price_usd?: string }) {
    const maxUsdPrice = input.max_price_usd;
    const { services, failures } = await findServices({ query: input.query, category: input.category, maxUsdPrice });
    for (const service of services) this.services.set(service.id, service);
    const summaries = services.map(summarize);
    this.emit({ type: 'discovered', services: summaries, failures });
    return { services: summaries, failures };
  }

  async inspect(serviceId: string) {
    const service = this.services.get(serviceId);
    if (!service) return { error: 'Unknown service_id. Use one returned by discover_services.' };
    const reputation = computeReputation(await this.store.listObservations(service.id));
    return {
      ...summarize(service),
      description: service.description,
      method: service.method,
      input_schema: service.inputSchema,
      identity: service.providerEns ?? 'No ENS name claimed',
      reputation:
        reputation.status === 'scored'
          ? { score: reputation.score, sample_size: reputation.sampleSize }
          : 'Not enough data',
    };
  }

  async buy(input: { service_id: string; params_json?: string }): Promise<PurchaseResult | { outcome: 'refused'; reason: string }> {
    const service = this.services.get(input.service_id);
    if (!service) return { outcome: 'refused', reason: 'Unknown service_id. Use one returned by discover_services.' };
    if (!service.purchasable) return { outcome: 'refused', reason: 'This service cannot be paid on the networks enabled here.' };
    if (this.purchases >= MAX_PURCHASES_PER_RUN) return { outcome: 'refused', reason: 'This run has reached its purchase limit.' };
    this.purchases += 1;

    let params: Record<string, string> | undefined;
    if (input.params_json) {
      try {
        params = Object.fromEntries(Object.entries(JSON.parse(input.params_json)).map(([key, value]) => [key, String(value)]));
      } catch {
        return { outcome: 'refused', reason: 'params_json is not valid JSON.' };
      }
    }

    this.emit({ type: 'selected', service: summarize(service) });
    const context: PurchaseContext = {
      store: this.store,
      userId: this.userId,
      agentId: this.agentId,
      taskId: this.taskId,
      taskBudgetMicros: this.taskBudgetMicros,
      emit: this.emit,
    };
    const result = await purchase(context, { service, params });
    if (result.outcome === 'needs_approval') {
      const { approval } = result;
      this.emit({
        type: 'approval_required',
        approvalId: approval.id,
        service: approval.serviceName,
        amount: formatUsd(approval.amountMicros),
        reason: approval.reason,
      });
    }
    if (result.outcome === 'delivered') this.emit({ type: 'data', service: service.name, data: result.data });
    return result;
  }
}
