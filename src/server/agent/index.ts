import 'server-only';

import { ApiError } from '@google/genai';
import { formatUsd } from '@/lib/money';
import { getStore } from '@/server/store';
import { parseTaskBudget } from './budget';
import { runGeminiAgent } from './claude';
import { runDemoAgent } from './demo';
import { AgentSession, type AgentEvent } from './session';

const friendlyError = (error: unknown) => {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403 || error.message.includes('API_KEY_INVALID')) {
      return 'The Gemini API key was rejected. Check GEMINI_API_KEY.';
    }
    if (error.status === 429 && error.message.includes('PerDay')) {
      return "Gemini's daily free quota is used up on every model. Try again tomorrow or enable billing on the key.";
    }
    if (error.status === 429 || error.status === 503) return 'Gemini is busy right now. Try again shortly.';
    return `Gemini returned an error (${error.status}).`;
  }
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
    if (process.env.GEMINI_API_KEY) await runGeminiAgent(session, message);
    
    else await runDemoAgent(session, message);
  } catch (error) {
    console.error('Agent run failed:', error);
    emit({ type: 'error', message: friendlyError(error) });
  }
}
