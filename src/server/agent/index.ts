import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { formatUsd } from '@/lib/money';
import { getStore } from '@/server/store';
import { parseTaskBudget } from './budget';
import { runClaudeAgent } from './claude';
import { runDemoAgent } from './demo';
import { AgentSession, type AgentEvent } from './session';

const friendlyError = (error: unknown) => {
  if (error instanceof Anthropic.AuthenticationError) return 'The Claude API key was rejected. Check ANTHROPIC_API_KEY.';
  if (error instanceof Anthropic.RateLimitError) return 'Claude is rate limited right now. Try again shortly.';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Try again.';
  if (error instanceof Anthropic.APIError) return `Claude returned an error (${error.status}).`;
  return 'The agent stopped because of an unexpected error.';
};

/** Runs one request, reporting progress through `emit`. Never throws. */
export async function runAgent(userId: string, message: string, emit: (event: AgentEvent) => void) {
  const store = getStore();
  const agentId = await store.ensureAgent(userId);
  const taskBudget = parseTaskBudget(message);
  if (taskBudget !== undefined) emit({ type: 'budget', amount: formatUsd(taskBudget) });

  const session = new AgentSession(store, userId, agentId, taskBudget, emit);
  await store.appendActivity({ userId, transactionId: null, eventType: 'agent_run', eventData: { taskId: session.taskId } });

  try {
    if (process.env.ANTHROPIC_API_KEY) await runClaudeAgent(session, message);
    else await runDemoAgent(session, message);
  } catch (error) {
    console.error('Agent run failed:', error);
    emit({ type: 'error', message: friendlyError(error) });
  }
}
