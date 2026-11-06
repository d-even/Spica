import { connection, NextResponse } from 'next/server';
import { readApiKey } from '@/server/api-keys';
import { localServices } from '@/server/discovery/catalog';
import { apiError } from '@/server/http/api';
import { allowRequest } from '@/server/http/rate-limit';
import { purchase } from '@/server/purchase';
import { getStore } from '@/server/store';

const isJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * The API a developer calls from their own code. The key replaces a wallet: each
 * call runs the same x402 purchase as the agent, on the agent's wallet, under the
 * owner's Spending Firewall and the budget signed into the key.
 */
export async function GET(request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  await connection();
  const { serviceId } = await params;
  const key = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const grant = key ? readApiKey(key) : null;
  if (!grant) return apiError('Send a valid API key as "Authorization: Bearer <key>".', 401);
  if (grant.serviceId !== serviceId) return apiError('This key is for a different API.', 403);
  if (!allowRequest(`api-key:${grant.taskId}`, 60, 60_000)) return apiError('Too many requests. Try again shortly.', 429);

  try {
    const service = (await localServices()).find((item) => item.id === serviceId);
    if (!service?.purchasable) return apiError('This API is not available right now.', 404);

    const result = await purchase(
      {
        store: getStore(),
        userId: grant.userId,
        agentId: grant.agentId,
        taskId: grant.taskId,
        taskBudgetMicros: grant.budgetMicros === undefined ? undefined : BigInt(grant.budgetMicros),
        preferredNetwork: grant.network,
        emit: () => {},
      },
      { service, params: Object.fromEntries(new URL(request.url).searchParams), repeatable: true },
    );

    switch (result.outcome) {
      case 'delivered':
        return new Response(result.data, {
          headers: {
            'content-type': isJson(result.data) ? 'application/json' : 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            ...(result.transaction ? { 'X-PayGate-Receipt': result.transaction.id, 'X-PayGate-Payment': result.transaction.status } : {}),
          },
        });
      case 'denied':
        return NextResponse.json({ error: result.reason, code: result.code }, { status: 402 });
      case 'needs_approval':
        return NextResponse.json({ error: result.approval.reason, code: 'needs_approval' }, { status: 403 });
      default:
        return apiError(result.reason, 502);
    }
  } catch (error) {
    console.error('Developer API failed:', error);
    return apiError('This API is temporarily unavailable.', 503);
  }
}
