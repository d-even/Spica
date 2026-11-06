import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { formatUsd } from '@/lib/money';
import { agentProvider } from '@/server/env';
import { getStore } from '@/server/store';
import { parseTaskBudget } from './budget';
import { runClaudeAgent } from './claude';
import { runDemoAgent } from './demo';
import { GeminiError, geminiModel, runGeminiAgent } from './gemini';
import { AgentSession, type AgentEvent } from './session';

const friendlyError = (error: unknown) => {
  if (error instanceof GeminiError) {
    if (error.status === 400 && /api key/i.test(error.message)) return 'The Gemini API key was rejected. Check GEMINI_API_KEY.';
    if (error.status === 403) return 'This Gemini API key is not allowed to use the model. Check the key in Google AI Studio.';
    if (error.status === 404) return `Gemini model "${geminiModel()}" was not found. Set GEMINI_MODEL to a current model.`;
    if (error.status === 429) return 'Gemini is rate limited or out of quota right now. Try again shortly.';
    return `Gemini returned an error (${error.status}): ${error.message}`;
  }
  if (error instanceof Error && error.name === 'TimeoutError') return 'The model took too long to answer. Try again.';
  if (error instanceof TypeError && /fetch failed/i.test(error.message) && agentProvider() === 'gemini') {
    return 'Could not reach Gemini. Check your internet connection and try again.';
  }
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
    const provider = agentProvider();
    if (provider === 'gemini') await runGeminiAgent(session, message);
    else if (provider === 'claude') await runClaudeAgent(session, message);
    else await runDemoAgent(session, message);
  } catch (error) {
    console.error('Agent run failed:', error);
    emit({ type: 'error', message: friendlyError(error) });
  }
}
