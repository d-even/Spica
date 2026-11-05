import { z } from 'zod';
import { apiError, authed, toJson } from '@/server/http/api';
import { purchase, type PurchaseEvent } from '@/server/purchase';
import { getStore } from '@/server/store';

const body = z.object({ decision: z.enum(['approved', 'rejected']) });

/**
 * A person's decision on a held payment. The agent has no route to this: it
 * needs a signed-in session, and the decision is one-way and single-use.
 * Approval waives the threshold for this exact quote. The firewall's hard limits
 * run again, and a changed quote is sent back for a fresh approval.
 */
export const POST = authed(async (user, request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { decision } = body.parse(await request.json());
  const store = getStore();

  const approval = await store.decideApproval(user.id, id, decision);
  if (!approval) return apiError('This approval was already decided or has expired.', 409);
  await store.appendActivity({
    userId: user.id,
    transactionId: null,
    eventType: `approval_${decision}`,
    eventData: { service: approval.serviceName },
  });
  if (decision === 'rejected') return toJson({ outcome: 'rejected' });

  const { service, params: serviceParams, taskBudgetMicros } = approval.request;
  const events: PurchaseEvent[] = [];
  const result = await purchase(
    {
      store,
      userId: user.id,
      agentId: await store.ensureAgent(user.id),
      taskId: approval.taskId,
      taskBudgetMicros: taskBudgetMicros === undefined ? undefined : BigInt(taskBudgetMicros),
      emit: (event) => events.push(event),
    },
    { service, params: serviceParams, approval },
  );
  return toJson({ ...result, events });
});
