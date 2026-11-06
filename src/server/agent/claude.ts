import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { AgentSession } from './session';
import { agentTools, SYSTEM_PROMPT } from './tools';

export const AGENT_MODEL = 'claude-opus-5-5';

export async function runClaudeAgent(session: AgentSession, message: string) {
  const client = new Anthropic();
  const runner = client.beta.messages.toolRunner({
    model: AGENT_MODEL,
    max_tokens: 16_000,
    max_iterations: 10,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    tools: agentTools(session).map((tool) =>
      betaZodTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, run: tool.run }),
    ),
    messages: [{ role: 'user', content: message }],
  });
  const final = await runner.runUntilDone();

  if (final.stop_reason === 'refusal') {
    session.emit({ type: 'error', message: 'The assistant declined this request.' });
    return;
  }
  const text = final.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
  session.emit({ type: 'answer', text, source: 'claude' });
}
